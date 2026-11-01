/* 雪团 js/08-bulk.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= 从照片批量加 [建议，用户 2026-10-27 要先把自己去过的全加上] =================
   * 一次选很多张照片，读照片里的拍摄地点和时间（只在手机上读，exifr），每张一组，同一个地方的自己合起来。
   * 每个地方在附近找名字：雪团里已有的 → 地点库 → Photon。打了分的才存，
   * 照片一起带上，记录日期用拍摄时间。默认不分享（一次加很多旧记录，不想一下子全公开）。
   * 很多手机把照片交给网页时会去掉经纬度：这些照片自己搜地点。 */
  var EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js';
  var BULK_NEAR = 150;
  var PHOTON_SKIP = ['highway', 'place', 'boundary', 'building', 'landuse', 'railway', 'waterway', 'power', 'route', 'junction'];
  function startBulk(files) {
    var list = Array.prototype.slice.call(files || []).filter(isMediaFile);
    if (!list.length) return;
    dropBulk();
    var b = state.bulk = { total: list.length, read: 0, items: [], groups: null, noGps: 0, share: false, saving: null, error: false, urls: [], rejected: [] };
    rememberFeedSnap();
    state.view = 'bulk'; state.form = null;
    render();
    setSnap('full');
    (window.exifr ? Promise.resolve() : loadScript(EXIFR_URL)).then(function () {
      return list.reduce(function (chain, file) {
        return chain.then(function () {
          if (state.bulk !== b) return;
          return readPhotoMeta(file, b).then(function (it) {
            if (it) b.items.push(it); b.read++;
            var el = $('#bk-progress');
            if (el) el.textContent = t('bulkReading', { n: b.read, m: b.total });
          }).catch(function (e) { b.read++; b.rejected.push(file.name + '：' + t(e && ['clipLong', 'clipBig', 'gifTooBig'].indexOf(e.message) !== -1 ? e.message : videoFile(file) ? 'clipRead' : 'photoReadFail', { n: CLIP_MAX_SEC })); });
        });
      }, Promise.resolve());
    }).then(function () {
      if (state.bulk !== b) return;
      b.groups = groupPhotos(b);
      render();
      findNames(b);
      bulkSkyGuess(b);
    }, function () {
      if (state.bulk !== b) return;
      b.error = true;
      render();
    });
  }
  /* 照片里存的小图（EXIF 缩略图）当预览，比解码整张原图省内存；小图没按拍摄方向转，自己转 */
  function readPhotoMeta(file, b) {
    if (videoFile(file) && file.size > MEDIA_MAX_BYTES) return Promise.reject(new Error('clipBig'));
    if (file.size > MEDIA_MAX_BYTES && (file.type === 'image/gif' || /\.gif$/i.test(file.name || ''))) return Promise.reject(new Error('gifTooBig'));
    if (videoFile(file)) return prepareMedia(file).then(function (media) {
      var url = URL.createObjectURL(media.thumb); b.urls.push(url);
      return { file: file, prepared: media, time: Math.min(file.lastModified || Date.now(), Date.now()), url: url, rot: 0, on: false };
    });
    var meta = window.exifr.parse(file).catch(function () { return null; });
    var thumb = window.exifr.thumbnailUrl ? window.exifr.thumbnailUrl(file).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([meta, thumb]).then(function (r) {
      var x = r[0] || {}, t0 = x.DateTimeOriginal || x.CreateDate || x.ModifyDate;
      var time = t0 instanceof Date && !isNaN(t0) ? t0.getTime() : (file.lastModified || Date.now());
      /* 没有 EXIF 小图时自己缩一张 240px 的：以前直接拿原图当预览，一次选四十多张、每张几 MB，
         手机浏览器内存不够会把页面重开，回来就全没了（用户 2026-10-28） */
      return (r[1] ? Promise.resolve(r[1]) : smallThumb(file)).then(function (url) {
        url = url || URL.createObjectURL(file);
        b.urls.push(url);
        var it = { file: file, time: Math.min(time, Date.now()), url: url, rot: r[1] ? rotOf(x.Orientation) : 0, on: false };
      if (typeof x.latitude === 'number' && typeof x.longitude === 'number' && isFinite(x.latitude) && isFinite(x.longitude) && (x.latitude || x.longitude)) {
          it.lat = x.latitude; it.lng = x.longitude;
        }
        return it;
      });
    });
  }
  document.addEventListener('error', function (e) {
    var img = e.target, button = img.closest && img.closest('.bk-preview');
    if (!button || img.tagName !== 'IMG' || img.dataset.repaired) return;
    img.dataset.repaired = '1';
    var b = state.bulk, g = b && b.groups && b.groups[+button.dataset.i], ph = g && g.photos[+button.dataset.j];
    if (!ph || videoFile(ph.file)) return;
    smallThumb(ph.file).then(function (url) {
      if (!url) { img.removeAttribute('src'); return; }
      if (state.bulk !== b) { URL.revokeObjectURL(url); return; }
      b.urls.push(url); ph.url = url; ph.rot = 0;
      if (img.isConnected) { img.style.transform = ''; img.src = url; }
    });
  }, true);
  function smallThumb(file) {
    if (!window.createImageBitmap) return Promise.resolve(null);
    return createImageBitmap(file, { resizeWidth: 240, resizeQuality: 'medium' }).then(function (bm) {
      var cv = document.createElement('canvas');
      cv.width = bm.width; cv.height = bm.height;
      cv.getContext('2d').drawImage(bm, 0, 0);
      if (bm.close) bm.close();
      return new Promise(function (resolve) { cv.toBlob(function (bl) { cv.width = cv.height = 0; resolve(bl ? URL.createObjectURL(bl) : null); }, 'image/jpeg', 0.75); });
    }).catch(function () { return null; });
  }
  function rotOf(o) {
    var s = String(o == null ? '' : o);
    return s === '6' || /rotate 90/i.test(s) ? 90 : s === '8' || /rotate 270/i.test(s) ? 270 : s === '3' || /rotate 180/i.test(s) ? 180 : 0;
  }
  /* 新拍的排前面；有位置的和没位置的各自分组，再按时间排在一起 */
  function groupPhotos(b) {
    var byTime = function (a, c) { return a.time - c.time; };
    var geo = b.items.filter(function (it) { return it.lat != null; }).sort(byTime);
    var bare = b.items.filter(function (it) { return it.lat == null; }).sort(byTime);
    b.noGps = bare.length;
    var groups = [], g = null;
    function open(it, noLoc) {
      g = { photos: [it], cands: null, pick: -1, touched: false, name: '', mode: 'food', modeSet: false, rating: null, price: null, noLoc: noLoc, q: '', found: null };
      groups.push(g);
    }
    /* 每张照片单独一组（用户 2026-10-28：自动按地点、时间分组会把不相干的照片分到一起），
       同一个地方的自己点「和上一组是同一个地方」合起来 */
    geo.forEach(function (it) { open(it, false); });
    bare.forEach(function (it) { open(it, true); });
    groups.forEach(function (g) {
      g.time = g.photos[0].time;
      g.lat = g.noLoc ? null : g.photos.reduce(function (s, p) { return s + p.lat; }, 0) / g.photos.length;
      g.lng = g.noLoc ? null : g.photos.reduce(function (s, p) { return s + p.lng; }, 0) / g.photos.length;
      g.plat = g.lat; g.plng = g.lng;
      if (g.noLoc) g.cands = [];
      g.photos.forEach(function (p, j) { p.on = j < MAX_PHOTOS; });
    });
    groups.sort(function (a, c) { return c.time - a.time; });
    groups.forEach(function (g, i) { g.i = i; });
    return groups;
  }
  /* 两个两个地找，找到一个更新一张卡片 */
  function findNames(b) {
    var queue = b.groups.filter(function (g) { return !g.noLoc; });
    function next() {
      var g = queue.shift();
      if (!g || state.bulk !== b) return;
      nearbyNames(g).catch(function () { return []; }).then(function (cands) {
        if (state.bulk !== b) return;
        if (g.touched) { next(); return; }
        g.cands = cands;
        bulkChoose(g, cands.length ? 0 : -1);
        updateBulkPlace(g); updateBulkMode(g);
        next();
      });
    }
    next(); next();
  }
  /* 按距离排；雪团里已有的地点算近 40 米（多半就是它，也免得重复建），但不会压过紧挨着的店 */
  function nearbyNames(g) {
    var c = { lat: g.lat, lng: g.lng };
    var byD = function (a, z) { return (a.place ? a.d - 40 : a.d) - (z.place ? z.d - 40 : z.d); };
    var known = store.places().filter(function (p) { return knownToMe(p) && haversine(p, c) <= BULK_NEAR; }).map(function (p) {
      return { place: p.id, name: placeTitle(p), mode: p.mode, cat: p.cat, lat: p.lat, lng: p.lng, osm: p.osm, d: haversine(p, c), been: beenThere(p) };
    });
    var jobs = [withTimeout(photonNear(c), SEARCH_TIMEOUT).catch(function () { return []; })];
    if (sbClient && sbClient.from) jobs.push(withTimeout(poiNear(c), SEARCH_TIMEOUT).catch(function () { return []; }));
    return Promise.all(jobs).then(function (r) {
      var ext = mergeResults(r[1] || [], r[0]).filter(function (x) {
        return !known.some(function (k) { return (x.osm && k.osm === x.osm) || (k.name.toLowerCase() === x.name.toLowerCase() && haversine(k, x) < BULK_NEAR); });
      });
      ext.forEach(function (x) { x.d = haversine(x, c); });
      return known.concat(ext).sort(byD).slice(0, 6);
    });
  }
  function poiNear(c) {
    var dLat = BULK_NEAR / 111320, dLng = dLat / Math.max(0.2, Math.cos(c.lat * Math.PI / 180));
    return sbClient.from('poi').select('id, name, alt_name, mode, cat, lat, lng, locality')
      .gte('lat', c.lat - dLat).lte('lat', c.lat + dLat).gte('lng', c.lng - dLng).lte('lng', c.lng + dLng).limit(80)
      .then(function (r) { if (r.error) throw r.error; return (r.data || []).map(poiRow); });
  }
  /* Photon 反查附近：路、门牌、城市这些不要，只要店和景点 */
  function photonNear(c) {
    var url = PHOTON_URL.replace(/api\/$/, 'reverse') + '?lat=' + c.lat.toFixed(5) + '&lon=' + c.lng.toFixed(5) + '&radius=' + (BULK_NEAR / 1000) + '&limit=20' + (state.lang === 'en' ? '&lang=en' : '');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('photon ' + res.status);
      return res.json();
    }).then(function (json) {
      var keep = ((json && json.features) || []).filter(function (f) { var pr = f.properties || {}; return PHOTON_SKIP.indexOf(pr.osm_key) === -1 && pr.type !== 'street'; });
      return parsePhoton({ features: keep }).filter(function (r) { return r.precision === 'exact'; });
    });
  }
  /* 以前这里用手机本地的小模型按照片猜美食/旅行，用户手机上三张照片就把页面撑崩、也没认出来（2026-10-28），去掉了。
     现在默认美食（用户 2026-10-31：奶茶被自动记到旅行，没注意很麻烦）；只有自己记过的地点，
     或附近找到的是很明确的景点（海岛、自然、古迹、玩乐活动）才自动换成旅行；不对自己点着改 */
  var BULK_TRAVEL_CATS = ['island', 'nature', 'culture', 'fun'];
  function bulkAutoMode(c, g) {
    if (c && c.place) return c.mode;
    if (g && g.sky) return 'travel';
    if (!c) return 'food';
    return c.mode === 'travel' && BULK_TRAVEL_CATS.indexOf(c.cat) !== -1 ? 'travel' : 'food';
  }
  function bulkChoose(g, k) {
    var c = k >= 0 && g.cands ? g.cands[k] : null;
    g.pick = c ? k : -1;
    if (!g.modeSet) g.mode = bulkAutoMode(c, g);
  }
  /* 不用模型的简单判断（用户 2026-11-01）：照片上面三分之一大片是平滑的天空 / 海
     （蓝、或日落那种暖色渐变），下面不是近拍的一大盘东西 → 先放旅行。只看 24×24 的小图，几乎不占内存。
     宁可漏判也别把奶茶记成旅行（用户 2026-10-31），所以条件收得很紧；点一下随时改 */
  function skyScore(px, w, h) {
    var top = Math.floor(h / 3), sky = 0, blues = 0, n = 0, rough = 0;
    for (var y = 0; y < top; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4, r = px[i], gg = px[i + 1], bb = px[i + 2];
      var mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb), v = mx / 255, sat = mx ? (mx - mn) / mx : 0;
      var blue = bb > r + 18 && bb >= gg - 8 && v > 0.35;          /* 蓝天、海 */
      var grey = sat < 0.2 && v > 0.45 && bb >= r - 6;             /* 偏冷的云 */
      var dusk = r > bb + 25 && r >= gg && v > 0.4 && sat > 0.25 && sat < 0.85; /* 日落那段暖色 */
      if (blue) blues++;
      if (blue || grey || dusk) sky++;
      if (x + 1 < w) { var j = i + 4; rough += Math.abs(r - px[j]) + Math.abs(gg - px[j + 1]) + Math.abs(bb - px[j + 2]); }
      n++;
    }
    return { blue: blues / n, sky: sky / n, rough: rough / n / 3 };
  }
  /* 一定要有不少蓝（白桌子、暖色墙、一盘橙色的菜都不算），再加上整体像天空、比较平滑 */
  function looksLikeSky(px, w, h) {
    var sc = skyScore(px, w, h);
    return sc.blue >= 0.4 && sc.sky >= 0.75 && sc.rough < 14;
  }
  window.__looksLikeSky = looksLikeSky; /* 测试用 */
  function bulkSkyGuess(b) {
    var cv = document.createElement('canvas'), W = 24, H = 24, ctx;
    cv.width = W; cv.height = H;
    try { ctx = cv.getContext('2d', { willReadFrequently: true }); } catch (e) { return; }
    if (!ctx) return;
    (b.groups || []).reduce(function (chain, g) {
      return chain.then(function () {
        var ph = g.photos[0];
        if (state.bulk !== b || !ph || !ph.url || ph.clip || g.modeSet) return;
        return new Promise(function (done) {
          var img = new Image();
          img.onload = function () {
            try {
              ctx.save(); ctx.clearRect(0, 0, W, H);
              if (ph.rot) { ctx.translate(W / 2, H / 2); ctx.rotate(ph.rot * Math.PI / 180); ctx.translate(-W / 2, -H / 2); }
              ctx.drawImage(img, 0, 0, W, H); ctx.restore();
              g.sky = looksLikeSky(ctx.getImageData(0, 0, W, H).data, W, H);
              var c = g.pick >= 0 && g.cands ? g.cands[g.pick] : null;
              if (g.sky && !g.modeSet && !g.touched && !(c && c.place) && g.mode !== 'travel') { g.mode = 'travel'; updateBulkMode(g); }
            } catch (e) { /* 读不了像素就算了 */ }
            img.src = ''; done();
          };
          img.onerror = function () { done(); };
          img.src = ph.url;
        });
      });
    }, Promise.resolve());
  }
  function bulkDate(ts) {
    var d = new Date(ts), sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(state.lang === 'en' ? 'en-MY' : 'zh-CN', sameYear ? { month: 'short', day: 'numeric', weekday: 'short' } : { year: 'numeric', month: 'short', day: 'numeric' });
  }
  /* 评论和人均放一行；人均只有美食才问（用户 2026-10-31：选填，一小块就行） */
  function bulkCommentHTML(g) {
    return '<div class="bk-note"><textarea class="input bk-comment" rows="1" data-bk-comment="' + g.i + '" maxlength="1000" placeholder="' + esc(t('review')) + '" aria-label="' + esc(t('review')) + '">' + esc(g.comment || '') + '</textarea>' +
      '<input class="input bk-price" type="number" inputmode="decimal" min="0" max="9999" step="0.5" data-bk-price="' + g.i + '" placeholder="' + esc(t('bulkPrice')) + '" aria-label="' + esc(t('priceFood')) + '" value="' + (g.price != null ? g.price : '') + '"' + (g.mode === 'food' ? '' : ' hidden') + '></div>';
  }
  function updateBulkMode(g) {
    updateBulkModeSeg(g);
    var pr = $('[data-bk-price="' + g.i + '"]');
    if (pr) pr.hidden = g.mode !== 'food';
  }
  function bulkCardHTML(g) {
    var h = '<li class="bk-card" id="bk-' + g.i + '"><div class="bk-photos">' + g.photos.map(function (p, j) {
      return '<div class="bk-ph" data-on="' + p.on + '"><button type="button" class="bk-preview" data-action="bulk-preview" data-i="' + g.i + '" data-j="' + j + '" aria-label="' + esc(t('photoPreview')) + '">' +
        '<img src="' + esc(p.url) + '" alt="" loading="lazy" decoding="async"' + (p.rot ? ' style="transform:rotate(' + p.rot + 'deg)"' : '') + '></button><button type="button" class="bk-check" data-action="bulk-ph" data-i="' + g.i + '" data-j="' + j + '" aria-label="' + esc(state.lang === 'en' ? 'Include this photo' : '是否导入这张照片') + '" aria-pressed="' + p.on + '">' + (p.on ? '✓' : '○') + '</button></div>';
    }).join('') + '</div>';
    var meta = g.noLoc ? bulkDate(g.time) + ' ' + bulkClock(g.time) + ' · ' + t('bulkPhotos', { n: g.photos.length }) + ' · ' + t('bulkNoLoc')
      : bulkDate(g.time) + ' · ' + t('bulkPhotos', { n: g.photos.length });
    h += '<div class="bk-head"><div class="bk-meta" id="bk-meta-' + g.i + '">' + esc(meta) + '</div>' + bulkModeSegHTML(g) + '</div>';
    if (g.i > 0) h += '<button type="button" class="link-btn bk-merge" data-action="bulk-merge" data-i="' + g.i + '">↑ ' + esc(t('bulkMerge')) + '</button>';
    /* 用户 2026-10-31：附近一排店名没人有耐心一个个看，只留离照片最近的那一个；不对就直接搜谷歌，
       搜的时候卡片里出一张小地图（照片在哪 + 搜到的店在哪），名字和位置两头对上再选 */
    h += '<div class="bk-place" id="bk-place-' + g.i + '">' + bulkPlaceHTML(g) + '</div>' +
      '<div class="bk-search"><div class="search-box"><img class="search-symbol" src="assets/search-pin.png" alt=""><input class="input" type="search" data-bk-q="' + g.i + '" maxlength="60" autocomplete="off" enterkeyhint="search" placeholder="' + esc(t('bulkFindPh')) + '" value="' + esc(g.q) + '"></div>' +
      '<button type="button" class="icon-btn bk-pin" data-action="bulk-map" data-i="' + g.i + '" aria-label="' + esc(t('addPinLong')) + '" title="' + esc(t('addPinLong')) + '">' + ICON.pin + '</button></div>' +
      '<div class="chips-wrap bk-known" id="bk-known-' + g.i + '">' + bulkKnownHTML(g) + '</div>' +
      '<div class="bk-map" id="bk-map-' + g.i + '"' + (bkMap.g === g && isMobile() ? '' : ' hidden') + '></div>' +
      '<div class="g-search bk-google" id="bk-google-' + g.i + '" hidden></div>' +
      '<p class="f-hint bk-need" id="bk-need-' + g.i + '"' + (bulkNeedsPlace(g) ? '' : ' hidden') + '>' + esc(t('bulkNeed')) + '</p>';
    return h + starsInputHTML('bk-rate-' + g.i, g.rating, 'bulk', 'bk-meta-' + g.i) + bulkCommentHTML(g) + '</li>';
  }
  /* 记到吃还是玩：跟着选中的店自动换（店的分类），用户点过就按用户的 */
  function bulkModeSegHTML(g) {
    return '<div class="seg bk-mode" id="bk-mode-' + g.i + '" role="group" aria-label="' + esc(t('bulkModeLabel')) + '">' + ['food', 'travel'].map(function (m) {
      return '<button type="button" data-action="bulk-mode" data-i="' + g.i + '" data-v="' + m + '" aria-pressed="' + (g.mode === m) + '">' + esc(t(m)) + '</button>';
    }).join('') + '</div>';
  }
  function updateBulkModeSeg(g) {
    var el = $('#bk-mode-' + g.i);
    if (el) el.outerHTML = bulkModeSegHTML(g);
  }
  function bulkClock(ts) {
    return new Date(ts).toLocaleTimeString(state.lang === 'en' ? 'en-MY' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  /* 没有位置的一组：自己搜店名。搜索中心用同一天里离得最近、有位置的那一组（多半在同一个城市），没有就用现在的位置 / 地图中心 */
  function bulkCenter(g) {
    if (g.lat != null && g.lng != null && isFinite(g.lat) && isFinite(g.lng)) return { lat: g.lat, lng: g.lng };
    var best = null;
    state.bulk.groups.forEach(function (o) {
      if (o === g || o.lat == null) return;
      var dt = Math.abs(o.time - g.time);
      if (dt <= 36 * 3600 * 1000 && (!best || dt < best.dt)) best = { dt: dt, c: { lat: o.lat, lng: o.lng } };
    });
    return best ? best.c : searchCenter();
  }
  /* 选中的地点：一个小牌子，再点一下取消；谷歌的店名在谷歌自己画的卡片里 */
  function bulkPlaceHTML(g) {
    var cur = g.pick >= 0 && g.cands ? g.cands[g.pick] : null;
    if (!cur) return !g.noLoc && !g.cands ? '<span class="f-hint">' + esc(t('bulkLooking')) + '</span>' : '';
    var sub = cur.been ? t('bulkBeen') : g.plat != null ? t('bulkFromPhoto', { d: fmtDist(haversine(cur, { lat: g.plat, lng: g.plng })) }) : String(cur.where || '').split(',')[0];
    return '<button type="button" class="chip" data-action="bulk-cur" data-i="' + g.i + '" aria-pressed="true">' + ICON.pin + '<b>' + esc(cur.name) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>' +
      (cur.gid ? '<div class="g-search bk-gcard" id="bk-gcard-' + g.i + '"></div>' : '');
  }
  function bulkNeedsPlace(g) { return g.rating != null && g.noLoc && g.pick < 0; }
  function updateBulkPlace(g) {
    var el = $('#bk-place-' + g.i);
    if (el) { el.innerHTML = bulkPlaceHTML(g); mountBulkGCard(g); }
    var need = $('#bk-need-' + g.i);
    if (need) need.hidden = !bulkNeedsPlace(g);
  }
  function mountBulkGCard(g) {
    var cur = g.pick >= 0 && g.cands ? g.cands[g.pick] : null, slot = $('#bk-gcard-' + g.i);
    if (cur && cur.gid && slot) mountGoogleCard(slot, cur.gid, function () { return slot.isConnected; });
  }
  function bulkCurToggle(i) {
    var g = state.bulk && state.bulk.groups && state.bulk.groups[i];
    if (!g || state.bulk.saving) return;
    g.touched = true;
    g.cands = []; g.pick = -1;
    if (g.plat != null) { g.lat = g.plat; g.lng = g.plng; } else { g.lat = g.lng = null; g.noLoc = true; }
    if (!g.modeSet) { g.mode = 'food'; updateBulkMode(g); }
    updateBulkPlace(g); updateBulkSave(); bulkMapDraw(g);
  }
  /* 搜的词对上自己记过的地点：排在谷歌结果前面（免得同一家又建一个），最多 3 个 */
  function bulkKnown(g) {
    var key = (g.q || '').trim().toLowerCase(), c = bulkCenter(g);
    if (key.length < 2) return [];
    return store.places().filter(function (p) {
      return knownToMe(p) && ((p.name || '').toLowerCase().indexOf(key) !== -1 || (p.altName || '').toLowerCase().indexOf(key) !== -1);
    }).map(function (p) {
      return { place: p.id, name: placeTitle(p), mode: p.mode, cat: p.cat, lat: p.lat, lng: p.lng, osm: p.osm, been: beenThere(p), where: placeSub(p) || '' };
    }).sort(function (a, z) { return haversine(a, c) - haversine(z, c); }).slice(0, 3);
  }
  function bulkKnownHTML(g) {
    g.known = bulkKnown(g);
    return g.known.map(function (r, k) {
      return '<button type="button" class="chip" data-action="bulk-known" data-i="' + g.i + '" data-k="' + k + '"><b>' + esc(r.name) + '</b><small>' + esc(r.been ? t('bulkBeen') : String(r.where || '').split(',')[0]) + '</small></button>';
    }).join('');
  }
  function bulkTake(g, r) {
    g.cands = [r]; g.pick = 0; g.lat = r.lat; g.lng = r.lng; g.name = r.name; g.noLoc = false; g.touched = true;
    if (!g.modeSet) g.mode = r.place ? r.mode : g.mode;
    g.q = ''; g.gplaces = null; g.showMap = true;
    var input = $('[data-bk-q="' + g.i + '"]'); if (input) { input.value = ''; input.blur(); }
    var box = $('#bk-google-' + g.i); if (box) box.hidden = true;
    var kn = $('#bk-known-' + g.i); if (kn) kn.innerHTML = '';
    updateBulkPlace(g); updateBulkMode(g); updateBulkSave(); bulkMapUpdate(g);
  }
  function bulkKnownPick(i, k) {
    var g = state.bulk && state.bulk.groups && state.bulk.groups[i], r = g && g.known && g.known[k];
    if (r && !state.bulk.saving) bulkTake(g, r);
  }
  /* 地点只问谷歌（用户 2026-10-31：直接连谷歌搜索），搜的时候以照片位置为中心 */
  function queueBulkGoogle(g) {
    var b = state.bulk, box = $('#bk-google-' + g.i);
    var kn = $('#bk-known-' + g.i); if (kn) kn.innerHTML = bulkKnownHTML(g);
    g.gplaces = null;
    bulkMapUpdate(g);
    queueGoogleBox(box, {
      query: function () { return state.bulk === b && b.groups.indexOf(g) !== -1 ? g.q || '' : ''; },
      center: function () { return bulkCenter(g); },
      loaded: function (places) {
        if (state.bulk !== b) return;
        g.gplaces = places.map(function (pl) { return googleResult(pl, ''); }).filter(Boolean);
        if (bkMap.g === g) bulkMapDraw(g);
      },
      pick: function (r) {
        if (!r || state.bulk !== b || b.saving || b.groups.indexOf(g) === -1) return;
        r.mode = g.mode;
        var p = store.places().find(function (p) { return p.osm === r.osm && p.mode === r.mode; });
        if (p) { r.place = p.id; r.name = placeTitle(p); r.cat = p.cat; }
        bulkTake(g, r);
        /* 谷歌说是景点就切到旅行、是餐厅就切回美食；自己点过美食/旅行就不动 */
        if (!p && /^g\//.test(r.osm || '')) fetchGoogleTypes(r.osm.slice(2)).then(function (ty) {
          var m = ty && googleTypesMode(ty);
          if (!m || g.modeSet || state.bulk !== b || g.cands[g.pick] !== r) return;
          if (g.mode !== m) { g.mode = r.mode = m; updateBulkMode(g); }
        });
      }
    });
  }

  /* 卡片里的小地图就是那张地图：手机上挪进正在搜的那张卡片（不另开一张，省内存），
     只看不点（点了会跳去地点页）。蓝点是照片拍的地方，小红点是谷歌搜到的，大红针是选中的 */
  var bkMap = { g: null, marks: [] };
  function bulkMapUpdate(g) {
    if (!map || !window.maplibregl || !maplibregl.Marker) return;
    var want = g && state.bulk && state.bulk.groups.indexOf(g) !== -1 && ((g.q || '').trim().length >= 2 || g.showMap);
    if (!want) { if (bkMap.g === g) bulkMapOff(); return; }
    if (bkMap.g && bkMap.g !== g) { var old = $('#bk-map-' + bkMap.g.i); if (old) old.hidden = true; bkMap.g.showMap = false; }
    bkMap.g = g;
    /* 电脑上地图本来就在旁边，不用挪，只在大地图上标出来 */
    var slot = isMobile() ? $('#bk-map-' + g.i) : null;
    if (slot) { slot.hidden = false; if (mapEl.parentNode !== slot) { slot.appendChild(mapEl); map.resize(); } }
    bulkMapDraw(g);
  }
  function bulkMapClear() {
    bkMap.marks.forEach(function (m) { m.remove(); });
    bkMap.marks = [];
  }
  function bulkMapOff() {
    var g = bkMap.g;
    bkMap.g = null;
    bulkMapClear();
    if (g) { g.showMap = false; var s = $('#bk-map-' + g.i); if (s) s.hidden = true; }
    if (mapEl.parentNode !== stage) { stage.insertBefore(mapEl, stage.firstChild); if (map) map.resize(); }
  }
  /* 整页重画前把地图挪出来，画完再挪回去 */
  function bulkMapPark() { if (mapEl.parentNode !== stage && view.contains(mapEl)) stage.insertBefore(mapEl, stage.firstChild); }
  function bulkMapDock() {
    var g = bkMap.g;
    if (!g) return;
    if (!state.bulk || state.bulk.groups.indexOf(g) === -1) { bulkMapOff(); return; }
    var slot = isMobile() ? $('#bk-map-' + g.i) : null;
    if (slot) { slot.hidden = false; if (mapEl.parentNode !== slot) { slot.appendChild(mapEl); if (map) map.resize(); } }
  }
  function bulkMark(cls, c, html) {
    var el = document.createElement('div');
    el.className = cls;
    if (html) el.innerHTML = html;
    bkMap.marks.push(new maplibregl.Marker({ element: el, anchor: cls === 'sel-pin' ? 'bottom' : 'center' }).setLngLat([c.lng, c.lat]).addTo(map));
  }
  function bulkMapDraw(g) {
    if (!map || bkMap.g !== g || !maplibregl.Marker) return;
    bulkMapClear();
    var pts = [], cur = g.pick >= 0 && g.cands ? g.cands[g.pick] : null;
    if (g.plat != null) { bulkMark('bk-mk-photo', { lat: g.plat, lng: g.plng }); pts.push({ lat: g.plat, lng: g.plng }); }
    (g.gplaces || []).forEach(function (r) {
      if (cur && cur.osm === r.osm) return;
      bulkMark('bk-mk-res', r); pts.push(r);
    });
    if (cur) { bulkMark('sel-pin', cur, SEL_PIN_SVG); pts.push(cur); }
    if (!pts.length) pts.push(bulkCenter(g));
    if (pts.length === 1 || !map.fitBounds) { map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: 16 }); return; }
    var w = Math.min.apply(null, pts.map(function (p) { return p.lng; })), e = Math.max.apply(null, pts.map(function (p) { return p.lng; }));
    var s = Math.min.apply(null, pts.map(function (p) { return p.lat; })), n = Math.max.apply(null, pts.map(function (p) { return p.lat; }));
    map.fitBounds([[w, s], [e, n]], { padding: 30, maxZoom: 17, duration: 0 });
  }
  /* 和上一组是同一个地方（用户 2026-10-28）：照片并到上一组，地点、评分只填一次。
     上一组没填的，用这一组填过的补上 */
  function bulkMerge(i) {
    var b = state.bulk, gs = b && b.groups;
    if (!gs || b.saving || i <= 0 || !gs[i]) return;
    var top = gs[i - 1], cur = gs[i];
    var onTop = top.photos.filter(function (p) { return p.on; }).length;
    cur.photos.forEach(function (p) { p.on = p.on && onTop < MAX_PHOTOS; if (p.on) onTop++; });
    top.photos = top.photos.concat(cur.photos);
    if (top.rating == null && cur.rating != null) top.rating = cur.rating;
    if (cur.comment) top.comment = [top.comment, cur.comment].filter(Boolean).join('\n').slice(0, 1000);
    top.time = Math.min(top.time, cur.time);
    if (top.noLoc && !cur.noLoc) { top.noLoc = false; top.lat = cur.lat; top.lng = cur.lng; top.cands = cur.cands; top.pick = cur.pick; top.name = top.name || cur.name; }
    else if (top.pick < 0 && cur.pick >= 0) { top.cands = cur.cands; top.pick = cur.pick; top.found = cur.found; top.q = cur.q; }
    if (!top.name && cur.name) top.name = cur.name;
    if (!top.modeSet && cur.modeSet) { top.mode = cur.mode; top.modeSet = true; }
    gs.splice(i, 1);
    gs.forEach(function (g, k) { g.i = k; });
    var y = view.scrollTop;
    renderBulk();
    view.scrollTop = y;
    var el = $('#bk-' + top.i);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function bulkReady(g) { return g.rating != null && (!g.noLoc || g.pick >= 0); }
  function renderBulk() {
    var b = state.bulk;
    if (!b) { goFeed(); return; }
    var h = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(t('bulkTitle')) + '</h2>' +
      (b.groups && b.groups.length ? '<button type="button" class="btn primary small" id="bk-save" data-action="bulk-save"></button>' : '') + '</div>';
    if (b.rejected && b.rejected.length) h += '<p class="f-hint" role="status">' + b.rejected.slice(0, 4).map(esc).join('<br>') + '</p>';
    if (b.error) h += '<p class="empty small">' + esc(t('bulkLoadFail')) + '</p>';
    else if (!b.groups) h += '<p class="empty small" id="bk-progress">' + esc(t('bulkReading', { n: b.read, m: b.total })) + '</p>';
    else if (!b.groups.length) h += '<p class="empty small">' + esc(b.rejected && b.rejected.length ? (state.lang === 'en' ? 'No files were imported. See the reasons above.' : '没有成功导入的文件，请查看上方原因。') : t('bulkNone')) + '</p>';
    else {
      h += '<p class="f-hint bk-sum">' + esc(t('bulkSum', { n: b.total, g: b.groups.length })) + (b.noGps ? ' ' + esc(t('bulkNoGps', { n: b.noGps })) : '') + '</p>';
      if (b.noGps) h += '<div class="bk-tip"><p>' + esc(t('bulkTip')) + '</p><button type="button" class="btn ghost small" data-action="bulk-files">' + ICON.folder + esc(t('bulkFiles')) + '</button></div>';
      h += '<button type="button" class="switch-row" role="switch" data-action="bulk-share" aria-checked="' + b.share + '">' +
        '<span class="sw-text"><b>' + esc(t('shareBig')) + '</b><small>' + esc(t('shareHint')) + '</small></span><span class="switch" aria-hidden="true"></span></button>';
      if (!me().name) h += '<div class="field bk-nick" id="bk-nick-field"' + (b.share ? '' : ' hidden') + '><label class="f-label" for="bk-nick">' + esc(t('nickname')) + '</label><input id="bk-nick" class="input" maxlength="20" autocomplete="nickname" placeholder="' + esc(t('nicknamePh')) + '"></div>';
      h += '<ul class="bk-list">' + b.groups.map(bulkCardHTML).join('') + '</ul>';
    }
    bulkMapPark();
    view.innerHTML = h;
    updateBulkSave();
    bulkMapDock();
    if (b.groups) b.groups.forEach(mountBulkGCard);
  }
  function updateBulkSave() {
    var b = state.bulk, btn = $('#bk-save');
    if (!b || !btn) return;
    var n = b.groups.filter(bulkReady).length;
    btn.textContent = b.saving ? t('bulkSaving', { n: b.saving.done, m: b.saving.total }) : t('bulkSave', { n: n });
    btn.disabled = !n || !!b.saving;
  }
  /* 只换这一张卡片，不重画整页（列表不跳、图不闪） */
  function updateBulkCard(g) {
    var el = $('#bk-' + g.i);
    if (!el) return;
    bulkMapPark();
    el.outerHTML = bulkCardHTML(g);
    bulkMapDock();
    mountBulkGCard(g);
  }
  function bulkGroupOf(el) {
    var b = state.bulk, i = +String(el.id).replace('bk-rate-', '');
    return b && b.groups ? b.groups[i] : null;
  }
  function bulkRate(el, v) {
    var g = bulkGroupOf(el);
    if (!g || state.bulk.saving) return;
    g.rating = v;
    var need = $('#bk-need-' + g.i); if (need) need.hidden = !bulkNeedsPlace(g);
    updateBulkSave();
  }
  function bulkTogglePhoto(i, j, el) {
    var g = state.bulk && state.bulk.groups && state.bulk.groups[i], p = g && g.photos[j];
    if (!p || state.bulk.saving) return;
    if (!p.on && g.photos.filter(function (x) { return x.on; }).length >= MAX_PHOTOS) { toast(t('bulkPhotoMax', { n: MAX_PHOTOS })); return; }
    p.on = !p.on;
    el.setAttribute('aria-pressed', String(p.on));
    el.textContent = p.on ? '✓' : '○';
    el.closest('.bk-ph').setAttribute('data-on', String(p.on));
    updateBulkSave();
  }
  function bulkSetMode(i, m) {
    var g = state.bulk && state.bulk.groups && state.bulk.groups[i];
    if (!g) return;
    g.mode = m === 'travel' ? 'travel' : 'food';
    g.modeSet = true;
    updateBulkMode(g);
  }
  function leaveBulk() {
    var b = state.bulk;
    if (b && b.saving) return;
    var dirty = b && b.groups && b.groups.some(function (g) { return g.rating != null; });
    (dirty ? confirmBox(t('bulkLeaveQ'), t('bulkLeave')) : Promise.resolve(true)).then(function (ok) {
      if (!ok || state.bulk !== b) return;
      dropBulk();
      state.view = 'add';
      render();
      setSnap('full');
    });
  }
  function dropBulk() {
    var b = state.bulk;
    if (!b) return;
    b.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    bulkMapOff();
    state.bulk = null;
  }
  /* 一个一个存：地点（已有的就用已有的，这一批里选了同一家的也只建一次）→ 压缩照片 → 记录 */
  function bulkSave() {
    var b = state.bulk;
    if (!b || !b.groups || b.saving || !requireLogin(bulkSave)) return;
    var todo = b.groups.filter(bulkReady);
    if (!todo.length) return;
    var nick = $('#bk-nick');
    if (b.share && nick && nick.value.trim()) store.updateProfile({ name: nick.value.trim().slice(0, 20) });
    b.saving = { done: 0, total: todo.length, ok: 0, fail: 0 };
    updateBulkSave();
    var made = {};
    todo.reduce(function (chain, g) {
      return chain.then(function () {
        return saveBulkGroup(g, b, made).then(function () { b.saving.ok++; }, function (e) {
          if (window.console) console.warn('bulk save:', e);
          b.saving.fail++;
        }).then(function () { b.saving.done++; updateBulkSave(); });
      });
    }, Promise.resolve()).then(function () {
      var s = b.saving;
      dropBulk();
      state.tab = 'foot'; state.scope = state.mineSub = 'mine'; renderFilters(); renderTabs();
      refreshMap();
      goFeed();
      toast(t('bulkDone', { n: s.ok }));
      if (s.fail) setTimeout(function () { toast(t('bulkFailSome', { n: s.fail })); }, 2600);
    });
  }
  function saveBulkGroup(g, b, made) {
    var c = g.pick >= 0 && g.cands ? g.cands[g.pick] : null;
    /* 用户把吃 / 玩换了：不沿用那家已有的地点和分类，按用户选的另建一个 */
    var mode = g.mode, keep = !!c && c.mode === mode;
    var key = c ? (keep && c.place ? c.place : (c.osm || c.place || '')) + ':' + mode : '';
    var p0 = keep && c.place ? placeById(c.place) : key && made[key] ? placeById(made[key]) : null;
    var name = (c ? c.name : g.name.trim()) || t(mode === 'food' ? 'unnamedFood' : 'unnamedTravel');
    /* 谷歌上的店：按谷歌的店铺类型分；地点库带来的旧“日韩”按店名分 */
    var gcat = !p0 && mode === 'food' && c && !c.cat && /^g\//.test(c.osm || '') ? fetchGoogleCat(c.osm.slice(2)) : Promise.resolve(null);
    var step = p0 ? Promise.resolve(p0) : gcat.then(function (gc) { return store.addPlace({
      mode: mode, cat: gc || (keep && normCat(c.cat, c.name)) || 'other', precision: g.precision || 'exact', lat: round6(c ? c.lat : g.lat), lng: round6(c ? c.lng : g.lng),
      name: name.slice(0, 60), altName: String((c && c.alt) || '').slice(0, 60), link: '', osm: (c && c.osm) || ''
    }); });
    return step.then(function (p) {
      if (key) made[key] = p.id;
      var photos = [];
      return g.photos.filter(function (ph) { return ph.on; }).reduce(function (chain, ph) {
        return chain.then(function () {
          return (ph.prepared ? Promise.resolve(ph.prepared) : prepareMedia(ph.file)).then(function (out) {
            if (out.blob) photos.push(mediaPhoto(out));
          }, function (e) { toast(t(e && e.message === 'gifTooBig' ? 'gifTooBig' : 'photoReadFail')); });
        });
      }, Promise.resolve()).then(function () {
        return store.addReview({ placeId: p.id, rating: g.rating, price: mode === 'food' && g.price != null ? g.price : null, text: (g.comment || '').trim(), visibility: b.share ? 'public' : 'private', createdAt: g.time }, photos);
      });
    });
  }

