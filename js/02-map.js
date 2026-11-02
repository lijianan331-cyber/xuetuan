/* 雪团 js/02-map.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= map ================= */
  var styleCache = {};
  var GLOBE_PROJ = ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator'];
  /* 简洁底图调成雪白：陆地更白，水面浅蓝 */
  function snowTint(style) {
    style.layers.forEach(function (l) {
      l.paint = l.paint || {};
      if (l.type === 'background') l.paint['background-color'] = '#F7FAFD';
      else if (/water/.test(l.id) && l.type === 'fill') l.paint['fill-color'] = '#CFE3F5';
      else if (/water/.test(l.id) && l.type === 'line') l.paint['line-color'] = '#B9D6F0';
    });
  }
  /* 样式只取一次（同时要两次也只发一个请求）。瓦片目录（TileJSON）也顺手取好写进样式，
     地图就不用拿到样式后再等一个来回才开始下瓦片（2026-10-27 提速） */
  function loadStyle(key) {
    if (!styleCache[key]) {
      styleCache[key] = fetch(STYLE_URLS[key]).then(function (res) {
        if (!res.ok) throw new Error('style ' + res.status);
        return res.json();
      }).then(function (json) {
        if (!json || !json.layers) throw new Error('bad style');
        if (key === 'light') snowTint(json);
        return Promise.all(Object.keys(json.sources || {}).map(function (id) {
          var src = json.sources[id];
          if (src.type !== 'vector' || !src.url || src.tiles) return null;
          return fetch(src.url).then(function (res) { return res.ok ? res.json() : null; }).then(function (tj) {
            if (!tj || !tj.tiles || !tj.tiles.length) return;
            ['tiles', 'minzoom', 'maxzoom', 'bounds', 'attribution', 'scheme'].forEach(function (k) { if (tj[k] != null && src[k] == null) src[k] = tj[k]; });
            delete src.url;
          }).catch(function () { /* 取不到就让地图自己去取 */ });
        })).then(function () { return json; });
      });
      styleCache[key].catch(function () { delete styleCache[key]; });
    }
    return styleCache[key].then(function (json) { return JSON.parse(JSON.stringify(json)); });
  }

  function showMapError() {
    var el = $('#map-error');
    el.textContent = t('mapFail');
    el.hidden = false;
  }

  function initMap() {
    if (!window.maplibregl) { showMapError(); return; }
    var v = loadView();
    var first = !v || !v.center;
    loadStyle(state.styleKey).catch(function () {
      state.styleKey = 'light';
      return loadStyle('light');
    }).then(function (style) {
      /* 谷歌底图试用：MapLibre 只画我们自己的东西，底图层全去掉（字体还要用底图的） */
      if (GMAP) style = { version: 8, glyphs: style.glyphs, sources: {}, layers: [] };
      map = new maplibregl.Map({
        container: 'map',
        style: style,
        interactive: !GMAP,
        /* 第一次打开直接在 XMUM，不再从地球飞过去：飞的路上每一级的瓦片都要下载，手机上要等好几秒（2026-10-27 提速） */
        center: first ? [XMUM.lng, XMUM.lat] : v.center,
        zoom: first ? 14.6 : v.zoom,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        /* 提速：高分屏手机按 2 倍画（3 倍屏要多画一倍多的像素，肉眼几乎看不出差别）；
           文字、图标出来时不淡入；多留些瓦片在内存里，放大缩小回来不用重新下载 */
        pixelRatio: DPR,
        fadeDuration: 0,
        maxTileCacheSize: 300,
        localIdeographFontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", sans-serif'
      });
      if (map.touchZoomRotate && map.touchZoomRotate.disableRotation) map.touchZoomRotate.disableRotation();
      if (GMAP) startGoogleMap(first ? [XMUM.lng, XMUM.lat] : v.center, first ? 14.6 : v.zoom);
      /* 面板挡住下面一截，学校要落在看得见的那块中间 */
      if (first) map.jumpTo({ center: [XMUM.lng, XMUM.lat], zoom: 14.6, padding: mapPadding() });
      map.on('style.load', onStyleLoad);
      map.on('click', onMapClick);
      map.on('styleimagemissing', onImageMissing);
      map.on('moveend', function () { if (!gSyncing) onMoveEnd(); });
      if (PERF) { map.on('move', perfMoved); map.on('style.load', perfHook); perfHook(); if (!GMAP) map.on('idle', perfMark); }
      map.on('idle', function () { if (!glyphsWarmed) setTimeout(warmGlyphs, 800); collectBaseNames(); updateHomePlacement(); });
      map.on('zoom', function () { if (state.picking) updatePickUI(); });
      map.on('dragstart', function () { if (state.picking && state.picking.selected) { state.picking.selected = null; updatePickUI(); } });
      map.on('error', function (e) { if (window.console) console.warn('map:', e && e.error ? e.error.message : e); });
    }).catch(function () { showMapError(); });
  }
  var viewTimer = null, lastGlobeChip = false;
  function onMoveEnd() {
    clearTimeout(viewTimer); viewTimer = setTimeout(saveView, 400);
    queueLib();
    ensurePinThumbs();
    updateSelPin();
    var g = globeChipShown();
    if (g !== lastGlobeChip) { lastGlobeChip = g; renderFilters(); }
  }

  /* ================= 实测开关（网址加 ?perf）[建议，用户 2026-10-27 要先在手机上测] =================
   * 左上角一个小黑框，截图发过来就知道慢在哪：
   * 打开：页面出来、地图第一次画完（谷歌底图就是谷歌瓦片第一次加载完）各用了几秒
   * 瓦片：下载了几块、平均几毫秒、最慢一块几毫秒（从手机到瓦片服务器的真实速度）
   * 滑动：最近一次拖动、缩放时每秒几帧、卡顿（一帧超过 50 毫秒）几次、最长一帧几毫秒 */
  var PERF = /[?&]perf\b/.test(location.search) ? { map: 0, n: 0, sum: 0, max: 0, frames: [], jank: [], moving: 0, sh: 0, shMs: 0, gl: 0, glMs: 0, last: 0 } : null;
  function perfMark() { if (PERF && !PERF.map) PERF.map = performance.now(); }
  /* 第一次遇到新东西才做的两件事，量它们花了多久：编译新的着色器、在手机上现画中文字。
     用的是 MapLibre 内部的方法（版本固定 5.24.0），只在 ?perf 时装上 */
  function perfHook() {
    if (!PERF || !map) return;
    var p = map.painter;
    if (p && p.useProgram && !p.__perf) {
      p.__perf = true;
      var use = p.useProgram;
      p.useProgram = function () {
        var before = this.cache ? Object.keys(this.cache).length : 0, t0 = performance.now();
        var r = use.apply(this, arguments);
        if (this.cache && Object.keys(this.cache).length !== before) { PERF.sh++; PERF.shMs += performance.now() - t0; }
        return r;
      };
    }
    var gm = map.style && map.style.glyphManager;
    if (gm && gm._drawGlyph && !gm.__perf) {
      gm.__perf = true;
      var draw = gm._drawGlyph;
      gm._drawGlyph = function () {
        var t0 = performance.now(), r = draw.apply(this, arguments);
        PERF.gl++; PERF.glMs += performance.now() - t0;
        return r;
      };
    }
  }
  function perfMoved() { if (PERF) PERF.moving = performance.now(); }
  function perfStart() {
    if (!PERF) return;
    var box = document.body.appendChild(document.createElement('div'));
    box.id = 'perf';
    box.style.cssText = 'position:fixed;z-index:99;left:4px;top:calc(env(safe-area-inset-top) + 4px);padding:4px 7px;border-radius:7px;background:rgba(0,0,0,.72);color:#fff;font:11px/1.45 monospace;pointer-events:none;white-space:pre';
    try { performance.setResourceTimingBufferSize(3000); } catch (e) { /* old browser */ }
    var tileRe = /\.(pbf|mvt)(\?|$)|googleapis\.com\/maps\/vt|\/maps\/vt\?|\/vt\/pb=/;
    function onEntries(list) {
      list.getEntries().forEach(function (e) {
        if (!tileRe.test(e.name)) return;
        PERF.n++; PERF.sum += e.duration; PERF.max = Math.max(PERF.max, e.duration);
      });
    }
    try { new PerformanceObserver(onEntries).observe({ type: 'resource', buffered: true }); } catch (e) { /* old browser */ }
    /* 只记地图在动的那些帧；停下半秒以上再动算新的一次 */
    function frame(now) {
      if (PERF.last && now - PERF.moving < 120) {
        if (now - (PERF.lastMove || 0) > 500) { PERF.frames = []; PERF.jank = []; }
        else {
          PERF.frames.push(now - PERF.last);
          if (now - PERF.last > 50 && map && PERF.jank.length < 6) PERF.jank.push(map.getZoom().toFixed(1));
        }
        PERF.lastMove = now;
      }
      PERF.last = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    function sec(ms) { return (ms / 1000).toFixed(1) + 's'; }
    function show() {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      var page = nav && nav.domContentLoadedEventEnd ? sec(nav.domContentLoadedEventEnd) : '…';
      var f = PERF.frames, lines = [(GMAP ? '谷歌底图' : '雪团底图') + ' · 打开 页面 ' + page + ' · 地图 ' + (PERF.map ? sec(PERF.map) : '…')];
      lines.push('瓦片 ' + PERF.n + ' 块' + (PERF.n ? ' · 平均 ' + Math.round(PERF.sum / PERF.n) + 'ms · 最慢 ' + Math.round(PERF.max) + 'ms' : ''));
      if (f.length > 5) {
        var sorted = f.slice().sort(function (a, b) { return a - b; }), med = sorted[sorted.length >> 1];
        lines.push('滑动 ' + Math.round(1000 / med) + ' 帧/秒 · 卡顿 ' + f.filter(function (x) { return x > 50; }).length + ' 次 · 最长 ' + Math.round(sorted[sorted.length - 1]) + 'ms');
        if (PERF.jank.length) lines.push('卡在缩放 ' + PERF.jank.join(' '));
      } else lines.push('滑动 拖一下地图再看');
      if (map) lines.push('现在缩放 ' + map.getZoom().toFixed(1) + ' · ' + (GMAP ? '谷歌平面' : map.getZoom() < 7 ? '地球' : '平面'));
      lines.push('新着色器 ' + PERF.sh + ' 个 ' + Math.round(PERF.shMs) + 'ms · 画字 ' + PERF.gl + ' 个 ' + Math.round(PERF.glMs) + 'ms');
      if (PERF.warm) lines.push('提前画字 ' + (PERF.warm - warmTodo.length) + '/' + PERF.warm);
      box.textContent = lines.join('\n');
    }
    show();
    setInterval(show, 500);
  }

  /* ================= 谷歌底图（试用：网址加 &map=google）[建议，用户 2026-10-27 要先试再决定] =================
   * 谷歌地图画在最下面、管手势；我们的 MapLibre 地图叠在上面，背景透明、不接手势，只画自己的东西
   * （图钉、照片、家乡红针、点亮国家），每一帧跟着谷歌的镜头走，原来的地图代码基本不用改。
   * MapLibre 的缩放级别比谷歌小 1（瓦片 512 对 256）。
   * 我们代码里让地图动的地方（flyTo / easeTo / jumpTo / panBy）都转给谷歌，padding 自己换算。
   * 点地图：先看点没点到我们的图钉，再看是不是谷歌地图上的店（谷歌卡片 + 我们的打分），都不是就照原来的处理 */
  var GMAP = /[?&]map=google\b/.test(location.search);
  var gmap = null, gSyncing = false, gPending = null, gAnim = 0, mlJump = null, gLast = {}, gFrames = false;
  function startGoogleMap(center, zoom) {
    document.documentElement.classList.add('gmap-on');
    var el = document.createElement('div');
    el.className = 'gmap';
    mapEl.insertBefore(el, mapEl.firstChild);
    mlJump = map.jumpTo;
    map.jumpTo = function (o) { gCamera(o || {}, false); return map; };
    map.flyTo = map.easeTo = function (o) { o = o || {}; gCamera(o, !reduceMotion && o.duration !== 0, o.duration); return map; };
    map.panBy = function (off) { if (gmap) gmap.panBy(off[0], off[1]); return map; };
    loadGoogle().then(function () { return google.maps.importLibrary('maps'); }).then(function (lib) {
      gmap = new lib.Map(el, {
        center: { lat: center[1], lng: center[0] }, zoom: zoom + 1, mapId: 'DEMO_MAP_ID', disableDefaultUI: true,
        gestureHandling: 'greedy', clickableIcons: true, isFractionalZoomEnabled: true, keyboardShortcuts: false,
        /* 不让两指倾斜、旋转：MapLibre 这边是平的、朝北的，转了图钉就对不上 */
        tiltInteractionEnabled: false, headingInteractionEnabled: false
      });
      /* 每画一帧就把镜头抄给 MapLibre */
      var ov = new lib.WebGLOverlayView();
      ov.onDraw = function (o) { if (o && o.transformer) { gFrames = true; gSyncFrame(o.transformer); } else gSync(); };
      ov.setMap(gmap);
      gmap.addListener('bounds_changed', gSync);
      gmap.addListener('idle', function () { gSync(); onMoveEnd(); });
      gmap.addListener('click', onGoogleClick);
      if (PERF) gmap.addListener('tilesloaded', perfMark);
      if (gPending) { var pd = gPending; gPending = null; gCamera(pd.o, pd.animate, pd.duration); }
    }).catch(function () {
      /* 谷歌加载不了：回到原来的地图 */
      location.replace(location.href.replace(/([?&])map=google\b&?/, '$1').replace(/[?&]$/, ''));
    });
  }
  /* 谷歌矢量地图每画一帧都给一个“这一帧的镜头”（transformer）。直接拿它算 MapLibre 该在哪：
     把中心附近两个点投到屏幕上，得到这一帧的准确中心和缩放。以前读 getCenter()/getZoom()，
     两指缩放时它们和这一帧画出来的不完全一样，再加上 bounds_changed 又按旧值同步一次，图钉就来回晃（用户 2026-10-28 视频） */
  function gSyncFrame(tr) {
    if (!gmap || !map) return;
    var c = gmap.getCenter();
    if (!c) return;
    var el = map.getContainer(), W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    function px(lat, lng) {
      var m = tr.fromLatLngAltitude({ lat: lat, lng: lng, altitude: 0 });
      return { x: (m[12] / m[15] * 0.5 + 0.5) * W, y: (0.5 - m[13] / m[15] * 0.5) * H };
    }
    var lat0 = c.lat(), lng0 = c.lng(), dl = 0.01;
    var p0 = px(lat0, lng0), p1 = px(lat0, lng0 + dl);
    var m0 = merc(lng0, lat0), k = (p1.x - p0.x) / (dl / 360);   /* 整个世界有多少像素宽 */
    if (!(k > 0) || !isFinite(k)) { gSync(); return; }
    var ll = unmerc(m0.x + (W / 2 - p0.x) / k, m0.y + (H / 2 - p0.y) / k), z = Math.log(k / 512) / Math.LN2;
    if (ll.lng === gLast.lng && ll.lat === gLast.lat && z === gLast.mz) return;
    gLast = { lng: ll.lng, lat: ll.lat, mz: z };
    gSyncing = true;
    try {
      mlJump.call(map, { center: [ll.lng, ll.lat], zoom: z, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      if (map.redraw) map.redraw();
    } finally { gSyncing = false; }
  }
  function gSync() {
    /* 有逐帧镜头时只按它来，别的事件不再插一脚 */
    if (!gmap || !map || gFrames) return;
    var c = gmap.getCenter(), z = gmap.getZoom();
    if (!c || z == null) return;
    var lng = c.lng(), lat = c.lat();
    if (lng === gLast.lng && lat === gLast.lat && z === gLast.z) return;
    gLast = { lng: lng, lat: lat, z: z };
    gSyncing = true;
    try {
      mlJump.call(map, { center: [lng, lat], zoom: z - 1, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
      /* 马上画，不等下一帧：等下一帧的话图钉总比谷歌地图慢一帧，一滑就晃（用户 2026-10-27） */
      if (map.redraw) map.redraw();
    } finally { gSyncing = false; }
  }
  function merc(lng, lat) {
    var s = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
    return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }
  function unmerc(x, y) {
    var n = Math.PI - 2 * Math.PI * y;
    return { lng: x * 360 - 180, lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) };
  }
  /* MapLibre 的镜头参数（中心、缩放、padding）换成谷歌的中心和缩放 */
  function gTarget(o) {
    var cur = map.getCenter(), z = o.zoom != null ? o.zoom : map.getZoom();
    var ll = o.center ? maplibregl.LngLat.convert(o.center) : cur;
    var m = merc(ll.lng, ll.lat), p = o.padding;
    if (p && o.center) {
      var ws = 512 * Math.pow(2, z);
      m.x -= ((p.left || 0) - (p.right || 0)) / 2 / ws;
      m.y -= ((p.top || 0) - (p.bottom || 0)) / 2 / ws;
    }
    return { x: m.x, y: m.y, zoom: z };
  }
  function gCamera(o, animate, duration) {
    if (!gmap) { gPending = { o: o, animate: animate, duration: duration }; return; }
    var to = gTarget(o);
    cancelAnimationFrame(gAnim);
    function put(x, y, z) { var ll = unmerc(x, y); gmap.moveCamera({ center: { lat: ll.lat, lng: ll.lng }, zoom: z + 1 }); }
    if (!animate) { put(to.x, to.y, to.zoom); return; }
    var c = gmap.getCenter(), from = merc(c.lng(), c.lat()), fz = gmap.getZoom() - 1;
    /* 离得远就先退到两头都看得见的高度再进去（像 flyTo） */
    var W = map.getContainer().clientWidth || 360, d = Math.hypot(to.x - from.x, to.y - from.y);
    var mid = Math.min(fz, to.zoom, d > 0 ? Math.log(W / (d * 512)) / Math.LN2 - 0.3 : 99);
    var ms = duration != null ? duration : clamp(400 + Math.abs(fz - mid) * 120 + Math.abs(to.zoom - mid) * 120, 400, 1800);
    var t0 = performance.now();
    function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function step(now) {
      var t = Math.min(1, (now - t0) / ms), e = ease(t);
      var z = t < 0.5 ? fz + (mid - fz) * ease(t * 2) : mid + (to.zoom - mid) * ease(t * 2 - 1);
      put(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, z);
      if (t < 1) gAnim = requestAnimationFrame(step);
    }
    gAnim = requestAnimationFrame(step);
  }
  function onGoogleClick(e) {
    if (!e.latLng) return;
    var lngLat = { lng: e.latLng.lng(), lat: e.latLng.lat() }, pt = map.project([lngLat.lng, lngLat.lat]);
    var ev = { point: pt, lngLat: lngLat };
    if (!e.placeId) { onMapClick(ev); return; }
    /* 点到谷歌地图上的店：不弹谷歌自己的小窗。图钉盖在店上面时算点图钉 */
    if (e.stop) e.stop();
    var ours = ['cl-photo', 'cl-circle', 'pt-photo', 'pt-pin', 'hometown-pin', 'home-pin'].filter(function (id) { return map.getLayer(id); });
    var hit = ours.length && map.queryRenderedFeatures([[pt.x - 12, pt.y - 12], [pt.x + 12, pt.y + 10]], { layers: ours }).length;
    if (hit || state.picking) { onMapClick(ev); return; }
    pickResult({ osm: 'g/' + e.placeId, gid: e.placeId, name: '', alt: '', lng: round6(lngLat.lng), lat: round6(lngLat.lat), mode: state.mode, cat: null, precision: 'exact', where: '', google: true, zoom: map.getZoom() });
  }

  function onStyleLoad() {
    poiLayerIds = null;
    /* 谷歌底图下面是平的，MapLibre 也要平的才对得上 */
    if (!GMAP) {
      /* 地球只在看全世界、看几个国家时用，缩到国家以下（7 级）就是平面：PRD V2 说城市和餐厅用平面地图；
         手机实测地球视图在城市级别会卡（原来的 'globe' 要到 12 级才变平面）（2026-10-27 提速） */
      try { map.setProjection({ type: GLOBE_PROJ }); } catch (e) { /* older renderer: stay flat */ }
      try { if (map.setSky) map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }); } catch (e) { /* optional */ }
    }
    if (!map.getSource('places')) { addAppLayers(); world.litKey = null; syncCountries(); }
    if (!hoverBound) {
      hoverBound = true;
      map.on('mousemove', function (e) {
        if (isMobile() || state.picking) return;
        var ours = ['pt-photo', 'pt-pin', 'cl-circle'].filter(function (id) { return map.getLayer(id); });
        var hit = (ours.length && map.queryRenderedFeatures(e.point, { layers: ours }).length) || basePoiAt(e.point);
        map.getCanvas().style.cursor = hit ? 'pointer' : '';
      });
    }
    patchLabels();
    baseFilters = null; trimBaseLabels();
    repaintAccent();
    updateSelection(true);
    if (state.me && map.getSource('me')) map.getSource('me').setData(meFC());
  }
  var hoverBound = false;

  function pickFonts() {
    var regular = null, bold = null;
    var layers = (map.getStyle() || {}).layers || [];
    for (var i = 0; i < layers.length; i++) {
      var f = layers[i].layout && layers[i].layout['text-font'];
      if (Array.isArray(f) && f[0] === 'literal' && Array.isArray(f[1])) f = f[1];
      if (!Array.isArray(f) || typeof f[0] !== 'string') continue;
      if (!regular && /regular/i.test(f[0])) regular = [f[0]];
      if (!bold && /bold/i.test(f[0])) bold = [f[0]];
      if (regular && bold) break;
    }
    regular = regular || bold || ['Noto Sans Regular'];
    return { regular: regular, bold: bold || regular };
  }

  function patchLabels() {
    if (!map) return;
    var expr = state.lang === 'en'
      ? ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]
      : ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name']];
    var layers = (map.getStyle() || {}).layers || [];
    layers.forEach(function (l) {
      if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) return;
      if (APP_LAYERS.indexOf(l.id) !== -1) return;
      if (!/name/.test(JSON.stringify(l.layout['text-field']))) return;
      try { map.setLayoutProperty(l.id, 'text-field', expr); } catch (e) { /* skip layer */ }
    });
  }

  /* 底图只留和吃、玩有关的：地点标签（店、景点）美食地图只留吃喝的，玩乐地图再加景点；
     车站、医院、学校、政府这些不显示（要找直接用谷歌）。小村落、街区名（label_other）也不显示，
     城镇、机场（KLIA）这些大的留着（用户 2026-10-27）。字少了，第一次缩放要现画的中文字也少 */
  var BASE_FOOD = ['restaurant', 'fast_food', 'food_court', 'cafe', 'bar', 'beer', 'pub', 'ice_cream', 'bakery'];
  var BASE_TRAVEL = BASE_FOOD.concat(['attraction', 'museum', 'castle', 'monument', 'zoo', 'aquarium', 'theme_park', 'viewpoint', 'art_gallery']);
  var HIDE_BASE = ['label_other'], BASE_POI_MINZOOM = 15;
  var baseFilters = null;
  function trimBaseLabels() {
    if (!map || GMAP) return;
    var st = map.getStyle();
    if (!st || !st.layers) return;
    if (!baseFilters) {
      baseFilters = {};
      st.layers.forEach(function (l) { if (l.type === 'symbol' && l['source-layer'] === 'poi') baseFilters[l.id] = l.filter || null; });
    }
    var keep = state.mode === 'travel' ? BASE_TRAVEL : BASE_FOOD;
    Object.keys(baseFilters).forEach(function (id) {
      var l = map.getLayer(id);
      if (!l) return;
      /* 底图的店按名气分几层（16、17 级才出小店），放大到 15 级就全出，跟地点库的点一样密（用户 2026-10-28） */
      if ((l.minzoom || 0) > BASE_POI_MINZOOM) try { map.setLayerZoomRange(id, BASE_POI_MINZOOM, l.maxzoom == null ? 24 : l.maxzoom); } catch (e) { /* skip */ }
      var only = ['match', ['get', 'class'], keep, true, false];
      try { map.setFilter(id, baseFilters[id] ? ['all', baseFilters[id], only] : only); } catch (e) { /* skip layer */ }
    });
    HIDE_BASE.forEach(function (id) { if (map.getLayer(id)) try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) { /* skip */ } });
  }

  /* 提前画中文字（2026-10-27 提速）：手机实测第一次缩小会顿一下，之后就顺了——第一次出现的中文字要在手机上现画。
     地图停下来后，悄悄下载附近 6 到 12 级的瓦片，把里面的中文字挑出来，空闲时一点点先画好存着，
     真缩小时就不用现画。用的是 MapLibre 内部的字形缓存（版本固定 5.24.0），没有就跳过 */
  var glyphsWarmed = false;
  function warmGlyphs() {
    if (glyphsWarmed || GMAP || !map || !map.style) return;
    var gm = map.style.glyphManager;
    if (!gm || !(gm._getAndCacheGlyphsPromise || gm.getGlyphs)) return;
    var conn = navigator.connection;
    if (conn && conn.saveData) return;
    glyphsWarmed = true;
    var c = map.getCenter();
    loadStyle(state.styleKey).then(function (style) {
      var tpl = null, maxz = 14;
      Object.keys(style.sources || {}).forEach(function (id) {
        var src = style.sources[id];
        if (!tpl && src.type === 'vector' && src.tiles && src.tiles.length) { tpl = src.tiles[0]; maxz = src.maxzoom || 14; }
      });
      if (!tpl) return;
      var urls = [];
      [12, 11, 10, 9, 8, 7, 6].forEach(function (z) {
        if (z > maxz) return;
        var n = Math.pow(2, z), m = merc(c.lng, c.lat), fx = m.x * n, fy = m.y * n;
        var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = fx - x0 < 0.5 ? x0 - 1 : x0 + 1, y1 = fy - y0 < 0.5 ? y0 - 1 : y0 + 1;
        [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(function (t) {
          if (t[1] < 0 || t[1] >= n) return;
          urls.push(tpl.replace('{z}', z).replace('{x}', ((t[0] % n) + n) % n).replace('{y}', t[1]));
        });
      });
      var chars = new Set(), dec = new TextDecoder('utf-8');
      return Promise.all(urls.map(function (u) {
        return fetch(u).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (buf) {
          if (!buf) return;
          (dec.decode(buf).match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).forEach(function (ch) { chars.add(ch.codePointAt(0)); });
        }).catch(function () {});
      })).then(function () {
        var stacks = [];
        ((map.getStyle() || {}).layers || []).forEach(function (l) {
          var f = l.type === 'symbol' && l.layout && l.layout['text-font'];
          if (!f || !f.every || !f.every(function (x) { return typeof x === 'string'; }) || (l.layout.visibility === 'none')) return;
          var k = f.join(',');
          if (stacks.indexOf(k) === -1) stacks.push(k);
        });
        /* 常规字体最多，先画它 */
        stacks.sort(function (a, b) { return (/Regular/.test(b) ? 1 : 0) - (/Regular/.test(a) ? 1 : 0); });
        var todo = [];
        stacks.forEach(function (k) { chars.forEach(function (cp) { todo.push([k, cp]); }); });
        warmTodo = todo;
        if (PERF) PERF.warm = todo.length;
        pumpWarm();
      });
    }).catch(function () {});
  }
  var warmTodo = [];
  function pumpWarm() {
    if (!warmTodo.length || !map || !map.style) return;
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 60); };
    idle(function (dl) {
      var gm = map.style && map.style.glyphManager;
      if (!gm) { warmTodo = []; return; }
      /* 用户在拖地图时不画，让给地图 */
      if (!map.isMoving || !map.isMoving()) {
        var t0 = performance.now();
        while (warmTodo.length && performance.now() - t0 < 8 && dl.timeRemaining() > 1) {
          var job = warmTodo.shift();
          try {
            if (gm._getAndCacheGlyphsPromise) gm._getAndCacheGlyphsPromise(job[0], job[1]);
            else { var q = {}; q[job[0]] = [job[1]]; gm.getGlyphs(q); }
          } catch (e) { warmTodo = []; }
        }
      }
      pumpWarm();
    });
  }

  /* 收藏过的地点：图钉右上角一个蓝底白星的小圆章（像谷歌地图上收藏的地方带个图标） */
  function drawStarBadge(g, cx, cy, r) {
    g.save();
    g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 2; g.shadowOffsetY = 0.5;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#2E7DCB'; g.fill();
    g.restore();
    g.lineWidth = 1.5; g.strokeStyle = '#ffffff'; g.stroke();
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.3 : r * 0.68;
      g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    g.closePath(); g.fillStyle = '#ffffff'; g.fill();
  }
  /* 一个地点一个圆点（用户 2026-10-28）：有评分按分数的颜色，没评分是蓝色；放大到照片级别再换成照片 */
  var CLUSTER_BLUE = '#5AA2E6', DOT_NONE = CLUSTER_BLUE;
  function drawPin(color, saved) {
    var w = 28, h = 28;
    var cv = document.createElement('canvas');
    cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
    var g = cv.getContext('2d');
    g.scale(DPR, DPR);
    g.save();
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
    g.beginPath(); g.arc(14, 14, 8.5, 0, Math.PI * 2);
    g.fillStyle = '#ffffff'; g.fill();
    g.restore();
    g.beginPath(); g.arc(14, 14, 6.5, 0, Math.PI * 2);
    g.fillStyle = color; g.fill();
    if (saved) drawStarBadge(g, 22, 6, 5.5);
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  /* 图钉颜色按 0.5 分一档，图钉图片用到哪个画哪个 */
  function pinImage(p, score, saved) {
    var bucket = score == null ? null : Math.round(score * 2) / 2;
    var id = 'dot-' + (bucket == null ? 'none' : bucket * 10) + (saved ? '-s' : '');
    if (map && !map.hasImage(id)) map.addImage(id, drawPin(bucket == null ? DOT_NONE : scoreColor(bucket), saved), { pixelRatio: DPR });
    return id;
  }

  /* 有照片的地点放大地图后显示成照片图钉，外框颜色仍然按评分。
     照片要先读出来画成小方块：只读地图上看得到、快放大到位的，最多同时读 3 张 */
  var PIN_PHOTO = 56, PHOTO_PIN_SCALE = 0.85; // 照片外框固定约 53 CSS px，缩放只决定显示点还是照片。
  /* 所有地图、所有地点精度统一到街区级再显示照片。城市全景不混用大照片与数字圈。 */
  var PHOTO_ZOOM = 12;
  function photoZoom(prec, mode) { return PHOTO_ZOOM; }
  /* 差一级就到了才去读照片，世界地图上不白白下载 */
  function photoWanted(p) { return !map || map.getZoom() >= photoZoom(p.precision, p.mode) - 1; }
  /* 所有地点在同一阈值切换；有可用缩略图才显示照片。 */
  function whenPhoto(onPhoto, k) {
    return ['step', ['zoom'], k, PHOTO_ZOOM, ['case', ['==', ['get', 'photo'], true], onPhoto, k]];
  }
  /* 普通图钉的大小；正在看的那家大一圈（像谷歌地图那样，不再在针下面画圈，用户 2026-10-27） */
  function pinSize(selId) {
    function at(v) { return !selId ? v : ['case', ['==', ['get', 'id'], selId], Math.round(v * 1300) / 1000, v]; }
    return ['interpolate', ['linear'], ['zoom'], 2, at(0.66), 12, at(0.85)];
  }
  function photoPinSize(selId) {
    return PHOTO_PIN_SCALE;
  }

  var pinThumbs = new Map();   // 照片 id → 'loading' | canvas | false（读不了）
  var thumbQueue = [], thumbBusy = 0, THUMB_PIN_MAX = 300, pinRefreshTimer = null;
  function photoPinImage(photo, score, saved, count) {
    var cv = pinThumbs.get(photo);
    if (!cv || cv === 'loading' || !map) return null;
    var bucket = score == null ? null : Math.round(score * 2) / 2;
    var id = 'ph-' + photo + '-' + (bucket == null ? 'none' : bucket * 10) + (saved ? '-s' : '') + '-n' + (count || 1);
    if (!map.hasImage(id)) {
      try { map.addImage(id, drawPhotoPin(cv, bucket == null ? DOT_NONE : scoreColor(bucket), saved, count), { pixelRatio: DPR }); } catch (e) { return null; }
    }
    return id;
  }
  function drawPhotoPin(thumb, color, saved, count) {
    var S = PIN_PHOTO, W = S + 12, H = S + 22;
    var cv = document.createElement('canvas');
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    var g = cv.getContext('2d');
    g.scale(DPR, DPR);
    function rounded(x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    /* 外框（评分颜色）+ 下面的小尖角，带一点阴影 */
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 5; g.shadowOffsetY = 1.5;
    g.fillStyle = color;
    rounded(3, 2, S + 6, S + 6, 12); g.fill();
    g.beginPath(); g.moveTo(W / 2 - 8, S + 7); g.lineTo(W / 2 + 8, S + 7); g.lineTo(W / 2, S + 16); g.closePath(); g.fill();
    g.restore();
    g.save();
    rounded(6, 5, S, S, 9); g.clip();
    g.drawImage(thumb, 6, 5, S, S);
    g.restore();
    if (saved) drawStarBadge(g, W - 8, 8, 7);
    if (count > 1) {
      var label = count > 99 ? '99+' : String(count), bw = label.length > 2 ? 26 : 20;
      g.fillStyle = 'rgba(255,255,255,.96)'; rounded(W - bw - 7, S - 13, bw, 18, 8); g.fill();
      g.fillStyle = '#25445e'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, W - bw / 2 - 7, S - 4);
    }
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  function loadImage(u) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (!/^(blob|data):/.test(u)) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image')); };
      img.src = u;
    });
  }
  function loadPinThumb(photo) {
    return store.photoURL(photo, true).then(function (u) {
      if (!u) throw new Error('no photo');
      return loadImage(u).catch(function () {
        return store.photoURL(photo).then(function (full) { if (!full || full === u) throw new Error('no photo'); return loadImage(full); });
      });
    }).then(function (img) {
      var px = Math.round(PIN_PHOTO * DPR), cv = document.createElement('canvas');
      cv.width = cv.height = px;
      var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h), g = cv.getContext('2d');
      g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, px, px);
      g.getImageData(0, 0, 1, 1);   /* 跨域读不了像素的话这里会出错，就当没有照片 */
      return cv;
    });
  }
  function queueThumb(photo) {
    if (pinThumbs.has(photo) || pinThumbs.size >= THUMB_PIN_MAX) return;
    pinThumbs.set(photo, 'loading');
    thumbQueue.push(photo);
    pumpThumbs();
  }
  function pumpThumbs() {
    while (thumbBusy < 3 && thumbQueue.length) {
      var photo = thumbQueue.shift();
      thumbBusy++;
      (function (photo) {
        loadPinThumb(photo).then(function (cv) { pinThumbs.set(photo, cv); }, function () { pinThumbs.set(photo, false); })
          .then(function () { thumbBusy--; pumpThumbs(); queuePinRefresh(); });
      })(photo);
    }
  }
  function queuePinRefresh() {
    clearTimeout(pinRefreshTimer);
    pinRefreshTimer = setTimeout(function () {
      var src = map && map.getSource && map.getSource('places');
      if (src) src.setData(placesGeoJSON());
      updateSelPin();
    }, 120);
  }
  function viewBounds() {
    try { return map && map.getBounds ? map.getBounds() : null; } catch (e) { return null; }
  }
  /* 地图挪动后，看得到但照片还没读的地点去读照片 */
  function ensurePinThumbs() {
    var b = viewBounds();
    placesInView().forEach(function (p) {
      var photo = coverPhoto(p);
      if (photo && !pinThumbs.has(photo) && photoWanted(p) && (!b || b.contains([p.lng, p.lat]))) queueThumb(photo);
    });
  }

  function placesInView() {
    if (hometownMode()) return [];
    return store.places().filter(function (p) { return inScope(p) && passesFilters(p); });
  }
  function placesGeoJSON() {
    if (hometownMode()) return { type: 'FeatureCollection', features: [] };
    var b = viewBounds(), points = new Map();
    placesInView().forEach(function (p) {
        /* 收藏地图上每个都是收藏的，就不再加星 */
        var saved = state.scope !== 'saved' && store.isSaved(p.id);
        var s = stats(p), photo = coverPhoto(p), count = placePhotos(p).length, ph = photo ? photoPinImage(photo, s.score, saved, count) : null;
        if (photo && !ph && !pinThumbs.has(photo) && photoWanted(p) && (!b || b.contains([p.lng, p.lat]))) queueThumb(photo);
        var f = {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { id: p.id, name: /^g\//.test(p.osm || '') ? '' : placeTitle(p), mode: p.mode, icon: pinImage(p, s.score, saved), pic: ph || '', photo: !!ph, photoRef: ph ? JSON.stringify([photo, s.score, saved]) : '', photoCount: count, photoTotal: count, locationCount: 1, saved: saved, color: scoreColor(s.score), precision: p.precision }
        }, key = p.lng.toFixed(6) + ',' + p.lat.toFixed(6), old = points.get(key);
        if (!old) { f.properties.memberIds = JSON.stringify([p.id]); points.set(key, f); }
        else {
          var ids = JSON.parse(old.properties.memberIds); ids.push(p.id); old.properties.memberIds = JSON.stringify(ids);
          old.properties.photoCount += count;
          old.properties.photoTotal = old.properties.photoCount;
          old.properties.point_count = old.properties.locationCount = ids.length;
          old.properties.point_count_abbreviated = String(ids.length);
          if (!old.properties.photoRef && f.properties.photoRef) { old.properties.photoRef = f.properties.photoRef; old.properties.photo = true; }
          if (old.properties.photoRef) {
            var ref = JSON.parse(old.properties.photoRef);
            old.properties.pic = photoPinImage(ref[0], ref[1], ref[2], old.properties.photoCount) || old.properties.pic;
          }
        }
    });
    return { type: 'FeatureCollection', features: Array.from(points.values()) };
  }
