/* 雪团 js/05-feed.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= 首页 =================
   * 上面一张地图预览（点了去探索），下面是大家最新分享的记录：两列图文卡片，点卡片看帖子。
   * 只放真实的公开记录，不放示例；没有就诚实地说没有（V2.0） */
  /* 按去的时间（批量加的是照片拍摄时间），不按上传/改动时间：旧足迹刚导入也不会被当成新动态推出去（用户 2026-11-01） */
  function homeTime(r) { return r.createdAt; }
  function homeEligible() { return store.reviews().filter(function (r) { return r.visibility === 'public' && !r.sample && r.photos && r.photos.length > 0 && placeById(r.placeId); }); }
  function homeReviews() {
    var cutoff = state.homeDays ? Date.now() - state.homeDays * 86400000 : 0;
    return homeEligible().filter(function (r) {
      return (state.homeMode === 'all' || placeById(r.placeId).mode === state.homeMode) && (!cutoff || homeTime(r) >= cutoff) && (!state.homeMin || (r.rating != null && r.rating >= state.homeMin));
    }).sort(function (a, b) { return (state.homeSort === 'rating' ? (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating) : 0) || homeTime(b) - homeTime(a); }).slice(0, 60);
  }
  function homeSelect(id, label, value, options) {
    return '<label><span>' + esc(label) + '</span><select class="input" id="' + id + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  function setHomeFiltersOpen(open) {
    state.homeFiltersOpen = !!open;
    var panel = $('#home-filter-panel'), button = $('[data-action="home-filters"]');
    if (panel) panel.hidden = !state.homeFiltersOpen;
    if (button) button.setAttribute('aria-expanded', String(state.homeFiltersOpen));
  }
  function homeFiltersHTML() {
    var en = state.lang === 'en', n = Number(state.homeDays !== HOME_DAYS) + Number(!!state.homeMin) + Number(state.homeSort !== 'newest');
    return '<div class="home-filters"><div class="home-filter-row">' + [['all',en?'All':'全部'],['food',t('food')],['travel',t('scenery')]].map(function (o) { return '<button type="button" class="chip" data-action="home-mode" data-v="' + o[0] + '" aria-pressed="' + (state.homeMode === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') +
      '<div class="home-filter-menu"><button type="button" class="btn ghost home-filter-toggle" data-action="home-filters" aria-expanded="' + state.homeFiltersOpen + '" aria-controls="home-filter-panel">' + CTRL_ICON.filter + esc(en?'Filter':'筛选') + (n ? '<span class="home-filter-count">' + n + '</span>' : '') + '</button><div class="home-filter-panel" id="home-filter-panel"' + (state.homeFiltersOpen ? '' : ' hidden') + '>' +
      homeSelect('home-days',en?'Time':'时间',state.homeDays,[[3,en?'3 days':'最近三天'],[7,en?'1 week':'最近一周'],[30,en?'1 month':'最近一个月'],[0,en?'All time':'全部时间']]) +
      homeSelect('home-min',en?'Rating':'评分',state.homeMin,[[0,en?'Any rating':'不限评分'],[3,en?'3+':'3分以上'],[4,en?'4+':'4分以上'],[4.5,en?'4.5+':'4.5分以上']]) +
      homeSelect('home-sort',en?'Sort':'排序',state.homeSort,[['newest',en?'Newest':'最新动态'],['rating',en?'Top rated':'评分优先']]) + '</div></div>' +
      '<button type="button" class="btn ghost home-refresh" data-action="home-refresh">' + esc(en?'Refresh':'刷新') + '</button></div></div>' +
      '<button type="button" class="btn ghost home-updates" data-action="home-apply" hidden>' + esc(en?'New content · tap to update':'有新内容，点击更新') + '</button>' +
      '<p class="home-privacy">' + esc(en?'Only public records with photos appear here. Private footprints stay private.':'仅展示带图片的公开记录，私人足迹不会自动公开。') + '</p>';
  }
  var homeSyncPromise = null, homeApplyRequested = false;
  function homeVisible() { return !state.bootLoading && !document.hidden && state.tab === 'home' && state.view === 'feed' && !state.picking; }
  function homeSignature() { return JSON.stringify(homeEligible().map(function (r) { return [r.id, homeTime(r), r.title, r.text, r.rating, r.photos]; })); }
  function refreshHome(force) {
    if (!homeVisible()) return Promise.resolve();
    homeApplyRequested = homeApplyRequested || !!force;
    if (homeSyncPromise) return homeSyncPromise;
    var before = homeSignature(), refreshButton = $('[data-action="home-refresh"]');
    if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = state.lang === 'en' ? 'Refreshing…' : '刷新中…'; }
    homeSyncPromise = (store.refresh ? store.refresh(homeVisible) : Promise.resolve()).then(function () {
      if (!homeVisible()) return;
      if (homeApplyRequested || (before !== homeSignature() && view.scrollTop < 100)) { render(); view.scrollTop = 0; }
      else if (before !== homeSignature()) { var btn = $('.home-updates'); if (btn) btn.hidden = false; }
      refreshMap();
    }).catch(function () { if (homeApplyRequested) toast(t('loadFail')); }).then(function () { homeSyncPromise = null; homeApplyRequested = false; var button = $('[data-action="home-refresh"]'); if (button) { button.disabled = false; button.textContent = state.lang === 'en' ? 'Refresh' : '刷新'; } });
    return homeSyncPromise;
  }
  setInterval(function () { if (homeVisible()) refreshHome(false); }, 45000);
  document.addEventListener('visibilitychange', function () { if (homeVisible()) refreshHome(false); });
  function renderHome() {
    var items = homeReviews(), h = '';
    if (isMobile()) {
      h += '<div class="home-top"><div class="home-brand"><span class="app-logo" role="img" aria-label="雪团"><img src="assets/app-icon-sheet.png" alt=""></span><b>雪团</b></div>' +
        '<button type="button" class="home-search" data-action="search">' + '<img src="assets/search-pin.png" width="24" height="24" alt=""><span>' + esc(t('searchPh')) + '</span></button>' + appShareButton() + '</div>' +
        '<div class="home-map" id="home-map"><button type="button" class="home-map-btn" data-action="tab" data-tab="explore" aria-label="' + esc(t('openMap')) + '">' +
        '<span class="hm-pill">' + CTRL_ICON.compass + esc(t('openMap')) + '</span></button>' +
        '<div class="home-attrib">' + $('.attrib').innerHTML + '</div></div>';
    }
    if (!isMobile()) h += '<div style="display:flex;justify-content:flex-end">' + appShareButton() + '</div>';
    h += '<div class="home-sec"><h2>' + esc(t('latest')) + '</h2><button type="button" class="btn primary small home-publish" data-action="new-post">' + ICON.pen + esc(state.lang === 'en' ? 'Post' : '发帖') + '</button></div>';
    h += homeFiltersHTML();
    if (!items.length) h += '<div class="empty home-empty"><p>' + esc(state.bootLoading ? (state.lang === 'en' ? 'Loading shares…' : '正在加载分享…') : (state.homeMode !== 'all' || state.homeDays !== HOME_DAYS || state.homeMin) ? (state.lang === 'en' ? 'No shares match these filters.' : '暂无符合筛选的分享。') : homeEligible().length ? (state.lang === 'en' ? 'No new shares in the last month.' : '最近一个月还没有新的分享。') : t('latestEmpty')) + '</p>' +
      (!state.bootLoading && state.homeDays && homeEligible().length ? '<button type="button" class="link-btn" data-action="home-all-time">' + esc(state.lang === 'en' ? 'See older shares' : '看更早的分享') + '</button>' : '') +
      '<button type="button" class="link-btn" data-action="add">' + esc(t('goRecord')) + '</button></div>';
    else h += '<ul class="post-grid">' + items.map(postCardHTML).join('') + '</ul>';
    view.innerHTML = h;
  }
  function saveBtnHTML(placeId, small) {
    var on = store.isSaved(placeId), label = t(on ? 'wished' : 'wish');
    return small
      ? '<button type="button" class="pc-save" data-action="save-place" data-id="' + esc(placeId) + '" aria-pressed="' + on + '" aria-label="' + esc(label) + '">' + (on ? ICON.starOn : ICON.star) + '</button>'
      : '<button type="button" class="btn save-btn" data-action="save-place" data-id="' + esc(placeId) + '" aria-pressed="' + on + '">' + (on ? ICON.starOn : ICON.star) + esc(label) + '</button>';
  }
  /* 一张卡片：有照片放第一张，没有就放评论的开头；下面是地点名、分数、谁发的 */
  function postCardHTML(r) {
    var p = placeById(r.placeId), c = catOf(p), name = authorLabel(r), text = reviewText(r), n = r.photos ? r.photos.length : 0;
    var cover = n
      ? '<img data-photo="' + esc(r.photos[0]) + '" data-small loading="lazy" decoding="async" alt="">' + (n > 1 ? '<span class="fi-count">' + ICON.camera + n + '</span>' : '')
      : '<span class="pc-words' + (p.mode === 'travel' ? ' travel' : '') + '"><i aria-hidden="true">' + c.emoji + '</i><span>' + esc(text || catName(c)) + '</span></span>';
    var score = (r.rating != null ? starsMiniHTML(r.rating) : '') + (r.price ? '<span>RM ' + fmtPrice(r.price) + '</span>' : '');
    return '<li class="post-card"><button type="button" class="pc-open" data-action="open-post" data-id="' + esc(r.id) + '">' +
      '<span class="pc-cover">' + cover + '</span><span class="pc-body"><span class="pc-place">' + esc(r.title || placeTitle(p)) + '</span>' +
      (score ? '<span class="pc-score">' + score + '</span>' : '') +
      '<span class="pc-who">' + avatarHTML(name) + '<span>' + esc(name) + ' · ' + esc(timeAgo(homeTime(r))) + '</span></span></span></button>' +
      saveBtnHTML(p.id, true) + '</li>';
  }

  /* 帖子：一条记录的全文（照片、谁、分数、评论），下面是这个地点，点了去探索地图上看 */
  function renderPost() {
    var r = store.review(state.postId), p = r && placeById(r.placeId);
    if (!p || (r.visibility !== 'public' && !isMine(r))) { goFeed(); return; }
    var name = authorLabel(r), from = authorFrom(r), text = reviewText(r), c = catOf(p);
    var h = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button></div>';
    if (r.photos && r.photos.length) h += '<div class="photo-strip">' + r.photos.map(function (id) {
      return '<button type="button" class="ph" data-action="photo" data-id="' + esc(id) + '" data-group="post"><img data-photo="' + esc(id) + '" data-small alt=""></button>';
    }).join('') + '</div>';
    h += '<div class="post-who">' + avatarHTML(name) + '<span class="pw-text"><b>' + esc(name) + '</b><small>' + (from ? esc(t('fromPrefix') + from) + ' · ' : '') + esc(timeAgo(r.createdAt)) + '</small></span></div>';
    var sc = [];
    if (r.rating != null) sc.push(starsMiniHTML(r.rating) + '<b style="color:' + scoreColor(r.rating) + '">' + fmtScore(r.rating) + '</b>');
    if (r.price) sc.push('<span>RM ' + fmtPrice(r.price) + ' ' + esc(t(p.mode === 'food' ? 'perPerson' : 'costLabel')) + '</span>');
    if (r.visibility === 'private') sc.push('<span class="pill">' + esc(t('visPrivateShort')) + '</span>');
    if (sc.length) h += '<div class="post-score">' + sc.join('<span class="sep">·</span>') + '</div>';
    if (r.title) h += '<h1 class="post-title">' + esc(r.title) + '</h1>';
    if (text) h += '<p class="post-text">' + esc(text) + '</p>';
    h += '<ul class="near-list post-place">' + placeRowHTML(p, 'post-place', esc(catName(c)) + ' · ' + esc(t('distFrom', { d: fmtDist(haversine(XMUM, p)) })), '<span class="near-cta">' + esc(t('postPlace')) + '</span>') + '</ul>';
    h += '<div class="actions post-actions">' + saveBtnHTML(p.id, false) + moderationControl(r) + '</div>';
    view.innerHTML = h;
  }

  /* 空的时候只给一行小字 + 一个文字按钮 */
  function emptyHTML() {
    var filtered = filtersActive();
    var msg = filtered ? t('emptyFiltered')
      : state.scope === 'mine' ? t('emptyMine')
      : state.scope === 'saved' ? t(state.savedWant && store.wishlist().length ? 'emptyWant' : 'emptySaved')
      : t(state.mode === 'food' ? 'emptyFoodAll' : 'emptyTravelAll');
    var btn = filtered
      ? '<button type="button" class="link-btn" data-action="clear-filters">' + esc(t('clearFilters')) + '</button>'
      : state.scope === 'saved'
        ? '<button type="button" class="link-btn" data-action="tab" data-tab="explore">' + esc(t('goExplore')) + '</button>'
        : '<button type="button" class="link-btn" data-action="add">' + esc(t(state.mode === 'food' ? 'addFood' : 'addTravel')) + '</button>';
    return '<div class="empty"><p>' + esc(msg) + '</p>' + btn + '</div>';
  }

  function scoreLabel(s) {
    if (state.scope === 'mine') return s.score != null ? t('myScore') : t('noRating');
    return s.raters ? t('avgOf', { n: s.raters }) + (s.zeros ? t('avgNoZero', { n: s.zeros }) : '') : t('noRating');
  }

  /* 苹果手机/iPad 上导航按钮直接开苹果地图，其它手机还是谷歌地图（用户 2026-11-01） */
  var APPLE = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function mapsHref(coords, name, view) {
    if (APPLE) return 'https://maps.apple.com/?' + (view ? 'll=' + coords + '&q=' + encodeURIComponent(name || coords) : 'daddr=' + coords + '&dirflg=d' + (name ? '&q=' + encodeURIComponent(name) : ''));
    return view ? 'https://www.google.com/maps/search/?api=1&query=' + coords : 'https://www.google.com/maps/dir/?api=1&destination=' + coords;
  }
  function renderPlace() {
    var p = placeById(state.placeId);
    if (!p) { goFeed(); return; }
    var c = catOf(p), s = stats(p), dist = haversine(XMUM, p);
    var link = safeURL(p.link);
    var coords = p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
    var far = dist > 300000;
    var saved = store.isSaved(p.id);
    /* 像谷歌地图的地点卡片：名字下面一排按钮，导航是实心的，收藏、打分紧跟着，其余往右滑 */
    var actions = (far
      ? '<a class="btn" href="' + esc(mapsHref(coords, placeTitle(p), true)) + '" target="_blank" rel="noopener">' + ICON.nav + esc(t(APPLE ? 'viewApple' : 'viewGoogle')) + '</a>'
      : '<a class="btn primary" href="' + esc(mapsHref(coords, placeTitle(p))) + '" target="_blank" rel="noopener">' + ICON.nav + esc(t(APPLE ? 'navApple' : 'navGoogle')) + '</a>') +
      '<button type="button" class="btn save-btn" data-action="toggle-save" aria-pressed="' + saved + '">' + (saved ? ICON.starOn + esc(t('wished')) : ICON.star + esc(t('wish'))) + '</button>' +
      '<button type="button" class="btn" data-action="write-review">' + ICON.pen + esc(t(p.mode === 'food' ? 'writeReview' : 'beenHere')) + '</button>' +
      (far ? '' : '<a class="btn" href="https://waze.com/ul?ll=' + coords + '&navigate=yes" target="_blank" rel="noopener">' + ICON.nav + esc(t('navWaze')) + '</a>');
    actions += '<button type="button" class="btn" data-action="copy-coords" data-c="' + coords + '">' + ICON.copy + esc(t('copyCoords')) + '</button>';
    if (link) actions += '<a class="btn" href="' + esc(link) + '" target="_blank" rel="noopener nofollow">' + ICON.link + esc(t('openLink')) + '</a>';
    /* 多人同一家店的照片：越新的越前面 */
    var photos = placePhotos(p).slice(0, 30);
    var reviews = s.rs.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    var tags = '<span class="tag">' + catIconHTML(c) + esc(catName(c)) + '</span><span class="tag">' + esc(precLabel(p.precision)) + '</span>' +
      (p.mode === 'food' ? '<span class="tag">' + esc(t('tier_' + distTier(p))) + '</span>' : '') +
      '<span class="tag">' + esc(t('distFrom', { d: fmtDist(dist) })) + '</span>';

    var h = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button>' +
      (p.sample ? '<span class="badge">' + esc(t('sample')) + '</span>' : '') + '</div>' +
      '<div class="place-head">' + (/^g\//.test(p.osm || '') ? '<div class="google-place-title" data-google-place="' + esc(p.osm.slice(2)) + '" role="status">' + esc(t('googleLoading')) + '</div>' : '<h2>' + esc(placeTitle(p)) + '</h2>') +
      (placeSub(p) ? '<div class="alt">' + esc(placeSub(p)) + '</div>' : '') +
      '<div class="tags">' + tags + '</div></div>' +
      '<div class="actions place-actions">' + actions + '</div>' +
      /* 别人记过、我还没记的地方：直接在这里打分添加，不用再去搜 */
      (beenThere(p) ? '' : quickRateHTML('place-score', p.mode, false)) +
      /* 照片放中间一大张，左右滑；右下角小按钮才放大看（用户 2026-11-01） */
      (photos.length ? '<div class="place-hero' + (photos.length === 1 ? ' single' : '') + '"><div class="hero-track" id="hero-track">' + photos.map(function (id) {
        return '<div class="hero-slide' + (isClip(id) ? ' is-clip' : '') + '" data-id="' + esc(id) + '"><img data-photo="' + esc(id) + '" data-small alt=""></div>';
      }).join('') + '</div>' +
        (photos.length > 1 ? '<span class="hero-count" id="hero-count">1 / ' + photos.length + '</span>' : '') +
        '<button type="button" class="hero-zoom" data-action="hero-zoom" aria-label="' + esc(state.lang === 'en' ? 'View larger' : '放大看') + '">' + ICON.expand + '</button></div>' : '');
    /* 收藏了、还没人记录的地方：没有分数和点评，说一句就好 */
    if (!scopedReviews(p.id, 'saved').length) { view.innerHTML = h + '<p class="place-empty">' + esc(t('placeEmpty')) + '</p>'; bindHero(); return; }
    h += '<div class="stats">' +
      '<div class="stat"><b>' + (s.score != null ? '<span class="score-big" style="color:' + scoreColor(s.score) + '">' + fmtScore(s.score) + '</span>' : '—') + '</b><small>' + esc(scoreLabel(s)) + '</small></div>' +
      '<div class="stat"><b>' + (s.avgPrice ? 'RM ' + fmtPrice(s.avgPrice) : '—') + '</b><small>' + esc(t(p.mode === 'food' ? 'perPerson' : 'costLabel')) + '</small></div>' +
      '<div class="stat"><b>' + s.count + '</b><small>' + esc(t('reviewsLabel')) + '</small></div></div>';
    h += '<h3 class="sec-title">' + esc(t('reviewsTitle')) + '</h3><ul class="reviews">' + reviews.map(reviewHTML).join('') + '</ul>';
    view.innerHTML = h;
    bindHero();
  }
  function heroIndex() {
    var tr = $('#hero-track'); if (!tr || !tr.children.length) return 0;
    var w = tr.children[0].getBoundingClientRect().width + 6;
    return Math.max(0, Math.min(tr.children.length - 1, Math.round(tr.scrollLeft / (w || 1))));
  }
  function bindHero() {
    var tr = $('#hero-track'), cnt = $('#hero-count');
    if (!tr || !cnt) return;
    tr.addEventListener('scroll', function () { cnt.textContent = (heroIndex() + 1) + ' / ' + tr.children.length; }, { passive: true });
  }

  function reviewHTML(r) {
    var name = authorLabel(r), from = authorFrom(r), meta = metaHTML(r), text = reviewText(r);
    return '<li class="review">' + avatarHTML(name) + '<div class="rv-main">' +
      '<div class="rv-who"><b>' + esc(name) + '</b>' + (from ? '<span class="muted">' + esc(t('fromPrefix') + from) + '</span>' : '') + '<span class="fi-time">' + esc(timeAgo(r.createdAt)) + '</span></div>' +
      (meta ? '<div class="rv-meta">' + meta + '</div>' : '') +
      (text ? '<p class="rv-text">' + esc(text) + '</p>' : '') +
      (r.photos && r.photos.length ? '<div class="rv-photos">' + r.photos.map(function (id) {
        return '<button type="button" class="ph sm" data-action="photo" data-id="' + esc(id) + '" data-group="rv-' + esc(r.id) + '"><img data-photo="' + esc(id) + '" data-small alt=""></button>';
      }).join('') + '</div>' : '') +
      (isMine(r) ? '<div class="rv-actions"><button type="button" class="link-btn" data-action="edit-review" data-id="' + esc(r.id) + '">' + esc(t('edit')) + '</button>' +
        '<button type="button" class="link-btn danger" data-action="del-review" data-id="' + esc(r.id) + '">' + esc(t('del')) + '</button></div>' : '') +
      moderationControl(r) + '</div></li>';
  }

  function fieldHTML(id, label, control) {
    return '<div class="field"><label class="f-label" for="' + id + '">' + label + '</label>' + control + '<div class="f-err" id="err-' + id + '" hidden></div></div>';
  }

  /* 新建地点，或者编辑自己建的地点时，表单里才有名称、分类、位置这些字段 */
  function formHasPlaceFields(f, p) {
    return !p || (!!f.editId && p.createdBy === me().id && !p.sample);
  }

  function renderForm() {
    var f = state.form;
    if (!f) { goFeed(); return; }
    var p = f.placeId ? placeById(f.placeId) : null;
    var isFood = (p ? p.mode : state.mode) === 'food';
    var placeFields = formHasPlaceFields(f, p);
    var share = f.visibility === 'public';
    var title = f.editId ? t('formEdit') : f.post ? (state.lang === 'en' ? 'Create post' : '发布分享') : p ? t('formReview') : t(isFood ? 'formNewFood' : 'formNewTravel');
    /* 发布按钮放在顶部右边，不用滑到底才找得到 */
    var h = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="form-cancel" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(title) + '</h2>' +
      '<button type="submit" form="place-form" class="btn primary small" id="f-submit">' + esc(t(f.editId ? 'saveEdit' : 'publish')) + '</button></div>' +
      '<form id="place-form" class="form" novalidate>';
    if (f.restored && !f.editId) h += '<div class="draft-bar" id="draft-bar"><span>' + esc(state.lang === 'en' ? 'Your unfinished draft' : '上次没写完的草稿') + '</span><button type="button" class="link-btn" data-action="draft-discard">' + esc(state.lang === 'en' ? 'Start over' : '清空重来') + '</button></div>';
    if (f.relocate && !f.post) {
      /* 编辑记录：不再有名称框；地点可以像新加时一样重新搜、或在地图上选（用户 2026-11-01） */
      if (/^g\//.test(f.osm || '')) h += '<div id="g-form-detail" class="g-search"></div>';
      else h += '<div class="form-place">' + catIconHTML(p ? catOf(p) : catOf({ mode: state.mode, cat: f.cat })) + '<b>' + esc(p ? placeTitle(p) : ((f.draft && f.draft.name) || t(isFood ? 'unnamedFood' : 'unnamedTravel'))) + '</b></div>';
      h += '<div class="btn-row"><button type="button" class="btn" id="post-location" data-action="post-location">' + ICON.pin + esc(state.lang === 'en' ? 'Change place' : '更换地点') + '</button><button type="button" class="btn ghost" data-action="post-map">' + esc(t('addPin')) + '</button></div>';
      if (placeFields) h += '<div class="field"><span class="f-label" id="lbl-cat">' + esc(t('category')) + '</span><div class="chips-wrap one-line" role="group" aria-labelledby="lbl-cat">' +
        catChoices(state.mode).map(function (c) {
          return '<button type="button" class="chip" data-action="f-cat" data-cat="' + c.id + '" aria-pressed="' + (f.cat === c.id) + '">' + catIconHTML(c) + esc(catName(c)) + '</button>';
        }).join('') + '</div><p class="f-hint cat-guess" id="cat-guess" hidden></p></div>';
    }
    else if (!f.post && p && !placeFields && /^g\//.test(p.osm || '')) h += '<div id="g-form-detail" class="g-search"></div>';
    else if (!f.post && p && !placeFields) h += '<div class="form-place">' + catIconHTML(catOf(p)) + '<b>' + esc(placeTitle(p)) + '</b></div>';
    if (placeFields && !f.post && !f.relocate) {
      if (/^g\//.test(f.osm)) h += '<div id="g-form-detail" class="g-search"></div>';
      else h += fieldHTML('f-name', esc(t('name')), '<input id="f-name" class="input" maxlength="60"' + (f.lockedName ? ' readonly' : '') + ' placeholder="' + esc(t(isFood ? 'namePhFood' : 'namePhTravel')) + '">');
      h += '<div class="f-loc"><span>' + esc(t('location')) + '：' + f.loc.lat.toFixed(5) + ', ' + f.loc.lng.toFixed(5) + '</span><button type="button" class="link-btn" data-action="repick">' + esc(t('repick')) + '</button></div>';
      if (!f.post) h += '<div class="field"><span class="f-label" id="lbl-cat">' + esc(t('category')) + '</span><div class="chips-wrap one-line" role="group" aria-labelledby="lbl-cat">' +
        catChoices(state.mode).map(function (c) {
          return '<button type="button" class="chip" data-action="f-cat" data-cat="' + c.id + '" aria-pressed="' + (f.cat === c.id) + '">' + catIconHTML(c) + esc(catName(c)) + '</button>';
        }).join('') + '</div><p class="f-hint cat-guess" id="cat-guess" hidden></p></div>';
    }
    if (f.post) h += '<div class="field"><span class="f-label">' + esc(state.lang === 'en' ? 'Photos' : '图片') + ' <small>· ' + esc(t('photoLimit', { n: MAX_PHOTOS })) + '</small></span><div class="photo-grid" id="f-photos"></div></div>';
    if (f.post || (f.draft && f.draft.title)) h += fieldHTML('f-title', esc(state.lang === 'en' ? 'Title' : '标题'), '<input id="f-title" class="input" maxlength="80" placeholder="' + esc(state.lang === 'en' ? 'Give this memory a title' : '给这次体验起个标题') + '">');
    /* 评分选填 */
    h += '<div class="field"><span class="f-label" id="lbl-rating">' + esc(t('rating')) + ' <small>· ' + esc(t('optional')) + '</small></span>' + starsInputHTML('f-rating', f.rating, 'form', 'lbl-rating') +
      '<div class="f-err" id="err-rating" hidden></div></div>';
    h += fieldHTML('f-text', esc(f.post ? (state.lang === 'en' ? 'Story (optional)' : '正文（选填）') : t('review')), '<textarea id="f-text" class="input" rows="2" maxlength="1000" placeholder="' + esc(t(isFood ? 'reviewPhFood' : 'reviewPhTravel')) + '"></textarea>');
    if (f.post) {
      h += '<div class="field"><span class="f-label">' + esc(state.lang === 'en' ? 'Add a place to your footprints' : '关联地点，保存到足迹') + '</span><div class="seg">' + ['food','travel'].map(function (m) { return '<button type="button" data-action="post-mode" data-v="' + m + '" aria-pressed="' + ((p ? p.mode : state.mode) === m) + '">' + esc(t(m === 'food' ? 'food' : 'scenery')) + '</button>'; }).join('') + '</div>';
      if (/^g\//.test(f.osm)) h += '<div id="g-form-detail" class="g-search"></div>';
      else if (p) h += '<div class="form-place">' + catIconHTML(catOf(p)) + '<b>' + esc(placeTitle(p)) + '</b></div>';
      else if (f.loc) h += fieldHTML('f-name', esc(t('name')), '<input id="f-name" class="input" maxlength="60"' + (f.lockedName ? ' readonly' : '') + ' placeholder="' + esc(t(isFood ? 'namePhFood' : 'namePhTravel')) + '">');
      h += '<div class="btn-row"><button type="button" class="btn" id="post-location" data-action="post-location">' + ICON.pin + esc(state.lang === 'en' ? (p || f.loc ? 'Change place' : 'Find a place') : (p || f.loc ? '更换地点' : '搜索地点')) + '</button><button type="button" class="btn ghost" data-action="post-map">' + esc(t('addPin')) + '</button></div></div>';
    }
    if (!f.post) h += '<div class="field"><span class="f-label">' + esc(t('photos')) + ' <small>· ' + esc(t('photoLimit', { n: MAX_PHOTOS })) + '</small></span><div class="photo-grid" id="f-photos"></div></div>';
    /* 人均只问吃的（筛选按人均）；旅行不问花费（用户 2026-10-26） */
    if (isFood && !f.post) h += fieldHTML('f-price', esc(t('priceFood')), '<input id="f-price" class="input" type="number" inputmode="decimal" min="0" step="0.5">');
    /* 记录默认进“我的地图”，只问要不要分享到大地图 */
    if (f.post && !f.editId) h += '<p class="f-hint">' + esc(state.lang === 'en' ? 'Public post · also saved to your footprints' : '公开分享 · 同时保存到个人足迹') + '</p>';
    else h += '<button type="button" class="switch-row" role="switch" data-action="f-share" aria-checked="' + share + '">' +
      '<span class="sw-text"><b>' + esc(t('shareBig')) + '</b><small>' + esc(t('shareHint')) + '</small></span><span class="switch" aria-hidden="true"></span></button>';
    if (!me().name) h += '<div class="field" id="nick-field"' + (share ? '' : ' hidden') + '><label class="f-label" for="f-nick">' + esc(t('nickname')) + '</label><input id="f-nick" class="input" maxlength="20" autocomplete="nickname" placeholder="' + esc(t('nicknamePh')) + '"></div>';
    if (placeFields && !f.post) {
      var d0 = f.draft || {};
      h += '<details class="more"' + (f.editId && (d0.alt || d0.link) ? ' open' : '') + '><summary>' + esc(t('formMore')) + '</summary><div class="more-body">' +
        '<div class="field"><span class="f-label" id="lbl-prec">' + esc(t('precision')) + '</span><div class="seg" role="group" aria-labelledby="lbl-prec">' +
        ['exact', 'area', 'city'].map(function (k) {
          return '<button type="button" data-action="f-prec" data-prec="' + k + '" aria-pressed="' + (f.precision === k) + '">' + esc(precLabel(k)) + '</button>';
        }).join('') + '</div><p class="f-hint">' + esc(t('precHint')) + '</p></div>' +
        fieldHTML('f-alt', esc(t('altName')), '<input id="f-alt" class="input" maxlength="60" placeholder="' + esc(t('altNamePh')) + '">') +
        fieldHTML('f-link', esc(t('link')), '<input id="f-link" class="input" type="url" inputmode="url" placeholder="' + esc(t('linkPh')) + '">') +
        '</div></details>';
    }
    h += '</form>';
    view.innerHTML = h;
    renderFormPhotos();
    restoreFormDraft();
    if (/^g\//.test(f.osm)) { mountGoogleFormDetail(f); googleCatForForm(f); googleAreaHint(f); }
    /* 分类只占一行，横着滑；预选的那个滑到看得见的地方 */
    var row = $('#place-form .chips-wrap.one-line'), sel = row && row.querySelector('[aria-pressed="true"]');
    if (sel) row.scrollLeft += sel.getBoundingClientRect().left - row.getBoundingClientRect().left - 18;
  }

  /* 表单里的照片：existing 是这条记录原来就有的（存在 IndexedDB），其余是刚选的 */
  function renderFormPhotos() {
    var box = $('#f-photos'), f = state.form;
    if (!box || !f) return;
    box.innerHTML = f.photos.map(function (ph) {
      var img = ph.existing ? '<img data-photo="' + esc(ph.id) + '" data-small alt="">' : '<img src="' + (ph.preview || ph.url) + '" decoding="async" alt="">';
      return '<div class="ph-edit' + (isClip(ph.id) ? ' is-clip' : isGif(ph.id) ? ' is-gif' : '') + '"><button type="button" class="ph-preview" data-action="f-photo-preview" data-id="' + esc(ph.id) + '" aria-label="' + esc(t('photoPreview')) + '">' + img + '</button><button type="button" class="ph-del" data-action="f-photo-del" data-id="' + ph.id + '" aria-label="' + esc(t('del')) + '">×</button></div>';
    }).join('') + (f.mediaBusy ? '<div class="ph-edit ph-busy">' + esc(t('mediaPreparing')) + '</div>' : '') + (f.photos.length + (f.mediaBusy || 0) < MAX_PHOTOS ? '<button type="button" class="ph-add" data-action="f-photo-add">' + ICON.camera + '<span>' + esc(t('addPhoto')) + '</span></button>' : '');
    hydratePhotos(box);
    var submit = $('#f-submit');
    if (submit && !f.saving) { submit.disabled = !!f.mediaBusy; submit.textContent = t(f.mediaBusy ? 'mediaPreparing' : f.editId ? 'saveEdit' : 'publish'); }
  }
  var DRAFT_FIELDS = [['f-title', 'title'], ['f-nick', 'nick'], ['f-name', 'name'], ['f-alt', 'alt'], ['f-price', 'price'], ['f-text', 'text'], ['f-link', 'link']];
  function captureFormDraft() {
    var f = state.form;
    if (!f || !$('#place-form')) return;
    var d = f.draft || {};
    DRAFT_FIELDS.forEach(function (pair) { var el = $('#' + pair[0]); if (el) d[pair[1]] = el.value; });
    f.draft = d;
  }
  function restoreFormDraft() {
    var d = state.form && state.form.draft;
    if (!d) return;
    DRAFT_FIELDS.forEach(function (pair) { var el = $('#' + pair[0]); if (el && d[pair[1]]) el.value = d[pair[1]]; });
  }

  /* 草稿（用户 2026-11-01）：新加记录、发帖时写的东西随时存在本机；意外退出、按了返回，下次点加号接着填。
     文字、打分、地点存 localStorage；照片原图和小图存 IndexedDB（键 draft:照片id）。
     保存成功或点“清空重来”才删。编辑已有记录不存（内容本来就在）。只留最近一份 */
  var LS_DRAFT = 'xuetuan:draft:v1';
  var DRAFT_PH = 'draft:';
  function draftKey() { var u = me(); return LS_DRAFT + ':' + ((u && u.id) || 'local'); }
  function readFormDraft() { try { var o = JSON.parse(lsGet(draftKey()) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
  function formHasContent(f) {
    var d = f.draft || {};
    return !!(f.photos.length || f.mediaBusy || (f.rating != null && f.rating !== f.rating0) || ['title', 'text', 'price', 'nick'].some(function (k) { return String(d[k] || '').trim(); }));
  }
  var draftLast = '';
  function saveFormDraft() {
    var f = state.form;
    if (!f || f.editId || f.saving) return;
    if (state.view === 'form') captureFormDraft();
    if (!formHasContent(f)) { if (f.drafted) clearFormDraft(); return; }
    var o = {};
    Object.keys(f).forEach(function (k) { if (k !== 'photos' && k !== 'saving' && k !== 'mediaBusy' && k !== 'restored' && k.charAt(0) !== '_') o[k] = f[k]; });
    o.photos = f.photos.filter(function (ph) { return !ph.existing && ph.blob; }).map(function (ph) {
      if (!ph._dk) {
        ph._dk = true;
        photoStore.put(DRAFT_PH + ph.id, ph.blob);
        if (ph.thumb) photoStore.put(DRAFT_PH + ph.id + THUMB_KEY, ph.thumb);
      }
      /* 后台传完了再记一笔，下次接着用不用再传 */
      if (ph._up && !ph.uploadedPath && !ph._dw) { ph._dw = true; ph._up.then(function () { saveFormDraft(); }, function () {}); }
      return { id: ph.id, up: ph.uploadedPath || '', thumb: !!ph.thumb };
    });
    o.mode = f.placeId && placeById(f.placeId) ? placeById(f.placeId).mode : state.mode;
    var json;
    try { json = JSON.stringify(o); } catch (e) { return; }
    if (json === draftLast) return;
    var old = readFormDraft();
    if (old && old.photos) old.photos.forEach(function (m) {
      if (!o.photos.some(function (n) { return n.id === m.id; })) { photoStore.del(DRAFT_PH + m.id); photoStore.del(DRAFT_PH + m.id + THUMB_KEY); }
    });
    draftLast = json; f.drafted = true;
    lsSet(draftKey(), json);
  }
  function clearFormDraft() {
    var old = readFormDraft();
    if (old && old.photos) old.photos.forEach(function (m) { photoStore.del(DRAFT_PH + m.id); photoStore.del(DRAFT_PH + m.id + THUMB_KEY); });
    try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ }
    draftLast = '';
    if (state.form) { state.form.drafted = false; state.form.photos.forEach(function (ph) { ph._dk = false; }); }
  }
  function loadDraftPhoto(m) {
    return Promise.all([photoStore.get(DRAFT_PH + m.id), m.thumb ? photoStore.get(DRAFT_PH + m.id + THUMB_KEY) : null]).then(function (r) {
      if (!r[0]) return null;
      /* 没确认传完的换个新名字重传（同名再传会被拒） */
      var ext = (m.id.match(/\.\w+$/) || [''])[0];
      var ph = { id: m.up ? m.id : uid('ph') + ext, blob: r[0], thumb: r[1] || null, url: URL.createObjectURL(r[0]) };
      ph.preview = ph.thumb ? URL.createObjectURL(ph.thumb) : ph.url;
      if (m.up) { ph.uploadedPath = m.up; ph._dk = true; }
      return ph;
    }, function () { return null; });
  }
  /* 点加号 / 发帖时有草稿就接着上次的；返回 true 表示接手了 */
  function resumeFormDraft(postOnly) {
    var o = readFormDraft();
    if (!o || (postOnly && !o.post)) return false;
    if (o.placeId && !placeById(o.placeId)) o.placeId = null;
    if (!o.post && !o.placeId && !(o.loc && isFinite(o.loc.lat) && isFinite(o.loc.lng))) { clearFormDraft(); return false; }
    var metas = o.photos || [];
    delete o.photos;
    rememberFeedSnap();
    Promise.all(metas.map(loadDraftPhoto)).then(function (list) {
      var f = newForm(Object.assign({}, o, { photos: list.filter(Boolean), restored: true, drafted: true }));
      if (o.mode && o.mode !== state.mode && !f.placeId) setMode(o.mode, { noFly: true });
      state.posting = !!f.post; state.form = f; state.view = 'form';
      draftLast = '';
      render(); setSnap('full');
      saveFormDraft();
      if (store.preupload) store.preupload(f.photos.filter(function (ph) { return !ph.uploadedPath; }));
      toast(state.lang === 'en' ? 'Picking up your unfinished draft' : '接着上次没写完的');
    });
    return true;
  }
  function discardFormDraft() {
    var f = state.form;
    confirmBox(state.lang === 'en' ? 'Clear this draft and start over?' : '清空这份草稿，重新开始？', state.lang === 'en' ? 'Clear' : '清空').then(function (ok) {
      if (!ok || state.form !== f) return;
      clearFormDraft();
      if (f) f.photos.forEach(releaseFormPreview);
      state.form = null;
      if (f && f.post) { state.posting = true; state.form = newForm(); state.view = 'form'; render(); setSnap('full'); }
      else openAdd();
    });
  }
  /* 写着的时候每两秒看一眼有没有变化；切到后台、关页面时马上存 */
  setInterval(function () { if (state.form && !document.hidden) saveFormDraft(); }, 2000);
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveFormDraft(); });
  window.addEventListener('pagehide', function () { saveFormDraft(); });

  function renderNearby() {
    var h = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="nearby-back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(t('nearbyTitle')) + '</h2></div>' +
      '<ul class="near-list">' + state.nearby.map(function (x) {
        return placeRowHTML(x.p, 'near-pick', esc(catName(catOf(x.p))) + ' · ' + esc(fmtDist(x.d)), '<span class="near-cta">' + esc(t('nearbyThis')) + '</span>');
      }).join('') + '</ul>' +
      '<div style="margin-top:16px"><button type="button" class="btn block" data-action="near-new">' + esc(t('nearbyNone')) + '</button></div>';
    view.innerHTML = h;
  }

  /* 搜索结果分三段：雪团里的、谷歌地图上的（谷歌自己画的列表，单独一块，不跟着重画）、地图上的地点 */
  var SEARCH_LISTS = '<ul class="search-results" id="search-local"></ul><div class="g-search" id="g-search" hidden></div><ul class="search-results" id="search-results"></ul>';
  function renderSearch() {
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button>' +
      '<div class="search-box"><img class="search-symbol" src="assets/search-pin.png" alt=""><input id="q" class="input" type="search" autocomplete="off" placeholder="' + esc(t('searchPh')) + '" aria-label="' + esc(t('searchBtn')) + '" value="' + esc(state.query) + '"></div></div>' +
      SEARCH_LISTS;
    queueOsmSearch();
    renderSearchResults();
    mountGoogle();
    setTimeout(function () { var q = $('#q'); if (q) q.focus(); }, 60);
  }
  /* 加地点：先按名字搜（雪团里已有的 + 地图上的），搜不到再去地图上选点 */
  function renderAdd() {
    var isFood = state.mode === 'food';
    view.innerHTML = '<div class="view-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button><h2 class="view-title">' + esc(t(isFood ? 'formNewFood' : 'formNewTravel')) + '</h2></div>' +
      '<div class="add-search"><div class="search-box"><img class="search-symbol" src="assets/search-pin.png" alt=""><input id="q" class="input" type="search" autocomplete="off" placeholder="' + esc(t(isFood ? 'addSearchPhFood' : 'addSearchPhTravel')) + '" aria-label="' + esc(t('searchBtn')) + '" value="' + esc(state.query) + '">' +
      '</div><button type="button" class="btn add-pin" data-action="add-pin">' + ICON.pin + esc(t('addPin')) + '</button></div>' +
      '<p class="f-hint add-hint">' + esc(t('addHint')) + '</p>' +
      (state.posting ? '' : '<button type="button" class="btn ghost block bulk-btn" data-action="bulk-start">' + ICON.camera + esc(t('bulkBtn')) + '</button>') +
      SEARCH_LISTS;
    queueOsmSearch();
    renderSearchResults();
    mountGoogle();
    setTimeout(function () { var q = $('#q'); if (q) q.focus(); }, 60);
  }
  function openAdd(post) {
    if (post !== true && !state.form && resumeFormDraft(false)) return;
    state.posting = post === true;
    rememberFeedSnap();
    state.view = 'add'; state.query = ''; state.form = null;
    render();
    setSnap('full');
  }
  function openPostComposer() {
    if (resumeFormDraft(true)) return;
    rememberFeedSnap();
    state.posting = true; state.form = newForm(); state.view = 'form';
    render(); setSnap('full');
    $('#f-file').click();
  }
  function returnPostComposer() { state.view = 'form'; render(); setSnap('full'); }
  /* 发帖和编辑记录时换地点：搜索、地图选点都回到同一张表单，草稿不丢 */
  function formKeepsDraft(f) { return !!(f && (f.post || f.relocate)); }
  function choosePostLocation(onMap) {
    var f = state.form;
    if (!formKeepsDraft(f) || f.saving) return;
    captureFormDraft();
    if (onMap) startPick({ post: true });
    else { state.view = 'add'; state.query = ''; render(); setSnap('full'); }
  }

  function renderSearchResults() {
    var box = $('#search-results'), local = $('#search-local');
    if (!box) return;
    var adding = state.view === 'add';
    var q = state.query.trim().toLowerCase();
    if (local) local.innerHTML = '';
    if (!q) { box.innerHTML = adding ? '' : areasHTML(); return; }
    var res = store.places().filter(function (p) {
      if (adding && p.mode !== state.mode) return false;
      return visibleToMe(p) && ((p.name || '').toLowerCase().indexOf(q) !== -1 || (p.altName || '').toLowerCase().indexOf(q) !== -1);
    }).slice(0, 30);
    var h = '';
    if (res.length) {
      h += '<li class="sec-title">' + esc(t('searchLocal')) + '</li>' + res.map(function (p) {
        var sub = placeSub(p);
        var info = esc(t(p.mode)) + ' · ' + esc(catName(catOf(p))) + (sub ? ' · ' + esc(sub) : '');
        return adding
          ? placeRowHTML(p, 'add-existing', info, '<span class="near-cta">' + esc(t(p.mode === 'food' ? 'writeReview' : 'beenHere')) + '</span>')
          : placeRowHTML(p, 'open-place', info);
      }).join('');
    }
    if (local) { local.innerHTML = h; hydratePhotos(local); h = ''; }
    h += '<li class="sec-title">' + esc(t('searchOsm')) + '</li>';
    if (q.length < 2) h += '<li class="empty small">' + esc(t('osmMin')) + '</li>';
    else if (osm.q !== q || osm.status === 'loading') h += '<li class="empty small">' + esc(t('osmLoading')) + '</li>';
    else if (osm.status === 'fail') h += '<li class="empty small">' + esc(t('osmFail')) + '<br><button type="button" class="link-btn" data-action="search-retry">' + esc(state.lang === 'en' ? 'Retry place search' : '重试地点搜索') + '</button></li>';
    else if (!osm.results.length) h += '<li class="empty small">' + esc(t(adding ? 'addNoResult' : 'noResults')) + '</li>';
    else h += osm.results.map(osmRowHTML).join('') + (osm.status === 'partial' ? '<li class="empty small">' + esc(t('osmMore')) + '</li>' : '');
    if (adding && q.length >= 2) h += '<li><button type="button" class="btn ghost block add-pin-bottom" data-action="add-pin">' + ICON.pin + esc(t('addPinLong')) + '</button></li>';
    h += '<li class="osm-credit">' + esc(t('osmCredit')) + '</li>';
    box.innerHTML = h;
    hydratePhotos(box);
  }

