/* 雪团 js/07-nav-form.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= navigation ================= */
  /* 每一栏的首页在手机上怎么放：首页、我的是整页；探索只有地图，不放列表（用户 2026-10-27）；
     足迹是能拖的列表面板，回到上次拉到的高度 */
  function feedSnapNow(snap) {
    if (isMobile()) {
      if (state.tab === 'home' || state.tab === 'me') return 'page';
      if (state.tab === 'explore') return 'hidden';
    }
    snap = snap || state.feedSnap;
    return /^(peek|half|full)$/.test(snap) ? snap : 'peek';
  }
  function goFeed(snap) {
    state.posting = false;
    state.view = 'feed'; state.placeId = null; state.postId = null; state.placeBack = null; state.form = null; state.nearby = null;
    if (state.bulk && !state.bulk.saving) dropBulk();
    render();
    setSnap(feedSnapNow(snap));
    updateSelection();
  }
  /* 换一栏：地图跟着换（探索、首页看公开的，足迹看我的），回到那一栏的首页。
     再点一下当前这一栏：在子页面就回到这一栏的首页，已经在首页就滚回最上面 */
  function scopeOfTab(tab) { return tab === 'foot' ? state.mineSub : 'all'; }
  function setTab(tab) {
    if (state.form && state.form.saving) { toast(t('saveWorking')); return; }
    if (state.bsheet) closeBSheet();
    if (tab === state.tab) {
      if (state.view !== 'feed') goFeed();
      else if (view.scrollTo) view.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      renderFilters();
      return;
    }
    if (tab !== 'foot') { selectingVisits = false; selectedVisits.clear(); }
    state.tab = tab;
    state.homesOn = false;
    state.preview = null; state.homes = null;
    var scope = scopeOfTab(tab);
    if (scope !== state.scope) state.scope = scope;
    renderFilters(); refreshMap();
    goFeed();
  }
  /* 地图上的东西（地点、搜索结果、去哪儿看）在首页、我的里打开时，跳到探索去看 */
  function toMapTab() {
    if (state.tab !== 'home' && state.tab !== 'me') return;
    state.tab = 'explore';
    if (state.scope !== 'all') { state.scope = 'all'; renderFilters(); refreshMap(); }
    renderFilters();
  }
  function openPost(id) {
    if (!store.review(id)) return;
    state.view = 'post'; state.postId = id; state.placeId = null; state.placeBack = null;
    render();
    setSnap('page');
    updateSelection();
  }
  /* 帖子里点地点：去探索地图上看；返回时回到这条帖子 */
  function openPostPlace(placeId) {
    var back = { postId: state.postId, tab: state.tab };
    toMapTab();
    openPlace(placeId);
    if (state.view === 'place') state.placeBack = back;
  }
  function openPlace(id, opts) {
    opts = opts || {};
    var p = placeById(id);
    if (!p) return;
    if (p.mode !== state.mode) setMode(p.mode, { noFly: true });
    toMapTab();
    /* 只有我自己的私密记录：在足迹里看 */
    if (!scopedReviews(p.id).length && reviewsOf(p.id).some(isMine)) {
      state.tab = 'foot'; state.scope = state.mineSub = 'mine'; renderFilters(); refreshMap();
    }
    rememberFeedSnap();
    state.view = 'place'; state.placeId = id; state.form = null; state.placeBack = null;
    render();
    setSnap(opts.photo && placePhotos(p).length ? 'full' : 'half');
    updateSelection();
    if (map && opts.fly !== false) {
      var z = map.getZoom();
      var target = p.precision === 'city' ? Math.max(Math.min(z, 10), 8) : p.precision === 'area' ? Math.max(z, 13) : Math.max(z, 15.5);
      flyTo([p.lng, p.lat], target);
    } else if (map && isMobile()) {
      map.easeTo({ center: [p.lng, p.lat], padding: mapPadding(), duration: reduceMotion ? 0 : 450 });
    }
    if (opts.drop) setTimeout(function () { dropMarker(p); }, reduceMotion ? 0 : 900);
  }
  function back() {
    if (state.view === 'add' && formKeepsDraft(state.form)) { returnPostComposer(); return; }
    if (state.view === 'place' && state.placeBack) {
      var pb = state.placeBack;
      state.tab = pb.tab;
      var scope = scopeOfTab(pb.tab);
      if (scope !== state.scope) { state.scope = scope; renderFilters(); refreshMap(); }
      openPost(pb.postId);
      return;
    }
    if (state.view === 'preview') {
      var fromMap = state.preview && state.preview.fromMap;
      state.preview = null;
      if (fromMap) { goFeed(); return; }
      state.view = 'search'; render(); setSnap('full'); return;
    }
    if (state.view === 'form') formCancel();
    else if (state.view === 'bulk') leaveBulk();
    else if (state.view === 'nearby') { if (formKeepsDraft(state.form)) returnPostComposer(); else { state.form = null; goFeed(); } }
    else if (state.view === 'home') leaveHomeSet();
    else goFeed();
  }
  function formCancel() {
    var f = state.form, pid = f && f.placeId;
    if (f && f.saving) { toast(t('saveWorking')); return; }
    if (f && !f.editId) { saveFormDraft(); if (f.drafted) setTimeout(function () { toast(state.lang === 'en' ? 'Draft kept: tap + to continue' : '草稿已存，下次点加号接着写'); }, 0); }
    if (f) f.photos.forEach(releaseFormPreview);
    state.form = null; state.posting = false;
    if (pid && placeById(pid)) {
      state.view = 'place'; state.placeId = pid; render(); setSnap('half'); updateSelection();
    } else goFeed();
  }

  var TRAVEL_ZOOM = 11;
  function setMode(mode, opts) {
    opts = opts || {};
    state.homesOn = false;
    if (mode === state.mode) return;
    state.mode = mode; state.cat = 'all';
    if (mode === 'travel') { state.priceAbout = 0; state.dist = 'any'; }
    renderChrome();
    refreshMap();
    repaintAccent();
    trimBaseLabels();
    saveView();
    if (state.view === 'feed') render();
    /* 换吃 / 玩时地图基本不动（用户 2026-10-27 嫌一换就飞到地球或一下放很大）：
       玩时贴得太近就退到 TRAVEL_ZOOM（10 级用户嫌远，改 11）；吃时在看整个大洲以上，回到自己附近 */
    if (map && !opts.noFly) {
      var z = map.getZoom();
      if (mode === 'travel' && z > TRAVEL_ZOOM) map.easeTo({ zoom: TRAVEL_ZOOM, duration: reduceMotion ? 0 : 500, padding: mapPadding() });
      if (mode === 'food' && z < 5) flyTo([(state.me || XMUM).lng, (state.me || XMUM).lat], 12);
    }
  }

  function setLang(lang) {
    if (lang === state.lang) return;
    if (state.view === 'form') captureFormDraft();
    state.lang = lang;
    saveView();
    applyStaticI18n();
    renderChrome();
    render();
    refreshMap();
    patchLabels();
  }

  /* ================= pick a location ================= */
  var NEAR_RADIUS = { exact: 60, area: 800, city: 15000 };
  function defaultPrecision(z) {
    if (state.mode === 'food') return 'exact';
    return z >= 14 ? 'exact' : z >= 9 ? 'area' : 'city';
  }
  function pickLngLat() {
    var c = map.getContainer();
    var ll = map.unproject([c.clientWidth / 2, c.clientHeight / 2]);
    return { lng: round6(ll.lng), lat: round6(ll.lat) };
  }
  function startPick(ctx) {
    if (!map) { toast(t('mapFail')); return; }
    rememberFeedSnap();
    state.picking = ctx || {};
    resetPickSearch();
    document.body.classList.add('picking');
    $('#pick').hidden = false;
    if (isMobile()) setSnap('hidden');
    updatePickUI();
    syncNavGuard();
    requestAnimationFrame(function () { if (map && state.picking) { map.resize(); if (map.triggerRepaint) map.triggerRepaint(); } });
    if (state.picking.home) {
      if (map.getZoom() > 10) map.easeTo({ zoom: 9, duration: reduceMotion ? 0 : 600 });
    } else if ((state.picking.mode || state.mode) === 'food' && map.getZoom() < 15 && !state.picking.repick) {
      var c = map.getContainer();
      map.easeTo({ zoom: 16, around: map.unproject([c.clientWidth / 2, c.clientHeight / 2]), duration: reduceMotion ? 0 : 700 });
    }
  }
  function updatePickUI() {
    var home = state.picking && state.picking.home;
    var mode = state.picking && state.picking.mode || state.mode;
    var selected = state.picking && state.picking.selected;
    $('#pick-hint').textContent = selected ? (state.lang === 'en' ? 'Selected: ' : '已选：') + selected.name : t(home ? 'homePickHint' : mode === 'food' ? 'pickHintFood' : 'pickHintTravel') + (home ? '' : state.lang === 'en' ? ' · Or tap a business name/icon.' : ' · 也可以直接点店名或图标');
    $('[data-action="pick-confirm"]').textContent = selected ? (state.lang === 'en' ? 'Choose this place' : '选择这家') : t('confirmSpot');
    var prec = $('#pick-prec');
    if (mode === 'travel' && map && !home) {
      prec.innerHTML = esc(t('pickPrecision', { p: '§' })).replace('§', '<b>' + esc(precLabel(map.getZoom() >= 14 ? 'exact' : map.getZoom() >= 9 ? 'area' : 'city')) + '</b>');
      prec.hidden = false;
    } else prec.hidden = true;
  }
  /* 地图选点上面的搜索（用户 2026-11-01）：搜城市、街区、路名，地图飞过去，针还是自己挪。
     用 Photon（免费），离地图中心近的排前面；不直接选点 */
  var pickQ = { timer: 0, seq: 0, results: [] };
  function pickZoom(r) { return r.precision === 'city' ? 12 : r.precision === 'area' ? 14.5 : 16.5; }
  function renderPickResults(status) {
    var box = $('#pick-results');
    if (!box) return;
    var en = state.lang === 'en';
    if (status === 'idle') { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (status === 'loading' && !pickQ.results.length) { box.innerHTML = '<li class="muted">' + esc(en ? 'Searching…' : '搜索中…') + '</li>'; return; }
    if (!pickQ.results.length) { box.innerHTML = '<li class="muted">' + esc(status === 'fail' ? (en ? 'Search failed, try again' : '搜索失败，再试一次') : (en ? 'Nothing found' : '没找到')) + '</li>'; return; }
    box.innerHTML = pickQ.results.map(function (r, k) {
      return '<li><button type="button" data-action="pick-go" data-k="' + k + '"><b>' + esc(r.name) + '</b>' + (r.where ? '<small>' + esc(r.where) + '</small>' : '') + '</button></li>';
    }).join('');
  }
  function queuePickSearch(q) {
    clearTimeout(pickQ.timer);
    var seq = ++pickQ.seq;
    q = (q || '').trim();
    if (q.length < 2) { pickQ.results = []; renderPickResults('idle'); return; }
    renderPickResults('loading');
    pickQ.timer = setTimeout(function () {
      var c = map ? map.getCenter() : XMUM;
      withTimeout(photonSearch(q, { lat: c.lat, lng: c.lng }), SEARCH_TIMEOUT).then(function (rs) {
        if (seq !== pickQ.seq) return;
        pickQ.results = (rs || []).slice(0, 6);
        renderPickResults('done');
      }, function () { if (seq === pickQ.seq) { pickQ.results = []; renderPickResults('fail'); } });
    }, 250);
  }
  function pickGo(k) {
    var r = pickQ.results[k];
    if (!r || !map) return;
    var q = $('#pick-q'); if (q) { q.value = r.name; q.blur(); }
    renderPickResults('idle');
    map.flyTo({ center: [r.lng, r.lat], zoom: pickZoom(r), essential: true, duration: reduceMotion ? 0 : 1100 });
  }
  function resetPickSearch() {
    clearTimeout(pickQ.timer); pickQ.seq++; pickQ.results = [];
    var q = $('#pick-q'); if (q) { q.value = ''; q.placeholder = state.lang === 'en' ? 'Search a city or area to fly there' : '搜城市、街区，地图飞过去'; }
    renderPickResults('idle');
  }
  function endPick() {
    resetPickSearch();
    state.picking = null;
    document.body.classList.remove('picking');
    $('#pick').hidden = true;
    syncNavGuard();
  }
  function cancelPick() {
    var ctx = state.picking;
    endPick();
    if (ctx && ctx.post && state.form) { returnPostComposer(); return; }
    if (ctx && ctx.bulkGroup != null && state.bulk) { state.view = 'bulk'; render(); setSnap('full'); view.scrollTop = ctx.scroll || 0; return; }
    if (ctx && ctx.repick && state.form) { state.view = 'form'; render(); setSnap('full'); return; }
    if (ctx && ctx.home) { state.view = 'home'; render(); setSnap('full'); return; }
    setSnap(state.view === 'feed' ? feedSnapNow() : state.view === 'place' ? 'half' : 'full');
  }
  function confirmPick() {
    var loc = pickLngLat(), z = map.getZoom(), ctx = state.picking || {}, selected = ctx.selected;
    if (selected) loc = {lat:selected.lat,lng:selected.lng};
    endPick();
    if ((ctx.post || ctx.repick) && state.form && (!state.form.editId || state.form.relocate) && selected) {
      if (selected.mode !== state.mode) setMode(selected.mode,{noFly:true});
      Object.assign(state.form, { placeId:selected.place || null, osm:selected.osm || '', lockedName:true, loc:loc, precision:selected.precision || 'exact', cat:normCat(selected.cat, selected.name) || null });
      state.form.draft = Object.assign({}, state.form.draft, {name:selected.name,alt:selected.alt || ''});
      returnPostComposer(); return;
    }
    if (ctx.bulkGroup != null && state.bulk && state.bulk.groups[ctx.bulkGroup]) {
      var g = state.bulk.groups[ctx.bulkGroup];
      clearTimeout(g.timer); g.seq = (g.seq || 0) + 1; g.finding = false;
      g.name = selected ? selected.name : g.name || g.q || ''; g.lat = loc.lat; g.lng = loc.lng; g.precision = selected ? selected.precision || 'exact' : g.mode === 'food' || z >= 14 ? 'exact' : z >= 9 ? 'area' : 'city';
      if (selected && !g.modeSet) g.mode = selected.mode;
      g.cands = selected ? [selected] : []; g.list = g.cands; g.pick = selected ? 0 : -1; g.noLoc = false; g.searchingPlace = false; g.touched = true;
      state.view = 'bulk'; render(); setSnap('full'); view.scrollTop = ctx.scroll || 0;
      return;
    }
    if (ctx.home) {
      toast(t('homeLookup'));
      reverseCity(loc).then(function (city) { return saveHome(city, loc); }, function () {
        toast(t('homePickFail'));
        state.view = 'home'; render(); setSnap('full');
      });
      return;
    }
    if (ctx.repick && state.form) {
      state.form.loc = loc;
      state.view = 'form'; render(); setSnap('full');
      return;
    }
    if (selected) {
      if (selected.mode !== state.mode) setMode(selected.mode,{noFly:true});
      if (selected.place) startReview(selected.place);
      else startNewPlace(loc,selected.precision || 'exact',0,Object.assign({},selected,{lockedName:true}));
      return;
    }
    if (ctx.post && state.form) {
      Object.assign(state.form, { placeId:null, osm:'', lockedName:false, loc:loc, precision:defaultPrecision(z) });
      /* 编辑时换成地图上的一个点：沿用原来的地名 */
      state.form.draft = Object.assign({},state.form.draft,{name:state.form.relocate ? state.form.origName || '' : '',alt:''});returnPostComposer();return;
    }
    startNewPlace(loc, defaultPrecision(z), z >= 14 ? 60 : z >= 10 ? 800 : 15000);
  }
  function newForm(o) {
    /* rating0：打开表单时带进来的分（地点页上直接点的星），没改过不算草稿内容 */
    return Object.assign({ post: state.posting, placeId: null, editId: null, loc: null, cat: null, precision: 'exact', rating: null, rating0: o && o.rating != null ? o.rating : null, visibility: state.posting || lsGet(LS_SHARE) === '1' ? 'public' : 'private', photos: [], draft: null, osm: '' }, o);
  }
  /* 新地点：先看附近有没有已经存在的同类地点，有就让用户先确认是不是同一个 */
  function startNewPlace(loc, precision, radius, prefill) {
    prefill = prefill || {};
    var near = store.places().filter(function (p) { return p.mode === state.mode && visibleToMe(p); })
      .map(function (p) { return { p: p, d: haversine(loc, p) }; })
      .filter(function (x) { return x.d <= radius; })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, 4);
    var postDraft = formKeepsDraft(state.form) ? state.form : null;
    var placePatch = { placeId: null, loc: loc, cat: normCat(prefill.cat, prefill.name) || null, precision: precision, osm: prefill.osm || '', lockedName: !!prefill.lockedName || (!!prefill.name && !!prefill.osm && !/^g\//.test(prefill.osm)) };
    state.form = postDraft ? Object.assign(postDraft, placePatch, { draft: Object.assign({}, postDraft.draft, { name: prefill.name || '', alt: prefill.alt || '' }) }) : newForm(Object.assign(placePatch, { rating: prefill.rating == null ? null : prefill.rating, draft: prefill.name ? { name: prefill.name, alt: prefill.alt || '' } : null }));
    if (near.length) { state.nearby = near; state.view = 'nearby'; } else state.view = 'form';
    render();
    setSnap('full');
  }
  function startReview(placeId, rating) {
    var pp = placeById(placeId) || {};
    var patch = { placeId: placeId, osm: pp.osm || '' };
    /* 发帖/编辑时换成已有地点：位置、分类跟着那个地点，不沿用之前选的点 */
    if (formKeepsDraft(state.form) && pp.id) Object.assign(patch, { loc: { lat: pp.lat, lng: pp.lng }, cat: pp.cat, precision: pp.precision });
    state.form = formKeepsDraft(state.form) ? Object.assign(state.form, patch) : newForm(Object.assign(patch, { rating: rating == null ? null : rating }));
    state.view = 'form';
    render();
    setSnap('full');
  }
  function startEdit(reviewId) {
    var r = store.review(reviewId);
    if (!r || !isMine(r)) return;
    var p = placeById(r.placeId);
    state.form = newForm({
      placeId: p.id, editId: r.id, loc: { lng: p.lng, lat: p.lat }, cat: p.cat, precision: p.precision, osm: p.osm || '',
      relocate: true, origPlaceId: p.id, origName: p.name || '',
      rating: r.rating, visibility: r.visibility,
      photos: (r.photos || []).map(function (id) { return { id: id, existing: true }; }),
      draft: { name: p.name, alt: p.altName, link: p.link, price: r.price ? String(r.price) : '', title: r.title || '', text: r.text }
    });
    state.view = 'form';
    render();
    setSnap('full');
  }

  /* ================= form actions ================= */
  function setPressed(groupSel, attr, value) {
    $$(groupSel).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset[attr] === value)); });
  }
  function showErr(id, msg) {
    var el = $('#err-' + id);
    if (el) { el.textContent = msg; el.hidden = false; }
    var input = $('#' + id);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function clearErrs() {
    $$('.f-err').forEach(function (el) { el.hidden = true; });
    $$('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
  }

  /* 动图和短视频（用户 2026-10-28：动图可以，视频 5 秒以内）。
     GIF 原样存；小视频优先保留原文件，普通添加的大文件可尝试 720p 重录。编码兼容性仍取决于浏览器，不能保证任意格式都能播放。
     都另做一张 jpg 小图，地图和列表用小图，点开才动 */
  var CLIP_MAX_SEC = 5, MEDIA_MAX_BYTES = 5 * 1024 * 1024;
  var MEDIA_TYPES = { gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
  function isClip(id) { return /\.(mp4|mov|webm)$/i.test(id || ''); }
  function isGif(id) { return /\.gif$/i.test(id || ''); }
  function mediaType(path) { var m = /\.(\w+)$/.exec(path); return (m && MEDIA_TYPES[m[1].toLowerCase()]) || 'image/jpeg'; }
  function extOf(type) {
    type = String(type || '').split(';')[0];
    for (var k in MEDIA_TYPES) if (MEDIA_TYPES[k] === type) return k;
    return '';
  }
  function isMediaFile(file) { return /^(image|video)\//.test(file.type) || /\.(gif|jpe?g|png|webp|heic|heif|mp4|mov|webm)$/i.test(file.name || ''); }
  function videoFile(file) { return /^video\//.test(file.type) || /\.(mp4|mov|webm)$/i.test(file.name || ''); }
  /* 返回 { blob, thumb, ext }；ext 是 jpg / gif / mp4 / mov / webm */
  function prepareMedia(file) {
    if (videoFile(file)) {
      var ext = /\.(mp4|mov|webm)$/i.exec(file.name || '');
      return prepareClip(!extOf(file.type) && ext ? file.slice(0, file.size, MEDIA_TYPES[ext[1].toLowerCase()]) : file);
    }
    return file.slice(0, 6).arrayBuffer().then(function (head) {
      var gif = /^GIF8[79]a$/.test(String.fromCharCode.apply(null, new Uint8Array(head)));
      if (gif && file.size > MEDIA_MAX_BYTES) throw new Error('gifTooBig');
      return compressImage(file).then(function (out) {
        if (gif) return { blob: file, thumb: out.thumb, ext: 'gif' };
        out.ext = 'jpg'; return out;
      });
    });
  }
  function frameJpeg(src, w, h, maxSide) {
    var scale = Math.min(1, maxSide / Math.max(w, h)), cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    return new Promise(function (resolve) { cv.toBlob(function (b) { cv.width = cv.height = 0; resolve(b); }, 'image/jpeg', 0.8); });
  }
  function prepareClip(file) {
    var src = URL.createObjectURL(file), v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
    function waitFor(ev, ms) {
      return new Promise(function (resolve, reject) {
        var tm = setTimeout(function () { reject(new Error('clipRead')); }, ms);
        v.addEventListener(ev, function () { clearTimeout(tm); resolve(); }, { once: true });
        v.addEventListener('error', function () { clearTimeout(tm); reject(new Error('clipRead')); }, { once: true });
      });
    }
    function cleanup() { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(src); }
    var meta = waitFor('loadedmetadata', 15000);
    v.src = src;
    return meta.then(function () {
      if (!isFinite(v.duration) || v.duration <= 0) throw new Error('clipRead');
      if (v.duration > CLIP_MAX_SEC + 0.05) throw new Error('clipLong');
      /* 有的手机不播就不给画面：先跳到 0.1 秒，不行再播一下 */
      var seeked = waitFor('seeked', 4000);
      v.currentTime = Math.min(0.1, v.duration / 2);
      return seeked.catch(function () { return v.play().then(function () { v.pause(); }); });
    }).then(function () {
      return frameJpeg(v, v.videoWidth, v.videoHeight, THUMB_SIDE);
    }).then(function (thumb) {
      var originalExt = extOf(file.type);
      if (originalExt && file.size <= MEDIA_MAX_BYTES) return { blob: file, thumb: thumb, ext: originalExt };
      return reencodeClip(v).then(function (blob) {
        if (!blob) {
          var ext = extOf(file.type);
          if (ext && file.size <= MEDIA_MAX_BYTES) return { blob: file, thumb: thumb, ext: ext };
          throw new Error('clipBig');
        }
        if (blob.size > MEDIA_MAX_BYTES) throw new Error('clipBig');
        return { blob: blob, thumb: thumb, ext: extOf(blob.type) || 'webm' };
      });
    }).then(function (out) { cleanup(); return out; }, function (e) { cleanup(); throw e; });
  }
  /* 边播边画到 720p 的画布上，用 MediaRecorder 录下来；手机不支持就返回 null（原文件够小就照传） */
  function reencodeClip(v) {
    var R = window.MediaRecorder, cv = document.createElement('canvas');
    if (!R || !cv.captureStream || !v.videoWidth) return Promise.resolve(null);
    var type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].filter(function (x) { return R.isTypeSupported(x); })[0];
    if (!type) return Promise.resolve(null);
    var scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    cv.width = Math.round(v.videoWidth * scale / 2) * 2; cv.height = Math.round(v.videoHeight * scale / 2) * 2;
    var ctx = cv.getContext('2d'), stream = cv.captureStream(30), parts = [], rec;
    try { rec = new R(stream, { mimeType: type, videoBitsPerSecond: 2500000 }); } catch (e) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var raf = 0, guard;
      function stop() { cancelAnimationFrame(raf); clearTimeout(guard); v.pause(); if (rec.state !== 'inactive') rec.stop(); }
      function draw() { ctx.drawImage(v, 0, 0, cv.width, cv.height); raf = requestAnimationFrame(draw); }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        cv.width = cv.height = 0;
        resolve(parts.length ? new Blob(parts, { type: type.split(';')[0] }) : null);
      };
      v.onended = stop;
      guard = setTimeout(stop, (CLIP_MAX_SEC + 4) * 1000);
      v.currentTime = 0;
      draw();
      rec.start(250);
      v.play().catch(function () { parts = []; stop(); });
    });
  }

  /* 返回 { blob: 1280px 原图, thumb: 640px 小图 } */
  function compressImage(file) {
    function toBlob(src, maxSide, quality) {
      var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      var scale = Math.min(1, maxSide / Math.max(w, h));
      var cv = document.createElement('canvas');
      cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
      return new Promise(function (resolve, reject) { cv.toBlob(function (b) { cv.width = cv.height = 0; if (b) resolve(b); else reject(new Error('encode')); }, 'image/jpeg', quality); });
    }
    function fromImage(src) {
      return toBlob(src, 1280, 0.82).then(function (blob) {
        return toBlob(src, THUMB_SIDE, 0.8).then(function (thumb) { return { blob: blob, thumb: thumb }; });
      }).finally(function () { if (src.close) src.close(); else src.src = ''; });
    }
    function viaImg() {
      return new Promise(function (resolve, reject) {
        var img = new Image(), u = URL.createObjectURL(file);
        img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('decode')); };
        img.src = u;
      });
    }
    var bitmap = window.createImageBitmap ? createImageBitmap(file, { resizeWidth: 1280, resizeQuality: 'medium' }).catch(viaImg) : viaImg();
    return bitmap.then(fromImage);
  }

  /* 新照片：url 是点开看的（动图、视频本身），preview 是缩略图 */
  function mediaPhoto(out) {
    var ext = out.ext || 'jpg', ph = { id: uid('ph') + (ext === 'jpg' ? '' : '.' + ext), blob: out.blob, thumb: out.thumb, url: URL.createObjectURL(out.blob) };
    ph.preview = out.thumb ? URL.createObjectURL(out.thumb) : ph.url;
    return ph;
  }
  function releaseFormPreview(ph) {
    if (ph.existing) return;
    if (ph.preview && ph.preview !== ph.url) URL.revokeObjectURL(ph.preview);
    if (!ph.uploadedPath && !store.hasPhotoURL(ph.id)) URL.revokeObjectURL(ph.url);
  }
  /* 发帖也读照片的拍摄时间（用户 2026-11-01）：记录的日期用最早那张照片拍的时间，
     首页按这个时间推，几年前的照片不会被当成新动态。读不到就用保存的时间 */
  function formTakenAt(f, file) {
    (window.exifr ? Promise.resolve() : loadScript(EXIFR_URL)).then(function () {
      return window.exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    }).then(function (x) {
      var t0 = x && (x.DateTimeOriginal || x.CreateDate), ts = t0 instanceof Date ? t0.getTime() : NaN;
      if (state.form !== f || !isFinite(ts) || ts > Date.now() || ts < Date.UTC(2000, 0, 1)) return;
      if (!f.takenAt || ts < f.takenAt) f.takenAt = ts;
    }).catch(function () {});
  }
  function addFormPhotos(files) {
    var f = state.form;
    if (!f || f.saving) return;
    var list = Array.prototype.slice.call(files || []).filter(isMediaFile).slice(0, MAX_PHOTOS - f.photos.length - (f.mediaBusy || 0));
    f.mediaBusy = (f.mediaBusy || 0) + list.length;
    renderFormPhotos();
    list.reduce(function (chain, file) {
      return chain.then(function () {
        var clip = videoFile(file);
        return prepareMedia(file).then(function (out) {
          if (!out.blob || state.form !== f) return;
          var added = mediaPhoto(out);
          f.photos.push(added);
          if (store.preupload) store.preupload([added]);
          if (!f.editId && !clip) formTakenAt(f, file);
          if (f.photos.length === 1 || !f.catGuessTried) guessCat(f, out.thumb);
        }).catch(function (e) {
          toast(t(e && (e.message === 'clipLong' || e.message === 'clipBig' || e.message === 'gifTooBig') ? e.message : clip ? 'clipRead' : 'photoReadFail', { n: CLIP_MAX_SEC }));
        }).then(function () {
          f.mediaBusy--;
          if (state.form === f) renderFormPhotos();
        });
      });
    }, Promise.resolve());
  }

  /* 分类预选（用户 2026-10-28，不接 AI 接口）：新地点、吃的、自己还没点过分类时
     1) 店名里有“寿司、拉面、奶茶”这类明确关键词 → 直接预选
     2) 加照片 → 手机本地的小模型（MobileNet，ImageNet 1000 类）认图，只认得准的几类：火锅、饮品、甜品、部分西餐
     都会在分类下面说一句，点别的随时改。优先级：自己点的 > 店名 > 照片 > 地点库带来的 > 空 */
  var NAME_CATS = [
    ['hotpot', /火锅|麻辣烫|冒菜|串串|海底捞|steamboat|hot ?pot|shabu|mala/i],
    ['bbq', /烤肉|烧烤|烤串|炭烤|五花肉|bbq|barbecue|yakiniku|samgyeopsal|korean grill/i],
    ['kr', /韩式|韩国|韩餐|部队锅|拌饭|korean|kimchi|bibimbap|tteok|bulgogi|jjigae|kimbap/i],
    ['jp', /寿司|拉面|日料|日式|日本|居酒屋|丼|乌冬|天妇罗|烧鸟|sushi|ramen|sashimi|izakaya|udon|donburi|katsu|yakitori|omakase|japanese|takoyaki|\bdon\b/i],
    ['sweet', /甜品|糖水|蛋糕|冰淇淋|雪花冰|刨冰|甜点|dessert|cake|ice ?cream|gelato|bingsu|waffle|cendol|ais kacang|patisserie|donut|doughnut/i],
    ['cafe', /奶茶|咖啡|茶饮|果茶|饮品|柠檬茶|coffee|caf[eé]|kopi(?!tiam)|boba|bubble ?tea|milk ?tea|tealive|chatime|mixue|蜜雪|starbucks|zus|luckin|瑞幸|latte|juice|smoothie/i],
    ['pretty', /漂亮饭|早午餐|brunch|bistro/i],
    ['west', /西餐|汉堡|披萨|比萨|牛排|意面|麦当劳|肯德基|burger|pizza|steak|pasta|western|mcdonald|\bkfc\b|subway|domino|grill/i],
    ['mamak', /嘛嘛|印度|mamak|roti|nasi kandar|banana leaf|biryani|thosai|tandoori|naan/i],
    ['malay', /椰浆饭|娘惹|马来|nasi lemak|nyonya|rendang|laksa|warung|ayam penyet|satay/i],
    ['street', /夜市|小摊|美食中心|pasar malam|hawker|food court/i],
    ['cn', /中餐|茶餐厅|云吞|肉骨茶|点心|饺子|小笼|面馆|bak kut teh|dim sum|dumpling|chinese/i]
  ];
  function nameCat(name) {
    for (var i = 0; i < NAME_CATS.length; i++) if (NAME_CATS[i][1].test(name || '')) return NAME_CATS[i][0];
    return null;
  }
  /* ImageNet 里和这几类对得上的标签（标签是英文，取逗号前后的名字比对） */
  var IMG_CATS = {
    hotpot: ['hot pot', 'hotpot', 'caldron', 'cauldron', 'dutch oven', 'crock pot'],
    cafe: ['espresso', 'cup', 'coffee mug', 'eggnog', 'red wine', 'beer glass', 'beer bottle', 'wine bottle', 'pop bottle', 'soda bottle', 'water bottle', 'goblet', 'cocktail shaker', 'coffeepot', 'teapot', 'water jug', 'pitcher', 'measuring cup'],
    sweet: ['ice cream', 'icecream', 'ice lolly', 'lolly', 'popsicle', 'trifle', 'chocolate sauce', 'chocolate syrup', 'waffle iron'],
    west: ['cheeseburger', 'hotdog', 'hot dog', 'pizza', 'carbonara', 'french loaf', 'bagel', 'burrito', 'meat loaf', 'meatloaf', 'potpie', 'mashed potato', 'pretzel', 'guacamole']
  };
  var IMG_MIN = 0.2;
  var DEBUG_CAT = /[?&]catdebug\b/.test(location.search);
  function imgCat(preds) {
    var sum = {};
    (preds || []).forEach(function (pr) {
      var names = String(pr.label || '').toLowerCase().split(/\s*,\s*/);
      Object.keys(IMG_CATS).forEach(function (c) {
        if (names.some(function (n) { return IMG_CATS[c].indexOf(n) !== -1; })) sum[c] = (sum[c] || 0) + (+pr.score || 0);
      });
    });
    var best = null;
    Object.keys(sum).forEach(function (c) { if (sum[c] >= IMG_MIN && (!best || sum[c] > sum[best])) best = c; });
    return best;
  }
  /* 模型第一次要下载（脚本 + 运行库 + 模型，压缩后大约 8MB，之后浏览器缓存），点“加照片”时就开始准备 */
  var TFJS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
  var IMG_MODELS = ['Xenova/mobilenet_v2_1.0_224', 'onnx-community/mobilenetv4_conv_small.e2400_r224_in1k'];
  var catModel = null;
  function loadCatModel() {
    if (window.__catClassifier) return Promise.resolve(window.__catClassifier);
    var conn = navigator.connection;
    if (conn && conn.saveData) return Promise.reject(new Error('save-data'));
    if (!catModel) {
      catModel = import(TFJS_URL).then(function (m) {
        /* 省内存：只用一个线程的 wasm，不开 WebGPU（手机上一堆照片时页面被撑崩过，用户 2026-10-28） */
        try { m.env.backends.onnx.wasm.numThreads = 1; } catch (e) { /* ignore */ }
        var tryModel = function (i) {
          if (i >= IMG_MODELS.length) throw new Error('no model');
          return m.pipeline('image-classification', IMG_MODELS[i], { dtype: 'q8', device: 'wasm' }).catch(function () { return tryModel(i + 1); });
        };
        return tryModel(0);
      });
      catModel.catch(function () { catModel = null; });
    }
    return catModel;
  }
  function catNoteFor(f) {
    if (!f || f.catSrc === 'user' || !$('#cat-guess')) return false;
    var p = f.placeId ? placeById(f.placeId) : null;
    return formHasPlaceFields(f, p) && (p ? p.mode : state.mode) === 'food';
  }
  function suggestCat(f, cat, src, extra) {
    var c = cat && CATS.food.filter(function (x) { return x.id === cat; })[0];
    if (!c || state.form !== f || !catNoteFor(f)) return;
    f.cat = c.id; f.catSrc = src;
    setPressed('[data-action="f-cat"]', 'cat', c.id);
    var row = $('#place-form .chips-wrap.one-line'), sel = row && row.querySelector('[aria-pressed="true"]');
    if (sel) row.scrollLeft += sel.getBoundingClientRect().left - row.getBoundingClientRect().left - 18;
    var el = $('#cat-guess');
    if (el) { el.textContent = t(src === 'name' ? 'catByName' : src === 'google' ? 'catByGoogle' : 'catGuessed', { c: catName(c) }) + (extra || ''); el.hidden = false; }
  }
  function onNameForCat(f, name) {
    if (!catNoteFor(f) || f.catSrc === 'google') return;
    var c = nameCat(name);
    if (c) { if (c !== f.cat || f.catSrc !== 'name') suggestCat(f, c, 'name'); }
    else if (f.catSrc === 'name') { var el = $('#cat-guess'); if (el) el.hidden = true; f.catSrc = 'name-old'; }
  }
  /* 认图小模型在用户的华为手机上会把页面撑崩（批量加三张就崩、单个加一张照片打几个字也崩，2026-10-28），
     默认关掉，只按店名关键词预选；网址加 ?catmodel 才用（测试里用假的分类器） */
  function catModelOn() { return !!window.__catClassifier || /[?&]catmodel\b/.test(location.search); }
  function guessCat(f, thumb) {
    if (!catModelOn()) return;
    var hint = $('#cat-guess');
    if (!catNoteFor(f) || f.catGuessTried || !hint || !thumb) return;
    if (f.cat && f.catSrc !== 'name-old' && f.catSrc !== 'photo') return; /* 店名或地点库已经给了分类，照片不去改 */
    f.catGuessTried = true;
    hint.textContent = t('catGuessing'); hint.hidden = false;
    var url = URL.createObjectURL(thumb);
    var end = function (preds) {
      URL.revokeObjectURL(url);
      var el = $('#cat-guess'), c = imgCat(preds);
      var dbg = DEBUG_CAT && preds ? '（' + preds.slice(0, 3).map(function (p) { return String(p.label).split(',')[0] + ' ' + Math.round(p.score * 100) + '%'; }).join('，') + '）' : '';
      if (state.form !== f || !catNoteFor(f) || (f.cat && f.catSrc !== 'name-old' && f.catSrc !== 'photo')) { if (el && state.form === f && f.catSrc !== 'name') el.hidden = true; return; }
      if (c) suggestCat(f, c, 'photo', dbg);
      else if (el) { el.textContent = dbg ? t('catNoGuess') + dbg : ''; el.hidden = !dbg; }
    };
    loadCatModel().then(function (clf) { return clf(url, { top_k: 10 }); }).then(end, function (e) {
      end(null);
      var el = $('#cat-guess');
      if (DEBUG_CAT && el && state.form === f) { el.textContent = t('catNoGuess') + '（' + String(e && e.message || e) + '）'; el.hidden = false; }
    });
  }
  function submitForm(e) {
    e.preventDefault();
    var f = state.form;
    if (!f || f.saving || f.mediaBusy) return;
    captureFormDraft();
    clearErrs();
    var d = f.draft || {};
    var p0 = f.placeId ? placeById(f.placeId) : null;
    var placeFields = formHasPlaceFields(f, p0);
    var bad = null;
    if (f.post && !(d.title || '').trim()) { toast(state.lang === 'en' ? 'Add a title' : '请写一个标题'); bad = $('#f-title'); }
    if (f.post && !f.photos.length) { toast(state.lang === 'en' ? 'Add at least one photo' : '请至少添加一张图片'); if (!bad) { $('#f-photos').scrollIntoView({ block: 'center' }); return; } }
    /* 评分选填（用户 2026-10-28）：不打分也能保存，地图上是蓝点 */
    if (bad) { bad.focus({ preventScroll: true }); centerInPanel(bad, !reduceMotion); return; }
    if (f.post && !p0 && !f.loc) { toast(state.lang === 'en' ? 'Choose a place for your footprints' : '再选一个地点，就能保存到足迹了'); $('#post-location').scrollIntoView({ block: 'center' }); return; }

    var btn = $('#f-submit');
    f.saving = true;
    if (btn) { btn.disabled = true; btn.textContent = t('saveWorking'); }
    var frozen = $$('#place-form input, #place-form textarea, #place-form button, #place-form select').filter(function (el) { return !el.disabled; });
    frozen.forEach(function (el) { el.disabled = true; });
    var status = document.createElement('p'); status.className = 'save-status'; status.setAttribute('role', 'status');
    $('#place-form').appendChild(status);
    function progress(stage, done, total) { status.textContent = stage === 'upload' ? t('saveUploading', { n: done, m: total }) : t('saveWriting'); if (btn) btn.textContent = stage === 'upload' ? (state.lang === 'en' ? 'Uploading ' : '上传 ') + done + '/' + total : t('saveWorking'); }
    progress('write');
    if (f.visibility === 'public' && (d.nick || '').trim()) store.updateProfile({ name: d.nick.trim().slice(0, 20) });
    /* 编辑记录时没有名称框：已有地点的名字、位置不动，只改分类；原地点的“更多”里的字段照常改 */
    if (f.relocate && p0) {
      var same = p0.id === f.origPlaceId;
      d = Object.assign({}, d, { name: p0.name, alt: same ? d.alt : p0.altName, link: same ? d.link : p0.link });
      f.loc = { lat: p0.lat, lng: p0.lng };
    }
    var placeData = placeFields ? {
      mode: p0 ? p0.mode : state.mode, cat: f.cat || 'other', precision: f.precision, lat: f.loc.lat, lng: f.loc.lng,
      name: ((d.name || '').trim() || (p0 && p0.name) || t((p0 ? p0.mode : state.mode) === 'food' ? 'unnamedFood' : 'unnamedTravel')).slice(0, 60), altName: (d.alt || '').trim().slice(0, 60), link: safeURL(d.link), osm: f.osm
    } : null;
    var price = parseFloat(d.price);
    var rv = {
      rating: f.rating, price: isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
      title: (d.title || '').trim().slice(0, 80) || null, text: (d.text || '').trim().slice(0, 1000), visibility: f.visibility
    };
    /* 照片是一小时以前拍的才改日期，刚拍刚发的照常用现在 */
    if (!f.editId && f.takenAt && f.takenAt < Date.now() - 3600000) rv.createdAt = f.takenAt;
    var newPhotos = f.photos.filter(function (ph) { return !ph.existing; });
    var keepPhotos = f.photos.filter(function (ph) { return ph.existing; }).map(function (ph) { return ph.id; });
    /* 照片和地点同时传，不用等地点存完再传照片 */
    if (store.preupload) store.preupload(newPhotos);
    var placeStep = !placeData ? Promise.resolve(p0) : p0 ? store.updatePlace(p0.id, placeData) : store.addPlace(placeData);
    placeStep.then(function (place) {
      /* 重试时复用刚创建成功的地点，避免重复创建。 */
      f.placeId = place.id;
      rv.placeId = place.id;
      /* 编辑时换了地点：记录搬到新地点（日期、照片都保留） */
      var save = f.editId && f.relocate && place.id !== f.origPlaceId ? store.moveReview(f.editId, place.id, rv, keepPhotos, newPhotos, progress)
        : f.editId ? store.updateReview(f.editId, rv, keepPhotos, newPhotos, progress) : store.addReview(rv, newPhotos, progress);
      return save.then(function (res) { return { place: place, res: res }; });
    }).then(function (x) {
      if (!f.editId) clearFormDraft();
      f.photos.forEach(releaseFormPreview);
      state.form = null; state.posting = false;
      var shared = x.res.review.visibility === 'public';
      if (!f.editId) {
        /* 新记录直接进足迹 */
        state.tab = 'foot'; state.scope = state.mineSub = 'mine'; renderFilters(); renderTabs();
        toast(t(shared ? 'addedShared' : 'addedMine'));
      } else {
        if (!shared && state.scope === 'all') { state.tab = 'foot'; state.scope = state.mineSub = 'mine'; renderFilters(); renderTabs(); }
        toast(t('updated'));
      }
      if (!x.res.photosOk) setTimeout(function () { toast(t('photoFail')); }, 2600);
      refreshMap();
      if (f.post) { state.tab = 'home'; state.scope = 'all'; renderFilters(); renderTabs(); goFeed(); }
      else openPlace(x.place.id, { drop: !f.editId });
    }).catch(function (e) {
      if (window.console) console.warn('save:', e);
      f.saving = false;
      frozen.forEach(function (el) { el.disabled = false; }); status.remove();
      if (btn) { btn.disabled = false; btn.textContent = t(f.editId ? 'saveEdit' : 'publish'); }
      toast(securitySaveError(e));
    });
  }

