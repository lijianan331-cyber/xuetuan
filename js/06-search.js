/* 雪团 js/06-search.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= place search [建议] =================
   * 两个来源一起搜：
   * 1. 雪团自己的地点库（Supabase 里的 poi 表，马来西亚、新加坡和日泰热门城市的 Overture 开放数据），按名字和距离排序；
   * 2. Photon（OpenStreetMap），补上城市、景点和国外的地方。
   * 同一个外部编号（ovt/… 或 node/…）算同一个地点，避免大家重复建同一家店。
   */
  var PHOTON_URL = 'https://photon.komoot.io/api/';
  /* 3. 维基百科（有坐标的词条）：像谷歌那样，搜“巴厘岛”“富士山”这种知名地方直接出来，中文名也认。
     有中文就搜中文维基，没有就搜英文维基 */
  var WIKI_TYPES = {
    country: ['city', 'city', 5], adm1st: ['city', 'city', 7], adm2nd: ['city', 'city', 9], adm3rd: ['city', 'city', 10],
    city: ['city', 'city', 10], isle: ['island', 'area', 9], mountain: ['nature', 'exact', 12], forest: ['nature', 'area', 11],
    waterbody: ['nature', 'area', 11], river: ['nature', 'area', 10], glacier: ['nature', 'area', 11], pass: ['nature', 'exact', 13],
    landmark: ['culture', 'exact', 15], airport: ['other', 'exact', 13], railwaystation: ['other', 'exact', 15], edu: ['culture', 'exact', 15]
  };
  function wikiSearch(q) {
    var zh = /[\u3400-\u9fff]/.test(q);
    var url = 'https://' + (zh ? 'zh' : 'en') + '.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*' +
      '&generator=prefixsearch&gpsnamespace=0&gpslimit=8&gpssearch=' + encodeURIComponent(q) +
      '&prop=coordinates%7Cdescription&coprop=type%7Cdim&colimit=50&redirects=1' + (zh ? '&variant=zh-cn' : '');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('wiki ' + res.status);
      return res.json();
    }).then(function (json) { return parseWiki(json, zh ? 'zh' : 'en', q); });
  }
  function parseWiki(json, lang, q) {
    var pages = (json && json.query && json.query.pages) || [];
    /* 搜“巴厘岛”会跳到词条“峇里岛”：显示用户搜的那个名字，词条名放在旁边 */
    var from = {};
    ((json && json.query && json.query.redirects) || []).forEach(function (r) {
      if (r.from && r.to && r.from.toLowerCase().indexOf(q.toLowerCase()) === 0 && !from[r.to]) from[r.to] = r.from;
    });
    return pages.slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0); }).map(function (pg) {
      var co = pg.coordinates && pg.coordinates[0];
      if (!co || (co.globe && co.globe !== 'earth')) return null;
      var type = String(co.type || '').replace(/\(.*$/, '');
      if (type === 'event') return null;
      var info = WIKI_TYPES[type] || ['other', 'exact', 14];
      var zoom = info[2];
      if (co.dim) zoom = clamp(Math.round(Math.log(40000000 / co.dim) / Math.LN2) + 1, 4, 16);
      var shown = pg.title.toLowerCase().indexOf(q.toLowerCase()) !== 0 && from[pg.title] ? from[pg.title] : pg.title;
      return { osm: 'wiki/' + lang + '/' + pg.pageid, name: shown, alt: shown !== pg.title ? pg.title : '', lng: round6(co.lon), lat: round6(co.lat), mode: 'travel', cat: info[0], precision: info[1], where: pg.description || '', zoom: zoom, wiki: true };
    }).filter(Boolean).slice(0, 4);
  }
  var osm = { q: '', status: 'idle', results: [], timer: null, seq: 0 };
  function searchCenter() {
    if (state.me) return state.me;
    var c = map ? map.getCenter() : XMUM;
    return { lng: c.lng, lat: c.lat };
  }
  function poiSearch(q, c) {
    if (!sbClient || !sbClient.rpc) return Promise.reject(new Error('no poi'));
    return sbClient.rpc('search_poi', { q: q, near_lat: c.lat, near_lng: c.lng, lim: 15 }).then(function (r) {
      if (r.error) throw r.error;
      return (r.data || []).map(poiRow);
    });
  }
  function poiRow(x) {
    return { osm: 'ovt/' + x.id, name: x.name, alt: x.alt_name || '', lng: round6(x.lng), lat: round6(x.lat), mode: x.mode, cat: x.cat, precision: 'exact', where: x.locality || '' };
  }
  function photonSearch(q, c) {
    var url = PHOTON_URL + '?q=' + encodeURIComponent(q) + '&limit=8&lat=' + c.lat.toFixed(4) + '&lon=' + c.lng.toFixed(4) + (state.lang === 'en' ? '&lang=en' : '');
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('photon ' + res.status);
      return res.json();
    }).then(parsePhoton);
  }
  /* 按顺序合并；名字一样、又在 150 米内的算重复。
     维基的城市、海岛和 Photon 里 5 公里内的城市、地区算同一个（名字语言常常不一样） */
  function mergeResults() {
    var out = [];
    Array.prototype.forEach.call(arguments, function (list) {
      list.forEach(function (r) {
        var dup = out.some(function (x) {
          if (x.name.toLowerCase() === r.name.toLowerCase() && haversine(x, r) < 150) return true;
          return (x.wiki || r.wiki) && x.precision !== 'exact' && r.precision !== 'exact' && haversine(x, r) < 5000;
        });
        if (!dup) out.push(r);
      });
    });
    return out;
  }
  /* 城市 / 国家的维基坐标、OSM 边界的中心点常常落在地理中心（新加坡会落到岛中间的水库）。
     像谷歌地图那样定到市中心：同一次搜索里 Photon 给了 30 公里内的城市点（place=city/town 的点），就用它的位置 */
  function snapToTown(list, towns) {
    return list.map(function (r) {
      if (r.precision !== 'city' || r.town) return r;
      var best = null;
      towns.forEach(function (n) { var d = haversine(r, n); if (d < 30000 && (!best || d < best.d)) best = { n: n, d: d }; });
      return best ? Object.assign({}, r, { lng: best.n.lng, lat: best.n.lat }) : r;
    });
  }
  function townsIn(list) { return (list || []).filter(function (r) { return r.town; }); }
  /* 三个来源（地点库、Photon、维基）谁先回来先显示谁，慢的最多等 4 秒；搜过的词记住结果，删字再打回来不用重搜 */
  var SEARCH_TIMEOUT = 4000;
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var tm = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(tm); resolve(v); }, function (e) { clearTimeout(tm); reject(e); });
    });
  }
  var osmCache = {};
  function queueOsmSearch() {
    var q = state.query.trim(), key = q.toLowerCase();
    clearTimeout(osm.timer);
    if (key.length < 2) { osm.q = key; osm.status = 'idle'; osm.results = []; osm.seq++; return; }
    /* 知名地方排最前；正在加吃的，店铺排最前 */
    var foodFirst = state.view === 'add' && state.mode === 'food';
    var ck = key + '|' + (foodFirst ? 'food' : 'any');
    if (osm.q === key && osm.ck === ck && (osm.status === 'done' || osm.status === 'partial')) return;
    osm.q = key; osm.ck = ck;
    osm.seq++;
    if (osmCache[ck]) { osm.results = osmCache[ck]; osm.status = 'done'; return; }
    osm.status = 'loading'; osm.results = [];
    var seq = osm.seq;
    osm.timer = setTimeout(function () {
      /* 本地版没有地点库，就只问另外两个 */
      var c = searchCenter(), jobs = { photon: photonSearch(q, c), wiki: wikiSearch(q) };
      if (sbClient && sbClient.rpc) jobs.poi = poiSearch(q, c);
      var names = Object.keys(jobs), got = {}, left = names.length;
      function update() {
        if (seq !== osm.seq) return;
        var towns = townsIn(got.photon);
        var poi = got.poi || [], photon = snapToTown(got.photon || [], towns), wiki = snapToTown(got.wiki || [], towns);
        var res = foodFirst ? mergeResults(poi, photon, wiki) : mergeResults(wiki, poi, photon);
        if (!left && names.every(function (k) { return got[k] === null; })) osm.status = 'fail';
        else {
          osm.results = res;
          osm.status = left ? (res.length ? 'partial' : 'loading') : 'done';
          if (!left && names.every(function (k) { return got[k] !== null; })) osmCache[ck] = res;
        }
        renderSearchResults();
      }
      names.forEach(function (k) {
        var timedOut = false;
        withTimeout(jobs[k], SEARCH_TIMEOUT).then(function (r) { got[k] = r || []; }, function () { timedOut = true; got[k] = null; }).then(function () { left--; update(); });
        // A slow response remains useful: update only the same active query, without issuing another request.
        jobs[k].then(function (r) { if (timedOut && seq === osm.seq) { got[k] = r || []; update(); } }, function () {});
      });
    }, 200);
  }
  /* ================= 谷歌地图搜索（Places UI Kit）[建议，用户 2026-10-27 给了密钥] =================
   * 新开的小店 Overture、OSM 里常常还没有（比如 Katsu Lab Bell），谷歌有。
   * 用 Places UI Kit 的搜索列表 gmp-place-search 和地点卡片 gmp-place-details-compact：服务条款 B.15 允许配非谷歌地图；
   * 列表和卡片是谷歌自己画的，带谷歌标志，不能遮。谷歌只把地点编号和坐标交给我们，店名、评分都在它画的卡片里，
   * 所以记录时店名先填用户搜的词，用户自己改。
   * 计费是 Places UI Kit（每月 1 万次免费，之后每千次 1 美元左右）。打开搜索预热组件，打字停 0.4 秒才问，同一个词不重问，
   * 每台手机每天最多问 GOOGLE_DAILY 次。谷歌加载不了、密钥不让用（本地文件、别的网址）或次数用完，这一块显示原因，原来的搜索照常。
   * 谷歌的组件要先把请求填好再放进页面，放进去以后再改请求它不理。
   * 条款 B.15.2：谷歌给的坐标最多存 30 天，记录下来的地点以后要按编号（osm 里的 g/编号）定期更新坐标（还没做） */
  var GOOGLE_KEY = 'AIzaSyC5-uXGoj_4uAi8peKUEuBfzfsl517NeOA';
  var GOOGLE_DAILY = 60;
  var LS_GOOGLE = 'xuetuan:google-day';
  var gsearch = { loading: null, failed: false, disabled: /[?&]nogoogle\b/.test(location.search), ready: false, script: null };
  function googleStatus(box, message, retry) {
    if (!box || !box.isConnected) return;
    box.hidden = false;
    var status = box.querySelector('.g-status'), actions = box.querySelector('.g-actions');
    if (status) { status.textContent = message ? t(message) : ''; status.hidden = !message; }
    if (actions) {
      actions.hidden = !message || message === 'googleLoading' || message === 'googleSearching';
      actions.innerHTML = (retry ? '<button type="button" class="link-btn" data-action="google-retry">' + esc(t('googleRetry')) + '</button>' : '') +
        '<a href="https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(box._googleContext ? box._googleContext.query().trim() : state.query.trim()) + '" target="_blank" rel="noopener noreferrer">' + esc(t('googleOpen')) + '</a>';
      if (message && ['googleLoading','googleSearching','googleEmpty'].indexOf(message) === -1 && /MicroMessenger/i.test(navigator.userAgent)) actions.innerHTML += '<p class="f-hint">' + esc(state.lang === 'en' ? L('In WeChat, tap ··· at the top right and open this link in your browser.') : '微信内加载失败时，点右上角“···”→在浏览器中打开，再搜索。') + '</p>';
    }
  }
  function loadGoogle() {
    if (gsearch.disabled) return Promise.reject(new Error('google off'));
    if (gsearch.loading) return gsearch.loading;
    var raw = new Promise(function (resolve, reject) {
      var done = false, timeout = setTimeout(function () { finish(new Error('google timeout')); }, 20000);
      function finish(err) { if (done) return; done = true; clearTimeout(timeout); if (err) reject(err); else resolve(); }
      window.__xtGoogleReady = function () { finish(); };
      window.gm_authFailure = function () {
        gsearch.failed = 'googleAuth'; finish(new Error('google auth'));
        $$('.g-search').forEach(function (box) {
          if (box._googleContext && box._googleContext.query().trim().length >= 2) { box.dataset.q = ''; box.querySelector('.g-list').innerHTML = ''; googleStatus(box, 'googleAuth', true); }
        });
        var detail = $('#g-detail'); if (detail) detail.hidden = true;
      };
      if (window.google && google.maps && google.maps.importLibrary) { finish(); return; }
      if (gsearch.script) gsearch.script.remove();
      var el = gsearch.script = document.createElement('script');
      el.src = 'https://maps.googleapis.com/maps/api/js?key=' + GOOGLE_KEY + '&v=weekly&loading=async&libraries=places&region=MY&language=' + (state.lang === 'en' ? 'en' : 'zh-CN') + '&callback=__xtGoogleReady';
      el.async = true;
      el.onerror = function () { finish(new Error('google load')); };
      document.head.appendChild(el);
    }).then(function () {
      return google.maps.importLibrary('places');
    }).then(function (lib) {
      return new Promise(function (resolve, reject) {
        var timeout = setTimeout(function () { reject(new Error('google components timeout')); }, 20000);
        Promise.all(['gmp-place-search', 'gmp-place-text-search-request', 'gmp-place-standard-content'].map(function (name) { return customElements.whenDefined(name); })).then(function () { clearTimeout(timeout); gsearch.ready = true; resolve(lib); });
      });
    });
    var loadingTimeout;
    raw = Promise.race([raw, new Promise(function (_, reject) { loadingTimeout = setTimeout(function () { reject(new Error('google startup timeout')); }, 30000); })]).finally(function () { clearTimeout(loadingTimeout); });
    gsearch.loading = raw.catch(function (error) {
      gsearch.loading = null;
      if (!gsearch.failed) gsearch.failed = 'googleUnavailable';
      throw error;
    });
    return gsearch.loading;
  }
  function googleDay() {
    var day = new Date().toISOString().slice(0, 10), v = null;
    try { v = JSON.parse(localStorage.getItem(LS_GOOGLE) || 'null'); } catch (e) { /* ignore */ }
    return v && v.d === day ? v : { d: day, n: 0 };
  }
  function googleCount() {
    var v = googleDay(); v.n++;
    try { localStorage.setItem(LS_GOOGLE, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }
  function hideGoogle() { var box = $('#g-search'); if (box) box.hidden = true; var d = $('#g-detail'); if (d) d.hidden = true; }
  function mountGoogle() {
    var box = $('#g-search');
    if (!box) return;
    initGoogleBox(box); warmGoogle();
    queueGoogle();
  }
  function warmGoogle() {
    if (!gsearch.disabled && googleDay().n < GOOGLE_DAILY) loadGoogle().catch(function () {});
  }
  function initGoogleBox(box) {
    if (!box || box.querySelector('.g-list')) return;
    box.innerHTML = '<p class="sec-title">' + esc(t('searchGoogle')) + '</p><p class="g-status" role="status" aria-live="polite" hidden></p><div class="g-list"></div><div class="g-actions" hidden></div>';
  }
  /* 先注册组件、填好请求再挂入可见列表，错误/限额不再静默消失。 */
  function queueGoogle() {
    queueGoogleBox($('#g-search'), { query: function () { return state.query; }, center: searchCenter, pick: pickResult });
  }
  function queueGoogleBox(box, context) {
    if (!box) return;
    initGoogleBox(box); box._googleContext = context;
    var q = context.query().trim(), serial = box._googleSerial = (box._googleSerial || 0) + 1;
    clearTimeout(box._googleTimer);
    if (q.length < 2) { box.hidden = true; return; }
    if (gsearch.disabled) { googleStatus(box, 'googleOff', false); return; }
    if (box.dataset.q === q && box.dataset.state === 'ready') { box.querySelector('.g-list').hidden = false; googleStatus(box, box.dataset.n ? null : 'googleEmpty', false); return; }
    if (googleDay().n >= GOOGLE_DAILY) { box.dataset.state = ''; box.querySelector('.g-list').innerHTML = ''; googleStatus(box, 'googleLimit', false); return; }
    box.querySelector('.g-list').hidden = true;
    googleStatus(box, gsearch.ready ? 'googleSearching' : 'googleLoading', false);
    box._googleTimer = setTimeout(function () {
      if (!box.isConnected || context.query().trim() !== q || serial !== box._googleSerial) return;
      loadGoogle().then(function () {
        var slot = box.querySelector('.g-list');
        if (!slot || !box.isConnected || context.query().trim() !== q || serial !== box._googleSerial) return;
        gsearch.failed = false;
        if (googleDay().n >= GOOGLE_DAILY) { box.dataset.state = ''; slot.innerHTML = ''; googleStatus(box, 'googleLimit', false); return; }
        var c = context.center(), list = document.createElement('gmp-place-search');
        list.setAttribute('selectable', ''); list.selectable = true;
        var template = document.createElement('template'); template.setAttribute('slot', 'details-item');
        ['gmp-place-name', 'gmp-place-address', 'gmp-place-type', 'gmp-place-rating'].forEach(function (tag) { template.content.appendChild(document.createElement(tag)); });
        list.appendChild(template);
        list.appendChild(document.createElement('gmp-place-attribution'));
        var req = document.createElement('gmp-place-text-search-request');
        req.setAttribute('max-result-count', '5');
        /* 只给一个点时谷歌几乎不管远近（搜 mitto 跑到瑞士去）：给一个 50 公里的圈（谷歌允许的最大），附近的排前面，远的照样能搜到 */
        req.locationBias = { center: { lat: c.lat, lng: c.lng }, radius: 50000 }; req.textQuery = q;
        list.appendChild(req);
        var done = false, timeout;
        function current() { return box.isConnected && list.isConnected && slot.querySelector('gmp-place-search') === list && context.query().trim() === q; }
        function fail(message) {
          if (done) return; done = true; clearTimeout(timeout);
          if (!current()) return;
          box.dataset.q = ''; box.dataset.state = 'error'; slot.innerHTML = '';
          googleStatus(box, message, true);
        }
        list.addEventListener('gmp-load', function () {
          if (done) return; done = true; clearTimeout(timeout);
          if (!current()) return;
          var n = list.places ? list.places.length : 0;
          box.dataset.n = n ? String(n) : ''; box.dataset.state = 'ready';
          if (context.loaded) context.loaded(list.places || []);
          googleStatus(box, n ? null : 'googleEmpty', false);
        });
        list.addEventListener('gmp-error', function () { fail(gsearch.failed || 'googleUnavailable'); });
        list.addEventListener('gmp-select', function (e) { if (e.cancelable) e.preventDefault(); if (current()) context.pick(googleResult(e.place, q)); });
        box.dataset.q = q; box.dataset.n = ''; box.dataset.state = 'loading'; box.hidden = false;
        slot.innerHTML = ''; slot.hidden = false; slot.appendChild(list); googleCount();
        timeout = setTimeout(function () {
          if (done || !current()) return;
          box.dataset.state = 'slow';
          googleStatus(box, 'googleSlow', true);
        }, 15000);
      }).catch(function () {
        if (box.isConnected && context.query().trim() === q && serial === box._googleSerial) { box.dataset.q = ''; googleStatus(box, gsearch.failed || 'googleUnavailable', true); }
      });
    }, 400);
  }
  function retryGoogle(box) {
    if (!box || !box._googleContext) return;
    box.dataset.q = ''; box.dataset.state = ''; gsearch.failed = false;
    queueGoogleBox(box, box._googleContext);
  }
  /* 谷歌只给编号和坐标：店名先用搜的词，吃还是玩跟着现在的地图 */
  function googleResult(pl, q) {
    if (!pl || !pl.id || !pl.location) return null;
    var lat = typeof pl.location.lat === 'function' ? pl.location.lat() : pl.location.lat;
    var lng = typeof pl.location.lng === 'function' ? pl.location.lng() : pl.location.lng;
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { osm: 'g/' + pl.id, gid: pl.id, name: q, alt: '', lng: round6(lng), lat: round6(lat), mode: state.mode, cat: null, precision: 'exact', where: '', google: true };
  }
  /* 按谷歌的店铺类型分类（用户 2026-11-01）：选了谷歌上的店，就问一次它的 types（Place Details Essentials，
     每月 1 万次免费），对上日料、韩餐这些就预选。同一家店只问一次。 */
  var GOOGLE_TYPE_CATS = [
    ['hotpot', /hot_pot|shabu/], ['bbq', /barbecue|yakiniku|korean_barbecue/], ['kr', /korean/], ['jp', /japanese|sushi|ramen|izakaya|udon|tonkatsu/],
    ['cn', /chinese|dim_sum|cantonese|sichuan|hunan|taiwanese|hong_kong/], ['mamak', /indian|pakistani|mamak/], ['malay', /malaysian|indonesian|nyonya|peranakan/],
    ['sweet', /dessert|ice_cream|bakery|confectioner|donut|cake|chocolate/], ['cafe', /bubble_tea|tea_house|juice|coffee|cafe|smoothie|^bar$|wine_bar|pub/],
    ['pretty', /brunch|breakfast_restaurant/],
    ['west', /fast_food|hamburger|pizza|steak|american|italian|western|french|mexican|spanish|greek|mediterranean|sandwich/],
    ['street', /food_court|hawker|night_market|street_food/]
  ];
  function googleTypesCat(types) {
    types = (types || []).map(function (x) { return String(x).toLowerCase(); });
    for (var i = 0; i < GOOGLE_TYPE_CATS.length; i++) if (types.some(function (x) { return GOOGLE_TYPE_CATS[i][1].test(x); })) return GOOGLE_TYPE_CATS[i][0];
    return null;
  }
  window.__googleTypesCat = googleTypesCat; /* 测试用 */
  var googleTypes = new Map();
  function fetchGoogleTypes(gid) {
    if (googleTypes.has(gid)) return googleTypes.get(gid);
    var job = loadGoogle().then(function () { return google.maps.importLibrary('places'); }).then(function (lib) {
      var Place = (lib && lib.Place) || (google.maps.places && google.maps.places.Place);
      if (!Place) return null;
      var pl = new Place({ id: gid });
      return pl.fetchFields({ fields: ['types'] }).then(function () { return (pl.types || []).map(function (x) { return String(x).toLowerCase(); }); });
    }).catch(function () { googleTypes.delete(gid); return null; });
    googleTypes.set(gid, job);
    return job;
  }
  function fetchGoogleCat(gid) { return fetchGoogleTypes(gid).then(function (ty) { return ty ? googleTypesCat(ty) : null; }); }
  /* 谷歌说它是吃的还是玩的（用户 2026-11-01：批量加的海边日落被记成美食）：
     有餐厅、咖啡、酒吧这类就是美食；景点、海滩、公园、自然、博物馆、城市这类就是玩乐；都不像就不说 */
  var G_FOOD = /restaurant|^food$|food_|cafe|coffee|bakery|^bar$|_bar$|pub|meal_|tea|dessert|ice_cream|juice|diner|bistro|hawker|food_court/;
  var G_TRAVEL = /book_store|^library$|tourist_attraction|natural_feature|^park$|_park$|beach|museum|zoo|aquarium|campground|hiking|landmark|monument|island|lake|mountain|waterfall|garden|scenic|observation|marina|temple|church|mosque|shrine|castle|historical|cultural|art_gallery|^locality$|administrative_area|sublocality|neighborhood|country|colloquial_area|airport|ski|national_park/;
  function googleTypesMode(types) {
    types = (types || []).map(function (x) { return String(x).toLowerCase(); });
    if (types.some(function (x) { return G_FOOD.test(x); })) return 'food';
    if (types.some(function (x) { return G_TRAVEL.test(x); })) return 'travel';
    return null;
  }
  window.__googleTypesMode = googleTypesMode; /* 测试用 */
  /* 选到的是城市、地区（比如“尼亚加拉瀑布”市），位置是市中心，不是那个景点 */
  function googleTypesArea(types) {
    return (types || []).some(function (x) { return /^(locality|political|administrative_area_level_\d|sublocality(_level_\d)?|neighborhood|country|colloquial_area|postal_town)$/.test(x); }) &&
      !(types || []).some(function (x) { return G_FOOD.test(x) || /tourist_attraction|natural_feature|establishment|point_of_interest/.test(x); });
  }
  window.__googleTypesArea = googleTypesArea; /* 测试用 */
  function googleCatForForm(f) {
    var gid = f.osm.slice(2), p = f.placeId ? placeById(f.placeId) : null;
    if (p || f.catSrc === 'user' || f.gcatFor === gid || (state.mode !== 'food')) return;
    f.gcatFor = gid;
    fetchGoogleCat(gid).then(function (c) {
      if (!c || state.form !== f || f.osm !== 'g/' + gid || f.catSrc === 'user') return;
      if (catNoteFor(f)) suggestCat(f, c, 'google');
      else { f.cat = c; f.catSrc = 'google'; } /* 发帖没有分类那一行：悄悄记上 */
    });
  }
  /* 选到的是城市 / 地区（用户 2026-11-01：选了“尼亚加拉瀑布”，定位在市区街道上）：提醒一句 */
  function googleAreaHint(f) {
    var gid = f.osm.slice(2);
    if (f.placeId && placeById(f.placeId)) return;
    fetchGoogleTypes(gid).then(function (ty) {
      var slot = $('#g-form-detail');
      if (!ty || !googleTypesArea(ty) || state.form !== f || f.osm !== 'g/' + gid || !slot || $('#area-hint')) return;
      var hint = document.createElement('p');
      hint.className = 'f-hint area-hint'; hint.id = 'area-hint';
      hint.innerHTML = esc(state.lang === 'en' ? L('This is a whole city or area, so the pin sits at its centre. For a spot (a waterfall, a shop), search its own name or ') : '这是一个城市 / 地区，位置在它的中心。想定在具体景点（比如瀑布）就搜景点自己的名字，或') +
        '<button type="button" class="link-btn" data-action="area-repick">' + esc(state.lang === 'en' ? L('pick it on the map') : '在地图上点位置') + '</button>';
      slot.insertAdjacentElement('afterend', hint);
    });
  }
  /* 添加时直接由谷歌组件显示店名，避免把搜索词展示成店名输入框。 */
  function mountGoogleFormDetail(f) {
    var slot = $('#g-form-detail');
    if (slot) mountGoogleCard(slot, f.osm.slice(2), function () { return slot.isConnected && state.form === f; });
  }
  function mountGoogleCard(slot, gid, alive) {
    if (slot.dataset.gid === gid) return;
    slot.dataset.gid = gid;
    loadGoogle().then(function () {
      if (!alive()) return;
      var card = document.createElement('gmp-place-details-compact');
      card.setAttribute('orientation', 'horizontal');
      var req = document.createElement('gmp-place-details-place-request');
      req.place = gid;
      card.appendChild(req);
      card.appendChild(document.createElement('gmp-place-standard-content'));
      card.addEventListener('gmp-error', function () { slot.hidden = true; });
      slot.replaceChildren(card);
    }, function () { slot.hidden = true; });
  }
  /* 预览里放谷歌的地点卡片（店名、照片、评分、地址都是谷歌画的） */
  function mountGoogleDetail(r) {
    var slot = $('#g-detail');
    if (!slot) return;
    loadGoogle().then(function () {
      if (!slot.isConnected || state.preview !== r) return;
      var card = document.createElement('gmp-place-details-compact');
      card.setAttribute('orientation', 'horizontal');
      var req = document.createElement('gmp-place-details-place-request');
      req.place = r.gid;
      card.appendChild(req);
      card.appendChild(document.createElement('gmp-place-standard-content'));
      card.addEventListener('gmp-error', function () { slot.hidden = true; });
      slot.innerHTML = '';
      slot.appendChild(card);
    }, function () { slot.hidden = true; });
  }
  function parsePhoton(json) {
    var seen = {};
    return ((json && json.features) || []).map(function (f) {
      var pr = f.properties || {}, co = f.geometry && f.geometry.coordinates;
      if (!pr.name || !co || pr.osm_id == null) return null;
      var key = ({ N: 'node', W: 'way', R: 'relation' }[pr.osm_type] || pr.osm_type) + '/' + pr.osm_id;
      if (seen[key]) return null;
      seen[key] = 1;
      var g = guessFromOsm(pr);
      var where = [];
      [pr.city || pr.county, pr.state, pr.country].forEach(function (x) { if (x && where.indexOf(x) === -1 && x !== pr.name) where.push(x); });
      var town = pr.osm_type === 'N' && pr.osm_key === 'place' && ['city', 'town'].indexOf(pr.osm_value) !== -1;
      return { osm: key, name: pr.name, lng: round6(co[0]), lat: round6(co[1]), mode: g.mode, cat: g.cat, precision: g.precision, where: where.join(', '), town: town };
    }).filter(Boolean);
  }
  var OSM_FOOD = {
    amenity: ['restaurant', 'fast_food', 'cafe', 'food_court', 'bar', 'pub', 'ice_cream', 'biergarten', 'bbq'],
    shop: ['bakery', 'deli', 'coffee', 'tea', 'beverages', 'confectionery', 'pastry', 'ice_cream']
  };
  function guessFromOsm(pr) {
    var k = pr.osm_key, v = pr.osm_value, type = pr.type;
    var food = !!(OSM_FOOD[k] && OSM_FOOD[k].indexOf(v) !== -1);
    var precision = 'exact';
    if (!food) {
      if (['city', 'country', 'state', 'county'].indexOf(type) !== -1 || (k === 'place' && ['city', 'town', 'country', 'state', 'province', 'region'].indexOf(v) !== -1)) precision = 'city';
      else if (['district', 'locality'].indexOf(type) !== -1 || k === 'boundary' || (k === 'place' && ['suburb', 'neighbourhood', 'quarter', 'village', 'hamlet', 'island', 'islet'].indexOf(v) !== -1)) precision = 'area';
    }
    var cat = null;
    if (food) {
      if (['cafe', 'coffee', 'tea', 'beverages'].indexOf(v) !== -1) cat = 'cafe';
      else if (['ice_cream', 'confectionery', 'pastry', 'bakery'].indexOf(v) !== -1) cat = 'sweet';
      else if (v === 'food_court') cat = 'street';
    } else if (precision === 'city') cat = 'city';
    else if (v === 'beach' || v === 'island' || v === 'islet') cat = 'island';
    else if (k === 'natural' || ['park', 'nature_reserve', 'national_park', 'garden'].indexOf(v) !== -1 || v === 'viewpoint') cat = 'nature';
    else if (k === 'shop' && ['mall', 'department_store'].indexOf(v) !== -1) cat = 'mall';
    else if (k === 'tourism' && ['hotel', 'hostel', 'guest_house', 'motel', 'resort', 'apartment'].indexOf(v) !== -1) cat = 'stay';
    else if (['theme_park', 'zoo', 'aquarium', 'water_park', 'amusement_arcade'].indexOf(v) !== -1) cat = 'fun';
    else if (k === 'historic' || v === 'place_of_worship' || ['museum', 'attraction', 'artwork', 'gallery'].indexOf(v) !== -1) cat = 'culture';
    return { mode: food ? 'food' : 'travel', cat: cat, precision: precision };
  }
  /* 搜索结果、底图上的店是不是雪团里已经有的：外部编号一样；没有编号的按名字一样、离得很近 */
  function osmExisting(r) {
    return store.places().filter(function (p) {
      if (!knownToMe(p)) return false;
      if (r.osm) return p.osm === r.osm;
      return haversine(p, r) < 120 && (sameName(p.name, r.name) || sameName(p.name, r.alt) || sameName(p.altName, r.name));
    })[0] || null;
  }
  function osmRowHTML(r, i) {
    var mode = CATS[r.mode], c = null;
    mode.forEach(function (x) { if (x.id === r.cat) c = x; });
    c = c || mode[mode.length - 1];
    var sub = [t(r.mode), catName(c), r.where, fmtDist(haversine(searchCenter(), r))].filter(Boolean).map(esc).join(' · ');
    var cta = osmExisting(r) ? t('osmOpen') : t('osmAdd');
    return '<li><button type="button" class="near-item" data-action="osm-pick" data-i="' + i + '">' + catIconHTML(c) +
      '<span class="near-text"><b>' + esc(r.name) + (r.alt ? ' <span class="muted">' + esc(r.alt) + '</span>' : '') + '</b><small>' + sub + '</small></span><span class="near-cta">' + esc(cta) + '</span></button></li>';
  }
  /* 从“加地点”进来时，用户已经选了吃还是玩，就不按搜索结果的类型切换 */
  /* 搜索里选中一个还不在雪团的地点：先像谷歌地图那样插一根红针、显示地点卡片，
     确认要加再进表单。从“加地点”进来的直接进表单 */
  function pickOsm(i) { pickResult(osm.results[i]); }
  function pickResult(r) {
    if (!r) return;
    var existing = osmExisting(r) || (r.google && osmExisting({ name: r.name, lat: r.lat, lng: r.lng }));
    var adding = state.view === 'add';
    if (existing) {
      if (adding && existing.mode === state.mode) startReview(existing.id); else openPlace(existing.id);
      return;
    }
    if (adding && (!r.google || formKeepsDraft(state.form))) { addFromResult(r, true); return; }
    toMapTab();
    state.preview = r;
    state.view = 'preview';
    render();
    setSnap('half');
    flyTo([r.lng, r.lat], r.zoom || (r.precision === 'city' ? 10 : r.precision === 'area' ? 14 : 16.5));
  }
  function addFromResult(r, keepMode, rating) {
    if (!requireLogin(function () { addFromResult(r, keepMode, rating); })) return;
    var mode = keepMode ? state.mode : r.mode;
    if (mode !== state.mode) setMode(mode, { noFly: true });
    var precision = mode === 'food' ? 'exact' : r.precision;
    var cat = mode === r.mode ? r.cat : null;
    flyTo([r.lng, r.lat], (mode === r.mode && r.zoom) || (precision === 'city' ? 10 : precision === 'area' ? 14 : 16.5));
    startNewPlace({ lng: r.lng, lat: r.lat }, precision, NEAR_RADIUS[precision], { name: r.name, alt: r.alt, cat: cat, osm: r.osm, rating: rating });
  }
  /* 五颗星：点或拖完松手，就带着分数进表单（地图卡片、地点页都用） */
  function quickRateHTML(action, mode, hint) {
    return '<div class="field quick-rate"><span class="f-label" id="lbl-qr">' + esc(t(mode === 'food' ? 'quickRateFood' : 'quickRate')) + '</span>' +
      starsInputHTML('qr-stars', null, action, 'lbl-qr') + (hint ? '<p class="f-hint">' + esc(t('quickRateHint')) + '</p>' : '') + '</div>';
  }
  function renderPreview() {
    var r = state.preview;
    if (!r) { goFeed(); return; }
    var c = null;
    CATS[r.mode].forEach(function (x) { if (x.id === r.cat) c = x; });
    var generic = !c;
    c = c || CATS[r.mode][CATS[r.mode].length - 1];
    var coords = r.lat.toFixed(6) + ',' + r.lng.toFixed(6);
    var tags = '<span class="tag">' + catIconHTML(c) + esc(generic ? t(r.mode === 'food' ? 'poiFood' : 'poiPlace') : catName(c)) + '</span>' +
      (r.where ? '<span class="tag">' + esc(r.where) + '</span>' : '') +
      '<span class="tag">' + esc(distLabel(r)) + '</span>';
    /* 谷歌搜到的：店名、照片、评分在谷歌画的卡片里，我们只加距离 */
    var head = r.google
      ? '<div class="place-head g-head"><div class="g-detail" id="g-detail"></div><div class="tags"><span class="tag">' + esc(distLabel(r)) + '</span></div></div>'
      : '<div class="place-head"><h2>' + esc(r.name) + '</h2>' + (r.alt ? '<div class="alt">' + esc(r.alt) + '</div>' : '') + '<div class="tags">' + tags + '</div></div>';
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button></div>' +
      head + campusHoursHTML(r) +
      quickRateHTML('preview-score', r.mode, true) +
      /* 还没去过也能先收藏（想去） */
      '<div class="actions"><a class="btn" href="' + esc(mapsHref(coords, r.name)) + '" target="_blank" rel="noopener">' + ICON.nav + esc(t(APPLE ? 'navApple' : 'navGoogle')) + '</a>' +
      '<button type="button" class="btn save-btn" data-action="save-preview">' + ICON.star + esc(t('wish')) + '</button></div>';
    if (r.google) mountGoogleDetail(r);
  }

  /* 我的：上面是头像、昵称、来自哪、去过 / 想去 / 分享几个，下面是原来“我”里的资料和设置 */
  function onMeRoot() { return state.view === 'feed' && state.tab === 'me'; }
  /* “我的”右上角的语言按钮（用户 2026-11-03：不只中英，和首页一样点开选 中文 / English / Қазақша / Bahasa Indonesia） */
  function meLangHTML() {
    return '<button type="button" class="me-lang" data-action="lang-menu" aria-label="Language / 语言">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>' +
      '<span>' + esc(trLangShort()) + '</span></button>';
  }
  /* 账号一行放在头像下面（用户 2026-11-03）：没登录 = 登录；游客 = 绑定谷歌；登录了 = 打码的邮箱 + 退出 */
  function maskEmail(e) {
    var m = /^([^@]{0,2})[^@]*(@.*)$/.exec(e || '');
    return m ? m[1] + '***' + m[2] : (e || '');
  }
  function meAccountHTML() {
    if (store.mode !== 'remote') return '';
    var en = state.lang === 'en';
    if (!store.signedIn()) return '<div class="me-account"><span>' + esc(en ? L('Log in to keep your records on any device') : '登录后换手机也能找回记录') + '</span><button type="button" class="btn small primary" data-action="login">' + esc(t('login')) + '</button></div>'+authReturnGuestHTML()+authWechatHintHTML();
    if (store.isAnon()) return authGuestAccountHTML();
    var who = managedIdentity && managedIdentity.alt ? identityText('主号管理的小号', 'Managed second identity') : maskEmail(store.email());
    return '<div class="me-account account-row"><span>' + esc((en ? L('Signed in · ') : '已登录 · ') + who) + '</span><button type="button" class="btn small ghost" data-action="logout">' + esc(t('logout')) + '</button></div>'+authReturnGuestHTML();
  }
  function meHeadHTML() {
    var pf = me();
    if (!store.signedIn()) return '<div class="me-headrow"><div class="me-head">' + avatarHTML('?') + '<span class="me-id"><b class="muted">' + esc(t('meGuest')) + '</b></span></div>' + meLangHTML() + '</div>' + meAccountHTML();
    var home = store.myHome(), been = {}, shared = 0;
    store.reviews().forEach(function (r) {
      if (!isMine(r) || !placeById(r.placeId)) return;
      been[r.placeId] = 1;
      if (r.visibility === 'public') shared++;
    });
    var want = store.wishlist().filter(function (w) { return placeById(w.placeId); }).length;
    function stat(n, key, sub) {
      var inner = '<b>' + n + '</b><small>' + esc(t(key)) + '</small>';
      return sub ? '<button type="button" class="me-stat" data-action="foot-sub" data-v="' + sub + '">' + inner + '</button>' : '<div class="me-stat">' + inner + '</div>';
    }
    /* 点头像或名字：换头像、改名字（用户 2026-11-02） */
    return '<div class="me-headrow"><button type="button" class="me-head me-edit" data-action="edit-profile" aria-label="' + esc(state.lang === 'en' ? L('Edit avatar and name') : '修改头像和名字') + '">' + avatarHTML(pf.name || '?', pf.id) + '<span class="me-id"><b' + (pf.name ? '' : ' class="muted"') + ' id="me-name">' + esc(pf.name || t('meNoName')) + '<span class="me-pencil" aria-hidden="true">' + ICON.pen + '</span></b>' +
      '<small>' + esc(home ? t('fromPrefix') + home.city : t('meNoHome')) + '</small></span></button>' + meLangHTML() + '</div>' + meAccountHTML() +
      '<div class="me-stats">' + stat(Object.keys(been).length, 'meBeen', 'mine') + stat(want, 'meWant', 'saved') + stat(shared, 'meShared') + '</div>';
  }
  function renderMe() {
    var pf = me();
    var accountOpen = !!($('.account-details') && $('.account-details').open), dataOpen = !!($('.data-details') && $('.data-details').open), adminOpen = !!($('.admin-details') && $('.admin-details').open);
    var areas = store.areas(), remote = store.mode === 'remote', signedIn = store.signedIn();
    /* 以前这里有“来自哪”四个输入框，没什么用，去掉了（以后改成在玩乐地图上设“我的家”） */
    var personal = !signedIn ? '' : '<div class="me-lines">' + homeFieldHTML() + pageFieldHTML() + '</div>';
    var dataButtons = remote
      ? (signedIn ? '<button type="button" class="btn small" data-action="export">' + esc(t('exportData')) + '</button>' +
          '<button type="button" class="btn small" data-action="import">' + esc(t('importData')) + '</button>' +
          (hasLegacyData() ? '<button type="button" class="btn small" data-action="upload-local">' + esc(t('uploadLocal')) + '</button>' : '') : '')
      : '<button type="button" class="btn small" data-action="export">' + esc(t('exportData')) + '</button>' +
        '<button type="button" class="btn small" data-action="import">' + esc(t('importData')) + '</button>' +
        (store.hasSamples() ? '<button type="button" class="btn small ghost" data-action="clear-samples">' + esc(t('clearSamples')) + '</button>' : '');
    var en = state.lang === 'en';
    function menu(icon,title,sub,action,href){return '<'+(href?'a href="'+href+'"':'button type="button" data-action="'+action+'"')+' class="me-menu-row">'+icon+'<span><b>'+esc(title)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</span><i aria-hidden="true">›</i></'+(href?'a':'button')+'>';}
    var h = meHeadHTML() + '<div class="me-shortcuts">' +
      (remote ? menu(dmIcon,en?L('Messages'):'消息',en?L('Requests and conversations'):'私信申请与聊天','dm-open').replace('</b>','</b>'+dmBadgeHTML()) : '') +
      menu(CTRL_ICON.arrow,en?L('Share my footprints'):'分享我的足迹',en?L('Maps and memories to take with you'):'把去过的地方，做成一张地图','my-share') +
      menu(ICON.home,t('homesBtn'),publicHomeCount()?t('homesN',{n:publicHomeCount()}):'', 'homes-open').replace('me-menu-row','me-menu-row me-homes') +
'</div><div class="form me-settings">' + personal +
      '<div class="field"><span class="f-label">'+esc(t('basemap'))+'</span><div class="seg">'+
      ['light','color'].map(function(k){return '<button type="button" data-action="set-style" data-style="'+k+'" aria-pressed="'+(state.styleKey===k)+'">'+esc(t(styleLabelKey(k)))+'</button>';}).join('')+'</div></div>' +
      (areas.length?'<details class="me-fold"><summary>'+esc(t('areas'))+'</summary><ul class="area-list">'+areas.map(function(a){return '<li><span>'+esc(a.name)+'</span><button type="button" class="link-btn danger" data-action="del-area" data-id="'+esc(a.id)+'">'+esc(t('del'))+'</button></li>';}).join('')+'</ul></details>':'') +
      ((identityCardHTML()+testAccountsHTML()) ? '<details class="me-fold account-details"' + (accountOpen?' open':'') + '><summary>'+esc(en?L('Identities'):'身份切换')+'</summary>'+identityCardHTML()+testAccountsHTML()+'</details>' : '') +
      '<details class="me-fold data-details"' + (dataOpen?' open':'') + '><summary>'+esc(en?L('Feedback & privacy'):'意见反馈与隐私')+'</summary><a class="btn small me-feedback" href="contact.html">'+ICON.pen+esc(en?L('Send feedback'):'意见反馈')+'</a><p class="note">'+esc(t(remote?'remoteNote':'localNote'))+'</p><div class="btn-row">'+dataButtons+'</div><p><a class="privacy-link" href="privacy.html" target="_blank" rel="noopener">'+esc(t('privacyLink'))+'</a></p></details>' +
      (isModerator()?'<details class="me-fold admin-details"' + (adminOpen?' open':'') + '><summary>'+esc(en?L('Moderation tools'):'管理工具')+'</summary><p class="f-hint">'+esc(en?L('Review reports or manage a public post.'):'处理评论举报，或进入公开帖子管理内容。')+'</p><div class="btn-row"><button type="button" class="btn small" data-action="social-reports">'+esc(en?L('Comment reports'):'评论举报')+'</button><button type="button" class="btn small" data-action="dm-reports">' + esc(en?L('Private-message reports'):'私信举报') + '</button><button type="button" class="btn small" data-action="moderation-clean">'+esc(en?L('Retry media cleanup'):'重试图片清理')+'</button></div><div id="social-reports"></div></details>':'') +
      '<p class="about">'+esc(t('about'))+'</p></div>';
    view.innerHTML = h;
  }

  /* 本地版的测试账号：点一下就换成另一个人 */
  var shareCard = null;
  function appShareButton() {
    return '<button type="button" class="icon-btn flat home-share" data-action="app-share" aria-label="' + esc(state.lang === 'en' ? L('Share XueTuan') : '分享雪团') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M6 11H4v10h16V11h-2"/></svg></button>';
  }
  function appShareURL() {
    var url = new URL(location.href), token = url.searchParams.get('_vercel_share');
    url.search = ''; url.hash = '';
    if (token) url.searchParams.set('_vercel_share', token);
    return url.href;
  }
  function openAppShare() {
    var en = state.lang === 'en', url = appShareURL();
    openModal('<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="app-share-title"><h3 id="app-share-title">' + esc(en ? L('Share XueTuan') : '把雪团分享给朋友') + '</h3><p class="f-hint">' + esc(en ? L('Discover food and things to do with your classmates.') : '一起发现同学推荐的美食和玩乐。') + '</p><input id="app-share-link" class="input" readonly aria-label="' + esc(en ? L('Website link') : '网站链接') + '" value="' + esc(url) + '"><div class="btn-row"><button type="button" class="btn primary" data-action="app-share-system">' + esc(en ? L('More apps') : '系统分享') + '</button><button type="button" class="btn" data-action="app-share-copy">' + esc(en ? L('Copy link') : '复制链接') + '</button><a class="btn" href="https://wa.me/?text=' + encodeURIComponent('雪团 XueTuan · ' + url) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a></div><p class="f-hint">' + esc(en ? L('WeChat / Instagram: copy the link and paste it in a chat. Available system share apps depend on your phone.') : '微信 / Instagram：复制链接后粘贴到聊天中；系统分享中的应用以手机实际支持为准。') + '</p><button type="button" class="btn ghost" data-modal="no">' + esc(en ? L('Close') : '关闭') + '</button></div>');
  }
  function copyAppShare() {
    function fallback() {
      var input = $('#app-share-link'); if (!input) return;
      input.focus(); input.select(); input.setSelectionRange(0,input.value.length);
      var copied = false; try { copied = document.execCommand('copy'); } catch (e) {}
      toast(copied ? (state.lang === 'en' ? L('Link copied') : '链接已复制，可以粘贴给朋友了') : (state.lang === 'en' ? L('Long-press the selected link to copy') : '长按选中的链接，选择复制'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(appShareURL()).then(function () { toast(state.lang === 'en' ? L('Link copied') : '链接已复制，可以粘贴给朋友了'); },fallback);
    else fallback();
  }
  function sendAppShare() {
    if (!navigator.share) { copyAppShare(); return; }
    try { Promise.resolve(navigator.share({title:'雪团 XueTuan',text:state.lang === 'en' ? L('Discover food and things to do with classmates.') : '一起发现同学推荐的美食和玩乐。',url:appShareURL()})).catch(function (e) { if (!e || e.name !== 'AbortError') copyAppShare(); }); }
    catch (e) { copyAppShare(); }
  }
  function shareSnapshot(includePrivate) {
    var ids = new Set();
    store.reviews().forEach(function (r) { if (isMine(r) && !r.sample && (includePrivate || r.visibility === 'public')) ids.add(r.placeId); });
    var ps = Array.from(ids).map(placeById).filter(function (p) { return p && !p.sample; }), countries = {};
    if (world.fc) ps.forEach(function (p) { var i = countryAt(p.lng, p.lat); if (i >= 0) countries[i] = true; });
    return { v: 1, name: (me().name || (state.lang === 'en' ? L('A XueTuan explorer') : '雪团同学')).slice(0, 20), food: ps.filter(function (p) { return p.mode === 'food'; }).length, scenery: ps.filter(function (p) { return p.mode === 'travel'; }).length, places: ps.length, countries: world.fc ? Object.keys(countries).length : null, countryIds: world.fc ? Object.keys(countries).map(function (i) { return String(world.fc.features[i].id).padStart(3, '0'); }).sort() : [], date: new Date().toISOString().slice(0, 10), privateCounts: !!includePrivate };
  }
  var FOOD_SHARE_AREAS = {'food-kl':[101.50,2.80,101.85,3.35],'food-xmum':[101.67,2.80,101.75,2.88]};
  function foodShareSnapshot(includePrivate, area) {
    var region=FOOD_SHARE_AREAS[area===true?'food-kl':area];
    var reviews = store.reviews().filter(function(r){return isMine(r) && !r.sample && (includePrivate || r.visibility === 'public');});
    var byPlace = {};
    reviews.forEach(function(r){var p=placeById(r.placeId);if(!p || p.sample || p.mode!=='food' || !isFinite(p.lng) || !isFinite(p.lat))return;
      if(region && !(p.lng>=region[0] && p.lng<=region[2] && p.lat>=region[1] && p.lat<=region[3]))return;
      (byPlace[p.id] || (byPlace[p.id]={p:p,reviews:[]})).reviews.push(r);
    });
    var points=Object.keys(byPlace).map(function(id){var x=byPlace[id],scored=x.reviews.filter(function(r){return r.rating!=null;});
      return {lng:+x.p.lng,lat:+x.p.lat,rating:scored.length?scored.reduce(function(a,r){return a+r.rating;},0)/scored.length:null,visits:x.reviews.length};});
    return {points:points,total:points.length,visits:points.reduce(function(n,p){return n+p.visits;},0),high:points.filter(function(p){return p.rating>=4;}).length};
  }
  function foodShareTheme(theme) {return theme==='food-kl' || theme==='food-world' || theme==='food-xmum';}
  function sharedCardURL(data) {
    var url = new URL(location.href), token = url.searchParams.get('_vercel_share');
    url.search = ''; url.hash = '';
    if (token) url.searchParams.set('_vercel_share', token);
    url.searchParams.set('card', btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    return url.href;
  }
  function readSharedCard() {
    try {
      var raw = new URL(location.href).searchParams.get('card');
      if (!raw || raw.length > 4096) return null;
      var d = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
      if (d.v !== 1 || typeof d.name !== 'string' || !d.name.trim() || d.name.length > 20 || !['food','scenery','places'].every(function (k) { return Number.isInteger(d[k]) && d[k] >= 0 && d[k] <= 100000; }) || (d.countries !== null && (!Number.isInteger(d.countries) || d.countries < 0 || d.countries > 300)) || d.food + d.scenery !== d.places) return null;
      if (d.countryIds != null && (!Array.isArray(d.countryIds) || d.countryIds.length > 300 || !d.countryIds.every(function (id) { return typeof id === 'string' && /^\d{3}$/.test(id); }) || new Set(d.countryIds).size !== d.countryIds.length || d.countryIds.length !== (d.countries || 0))) return null;
      return { v: 1, name: d.name, food: d.food, scenery: d.scenery, places: d.places, countries: d.countries, countryIds: d.countryIds || [], theme: d.theme === 'stats' ? 'stats' : 'atlas', date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '', privateCounts: d.privateCounts === true };
    } catch (e) { return null; }
  }
  function openMyShare() {
    shareCard = { own: true, includePrivate: false, owner: me().id, theme: 'atlas' };
    state.view = 'share'; render(); setSnap('full');
    loadWorld().then(function () { if (shareCard && shareCard.own && shareCard.owner === me().id && state.view === 'share') render(); }, function () {});
  }
  function renderShareCard() {
    if (!shareCard) { goFeed(); return; }
    if (shareCard.own && shareCard.owner !== me().id) { shareCard = null; goFeed(); return; }
    if (shareCard.own) shareCard.data = shareSnapshot(shareCard.includePrivate);
    var card = shareCard, d = card.data, en = state.lang === 'en';
    d.theme = card.theme || d.theme || 'atlas';
    if (foodShareTheme(d.theme)) d.foodMap=foodShareSnapshot(card.includePrivate,d.theme);
    card.url = foodShareTheme(d.theme) ? appShareURL() : sharedCardURL(d); card.blob = null;
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(en ? L('My footprint card') : '足迹分享卡') + '</h2></div>' +
      (card.own ? '<div class="seg share-themes" style="margin-bottom:14px;display:flex;flex-wrap:wrap">' + [['atlas',en?L('World map'):'点亮世界'],['food-kl',en?L('KL food'):'KL 美食'],['food-xmum',en?L('Near XMUM'):'XMUM 附近'],['food-world',en?L('World food'):'世界美食'],['stats',en?L('Minimal'):'简洁数据']].map(function (x) { return '<button type="button" data-action="share-theme" data-v="' + x[0] + '" aria-pressed="' + (d.theme === x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div><label class="f-hint"><input type="checkbox" id="share-private"' + (card.includePrivate ? ' checked' : '') + '> ' + esc(foodShareTheme(d.theme) ? (en ? L('Include private restaurants: locations and ratings will appear on the image') : '包含仅个人餐厅：图片将展示餐厅位置和评分') : (en ? L('Include private footprints: totals and countries only') : '包含仅个人足迹：只展示汇总和国家')) + '</label>' : '') +
      '<div class="share-card"><canvas id="share-canvas" width="900" height="1120" role="img" aria-label="' + esc(d.name + ' · ' + d.food + (en ? L(' restaurants, ') : ' 家餐厅，') + d.scenery + (en ? L(' places to enjoy, ') : ' 处玩乐，') + d.places + (en ? L(' places') : ' 个地点')) + '"></canvas></div>' +
      '<p class="f-hint">' + esc(foodShareTheme(d.theme) ? (en ? L('Unique restaurants, coloured by your average rating. KL includes the Klang Valley and Sepang. Share the image for the full map; the link opens XueTuan.') : '餐厅去重，按自己的平均评分配色。KL 范围含巴生谷和雪邦；分享图片保留完整地图，链接用于打开雪团。') : en ? L('A snapshot of recorded footprints. Country counts are estimated from coordinates. No photos, reviews or hometown location are included.') : '统计来自已记录的足迹，国家/地区按坐标估算。不含照片、点评或家乡位置。') + '</p><div class="share-actions"><button type="button" class="btn primary" data-action="share-card">' + esc(en ? L('Share') : '分享') + '</button><button type="button" class="btn" data-action="save-share-card">' + esc(en ? L('Save image') : '保存图片') + '</button><button type="button" class="btn ghost" data-action="copy-share-card">' + esc(en ? L('Copy link') : '复制链接') + '</button></div>' +
      '<input class="input share-link" id="share-link" readonly aria-label="' + esc(en ? L('Share link') : '分享链接') + '" value="' + esc(card.url) + '">' + (!card.own ? '<button type="button" class="btn primary" data-action="tab" data-tab="home">' + esc(en ? L('Explore XueTuan') : '打开雪团，一起发现') + '</button>' : '');
    var canvas = $('#share-canvas');
    drawShareCard(canvas, d, en);
    var saveButton = $('[data-action="save-share-card"]');
    if (saveButton) saveButton.disabled = true;
    var sendButton=$('[data-action="share-card"]');if(sendButton)sendButton.disabled=true;
    function ready(){canvas.toBlob(function (blob) { if (shareCard === card && canvas.isConnected) { card.blob = blob; if (saveButton) saveButton.disabled = !blob;if(sendButton)sendButton.disabled=!blob; } }, 'image/png');}
    if(FOOD_SHARE_AREAS[d.theme]) paintKLFoodMap(canvas,d,en).then(ready); else ready();
  }
  function drawShareCard(canvas, d, en) {
    var g = canvas.getContext('2d');
    if (foodShareTheme(d.theme)) { drawFoodShareCard(g,d,en); return; }
    if (d.theme !== 'stats') { drawAtlasCard(g, d, en); return; }
    var grad = g.createLinearGradient(0, 0, 900, 1120);
    grad.addColorStop(0, '#e7f4ff'); grad.addColorStop(1, '#fbfdff'); g.fillStyle = grad; g.fillRect(0, 0, 900, 1120);
    g.fillStyle = '#3b89cc'; g.font = '700 32px sans-serif'; g.fillText('雪团 XueTuan', 64, 100);
    g.fillStyle = '#23425f'; g.font = '700 48px sans-serif'; g.fillText(en ? L('Places become memories') : '每一处，都是我的故事', 64, 206);
    g.font = '30px sans-serif'; var name = d.name; while (g.measureText(name).width > 760) name = name.slice(0, -1); g.fillText(name, 64, 270);
    var labels = en ? ['Restaurants','Things to do','Countries / regions','Places'] : ['家餐厅','处玩乐','个国家 / 地区','个地点'];
    [d.food, d.scenery, d.countries, d.places].forEach(function (n, i) {
      var x = 64 + (i % 2) * 396, y = 340 + Math.floor(i / 2) * 240;
      g.fillStyle = '#ffffff'; g.fillRect(x, y, 376, 220); g.fillStyle = '#4b91c5'; g.font = '700 74px sans-serif'; g.fillText(n == null ? '—' : String(n), x + 28, y + 104);
      g.fillStyle = '#647e91'; g.font = '26px sans-serif'; g.fillText(labels[i], x + 28, y + 164);
    });
    g.fillStyle = '#6e889b'; g.font = '24px sans-serif'; g.fillText(en ? L('Food, fun, and the stories in between.') : '记录美食与玩乐，发现同学的故事。', 64, 910);
    g.font = '21px sans-serif'; g.fillText((d.privateCounts ? (en ? L('All recorded footprints') : '全部足迹数量') : (en ? L('Public footprints') : '公开足迹数量')) + ' · ' + d.date, 64, 978);
    g.fillText(en ? L('Open the shared link to explore XueTuan.') : '打开分享链接，来雪团一起发现。', 64, 1040);
  }
  function drawAtlasCard(g, d, en) {
    var grad = g.createLinearGradient(0, 0, 900, 1120);
    grad.addColorStop(0, '#1c3441'); grad.addColorStop(1, '#101e2b');
    g.fillStyle = grad; g.fillRect(0, 0, 900, 1120);
    var light = g.createRadialGradient(720, 430, 20, 720, 430, 620);
    light.addColorStop(0, 'rgba(85,155,160,.16)'); light.addColorStop(1, 'rgba(85,155,160,0)');
    g.fillStyle = light; g.fillRect(0, 0, 900, 1120);
    g.fillStyle = '#a4dce3'; g.font = '600 27px sans-serif'; g.fillText('雪团  XueTuan', 64, 82);
    g.textAlign = 'right'; g.fillStyle = '#74929f'; g.font = '18px sans-serif'; g.fillText('MY FOOTPRINTS', 836, 80); g.textAlign = 'left';
    g.fillStyle = '#f4f7f6'; g.font = '600 ' + (en ? 49 : 53) + 'px sans-serif'; g.fillText(en ? L('A world of little memories.') : '我的世界，慢慢点亮', 64, 178);
    g.fillStyle = '#a4b9c1'; g.font = '27px sans-serif';
    var name = d.name; while (g.measureText(name).width > 700) name = name.slice(0, -1);
    g.fillText(name + (en ? L(' · on the way') : ' · 在路上'), 64, 231);
    g.fillStyle = '#9fe3df'; g.font = '500 74px sans-serif'; var count = d.countries == null ? '—' : String(d.countries); g.fillText(count, 64, 330);
    var cw = g.measureText(count).width; g.font = '25px sans-serif'; g.fillStyle = '#c5d9df'; g.fillText(en ? L('countries / regions lit up') : '个国家 / 地区已点亮', 82 + cw, 323);
    drawShareWorld(g, d, 24, 355, 852, 415);
    g.fillStyle = '#8eabb7'; g.font = '20px sans-serif'; g.fillText(en ? L('● Visited     ○ Still to discover') : '● 已留下足迹     ○ 等待探索', 64, 785);
    g.strokeStyle = 'rgba(172,204,212,.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(64, 830); g.lineTo(836, 830); g.stroke();
    var vals = [d.food, d.scenery, d.places], labels = en ? ['Restaurants','Things to do','Places'] : ['家餐厅','处玩乐','个地点'];
    vals.forEach(function (n, i) { var x = 64 + i * 272;
      g.fillStyle = '#f2f6f5'; g.font = '500 58px sans-serif'; g.fillText(String(n), x, 907);
      g.fillStyle = '#93b0bd'; g.font = '24px sans-serif'; g.fillText(labels[i], x, 952);
    });
    g.fillStyle = '#91aeba'; g.font = '20px sans-serif'; g.fillText(en ? L('Every little discovery counts.') : '把值得记住的，留在地图上。', 64, 1043);
    g.fillStyle = '#647f8c'; g.font = '17px sans-serif'; g.fillText((d.privateCounts ? (en ? L('All footprints') : '全部足迹汇总') : (en ? L('Public footprints') : '公开足迹汇总')) + ' · ' + d.date, 64, 1081);
    g.textAlign = 'right'; g.fillText('XUETUAN / EXPLORE MORE', 836, 1081); g.textAlign = 'left';
  }
  function drawShareWorld(g, d, x, y, w, h) {
    if (!world.fc) { g.fillStyle = '#9ab6c2'; g.font = '26px sans-serif'; g.fillText(state.lang === 'en' ? L('Map unavailable · totals preserved') : '地图暂未载入 · 足迹数据已保留', x + 40, y + h / 2); return; }
    var ids = new Set(d.countryIds || []);
    function project(c, offset) { return [x + (c[0] + offset + 180) / 360 * w, y + (85 - c[1]) / 145 * h]; }
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.lineWidth = .7; g.strokeStyle = 'rgba(140,180,193,.08)';
    for (var lon = -180; lon <= 180; lon += 30) { var px = project([lon,0],0)[0]; g.beginPath(); g.moveTo(px,y); g.lineTo(px,y+h); g.stroke(); }
    for (var lat = -60; lat <= 80; lat += 30) { var py = project([0,lat],0)[1]; g.beginPath(); g.moveTo(x,py); g.lineTo(x+w,py); g.stroke(); }
    var lit = [];
    world.fc.features.forEach(function (f) {
      var on = ids.has(String(f.id).padStart(3, '0')); if (on) lit.push(f);
      g.fillStyle = on ? '#8dd8d4' : '#334c59'; g.strokeStyle = on ? '#b4eeea' : '#506674'; g.lineWidth = on ? 1 : .65;
      (f.polys || polysOf(f.geometry)).forEach(function (poly) {
        [-360,0,360].forEach(function (offset) {
          g.beginPath(); poly.forEach(function (ring) { ring.forEach(function (c,i) { var p = project(c,offset); if (i) g.lineTo(p[0],p[1]); else g.moveTo(p[0],p[1]); }); g.closePath(); });
          g.fill('evenodd'); g.stroke();
        });
      });
    });
    /* 小国用国家轮廓中心的光点辅助辨识；不使用用户的具体地点坐标。 */
    lit.forEach(function (f) {
      var b = f.box || boxOf(f.polys || polysOf(f.geometry));
      if ((b[2]-b[0]) * (b[3]-b[1]) > 20) return;
      var c = project([(b[0]+b[2])/2,(b[1]+b[3])/2],0);
      g.beginPath(); g.arc(c[0],c[1],7,0,Math.PI*2); g.fillStyle='rgba(141,216,212,.18)'; g.fill();
      g.beginPath(); g.arc(c[0],c[1],2.5,0,Math.PI*2); g.fillStyle='#b4eeea'; g.fill();
    });
    g.restore();
  }
  var foodMapImages = {}, foodMapLoading = {}, foodMapBounds = {};
  function foodRatingColor(r){return r==null?'#91a1af':r>=4?'#269c91':r>=3?'#599bd2':r>=2?'#dca454':'#d77f78';}
  function drawFoodShareCard(g,d,en){
    var f=d.foodMap,regional=!!FOOD_SHARE_AREAS[d.theme],foodKLImage=foodMapImages[d.theme],foodKLBounds=foodMapBounds[d.theme];
    g.fillStyle='#eef4fa';g.fillRect(0,0,900,1120);g.fillStyle='#2e7dcb';g.font='600 25px sans-serif';g.fillText('雪团 XueTuan / FOOD ATLAS',52,66);
    g.fillStyle='#1b2a3a';g.font='600 46px sans-serif';g.fillText(d.theme==='food-xmum'?(en?L('Food around XMUM'):'我的 XMUM 周边美食'):d.theme==='food-kl'?(en?L('My KL food map'):'我的 KL 美食地图'):(en?L('My world of food'):'我吃过的世界'),52,140);
    g.fillStyle='#687a8c';g.font='25px sans-serif';g.fillText(d.name.slice(0,20)+' · '+d.date,52,188);
    var y=210,h=600;g.fillStyle='#e0eaf1';g.fillRect(40,y,820,h);
    if(regional && foodKLImage) g.drawImage(foodKLImage,40,y,820,h);
    else if(d.theme==='food-world') {
      if(world.fc) world.fc.features.forEach(function(feature){g.fillStyle='#f9fbfd';g.strokeStyle='#c1d0dc';g.lineWidth=.7;
        (feature.polys||polysOf(feature.geometry)).forEach(function(poly){g.beginPath();poly.forEach(function(ring){ring.forEach(function(c,i){var px=40+(c[0]+180)/360*820,py=y+(85-c[1])/145*h;if(i)g.lineTo(px,py);else g.moveTo(px,py);});g.closePath();});g.fill('evenodd');g.stroke();});});
    }
    g.save();g.beginPath();g.rect(40,y,820,h);g.clip();
    var marks=[];f.points.forEach(function(p){var x,py;
      if(regional){var bounds=foodKLBounds||FOOD_SHARE_AREAS[d.theme];x=40+(p.lng-bounds[0])/(bounds[2]-bounds[0])*820;var merc=function(lat){return Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));};py=y+(merc(bounds[3])-merc(p.lat))/(merc(bounds[3])-merc(bounds[1]))*h;}
      else{x=40+(p.lng+180)/360*820;py=y+(85-p.lat)/145*h;}
      var group=marks.find(function(m){return Math.hypot(m.x-x,m.y-py)<30;});
      if(group){group.x=(group.x*group.n+x)/(group.n+1);group.y=(group.y*group.n+py)/(group.n+1);group.n++;if(p.rating!=null){group.sum+=p.rating;group.rated++;}}
      else marks.push({x:x,y:py,n:1,sum:p.rating||0,rated:p.rating==null?0:1});
    });
    marks.forEach(function(m){var r=m.n>1?18:11;g.beginPath();g.arc(m.x,m.y,r+4,0,Math.PI*2);g.fillStyle='rgba(255,255,255,.88)';g.fill();g.beginPath();g.arc(m.x,m.y,r,0,Math.PI*2);g.fillStyle=foodRatingColor(m.rated?m.sum/m.rated:null);g.fill();g.strokeStyle='#23425f';g.lineWidth=1.5;g.stroke();
      if(m.n>1){g.fillStyle='#fff';g.strokeStyle='rgba(0,0,0,.35)';g.lineWidth=2;g.font='700 23px sans-serif';g.textAlign='center';g.textBaseline='middle';g.strokeText(String(m.n),m.x,m.y);g.fillText(String(m.n),m.x,m.y);g.textAlign='left';g.textBaseline='alphabetic';}
    });g.restore();
    g.fillStyle='#687a8c';g.font='16px sans-serif';g.fillText(regional?(foodKLImage?'© OpenFreeMap · © OpenMapTiles · © OpenStreetMap':'Coordinate map · '+(d.theme==='food-xmum'?'XMUM / Kota Warisan / Dengkil':'Klang Valley / Sepang')):'World map · Natural Earth',52,835);
    var legend=[[4,'4–5'],[3,'3–<4'],[2,'2–<3'],[1,'0–<2'],[null,en?L('Unrated'):'未评分']];
    legend.forEach(function(a,i){var x=58+i*161;g.fillStyle=foodRatingColor(a[0]);g.beginPath();g.arc(x,870,9,0,Math.PI*2);g.fill();g.fillStyle='#687a8c';g.font='20px sans-serif';g.fillText(a[1],x+18,877);});
    [f.total,f.visits,f.high].forEach(function(n,i){var x=52+i*272;g.fillStyle='#1b2a3a';g.font='600 58px sans-serif';g.fillText(String(n),x,963);g.fillStyle='#687a8c';g.font='24px sans-serif';g.fillText((en?['Restaurants','Visits','Rated 4+']:['家餐厅','次到访','家评分 ≥4'])[i],x,1005);});
    g.fillStyle='#687a8c';g.font='21px sans-serif';g.fillText(!f.total?(en?L('Your next discovery starts here.'):'下一家好吃的，等你发现。'):(en?L('One little dot, one delicious memory.'):'每一个小点，都是吃过的好时光。'),52,1057);
    g.font='17px sans-serif';g.fillText((d.privateCounts?(en?L('Includes private restaurants'):'包含仅个人餐厅'):(en?L('Public restaurants only'):'仅公开餐厅'))+' · XUETUAN',52,1095);
  }
  function paintKLFoodMap(canvas,d,en){
    var key=d.theme,region=FOOD_SHARE_AREAS[key];
    if(foodMapImages[key]){drawFoodShareCard(canvas.getContext('2d'),d,en);return Promise.resolve();}
    if(!foodMapLoading[key]) foodMapLoading[key]=new Promise(function(resolve){
      var holder=document.createElement('div');holder.style.cssText='position:fixed;left:-10000px;top:0;width:820px;height:600px;pointer-events:none';document.body.appendChild(holder);
      var mini=null,done=false,timer=setTimeout(finish,12000);
      function finish(){if(done)return;done=true;clearTimeout(timer);if(mini)mini.remove();holder.remove();resolve();}
      loadStyle('light').then(function(style){if(done)return;
        try{mini=new maplibregl.Map({container:holder,style:style,interactive:false,attributionControl:false,preserveDrawingBuffer:true,fadeDuration:0});
          mini.fitBounds([[region[0],region[1]],[region[2],region[3]]],{padding:0,duration:0});
          mini.once('idle',function(){try{var bounds=mini.getBounds();foodMapBounds[key]=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()];var img=new Image();img.onload=function(){foodMapImages[key]=img;finish();};img.onerror=finish;img.src=mini.getCanvas().toDataURL('image/png');}catch(e){finish();}});
        }catch(e){finish();}
      }).catch(finish);
    }).then(function(){delete foodMapLoading[key];});
    return foodMapLoading[key].then(function(){if(canvas.isConnected)drawFoodShareCard(canvas.getContext('2d'),d,en);});
  }
  function saveShareCard() {
    if (!shareCard || !shareCard.blob) return;
    var a = document.createElement('a'), url = URL.createObjectURL(shareCard.blob);
    a.href = url; a.download = 'xuetuan-footprints.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
  function copyShareCard() {
    if (!shareCard) return;
    var field = $('#share-link');
    function fallback() { if (field) { field.focus(); field.select(); } toast(state.lang === 'en' ? L('Copy the selected link') : '长按选中的链接即可复制'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareCard.url).then(function () { toast(state.lang === 'en' ? L('Link copied') : '链接已复制'); }, fallback);
    else fallback();
  }
  function sendShareCard() {
    if (!shareCard) return;
    if (!navigator.share) { copyShareCard(); return; }
    var data = { title: '雪团 XueTuan', text: shareCard.data.name + (state.lang === 'en' ? L('’s footprints') : '的雪团足迹'), url: shareCard.url };
    if (shareCard.blob && navigator.canShare) { var files = [new File([shareCard.blob], 'xuetuan-footprints.png', { type: 'image/png' })]; if (navigator.canShare({ files: files })) data.files = files; }
    try { Promise.resolve(navigator.share(data)).catch(function (err) { if (err.name !== 'AbortError') copyShareCard(); }); } catch (err) { copyShareCard(); }
  }
  function testAccountsHTML() {
    if (!store.accounts) return '';
    var cur = me().id;
    return '<div class="field" id="test-accounts"><span class="f-label">' + esc(t('testAccounts')) + '</span><div class="chips-wrap">' +
      store.accounts().map(function (a) {
        return '<button type="button" class="chip" data-action="acct" data-id="' + esc(a.id) + '" aria-pressed="' + (a.id === cur) + '">' + esc(a.name || t('acctUnnamed')) + '</button>';
      }).join('') +
      (store.accounts().length < 8 ? '<button type="button" class="chip" data-action="acct-add">' + esc(t('acctAdd')) + '</button>' : '') +
      '</div><p class="f-hint">' + esc(t('testAccountsHint')) + '</p></div>';
  }
  function switchAccount(id) {
    if (id === me().id) return;
    store.switchAccount(id).then(function (pf) {
      state.form = null; state.placeId = null; state.homes = null; state.preview = null;
      afterHomeChange();
      render();
      toast(t('acctSwitched', { n: pf.name || t('acctUnnamed') }));
    });
  }
  function addAccount() {
    var n = store.accounts().length;
    store.addAccount(t('acctDefault', { c: String.fromCharCode(65 + n) })).then(function (pf) { switchAccount(pf.id); });
  }
  /* “我”里的“我的家”：一行城市 + 改 / 不设了，下面一个公开开关（默认关） */
  /* 我的家、公开主页：各一行（用户 2026-11-03 嫌占地方）。点左边改，右边开关；“不设了”挪到设置家乡的页面里 */
  function homeFieldHTML() {
    var h = store.myHome(), en = state.lang === 'en';
    var main = '<button type="button" class="me-line-main' + (h ? ' home-row' : ' home-set-btn') + '" data-action="home-set">' + ICON.home +
      '<span><b>' + esc(t('myHome')) + '</b><small>' + esc(h ? h.city : (en ? L('Not set · city only') : '未设置 · 只记城市')) + '</small></span>' + (h ? '' : '<i aria-hidden="true">›</i>') + '</button>';
    var sw = !h ? '' : '<button type="button" class="me-switch" role="switch" data-action="home-public" aria-checked="' + h.public + '" aria-label="' + esc(en ? L('Share my hometown (city only)') : '公开家乡（只显示城市）') + '"><span class="me-sw-label">' + esc(en ? L('Public') : '公开') + '</span><span class="switch" aria-hidden="true"></span></button>';
    return '<div class="me-line" id="home-field">' + main + sw + '</div>';
  }
  /* 个人主页开关（默认关）：开了以后，同学点你的名字 / 头像能进你的主页，只看到你分享到大地图的记录 */
  function pageFieldHTML() {
    var on = store.pagePublic(me().id), en = state.lang === 'en';
    return '<div class="me-line" id="page-field"><button type="button" class="me-line-main" data-action="person" data-uid="' + esc(me().id) + '">' + PERSON_ICON +
      '<span><b>' + esc(en ? L('My page') : '我的主页') + '</b><small>' + esc(on ? (en ? L('Classmates can open it') : '同学点你的名字能进来') : (en ? L('Only you can open it') : '只有自己能看')) + '</small></span></button>' +
      '<button type="button" class="me-switch" role="switch" data-action="page-public" aria-checked="' + on + '" aria-label="' + esc(en ? L('Public profile') : '公开我的主页') + '"><span class="me-sw-label">' + esc(en ? L('Public') : '公开') + '</span><span class="switch" aria-hidden="true"></span></button></div>';
  }
  var PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  /* 点了地图上的小房子：谁的家、在哪 */
  function renderPlaceCluster() {
    var places = (state.clusterPlaces || []).map(placeById).filter(function (p) { return p && inScope(p) && passesFilters(p); });
    if (!places.length) { goFeed(); return; }
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(state.lang === 'en' ? places.length + ' nearby places' : '这里有 ' + places.length + ' 个地点') + '</h2></div>' +
      '<p class="f-hint">' + esc(state.lang === 'en' ? L('Choose a place to see its photos and reviews.') : '位置相近，选择地点查看照片和点评。') + '</p>' +
      (places.some(function (p) { return placePhotos(p).length; }) ? '<button type="button" class="btn small" data-action="cluster-photos">' + esc(state.lang === 'en' ? L('View all photos') : '查看全部照片') + '</button>' : '') + '<ul class="near-list cluster-list">' + places.map(function (p) {
        return placeRowHTML(p, 'open-place', esc(catName(catOf(p))) + ' · ' + esc(state.lang === 'en' ? placePhotos(p).length + ' photos' : placePhotos(p).length + ' 张照片'), stats(p).score != null ? scoreHTML(stats(p).score) : '');
      }).join('') + '</ul>';
  }
  function renderHomes() {
    var list = (state.homes || []).map(homeOf).filter(Boolean);
    if (!list.length) { goFeed(); return; }
    var cities = [];
    list.forEach(function (h) { if (cities.indexOf(h.city) === -1) cities.push(h.city); });
    var title = list.length === 1 ? t('homeOf', { n: homeName(list[0]) }) : cities.length === 1 ? cities[0] : t('homesN', { n: list.length });
    var mine = list.some(function (h) { return h.userId === me().id; });
    var h = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button>' +
      '<h2 class="view-title">' + esc(title) + '</h2></div><ul class="near-list homes-list">' +
      list.map(function (x) {
        var you = x.userId === me().id;
        var sub = esc(x.city) + (you && !x.public ? ' · ' + esc(t('homeOnlyYou')) : '');
        return '<li><div class="near-item">' + avatarHTML(homeName(x), x.userId) + '<span class="near-text"><b>' + esc(t('homeOf', { n: homeName(x) })) + '</b><small>' + sub + '</small></span></div></li>';
      }).join('') + '</ul>' +
      '<div class="actions"><button type="button" class="btn" data-action="home-set">' + ICON.home + esc(t(mine ? 'homeEdit' : store.myHome() ? 'homeEdit' : 'homeSetCta')) + '</button></div>';
    view.innerHTML = h;
  }
  /* 设置我的家：只搜城市（Photon 的城市 / 州 + 维基的城市词条），或者在地图上点 */
  var homeQ = { q: '', status: 'idle', results: [], timer: null, seq: 0 };
  function renderHomeSet() {
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(t('homeTitle')) + '</h2></div>' +
      '<div class="add-search"><div class="search-box"><img class="search-symbol" src="assets/search-pin.png" alt=""><input id="home-q" class="input" type="search" autocomplete="off" placeholder="' + esc(t('homeSearchPh')) + '" aria-label="' + esc(t('homeSearchPh')) + '" value="' + esc(homeQ.q) + '">' +
      '</div><button type="button" class="btn add-pin" data-action="home-pick">' + ICON.pin + esc(t('homePick')) + '</button></div>' +
      '<p class="f-hint add-hint">' + esc(t('homeNote')) + '</p>' +
      (store.myHome() ? '<p class="home-remove"><button type="button" class="link-btn danger" data-action="home-del">' + esc(t('homeRemove')) + '</button></p>' : '') +
      '<ul class="search-results" id="home-results"></ul>';
    renderHomeResults();
    setTimeout(function () { var q = $('#home-q'); if (q) q.focus(); }, 60);
  }
  function renderHomeResults() {
    var box = $('#home-results');
    if (!box) return;
    var q = homeQ.q.trim(), h = '';
    if (q.length < 2) h = '';
    else if (homeQ.status === 'loading') h = '<li class="empty small">' + esc(t('osmLoading')) + '</li>';
    else if (homeQ.status === 'fail') h = '<li class="empty small">' + esc(t('osmFail')) + '</li>';
    else if (!homeQ.results.length) h = '<li class="empty small">' + esc(t('homeNoResult')) + '</li>';
    else h = homeQ.results.map(function (r, i) {
      return '<li><button type="button" class="near-item" data-action="home-result" data-i="' + i + '"><span class="cat-ic home-ic" aria-hidden="true">' + ICON.home + '</span>' +
        '<span class="near-text"><b>' + esc(r.name) + '</b><small>' + esc(r.where || '') + '</small></span><span class="near-cta">' + esc(t('homeSet')) + '</span></button></li>';
    }).join('');
    box.innerHTML = h;
  }
  /* 谷歌文字搜索，只要城市（locality），算进每天的谷歌次数 */
  function googleCities(q) {
    if (gsearch.disabled || googleDay().n >= GOOGLE_DAILY) return Promise.reject(new Error('google off'));
    if (window.__googleCities) return Promise.resolve(window.__googleCities(q)); /* 测试用 */
    return loadGoogle().then(function () { return google.maps.importLibrary('places'); }).then(function (lib) {
      var Place = (lib && lib.Place) || (google.maps.places && google.maps.places.Place);
      if (!Place || !Place.searchByText) throw new Error('no searchByText');
      googleCount();
      return Place.searchByText({ textQuery: q, fields: ['displayName', 'location', 'formattedAddress'], includedType: 'locality', maxResultCount: 5, language: state.lang === 'en' ? 'en' : 'zh-CN' });
    }).then(function (res) {
      return ((res && res.places) || []).map(function (pl) {
        var lat = typeof pl.location.lat === 'function' ? pl.location.lat() : pl.location.lat, lng = typeof pl.location.lng === 'function' ? pl.location.lng() : pl.location.lng;
        return { osm: 'g/' + pl.id, name: pl.displayName || q, where: pl.formattedAddress || '', lat: round6(lat), lng: round6(lng), mode: 'travel', cat: 'city', precision: 'city' };
      }).filter(function (r) { return isFinite(r.lat) && isFinite(r.lng); });
    });
  }
  function queueHomeSearch() {
    var q = homeQ.q.trim();
    clearTimeout(homeQ.timer);
    var seq = ++homeQ.seq;
    if (q.length < 2) { homeQ.status = 'idle'; homeQ.results = []; return; }
    homeQ.status = 'loading';
    homeQ.timer = setTimeout(function () {
      var fail = function () { return null; };
      var url = PHOTON_URL + '?q=' + encodeURIComponent(q) + '&limit=10&layer=city&layer=county&layer=state' + (state.lang === 'en' ? '&lang=en' : '');
      var photon = fetch(url).then(function (res) { if (!res.ok) throw new Error('photon ' + res.status); return res.json(); }).then(parsePhoton);
      Promise.all([withTimeout(wikiSearch(q), SEARCH_TIMEOUT).catch(fail), withTimeout(photon, SEARCH_TIMEOUT).catch(fail)]).then(function (rs) {
        if (seq !== homeQ.seq) return;
        var towns = townsIn(rs[1]);
        var wiki = snapToTown(rs[0] || [], towns).filter(function (r) { return r.cat === 'city' && (r.zoom || 10) >= 7; });
        var cities = snapToTown(rs[1] || [], towns).filter(function (r) { return r.precision === 'city'; });
        /* Photon 只给英文名（搜“厦门”出来 Xiamen，用户 2026-11-02）：中文搜的，附近有中文维基词条就用它的名字，
           没有就第一个城市直接用打的字；英文名放到下面一行 */
        var cjk = /[\u4e00-\u9fff]/;
        if (cjk.test(q)) cities = cities.map(function (r, i) {
          if (cjk.test(r.name)) return r;
          var w = (rs[0] || []).filter(function (x) { return cjk.test(x.name) && haversine(x, r) < 40000; })[0];
          var zh = w ? w.name : i === 0 ? q : '';
          return zh ? Object.assign({}, r, { name: zh, where: [r.name, r.where].filter(Boolean).join(' · ') }) : r;
        });
        homeQ.results = mergeResults(wiki, cities).slice(0, 8);
        if (homeQ.results.length) { homeQ.status = 'done'; renderHomeResults(); return; }
        /* 两个免费来源都没给（常常是 Photon 超时，搜 Almaty 都出不来，用户 2026-11-02）：再问谷歌，只要城市 */
        withTimeout(googleCities(q), 8000).then(function (gs) {
          if (seq !== homeQ.seq) return;
          homeQ.results = gs || []; homeQ.status = 'done'; renderHomeResults();
        }, function () {
          if (seq !== homeQ.seq) return;
          homeQ.results = []; homeQ.status = rs[0] || rs[1] ? 'done' : 'fail'; renderHomeResults();
        });
      });
    }, 200);
  }
  /* 只存到 0.1 度（约 10 公里），数据库里也会再取整一次 */
  function round1(v) { return Math.round(v * 10) / 10; }
  function saveHome(city, loc) {
    var old = store.myHome();
    return store.setHome({ city: String(city).slice(0, 60), lat: round1(loc.lat), lng: round1(loc.lng), public: old ? old.public : false }).then(function (h) {
      toast(t('homeSaved', { c: h.city }));
      homeQ.q = ''; homeQ.results = []; homeQ.status = 'idle';
      afterHomeChange();
      if (state.mode !== 'travel') setMode('travel', { noFly: true });
      leaveHomeSet();
      /* 现在面板是展开的；按收起时的位置飞过去，回到地图时小房子正好在中间 */
      if (map) map.flyTo({ center: [h.lng, h.lat], zoom: 8, essential: true, duration: reduceMotion ? 0 : 1200, padding: { top: 24, bottom: isMobile() ? snapVisible('peek') + tabbarH() + 12 : 40, left: 20, right: isMobile() ? 64 : 70 } });
    }, function () { toast(t('saveFail')); });
  }
  function afterHomeChange() { refreshMap(); renderFilters(); }
  function openHomeSet() {
    if (!requireLogin(openHomeSet)) return;
    rememberFeedSnap();
    state.homeBack = onMeRoot() ? 'me' : state.view === 'homes' ? 'homes' : null;
    state.view = 'home';
    render();
    setSnap('full');
  }
  function leaveHomeSet() {
    var to = state.homeBack;
    state.homeBack = null;
    if (to === 'me') { state.tab = 'me'; goFeed(); }
    else if (to === 'homes' && state.homes) { state.view = 'homes'; render(); setSnap('half'); }
    else goFeed();
  }
  /* 地图上点的：问 Photon 这是哪个城市，只要城市名 */
  function reverseCity(loc) {
    var url = PHOTON_URL.replace(/api\/$/, 'reverse') + '?lat=' + loc.lat.toFixed(4) + '&lon=' + loc.lng.toFixed(4) + '&radius=20' + (state.lang === 'en' ? '&lang=en' : '');
    return fetch(url).then(function (res) { if (!res.ok) throw new Error('photon ' + res.status); return res.json(); }).then(function (json) {
      var f = json && json.features && json.features[0], pr = (f && f.properties) || {};
      var name = pr.city || pr.county || pr.state || (['city', 'county', 'state'].indexOf(pr.type) !== -1 ? pr.name : '');
      if (!name) throw new Error('no city');
      return name;
    });
  }

  function renderLogin() {
    if (store.isAnon && store.isAnon()) {
      view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(t('linkGoogle')) + '</h2></div><div class="form"><p class="note">' + esc(t('anonWhy')) + '</p><button type="button" class="btn primary block" data-action="link-google">' + ICON.google + esc(t('linkGoogle')) + '</button></div>';
      return;
    }
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(t('loginTitle')) + '</h2></div>' +
      '<div class="form"><p class="note">' + esc(t('loginWhy')) + '</p>' +
      '<button type="button" class="btn primary block" data-action="login-google">' + ICON.google + esc(t('loginGoogle')) + '</button>' +
      '<div class="or-line"><span>' + esc(t('loginOr')) + '</span></div>' +
      '<form id="login-form" class="field" novalidate><input id="login-email" class="input" type="email" autocomplete="email" inputmode="email" placeholder="' + esc(t('loginEmailPh')) + '" aria-label="' + esc(t('loginEmailPh')) + '">' +
      '<button type="submit" class="btn block" id="login-send">' + esc(t('loginSend')) + '</button></form>' +
      '<p class="f-hint" id="login-msg" role="status"></p></div>';
  }
  function openLogin() {
    rememberFeedSnap();
    state.view = 'login'; state.form = null;
    render(); setSnap('full');
  }
  /* 线上版没登录时：先自动发一个匿名号，发好了接着做刚才那件事（用户 2026-10-28：匿名也能加，随便分配个号，
     想换手机不丢再绑谷歌）。retry 为空的（要选文件的）发好号后让用户再点一次——浏览器不让代码替用户打开选文件。
     匿名创建失败时留在原页，可再次点击重试，不强迫注册 */
  var afterAuth = null;
  function requireLogin(retry) {
    if (store.signedIn()) return true;
    if (store.signInAnonymously) {
      if (afterAuth) return false;
      afterAuth = retry || function () { toast(t('anonTapAgain')); };
      store.signInAnonymously().catch(function () {
        afterAuth = null;
        toast(t('anonFail'));
      });
      return false;
    }
    toast(t('loginFirst'));
    openLogin();
    return false;
  }
  /* 匿名号没名字：给个「雪团用户 1234」，以后在「我的」里随时改 */
  function ensureAnonName() {
    if (!store.isAnon || !store.isAnon() || (me().name || '').trim()) return;
    var id = me().id || '', num = parseInt(id.replace(/[^0-9a-f]/gi, '').slice(-6) || '0', 16) % 10000;
    store.updateProfile({ name: t('anonName', { n: ('000' + num).slice(-4) }) });
  }
  function sendLoginLink() {
    var input = $('#login-email'), msg = $('#login-msg'), btn = $('#login-send');
    var addr = (input && input.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    input.removeAttribute('aria-invalid');
    btn.disabled = true;
    store.signInWithEmail(addr).then(function () {
      msg.textContent = t('loginSent', { e: addr });
    }, function (err) {
      msg.textContent = t('loginFail', { m: (err && err.message) || '' });
      btn.disabled = false;
    });
  }
  function hasLegacyData() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_DATA) || 'null');
      return !!(d && Array.isArray(d.reviews) && d.reviews.some(function (r) { return !r.sample; }));
    } catch (e) { return false; }
  }
  function uploadLegacy() {
    confirmBox(t('uploadLocalQ'), t('uploadLocalOk')).then(function (yes) {
      if (!yes) return;
      var legacy = localStore();
      legacy.init().then(function () { return legacy.exportBackup(); }).then(function (obj) {
        return store.importBackup(obj);
      }).then(function (n) {
        refreshMap(); render();
        toast(t('uploadedLocal', { n: n }));
      }, function () { toast(t('saveFail')); });
    });
  }

