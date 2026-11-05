/* 雪团 js/04-ui.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= sheet ================= */
  var panel = $('#panel'), stage = $('#stage'), view = $('#view');

  /* 真实可见高度：有 visualViewport 就用它（没在双指缩放时），量完写进 --app-h，整个界面按它排 */
  var appH = 0;
  function measureAppH() {
    var vv = window.visualViewport, h = window.innerHeight;
    if (vv && vv.scale && Math.abs(vv.scale - 1) < 0.01 && vv.height > 0) h = Math.min(h, vv.height);
    return Math.round(h);
  }
  /* 键盘弹起时浏览器可能把可见区域往下挪，界面要跟着挪，不然顶部被切掉、底部滑不到 */
  var appTop = 0, fullH = 0, kbOpen = false;
  /* 网址后面加 ?debug：左上角显示量到的高度，真机上出问题时截图给我们看 */
  var debugBox = /[?&]debug\b/.test(location.search) ? document.body.appendChild(document.createElement('div')) : null;
  if (debugBox) debugBox.style.cssText = 'position:fixed;z-index:99;left:4px;top:4px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;font:11px/1.4 monospace;pointer-events:none';
  function measureAppTop() {
    var vv = window.visualViewport;
    return vv && vv.scale && Math.abs(vv.scale - 1) < 0.01 ? Math.max(0, Math.round(vv.offsetTop)) : 0;
  }
  function typingNow() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|checkbox|radio|file|submit)$/.test(a.type)));
  }
  /* 只滚面板里的列表，不用 scrollIntoView：它会把 overflow:hidden 的外层也滚动，整个界面往上错位 */
  function centerInPanel(el, smooth) {
    var body = el.closest && el.closest('.panel-body');
    if (!body) return;
    var r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
    var top = body.scrollTop + (r.top + r.height / 2) - (b.top + b.height / 2);
    if (smooth && body.scrollTo) body.scrollTo({ top: top, behavior: 'smooth' }); else body.scrollTop = top;
  }
  /* 浏览器给输入框让位时会偷偷滚动外层容器（哪怕是 overflow:hidden），发现了就滚回去 */
  var appEl = document.getElementById('app');
  function unscrollApp() { if (appEl.scrollTop || appEl.scrollLeft) { appEl.scrollTop = 0; appEl.scrollLeft = 0; } }
  appEl.addEventListener('scroll', unscrollApp);
  /* 键盘弹起来了吗：新的 Chrome 键盘只缩小可见区域（innerHeight 不变）；老的会把整页变矮，就跟没打字时的高度比。
     浏览器自己的地址栏、工具栏出现也会让页面变矮一截，所以要矮到四分之三以下才算键盘，不然标签栏会被错收起来 */
  function keyboardUp(h) {
    var vv = window.visualViewport;
    if (vv && vv.scale && Math.abs(vv.scale - 1) < 0.01 && window.innerHeight - vv.height > 150) return true;
    return fullH > 0 && h < fullH * 0.75;
  }
  /* 拖面板、碰地图时收起键盘：输入框一直留着焦点的话，有的浏览器收了键盘还算在打字 */
  function blurTyping() { if (typingNow()) document.activeElement.blur(); }
  /* 华为浏览器刚打开时顶上多一行“相关搜索”，报给网页的却是那行收起后的高度（?debug 量到 668，实际只露出约 615），
     标签栏被挤到底部工具栏后面，要用户先滑一下那行才收起（用户 2026-10-28）。打开时替用户把页面滚 1 像素再滚回来，
     让浏览器以为滑过了、收起那一行；不支持的浏览器什么也不发生 */
  var nudging = false;
  function nudgeBrowserBars() {
    if (!isMobile() || typingNow()) return;
    var de = document.documentElement, b = document.body;
    nudging = true;
    de.style.overflow = b.style.overflow = 'auto';
    b.style.height = 'calc(100% + 80px)';
    window.scrollTo(0, 1);
    setTimeout(function () {
      window.scrollTo(0, 0);
      de.style.overflow = b.style.overflow = b.style.height = '';
      nudging = false;
      syncViewport();
    }, 450);
  }
  function syncViewport() {
    var h = measureAppH(), top = measureAppTop(), typing = typingNow();
    if (!nudging && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
    unscrollApp();
    if (!typing) fullH = h;
    else if (h > fullH) fullH = h;
    /* 正在打字、可见高度又明显变矮，就当是键盘弹起来了：先把标签栏收起来，给表单腾地方 */
    var kb = typing && isMobile() && keyboardUp(h);
    if (debugBox) debugBox.textContent = 'inner ' + window.innerHeight + ' vv ' + (window.visualViewport ? Math.round(window.visualViewport.height) + '@' + Math.round(window.visualViewport.offsetTop) : '-') +
      ' app ' + h + ' full ' + fullH + (typing ? ' typing' : '') + (kb ? ' KB' : '') + ' snap ' + state.snap + ' tab ' + Math.round($('#tabbar').getBoundingClientRect().bottom);
    if (h === appH && top === appTop && kb === kbOpen) return;
    appH = h; appTop = top; kbOpen = kb;
    var root = document.documentElement;
    root.style.setProperty('--app-h', h + 'px');
    root.style.setProperty('--app-top', top + 'px');
    root.classList.toggle('kb-open', kb);
    applySnap();
    if (map) map.resize();
    /* 键盘刚弹起：把正在填的那一栏滑到中间 */
    if (kb) setTimeout(function () { var a = document.activeElement; if (a && typingNow()) centerInPanel(a); }, 60);
  }
  function snapVisible(snap) {
    if (!isMobile()) return 0;
    var H = appH || window.innerHeight;
    if (snap === 'hidden') return 0;
    if (snap === 'peek') return peekH();
    if (snap === 'half') return Math.round((H - tabbarH()) * 0.5);
    return panel.offsetHeight || H;   /* full；page（整页）时面板本身就是整屏高 */
  }
  /* 收到最低时只露出标题这一截（像谷歌地图收起来的样子），不露半截列表：量到标题（和示例提示）的底边为止 */
  function peekH() {
    var heads = view.querySelectorAll('.view-head, .foot-tools, .sample-note, .place-head'), last = heads[heads.length - 1];
    if (!last) return 96;
    return clamp(Math.round(last.offsetTop + last.offsetHeight + 10), 64, 150);
  }
  function tabbarH() { var tb = $('#tabbar'); return tb && isMobile() ? tb.offsetHeight : 0; }
  /* 足迹的列表面板记住拉到多高，切回来时还是那样；首页、我的是整页，探索只有地图，都不记 */
  function rememberFeedSnap() {
    if (state.view === 'feed' && state.tab === 'foot' && state.scope === 'mine' && /^(peek|half|full)$/.test(state.snap)) state.feedSnap = state.snap;
  }
  function setSnap(snap) {
    /* 收到最低时回到最上面，露出标题，不露半截列表 */
    if (snap === 'peek' && isMobile()) view.scrollTop = 0;
    /* 整页和面板之间换，不滑动，直接换（像换了一页） */
    var jump = isMobile() && (snap === 'page') !== (state.snap === 'page');
    if (jump) panel.classList.add('no-anim');
    state.snap = snap;
    panel.dataset.snap = snap;
    rememberFeedSnap();
    applySnap();
    if (jump) { void panel.offsetHeight; requestAnimationFrame(function () { panel.classList.remove('no-anim'); }); }
  }
  function applySnap() {
    /* 先标上 page，面板变成整屏高，再量 */
    document.body.dataset.snap = isMobile() ? state.snap : '';
    /* 露出来的高度不能超过面板本身，不然面板会悬在半空 */
    var v = Math.min(snapVisible(state.snap), panel.offsetHeight || Infinity);
    /* 收起时连标签栏的高度也一起移出屏幕 */
    panel.style.setProperty('--visible', (state.snap === 'hidden' && isMobile() ? -(parseFloat(getComputedStyle(panel).bottom) || 0) : v) + 'px');
    panel.style.setProperty('--hidden', (isMobile() ? Math.max(0, panel.offsetHeight - v) : 0) + 'px');
    stage.style.setProperty('--sheet-visible', (isMobile() ? Math.min(v, Math.round((appH || window.innerHeight) * 0.5)) : 0) + 'px');
    if(typeof syncPersonMapLayout==='function')syncPersonMapLayout(false);
  }

  /* 拖面板：拖上面的小横条，或者像谷歌地图那样直接拖内容——
     内容已经在最上面时往下拖是收面板，面板没拉满时往上拖是拉面板，其余照常滚列表。
     手势自己接住（preventDefault），不然有的手机浏览器会把往下划当成自己的（弹出工具栏、下拉刷新），把标签栏盖住 */
  (function setupDrag() {
    var grip = $('#grip'), drag = null, touch = null;
    function snaps() { return ['peek', 'half', 'full'].map(function (s) { return { s: s, v: snapVisible(s) }; }); }
    function begin(y) {
      blurTyping();
      drag = { y0: y, t0: performance.now(), start: snapVisible(state.snap), vis: snapVisible(state.snap), moved: false };
      panel.classList.add('dragging');
    }
    function move(y) {
      var dy = y - drag.y0;
      if (Math.abs(dy) > 4) drag.moved = true;
      drag.vis = clamp(drag.start - dy, 60, panel.offsetHeight);
      panel.style.setProperty('--visible', drag.vis + 'px');
    }
    function end() {
      if (!drag) return;
      panel.classList.remove('dragging');
      var d = drag; drag = null;
      if (!d.moved) {
        setSnap(state.snap === 'peek' ? 'half' : state.snap === 'half' ? (state.view === 'feed' ? 'full' : 'peek') : 'half');
        return;
      }
      var dt = Math.max(1, performance.now() - d.t0);
      var velocity = (d.vis - d.start) / dt;
      var target = d.vis + velocity * 220;
      var best = snaps().reduce(function (a, b) { return Math.abs(b.v - target) < Math.abs(a.v - target) ? b : a; });
      setSnap(best.s);
    }
    grip.addEventListener('pointerdown', function (e) {
      if (!isMobile() || drag || state.snap === 'page') return;
      begin(e.clientY);
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    grip.addEventListener('pointermove', function (e) { if (drag && !touch) move(e.clientY); });
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);

    panel.addEventListener('touchstart', function (e) {
      touch = null;
      if (!isMobile() || drag || state.snap === 'page' || e.touches.length !== 1 || e.target.closest('#grip, input, textarea, select, .stars-input, .bk-map, .ph-edit, .bk-ph')) return;
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, sheet: null };
    }, { passive: true });
    panel.addEventListener('touchmove', function (e) {
      if (!touch) return;
      var p = e.touches[0], dx = p.clientX - touch.x, dy = p.clientY - touch.y;
      if (touch.sheet === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        var down = dy > 0 && view.scrollTop <= 0, up = dy < 0 && state.snap !== 'full';
        touch.sheet = Math.abs(dy) > Math.abs(dx) && (down || up);
        if (!touch.sheet) { touch = null; return; }
        begin(touch.y);
      }
      if (e.cancelable) e.preventDefault();
      move(p.clientY);
    }, { passive: false });
    function touchEnd() { if (touch && touch.sheet) end(); touch = null; }
    panel.addEventListener('touchend', touchEnd);
    panel.addEventListener('touchcancel', touchEnd);
    /* 碰地图就收起键盘 */
    $('#map').addEventListener('pointerdown', blurTyping);
  })();

  /* ================= chrome ================= */
  function applyStaticI18n() {
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $$('[data-i18n-title]').forEach(function (el) { el.setAttribute('title', t(el.dataset.i18nTitle)); });
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : uiLang();
  }
  function renderChrome() {
    document.documentElement.classList.toggle('mode-travel', state.mode === 'travel');
    var fab = $('#fab'), fabT = t(state.mode === 'food' ? 'addFood' : 'addTravel');
    fab.setAttribute('aria-label', fabT); fab.title = fabT;
    renderFilters();
    renderTabs();
    if (state.picking) updatePickUI();
    if (state.bsheet) renderBSheet();
  }
  /* 底部四栏（V2.0）：首页 = 地图预览 + 大家最新分享；探索 = 公开的大地图；
     足迹 = 我去过 / 想去（筛选里切换）；我的 = 资料和设置。加一笔只在足迹上 */
  function renderTabs() {
    state.mineSub = 'mine';
    /* “我的”主页用分组卡片的灰底（css: html[data-page="me"]），只在资料页本身，不影响从这里打开的别的页面 */
    document.documentElement.dataset.page = state.view === 'feed' ? state.tab : state.view;
    $$('#tabbar [data-tab]').forEach(function (b) {
      if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.documentElement.classList.toggle('scope-my', state.tab === 'foot');
  }
  var SCORE_STEPS = [0, 3, 4];
  var DIST_STEPS = ['any'].concat(DIST_TIERS.map(function (x) { return x.id; }));
  function activeFilterCount() {
    if (state.scope === 'person') return 0;
    return (state.cat !== 'all' ? 1 : 0) + (state.minScore ? 1 : 0) + (state.dist !== 'any' ? 1 : 0) + (state.priceAbout ? 1 : 0) + (state.halal ? 1 : 0);
  }
  var CTRL_ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    landscape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 20 7-12 5 8 3-5 5 9H2Z"/><circle cx="17" cy="5" r="2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 19 14-14M7 5h12v12"/></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>',
    food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3v7m3-7v7M3 3v5a3 3 0 0 0 6 0V3M6 11v10M17 3c-3 3-3 7-3 9h4V3h-1zm1 9v9"/></svg>',

    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>'
  };
  /* 地图右上角的按钮：吃/玩切换、筛选；我的地图缩小到国家级别再多一个“点亮国家”。左上角是家乡红针的说明小签 */
  function renderFilters() {
    var food = state.mode === 'food', n = activeFilterCount();
    lastGlobeChip = globeChipShown();
    var toKey = food ? 'modeToTravel' : 'modeToFood';
    /* 搜索条右边原来是个斜箭头（像外链），换成放大镜；美食 / 玩乐两段都写出来，亮的那段是现在这张图（2026-11-01 精修） */
    var h = '<button type="button" class="map-search" data-action="search" aria-label="' + esc(t('searchBtn')) + '"><img src="assets/search-pin.png" alt=""><span>' + esc(t('mapSearchPh')) + '</span>' + CTRL_ICON.search + '</button>';
    /* 个人主页的地图美食玩乐一起看，不用切换和筛选 */
    if (state.scope !== 'person') h += '<button type="button" class="icon-btn mode-btn" data-action="toggle-mode" aria-label="' + esc(t(toKey)) + '" title="' + esc(t(toKey)) + '">' +
      '<span class="mode-opt' + (food ? ' on' : '') + '">' + CTRL_ICON.food + '<span>' + esc(t('food')) + '</span></span>' +
      '<span class="mode-opt' + (food ? '' : ' on') + '">' + CTRL_ICON.landscape + '<span>' + esc(t('scenery')) + '</span></span></button>';
    if (state.scope !== 'person') h += '<button type="button" class="icon-btn filter-btn" data-action="filters" aria-pressed="' + (n > 0) + '" aria-label="' + esc(t('filterBtn')) + '" title="' + esc(t('filterBtn')) + '">' + CTRL_ICON.filter + (n ? '<b>' + n + '</b>' : '') + '</button>';
    if (globeChipShown()) {
      var lit = state.countries && world.fc;
      h += '<button type="button" class="icon-btn globe-btn" data-action="countries" aria-pressed="' + state.countries + '" aria-label="' + esc(t('litCountries')) + '" title="' + esc(t('litCountries')) + '">' + CTRL_ICON.globe + (lit ? '<b>' + world.litCount + '</b>' : '') + '</button>';
    }
    $('#map-ctrls').innerHTML = h;
    /* 玩乐大地图左上角：红针是什么、有几位，点一下收起 / 显示；没人公开家乡就不出 */
    var publicHomes = hometownMode(), ownHome = false; /* 我的家开关挪进筛选了 */
    var homeLabel = publicHomes ? (state.lang === 'en' ? L('Back to explore') : '返回探索') : (state.lang === 'en' ? L('Show my hometown') : '显示我的家乡');
    $('#map-chips').innerHTML = publicHomes || ownHome ? '<button type="button" class="map-chip' + (publicHomes ? '' : ' homes-switch') + '" data-action="' + (publicHomes ? 'homes-toggle' : 'mine-home-toggle') + '" aria-label="' + esc(homeLabel) + '" title="' + esc(homeLabel) + '" aria-pressed="' + (publicHomes ? state.homesOn : state.mineHomeOn) + '">' + (publicHomes ? ICON.back + esc(homeLabel) : ICON.home) + '</button>' : '';
  }

  /* 我的地图只分 美食 / 玩乐 / 合并（在筛选里选） */
  var COUNTRY_ZOOM = 5;
  function mineView() { return state.mineBoth ? 'both' : state.mode; }
  function globeChipShown() { return state.scope === 'mine' && (state.mode === 'travel' || state.mineBoth) && !!map && map.getZoom() <= COUNTRY_ZOOM; }
  function setMineView(v) {
    if (v === 'both') {
      state.mineBoth = true;
      renderChrome(); refreshMap();
      if (state.view === 'feed') render();
    } else {
      var same = v === state.mode;
      state.mineBoth = false;
      if (same) { renderChrome(); refreshMap(); if (state.view === 'feed') render(); }
      else setMode(v);
    }
    saveView();
  }
  /* ================= 点亮去过的国家 =================
   * 国家边界：world-atlas（Natural Earth 1:50m，公有领域），打开开关时才下载。
   * 去过 = 我自己记录过的地点（吃和玩都算）落在哪个国家里。 */
  var WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
  var TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js';
  var world = { fc: null, loading: null, litKey: null, litCount: 0 };
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = resolve; el.onerror = function () { reject(new Error('script ' + src)); };
      document.head.appendChild(el);
    });
  }
  /* 读照片拍摄时间 / 位置的小库：点“+”时就先在后台下好，选照片时不用再等它（用户 2026-11-02 嫌读照片慢） */
  var exifrLoading = null;
  function loadExifr() {
    if (window.exifr) return Promise.resolve();
    if (!exifrLoading) exifrLoading = loadScript(EXIFR_URL).catch(function (e) { exifrLoading = null; throw e; });
    return exifrLoading;
  }
  function loadWorld() {
    if (world.loading) return world.loading;
    world.loading = Promise.all([
      window.topojson ? null : loadScript(TOPOJSON_URL),
      fetch(WORLD_URL).then(function (res) { if (!res.ok) throw new Error('world ' + res.status); return res.json(); })
    ]).then(function (res) {
      var topo = res[1];
      var fc = window.topojson.feature(topo, topo.objects.countries);
      /* 南极整圈绕着极点，球面上画不好，不要了；跨 180° 经线的（俄罗斯东端、斐济）把西经那半挪到 180° 以东，免得绕地球一圈 */
      fc.features = fc.features.filter(function (f) { return f.id !== '010'; });
      fc.features.forEach(function (f) {
        f.polys = polysOf(f.geometry);
        f.polys.forEach(unwrapPoly);
        f.box = boxOf(f.polys);
      });
      world.fc = fc;
      return fc;
    });
    world.loading.catch(function () { world.loading = null; });
    return world.loading;
  }
  function polysOf(g) { return !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function unwrapPoly(poly) {
    var lo = false, hi = false;
    poly[0].forEach(function (c) { if (c[0] < -170) lo = true; if (c[0] > 170) hi = true; });
    if (lo && hi) poly.forEach(function (ring) { ring.forEach(function (c) { if (c[0] < 0) c[0] += 360; }); });
  }
  function boxOf(polys) {
    var b = [Infinity, 90, -Infinity, -90];
    polys.forEach(function (poly) { poly[0].forEach(function (c) {
      if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
    }); });
    return b;
  }
  function inRing(x, y, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function inPoly(x, y, poly) {
    if (!inRing(x, y, poly[0])) return false;
    for (var k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) return false;
    return true;
  }
  /* 落在哪个国家；海边、小岛不在 1:50m 轮廓里的，就算离得最近的国家（0.5 度以内） */
  var NEAR_DEG = 0.5;
  function countryAt(lng, lat) {
    var i = countryNear(lng, lat);
    return i < 0 && lng < -150 ? countryNear(lng + 360, lat) : i;
  }
  function countryNear(lng, lat) {
    var feats = world.fc.features, near = -1, nearD = NEAR_DEG * NEAR_DEG;
    for (var i = 0; i < feats.length; i++) {
      var b = feats[i].box;
      if (lng < b[0] - NEAR_DEG || lng > b[2] + NEAR_DEG || lat < b[1] - NEAR_DEG || lat > b[3] + NEAR_DEG) continue;
      var polys = feats[i].polys;
      for (var k = 0; k < polys.length; k++) {
        if (inPoly(lng, lat, polys[k])) return i;
        polys[k][0].forEach(function (c) {
          var dx = c[0] - lng, dy = c[1] - lat, d = dx * dx + dy * dy;
          if (d < nearD) { nearD = d; near = i; }
        });
      }
    }
    return near;
  }
  function visitedCountries() {
    var lit = {};
    store.places().forEach(function (p) {
      if (!reviewsOf(p.id).some(isMine)) return;
      var i = countryAt(p.lng, p.lat);
      if (i >= 0) lit[i] = true;
    });
    return lit;
  }
  function countriesOn() { return state.countries && state.scope === 'mine' && (state.mode === 'travel' || state.mineBoth); }
  var COUNTRY_LAYERS = ['ct-dim', 'ct-lit', 'ct-line'];
  function syncCountries() {
    if (!map || !map.getSource('places')) return;
    var on = countriesOn();
    if (on && !world.fc) {
      loadWorld().then(function () { syncCountries(); renderFilters(); }, function () {
        state.countries = false; renderFilters(); toast(t('worldFail'));
      });
      return;
    }
    if (!on) {
      COUNTRY_LAYERS.forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none'); });
      return;
    }
    var lit = visitedCountries(), key = Object.keys(lit).sort().join(',');
    var n = Object.keys(lit).length;
    if (n !== world.litCount) { world.litCount = n; renderFilters(); }
    var src = map.getSource('countries');
    if (!src || key !== world.litKey) {
      var data = { type: 'FeatureCollection', features: world.fc.features.map(function (f, i) {
        return { type: 'Feature', geometry: f.geometry, properties: { v: lit[i] ? 1 : 0, name: (f.properties && f.properties.name) || '' } };
      }) };
      if (src) src.setData(data);
      else addCountryLayers(data);
      world.litKey = key;
    }
    COUNTRY_LAYERS.forEach(function (id) { map.setLayoutProperty(id, 'visibility', 'visible'); });
  }
  function addCountryLayers(data) {
    map.addSource('countries', { type: 'geojson', data: data });
    var fade = function (a) { return ['interpolate', ['linear'], ['zoom'], 3, a, 5.5, a * 0.8, 7, 0]; };
    map.addLayer({ id: 'ct-dim', type: 'fill', source: 'countries', maxzoom: 8, filter: ['==', ['get', 'v'], 0],
      paint: { 'fill-color': '#0B1626', 'fill-opacity': fade(0.5) } }, 'cl-halo');
    map.addLayer({ id: 'ct-lit', type: 'fill', source: 'countries', maxzoom: 8, filter: ['==', ['get', 'v'], 1],
      paint: { 'fill-color': '#FFC23D', 'fill-opacity': fade(0.55) } }, 'cl-halo');
    map.addLayer({ id: 'ct-line', type: 'line', source: 'countries', maxzoom: 8, filter: ['==', ['get', 'v'], 1],
      paint: { 'line-color': '#F29D00', 'line-width': 1.4, 'line-opacity': fade(0.9) } }, 'cl-halo');
  }

  /* ================= bottom sheets: 筛选、去哪儿看 ================= */
  function openBSheet(kind) { state.bsheet = kind; renderBSheet(); $('#bsheet').hidden = false; syncNavGuard(); }
  function closeBSheet() { state.bsheet = null; $('#bsheet').hidden = true; $('#bsheet-card').innerHTML = ''; syncNavGuard(); }
  function optHTML(action, v, on, label) {
    return '<button type="button" class="chip" data-action="' + action + '" data-v="' + v + '" aria-pressed="' + on + '">' + esc(label) + '</button>';
  }
  function renderBSheet() {
    var card=$('#bsheet-card'),h='';
    if(state.bsheet==='lang') h=langSheetHTML();
    if(state.bsheet==='filters') {
      var mine=state.scope==='mine', both=mine&&state.mineBoth, food=both||state.mode==='food';
      var shown=store.places().filter(function(p){return inScope(p)&&passesFilters(p);}).length;
      h+='<div class="bsheet-head"><h3>'+esc(t('filtersTitle'))+'</h3></div>';
      var modes=both?['food','travel']:[state.mode];
      modes.forEach(function(mode){
        h+='<div class="field"><span class="f-label">'+esc(both?t(mode==='food'?'food':'scenery')+' · '+t('filterCat'):t('filterCat'))+(mode==='food'?'<button type="button" class="halal-filter" role="switch" data-action="halal-toggle" aria-label="Halal" aria-checked="'+!!state.halal+'" title="'+esc(state.lang==='en'?'Halal estimate. Please check with the restaurant.':'按店名和分类估计，请自行向店家确认')+'">Halal</button>':'')+'</span><div class="chips-wrap">'+(mode===modes[0]?'<button type="button" class="chip" data-action="cat" data-cat="all" aria-pressed="'+(state.cat==='all')+'">'+esc(t('catAll'))+'</button>':'')+
          catChoices(mode).map(function(c){return '<button type="button" class="chip" data-action="cat" data-cat="'+c.id+'" data-cat-mode="'+mode+'" aria-pressed="'+(state.cat===c.id)+'">'+catIconHTML(c)+esc(catName(c))+'</button>';}).join('')+'</div></div>';
      });
      h+='<div class="field"><span class="f-label">'+esc(t('filterScore'))+'<span class="legend" aria-hidden="true"><b>0</b><i></i><b>5</b></span></span><div class="chips-wrap">'+SCORE_STEPS.map(function(n){return optHTML('set-score',n,state.minScore===n,n?t('scoreOpt',{n:n}):t('anyOpt'));}).join('')+'</div></div>';
      h+='<div class="field"><span class="f-label">'+esc(t('filterDist'))+'</span><div class="chips-wrap">'+DIST_STEPS.map(function(d){return optHTML('set-dist',d,state.dist===d,d==='any'?t('anyOpt'):t('dist_'+d));}).join('')+'</div></div>';
      if(food) {
        var pi=Math.max(0,PRICE_STOPS.indexOf(state.priceAbout));
        h+='<div class="field price-field"><span class="f-label">'+esc(t('filterPrice'))+'<b id="flt-price-val"'+(pi?'':' class="muted"')+'>'+esc(priceLabel(state.priceAbout))+'</b></span><input type="range" id="flt-price" min="0" max="'+(PRICE_STOPS.length-1)+'" step="1" value="'+pi+'" style="--fill:'+(pi/(PRICE_STOPS.length-1)*100)+'%" aria-label="'+esc(t('filterPrice'))+'"><div class="price-ticks" aria-hidden="true"><span>'+esc(t('anyOpt'))+'</span><span>RM500</span></div></div>';
      }
      if(mine&&store.myHome()) h+='<button type="button" class="switch-row" role="switch" data-action="mine-home-toggle" aria-checked="'+state.mineHomeOn+'"><span class="sw-text"><b>'+esc(state.lang==='en'?L('Show my home'):'显示我的家')+'</b><small>'+esc(state.lang==='en'?L('A little house on your hometown'):'在家乡的位置放一个小房子')+'</small></span><span class="switch" aria-hidden="true"></span></button>';
      if(mine&&state.tab==='foot') h+='<button type="button" class="switch-row" role="switch" data-action="mine-dots-toggle" aria-checked="'+!state.mineDots+'"><span class="sw-text"><b>'+esc(state.lang==='en'?L('Group nearby places'):'缩小时合并成数字')+'</b><small>'+esc(state.lang==='en'?L('Turn off to see every place as its own dot'):'关掉就每个地点一个点，不合并')+'</small></span><span class="switch" aria-hidden="true"></span></button>';
      h+='<div class="bsheet-foot"><button type="button" class="btn ghost" data-action="clear-filters">'+esc(t('filterReset'))+'</button><button type="button" class="btn primary" data-action="sheet-close">'+esc(t('filterShow',{n:shown}))+'</button></div>';
    }
    card.innerHTML=h;
  }
  /* 常去的地方：搜索框还没输字时列在搜索页里 */
  function areasHTML() {
    var pin = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22c-.4 0-7-6.6-7-12a7 7 0 0 1 14 0c0 5.4-6.6 12-7 12zm0-9.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"/></svg>';
    var li = function (inner) { return '<li>' + inner + '</li>'; };
    var h = '<li class="sec-title">' + esc(t('areasTitle')) + '</li>';
    h += li('<button type="button" class="area-opt" data-action="locate">' + ICON.nav + esc(t('locate')) + '</button>');
    PRESET_AREAS.forEach(function (a) { h += li('<button type="button" class="area-opt" data-action="goto-area" data-id="' + esc(a.id) + '">' + pin + esc(state.lang === 'en' ? L(a.en) : a.zh) + '</button>'); });
    store.areas().forEach(function (a) { h += li('<button type="button" class="area-opt" data-action="goto-area" data-id="' + esc(a.id) + '">' + pin + esc(a.name) + '</button>'); });
    h += li('<button type="button" class="area-opt muted" data-action="save-area">＋ ' + esc(t('saveHere')) + '</button>');
    return h;
  }

  /* ================= views ================= */
  /* 首页的地图预览就是那张地图：手机上在首页时把 #map 挪进首页的卡片里，别的时候放回地图区。
     重画面板前先把它挪出来，不然会跟着旧内容一起被删掉 */
  var mapEl = $('#map');
  function mapInCard() { return mapEl.parentNode !== stage; }
  function placeMap(wasInCard) {
    if (state.view !== 'bulk' && bkMap && (bkMap.g || bkMap.marks.length)) { bkMap.g = null; bulkMapClear(); }
    var slot = !isMobile() ? null : state.view === 'feed' && state.tab === 'home' ? $('#home-map') : state.view === 'bulk' && bkMap && bkMap.g ? $('#bk-map-' + bkMap.g.i) : null;
    var target = slot || stage;
    if (mapEl.parentNode !== target) target.insertBefore(mapEl, target.firstChild);
    if (map && wasInCard !== !!slot) map.resize();
  }
  function render() {
    var v = state.view, wasInCard = mapInCard();
    if (wasInCard) stage.insertBefore(mapEl, stage.firstChild);
    if (v === 'feed') renderFeed();
    else if (v === 'messages') renderMessages();
    else if (v === 'post') renderPost();
    else if (v === 'person') renderPerson();
    else if (v === 'place') renderPlace();
    else if (v === 'form') renderForm();
    else if (v === 'nearby') renderNearby();
    else if (v === 'search') renderSearch();
    else if (v === 'add') renderAdd();
    else if (v === 'bulk') renderBulk();
    else if (v === 'preview') renderPreview();
    else if (v === 'login') renderLogin();
    else if (v === 'homes') renderHomes();
    else if (v === 'cluster') renderPlaceCluster();
    else if (v === 'share') renderShareCard();
    else if (v === 'home') renderHomeSet();
    placeMap(wasInCard);
    if (lastRenderedView !== v + state.tab) view.scrollTop = 0;
    lastRenderedView = v + state.tab;
    updateSelPin();
    updateSelection();
    renderTabs();
    hydratePhotos(view);
    if (state.snap === 'peek') applySnap();
    syncNavGuard();
  }

  /* 已发布地点按原 Google ID 显示官方名称，不把搜索词再当成标题。 */
  function hydrateGoogleTitles(root) {
    $$('[data-google-place]', root).forEach(function (slot) {
      if (slot.dataset.mounted) return;
      slot.dataset.mounted = '1';
      loadGoogle().then(function () {
        if (!slot.isConnected) return;
        var card = document.createElement('gmp-place-details');
        var req = document.createElement('gmp-place-details-place-request');
        req.place = slot.dataset.googlePlace;
        card.appendChild(req);
        card.appendChild(document.createElement('gmp-place-name'));
        card.addEventListener('gmp-error', function () { slot.textContent = t('googleUnavailable'); });
        slot.replaceChildren(card);
      }, function () { if (slot.isConnected) slot.textContent = t('googleUnavailable'); });
    });
  }
  /* 带 data-small 的用小图，小图打不开（以前传的照片没有小图）就换原图 */
  /* 头像照片：页面上出现 img[data-avatar] 就去拿地址（各处 innerHTML 都不用自己管） */
  function hydrateAvatars(root) {
    $$('img[data-avatar]:not([data-av-done])', root || document).forEach(function (img) {
      img.setAttribute('data-av-done', '');
      store.photoURL(img.dataset.avatar, true).then(function (u) {
        if (u) { img.onerror = function () { img.onerror = null; store.photoURL(img.dataset.avatar).then(function (f) { if (f && f !== u) img.src = f; }); }; img.src = u; }
        else if (img.parentElement) img.parentElement.classList.add('missing');
      });
    });
  }
  if (window.MutationObserver) {
    var avTimer = 0;
    new MutationObserver(function () { if (!avTimer) avTimer = setTimeout(function () { avTimer = 0; hydrateAvatars(); }, 0); }).observe(document.documentElement, { childList: true, subtree: true });
  }
  var photoJobs=[],photoBusy=0,photoSeen=new WeakSet(),photoObserver=null,photoObserved=new Set(),photoActive=new Set();
  function photoNearScreen(img) { var r=img.getBoundingClientRect();return r.bottom>=-240&&r.top<=innerHeight+240&&r.right>=-240&&r.left<=innerWidth+240; }
  function queuePhoto(img) { if(photoSeen.has(img))return;photoSeen.add(img);photoJobs.push({img:img,owner:me().id});pumpPhotos(); }
  function pumpPhotos() {
    photoJobs=photoJobs.filter(function(j){return j.img.isConnected&&j.owner===me().id;});
    while(photoBusy<4&&photoJobs.length){var job=photoJobs.shift();photoBusy++;photoActive.add(job);(function(j){loadViewPhoto(j).catch(function(){}).then(function(){photoActive.delete(j);photoBusy--;pumpPhotos();});})(job);}
  }
  function loadViewPhoto(job) {
    var img=job.img,id=img.dataset.photo,small=img.hasAttribute('data-small')||isClip(id),preview=img.dataset.preview||'';
    function current(){return !job.cancelled&&img.isConnected&&job.owner===me().id;}
    function missing(){if(current()&&!preview&&img.parentElement)img.parentElement.classList.add('missing');}
    function show(url){return new Promise(function(resolve){
      if(!url||!current()){resolve(false);return;}
      var probe=new Image(),finished=false,timer=setTimeout(function(){done(false);},15000);
      function done(ok){if(finished)return;finished=true;clearTimeout(timer);probe.onload=probe.onerror=null;if(ok&&current()){img.src=url;img.parentElement.classList.remove('missing');}resolve(ok);}
      job.cancelProbe=function(){done(false);probe.src='';};
      probe.decoding='async';probe.onload=function(){done(true);};probe.onerror=function(){done(false);};probe.src=url;
    });}
    var cancelled=new Promise(function(resolve){job.cancel=function(){job.cancelled=true;if(job.cancelProbe)job.cancelProbe();resolve();};});
    var work=store.photoURL(id,small).then(function(url){return show(url).then(function(ok){
      if(ok||!small||!current())return ok;
      return store.photoURL(id).then(function(full){return full&&full!==url?show(full):false;});
    });}).then(function(ok){if(!ok)missing();},missing);
    return Promise.race([work,cancelled]);
  }
  function hydratePhotos(root) {
    hydrateGoogleTitles(root);
    photoActive.forEach(function(j){if(!j.img.isConnected||j.owner!==me().id)j.cancel();});
    if(photoObserver)photoObserved.forEach(function(img){if(!img.isConnected){photoObserver.unobserve(img);photoObserved.delete(img);}});
    if(window.IntersectionObserver&&!photoObserver)photoObserver=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){photoObserver.unobserve(e.target);photoObserved.delete(e.target);queuePhoto(e.target);}});},{rootMargin:'240px'});
    $$('img[data-photo]',root).forEach(function(img){
      var id=img.dataset.photo,small=img.hasAttribute('data-small')||isClip(id);
      if((isClip(id)||isGif(id))&&img.parentElement)img.parentElement.classList.add(isClip(id)?'is-clip':'is-gif');
      var cached=store.cachedPhotoURL&&(store.cachedPhotoURL(id,small)||(!small&&img.hasAttribute('data-progressive')&&store.cachedPhotoURL(id,true)));
      if(cached){img.src=cached;img.dataset.preview=cached;}
      if(photoSeen.has(img))return;
      if(!photoObserver||photoNearScreen(img))queuePhoto(img);else{photoObserved.add(img);photoObserver.observe(img);}
    });
  }

  function feedReviews() {
    return store.reviews().filter(function (r) {
      var p = placeById(r.placeId);
      if (!p || !modeOk(p)) return false;
      if (state.scope === 'mine' ? (!isMine(r) || !ownVisitMatches(p,r)) : r.visibility !== 'public') return false;
      return passesFilters(p);
    }).sort(function (a, b) { return listTime(b) - listTime(a); }).slice(0, store.pagedReads && store.pagedReads() ? Number.MAX_SAFE_INTEGER : 80);
  }
  /* 足迹里默认按加进来的时间排（用户 2026-10-31），点「拍摄时间」按照片拍的时间。
     从照片批量加的记录 createdAt 存的是拍摄时间；加进来的时间不另存，照片文件名 ph-<时间>… 里有上传那一刻，
     取两者较晚的（普通记录照片先传、记录后存，差几秒）。updatedAt 改公开范围也会变，不能用 */
  function addedAt(r) {
    var up = 0;
    (r.photos || []).forEach(function (p) {
      var m = /(?:^|\/)ph-([0-9a-z]{8})/.exec(p), x = m ? parseInt(m[1], 36) : 0;
      if (x > 1.6e12 && x < Date.now() + 864e5 && (!up || x < up)) up = x;
    });
    return Math.max(r.createdAt || 0, up);
  }
  function footTimed() { return state.tab === 'foot' && state.scope === 'mine'; }
  function listTime(r) { return footTimed() && state.footTime !== 'taken' ? addedAt(r) : r.createdAt; }
  function savedPlaces() {
    return store.wishlist().slice().sort(function (a, b) { return b.createdAt - a.createdAt; })
      .map(function (w) { return placeById(w.placeId); })
      .filter(function (p) { return p && p.mode === state.mode && visibleToMe(p) && savedStatusMatches(p) && passesFilters(p); });
  }

  function favoritesButtonHTML(extra) {
    var on=state.scope==='saved', label=state.lang==='en'?L('Saved places'):'收藏';
    return '<button type="button" class="icon-btn flat favorites-entry '+(extra||'')+'" data-action="open-favorites" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+(on?ICON.starOn:ICON.star)+'</button>';
  }
  /* 首页右上角：中英切换（用户 2026-11-02 换掉了收藏星星；收藏在足迹页里进） */
  /* 语言（用户 2026-11-03）：中文 / English / 哈萨克语 / 印尼语（阿拉伯语用户说先删掉）。
     哈萨克语、印尼语的按钮文字查 data/i18n-ui.js；点评和帖子点「翻译」才翻成这里选的语言 */
  var TR_LANGS = [['zh', '中文', 'zh-CN'], ['en', 'English', 'en'], ['kk', 'Қазақша', 'kk'], ['id', 'Bahasa Indonesia', 'id']];
  var LS_TRLANG = 'xuetuan:trlang';
  function trLang() {
    var v = lsGet(LS_TRLANG);
    return TR_LANGS.some(function (l) { return l[0] === v; }) && (v === 'kk' || v === 'id' ? state.lang === 'en' : v === state.lang) ? v : state.lang;
  }
  function trLangShort() { return { zh: '中文', en: 'ENG', kk: 'KAZ', id: 'IND' }[trLang()]; }
  function langButtonHTML() {
    return '<button type="button" class="home-lang" data-action="lang-menu" aria-label="Language / 语言">ENG</button>';
  }
  function langSheetHTML() {
    var cur = trLang();
    return '<div class="bsheet-head"><h3>' + esc(state.lang === 'en' ? L('Language') : '语言') + '</h3></div>' +
      '<div class="lang-list">' + TR_LANGS.map(function (l) {
        return '<button type="button" class="lang-opt" data-action="pick-lang" data-lang="' + l[0] + '" aria-pressed="' + (cur === l[0]) + '">' + esc(l[1]) + '</button>';
      }).join('') + '</div>';
  }
  function footprintToolsHTML(saved) {
    var en=state.lang==='en', n=activeFilterCount();
    var modes=saved?['food','travel']:['both','food','travel'];
    var h='<div class="foot-tools"><div class="foot-mode-group" role="group" aria-label="'+esc(en?L('Place type'):'地点类型')+'">'+modes.map(function(m){return '<button type="button" class="chip" data-action="mine-mode" data-v="'+m+'" aria-pressed="'+((saved?state.mode:mineView())===m)+'">'+esc(m==='both'?(en?L('All'):'全部'):t(m==='food'?'food':'scenery'))+'</button>';}).join('')+'</div>'+favoritesButtonHTML()+'<button type="button" class="icon-btn flat foot-filter" data-action="foot-filters" aria-label="'+esc(t('filterBtn'))+'" title="'+esc(t('filterBtn'))+'">'+CTRL_ICON.filter+(n?'<b>'+n+'</b>':'')+'</button></div>';
    if(saved) h+='<div class="saved-status" role="group" aria-label="'+esc(en?L('Visit status'):'到访状态')+'">'+['all','want','been'].map(function(v){var selected=state.savedWant?'want':state.savedStatus;return '<button type="button" class="chip" data-action="saved-want" data-v="'+v+'" aria-pressed="'+(selected===v)+'">'+esc(en?({all:'All',want:'Want to go',been:'Been'})[v]:({all:'全部',want:'想去',been:'去过'})[v])+'</button>';}).join('')+'</div>';
    return h;
  }
  /* 每一栏的首页都是 feed 这个视图：首页、我的各画各的；探索（地点）和足迹（我的记录 / 想去）用同一个列表 */
  function renderFeed() {
    if (state.tab === 'home') { renderHome(); return; }
    if (state.tab === 'me') { renderMe(); return; }
    if (hometownMode()) {
      view.innerHTML = '<div class="view-head"><h2 class="view-title" data-action="expand">' + esc(t('homesBtn')) + '</h2><span class="count">' + publicHomeCount() + '</span></div><p class="muted">' + esc(t('homesN', { n: publicHomeCount() })) + '</p>';
      return;
    }
    var saved = state.scope === 'saved', places = state.scope === 'all';
    var items = saved ? savedPlaces() : places ? placesInView() : feedReviews();
    var key = {
      food: { all: 'feedFoodAll', mine: 'feedFoodMine', saved: 'feedSavedFood' },
      travel: { all: 'feedTravelAll', mine: 'feedTravelMine', saved: 'feedSavedTravel' }
    }[state.mode][state.scope];
    if (places) key = state.mode === 'food' ? 'placesFoodAll' : 'placesTravelAll';
    if (state.scope === 'mine' && state.mineBoth) key = 'feedBothMine';
    var h = '<div class="view-head"><div class="title-row">' + (saved ? '<button type="button" class="icon-btn flat" data-action="favorites-back" aria-label="'+esc(t('back'))+'">'+ICON.back+'</button>' : '') + '<h2 class="view-title" data-action="expand">' + esc(saved ? (state.lang==='en'?L('Saved places'):'我的收藏') : t(key)) + '</h2><span class="count">' + items.length + '</span></div></div>';
    if (state.tab === 'foot') h += footprintToolsHTML(saved);
    if (state.tab === 'foot' && state.scope === 'mine') h += visitBulkHTML(items);
    if (store.hasSamples() && state.scope === 'all') {
      h += '<div class="sample-note"><span>' + esc(t('samplesShown')) + '</span><button type="button" class="link-btn" data-action="clear-samples">' + esc(t('clearSamples')) + '</button></div>';
    }
    if (!items.length) h += emptyHTML();
    else if (saved) h += '<ul class="near-list">' + items.map(savedItemHTML).join('') + '</ul>';
    else if (places) h += '<p class="explore-hint">' + esc(t('exploreHint')) + '</p>';
    else h += '<ul class="feed">' + items.slice(0,state.footLimit || 80).map(feedItemHTML).join('') + '</ul>' + (items.length>(state.footLimit || 80)?'<div class="read-more"><button type="button" class="btn ghost" data-action="read-own-more">'+esc(state.lang==='en'?'Load more':'加载更多')+'</button></div>':'');
    view.innerHTML = h;
  }

  function metaHTML(r, hidePrivacy, interactive) {
    var parts = [];
    if (r.rating != null) parts.push(starsMiniHTML(r.rating));
    if (r.price) { var pp = placeById(r.placeId), pc = reviewPriceCurrency(pp,r); parts.push(interactive === false ? '<span>' + esc(PRICE_SYM[pc] + ' ' + fmtPrice(r.price)) + '</span>' : priceToggleHTML(pp,r.price,pc,'r:'+r.id)); }
    if (r.visibility === 'private' && !hidePrivacy) parts.push('<span class="pill">' + esc(t('visPrivateShort')) + '</span>');
    return parts.join('<span class="sep">·</span>');
  }

  var selectingVisits = false, selectedVisits = new Set(), visibilityBusy = false;
  function visitPrivacyHTML(r, withoutEdit) {
    var en = state.lang === 'en';
    return '<div class="visit-controls" role="group" aria-label="' + esc(en?L('Visibility'):'可见范围') + '">' + [['private',en?L('Only me'):'仅个人'],['public',en?L('Public'):'公开']].map(function (o) {
      return '<button type="button" data-action="visit-privacy" data-id="' + esc(r.id) + '" data-v="' + o[0] + '" aria-pressed="' + (r.visibility === o[0]) + '"' + (visibilityBusy?' disabled':'') + '>' + esc(o[1]) + '</button>';
    }).join('') + (withoutEdit ? '' : '<button type="button" class="visit-edit" data-action="edit-review" data-id="' + esc(r.id) + '">' + esc(en?L('Edit'):'编辑') + '</button>') + '</div>';
  }
  function visitBulkHTML(items) {
    var en = state.lang === 'en', disabled = visibilityBusy?' disabled':'', n = selectedVisits.size;
    return '<div class="visit-bulk"><button type="button" class="btn ghost" data-action="visit-multi"' + disabled + '>' + esc(selectingVisits?(en?L('Done'):'完成'):(en?L('Select'):'多选')) + '</button>' +
      (selectingVisits ? '' : '<button type="button" class="btn ghost foot-time" data-action="foot-time" aria-pressed="' + (state.footTime === 'taken') + '">' + ICON.camera + esc(t('footTaken')) + '</button>') + (selectingVisits ?
      '<button type="button" class="btn ghost" data-action="visit-all"' + disabled + '>' + esc(en?L('Select all'):'全选') + '</button><small>' + esc(en?n+' selected':'已选 '+n) + '</small>' +
      [['public',en?L('Make public'):'设为公开'],['private',en?L('Only me'):'仅个人']].map(function (o) { return '<button type="button" class="btn ghost" data-action="visit-bulk" data-v="' + o[0] + '"' + (visibilityBusy || !n?' disabled':'') + '>' + esc(o[1]) + '</button>'; }).join('') : '') + (visibilityBusy?'<small>'+esc(en?L('Saving…'):'保存中…')+'</small>':'') + '</div>';
  }
  function changeVisitVisibility(ids, visibility) {
    if (visibilityBusy || ['private','public'].indexOf(visibility) === -1) return;
    ids = ids.filter(function (id) { var r=store.review(id); return r && isMine(r) && r.visibility !== visibility; });
    if (!ids.length) return;
    visibilityBusy = true;
    var top = view.scrollTop, actor = me().id;
    render(); view.scrollTop = top;
    store.setVisibility(ids,visibility).then(function () { if (actor !== me().id) return; toast(state.lang === 'en'?L('Visibility updated'):visibility==='public'?'已设为公开':'已设为仅个人'); },function () { toast(t('saveFail')); }).then(function () {
      visibilityBusy=false; refreshMap(); if(state.view==='feed'||state.view==='place') { var y=view.scrollTop; render(); view.scrollTop=y; }
    });
  }

  /* 列表一条：有照片时第一张照片放在左边代替头像，多张时角上标张数；点进去看大图 */
  function feedItemHTML(r) {
    var p = placeById(r.placeId), c = catOf(p);
    var ownControls = state.tab === 'foot' && state.scope === 'mine' && isMine(r);
    var name = authorLabel(r), from = '', meta = metaHTML(r, ownControls, false), text = reviewText(r);
    var n = r.photos ? r.photos.length : 0;
    var lead = n ? '<span class="fi-pic"><img data-photo="' + esc(r.photos[0]) + '" data-small alt="">' +
      (n > 1 ? '<span class="fi-count">' + ICON.camera + n + '</span>' : '') + '</span>' : avatarHTML(name, r.authorId);
    return '<li' + (ownControls ? ' class="visit-row"' : '') + '>' + (ownControls && selectingVisits ? '<button type="button" class="visit-select" data-action="visit-select" data-id="' + esc(r.id) + '" aria-label="' + esc(state.lang === 'en' ? L('Select record') : '选择这条记录') + '" aria-pressed="' + selectedVisits.has(r.id) + '">' + (selectedVisits.has(r.id) ? '✓' : '○') + '</button>' : '') + '<button type="button" class="feed-item' + (n ? ' with-pic' : '') + '" data-action="' + (ownControls && selectingVisits ? 'visit-select' : 'open-place') + '" data-id="' + esc(ownControls && selectingVisits ? r.id : p.id) + '">' +
      lead +
      '<span class="fi-main">' +
      '<span class="fi-who"><b>' + esc(name) + '</b>' + (from ? '<span class="muted">' + esc(t('fromPrefix') + from) + '</span>' : '') + '<span class="fi-time">' + esc(ownControls && state.footTime === 'taken' ? t('footTakenAt', { t: timeAgo(r.createdAt) }) : timeAgo(listTime(r))) + '</span></span>' +
      '<span class="fi-place">' + catIconHTML(c) + '<span>' + esc(placeTitle(p)) + '</span>' + scoreHTML(stats(p).score) + (p.sample ? '<span class="badge">' + esc(t('sample')) + '</span>' : '') + '</span>' +
      (meta ? '<span class="fi-meta">' + meta + '</span>' : '') +
      (text ? '<span class="fi-text">' + esc(text) + '</span>' : '') +
      '</span></button>' + (ownControls ? visitPrivacyHTML(r) : '') + '</li>';
  }

  /* 地点一行：搜索结果、附近已有、收藏列表都用这个。sub 和 right 是已经转义好的 HTML */
  function placeRowHTML(p, action, sub, right) {
    var photo = coverPhoto(p, 'saved');
    var lead = photo ? '<span class="row-pic"><img data-photo="' + esc(photo) + '" data-small alt=""></span>' : catIconHTML(catOf(p));
    return '<li><button type="button" class="near-item" data-action="' + action + '" data-id="' + esc(p.id) + '">' + lead +
      '<span class="near-text"><b>' + esc(placeTitle(p)) + '</b><small>' + sub + '</small></span>' + (right || '') + '</button></li>';
  }
  function savedItemHTML(p) {
    var s = stats(p);
    var sub = esc(catName(catOf(p))) + ' · ' + esc(distLabel(p));
    return placeRowHTML(p, 'open-place', sub, s.score != null ? scoreHTML(s.score) : '<span class="near-cta muted">' + esc(t('noRating')) + '</span>');
  }

