/* 雪团 js/09-actions-boot.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= other actions ================= */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2400);
  }

  var modalResolve = null;
  function openModal(html) { var m = $('#modal'); m.innerHTML = html; m.hidden = false; syncNavGuard(); }
  function closeModal(result) {
    var m = $('#modal'); m.hidden = true; m.innerHTML = '';
    syncNavGuard();
    if (modalResolve) { var r = modalResolve; modalResolve = null; r(!!result); }
  }
  function confirmBox(msg, okLabel) {
    return new Promise(function (resolve) {
      openModal('<div class="modal-card" role="alertdialog" aria-modal="true"><p>' + esc(msg) + '</p><div class="btn-row end">' +
        '<button type="button" class="btn ghost" data-modal="no">' + esc(t('cancel')) + '</button>' +
        '<button type="button" class="btn danger" data-modal="yes">' + esc(okLabel) + '</button></div></div>');
      modalResolve = resolve;
      setTimeout(function () { var b = $('[data-modal="no"]'); if (b) b.focus(); }, 30);
    });
  }

  function openAreaDialog() {
    if (!map) { toast(t('mapFail')); return; }
    openModal('<form class="modal-card" id="area-form"><h3>' + esc(t('saveArea')) + '</h3>' +
      '<label class="f-label" for="area-name">' + esc(t('areaName')) + '</label>' +
      '<input id="area-name" class="input" maxlength="20" placeholder="' + esc(t('areaNamePh')) + '">' +
      '<div class="btn-row end"><button type="button" class="btn ghost" data-modal="no">' + esc(t('cancel')) + '</button>' +
      '<button type="submit" class="btn primary">' + esc(t('save')) + '</button></div></form>');
    setTimeout(function () { var i = $('#area-name'); if (i) i.focus(); }, 30);
  }
  /* 改名字：个人主页点头像/名字打开（头像现在是名字的第一个字，改名字头像跟着变） */
  function openProfileDialog() {
    var en = state.lang === 'en', name = me().name || '';
    openModal('<form class="modal-card" id="profile-form"><h3>' + esc(en ? 'Avatar and name' : '头像和名字') + '</h3>' +
      '<div class="pf-preview"><button type="button" class="pf-av-btn" data-action="pf-avatar-pick" aria-label="' + esc(en ? 'Change photo' : '换头像照片') + '"><span id="pf-preview">' + avatarHTML(name || '?', me().id) + '</span><i>' + esc(en ? 'Change photo' : '换照片') + '</i></button>' +
      '<input id="pf-avatar-file" type="file" accept="image/*" hidden></div>' +
      '<input id="pf-dialog-name" class="input" maxlength="20" autocomplete="nickname" value="' + esc(name) + '" placeholder="' + esc(t('nicknamePh')) + '">' +
      '<p class="f-hint">' + esc(en ? 'Tap the avatar to use a photo. Without one, it shows the first letter of your name.' : '点头像可以换成照片；没有照片时显示名字的第一个字。') + '</p>' +
      '<div class="btn-row end"><button type="button" class="btn ghost" data-modal="no">' + esc(t('cancel')) + '</button>' +
      '<button type="submit" class="btn primary">' + esc(t('save')) + '</button></div></form>');
    setTimeout(function () { var i = $('#pf-dialog-name'); if (i) { i.focus(); i.select(); } }, 30);
  }
  /* 头像照片裁成正中的正方形：400px 原图 + 120px 小图 */
  function squareAvatar(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(u);
        var side = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        function enc(n) {
          var cv = document.createElement('canvas'); cv.width = cv.height = Math.min(n, side);
          cv.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, cv.width, cv.height);
          return new Promise(function (ok2, bad) { cv.toBlob(function (b) { if (b) ok2(b); else bad(new Error('encode')); }, 'image/jpeg', 0.85); });
        }
        Promise.all([enc(400), enc(120)]).then(function (b) { resolve({ blob: b[0], thumb: b[1] }); }, reject);
      };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('decode')); };
      img.src = u;
    });
  }
  var pendingAvatar = null;
  function pickAvatarFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    squareAvatar(file).then(function (out) {
      pendingAvatar = out;
      var pv = $('#pf-preview');
      if (pv) pv.innerHTML = '<span class="avatar has-photo" aria-hidden="true"><img src="' + URL.createObjectURL(out.thumb) + '" alt=""></span>';
    }, function () { toast(state.lang === 'en' ? 'Could not read this photo' : '这张照片读不出来，换一张试试'); });
  }
  function saveProfileDialog() {
    var i = $('#pf-dialog-name'), name = (i && i.value || '').trim().slice(0, 20), btn = $('#profile-form [type="submit"]');
    if (!name) { i.focus(); return; }
    if (btn) btn.disabled = true;
    var av = pendingAvatar ? store.setAvatar(pendingAvatar) : Promise.resolve();
    av.then(function () { pendingAvatar = null; return store.updateProfile({ name: name }); }).then(function () {
      closeModal(false); toast(t('updated')); refreshMap();
      if (state.view === 'feed' || state.view === 'person') { var y = view.scrollTop; render(); view.scrollTop = y; }
    }, function () { if (btn) btn.disabled = false; toast(t('saveFail')); });
  }
  function saveArea() {
    var name = ($('#area-name') && $('#area-name').value || '').trim();
    if (!name) { $('#area-name').focus(); return; }
    var c = map.getCenter();
    store.addArea({ name: name.slice(0, 20), lng: round6(c.lng), lat: round6(c.lat), zoom: Math.round(map.getZoom() * 100) / 100 }).then(function () {
      closeModal(false);
      toast(t('areaSaved'));
      if (state.view === 'feed') render();
    });
  }
  function gotoArea(id) {
    var a = null;
    PRESET_AREAS.concat(store.areas()).forEach(function (x) { if (x.id === id) a = x; });
    if (a) flyTo([a.lng, a.lat], a.zoom);
  }

  function clearSamples() {
    confirmBox(t('clearSamplesQ'), t('clearSamplesOk')).then(function (ok) {
      if (!ok) return;
      store.clearSamples().then(function () {
        refreshMap();
        if (state.view === 'place' && !placeById(state.placeId)) goFeed(); else render();
        toast(t('samplesCleared'));
      });
    });
  }

  function deleteReview(id) {
    var r = store.review(id);
    if (!r || !isMine(r)) return;
    confirmBox(t('delReviewQ'), t('delOk')).then(function (ok) {
      if (!ok) return;
      store.deleteReview(id).then(function (res) {
        refreshMap();
        toast(t('deleted'));
        if (res.placeRemoved) goFeed(); else render();
      });
    });
  }

  var savedWrites = new Map();
  function savedButtons(placeId) {
    return $$('[data-action="save-place"], [data-action="toggle-save"]').filter(function (b) { return b.dataset.id === placeId || (b.dataset.action === 'toggle-save' && state.placeId === placeId); });
  }
  function paintSavedButtons(placeId) {
    savedButtons(placeId).forEach(function (b) {
      var tmp = document.createElement('div'), action = b.dataset.action;
      tmp.innerHTML = saveBtnHTML(placeId,b.classList.contains('pc-save'));
      var fresh = tmp.firstElementChild; fresh.dataset.action = action;
      fresh.disabled = savedWrites.has(placeId); fresh.setAttribute('aria-busy',String(savedWrites.has(placeId)));
      b.replaceWith(fresh);
    });
  }
  function savePlace(placeId) {
    if (!placeId) { toast(state.lang === 'en' ? 'Place is still loading. Try again.' : '地点还没加载好，请稍后再试'); return Promise.resolve(false); }
    if (savedWrites.has(placeId)) return savedWrites.get(placeId);
    var on = !store.isSaved(placeId), actor = me().id;
    savedButtons(placeId).forEach(function (b) { b.disabled = true; b.setAttribute('aria-busy','true'); b.classList.add('saving'); if (!b.classList.contains('pc-save')) b.innerHTML = (on ? ICON.star : ICON.starOn) + esc(state.lang === 'en' ? (on ? 'Saving…' : 'Removing…') : (on ? '收藏中…' : '取消中…')); });
    var slow = setTimeout(function () { if (savedWrites.has(placeId)) toast(state.lang === 'en' ? 'Saving is taking longer. Please wait…' : '收藏保存较慢，请稍候…'); }, 4000);
    var work = Promise.resolve().then(function () { return store.setSaved(placeId,on); }).then(function () {
      if (actor !== me().id) return false;
      toast(t(on ? 'wishAdded' : 'wishRemoved')); refreshMap();
      if (!placeById(placeId) && state.view === 'place' && state.placeId === placeId) goFeed();
      return true;
    }, function (e) {
      if (actor !== me().id) return false;
      var message = String(e && e.message || e || '');
      toast(/XUETUAN_/.test(message) ? securitySaveError(e) : (state.lang === 'en' ? 'Could not save. Check your connection and retry.' : '收藏没有保存成功，请检查网络后重试'));
      return false;
    }).finally(function () {
      clearTimeout(slow); savedWrites.delete(placeId);
      if (actor === me().id) paintSavedButtons(placeId);
    });
    savedWrites.set(placeId,work); return work;
  }
  function toggleSave(placeId) { return savePlace(placeId); }
  /* 还不在雪团的地方（搜索结果、底图上的店）先收藏：建一个没有记录的地点，放进想去 */
  function savePreview(r) {
    var p0 = osmExisting(r);
    var gcat = !p0 && !r.cat && r.mode === 'food' && /^g\//.test(r.osm || '') ? fetchGoogleCat(r.osm.slice(2)) : Promise.resolve(null);
    var step = p0 ? Promise.resolve(p0) : gcat.then(function (gc) { return store.addPlace({
      mode: r.mode, cat: gc || normCat(r.cat, r.name) || 'other', precision: r.mode === 'food' ? 'exact' : r.precision, lat: r.lat, lng: r.lng,
      name: String(r.name || t(r.mode === 'food' ? 'unnamedFood' : 'unnamedTravel')).slice(0, 60), altName: String(r.alt || '').slice(0, 60), link: '', osm: r.osm || ''
    }); });
    step.then(function (p) {
      return store.isSaved(p.id) ? p : store.setSaved(p.id, true).then(function () { return p; });
    }).then(function (p) {
      state.preview = null;
      toast(t('wishAdded'));
      refreshMap();
      openPlace(p.id, { fly: false });
    }, function () { toast(t('saveFail')); });
  }

  function copyCoords(c) {
    var done = function () { toast(t('copied')); };
    var fail = function () { toast(t('copyFail', { c: c })); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(c).then(done, fail);
      else fail();
    } catch (e) { fail(); }
  }

  function blobToDataURL(b) {
    return new Promise(function (resolve) { var fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = function () { resolve(null); }; fr.readAsDataURL(b); });
  }
  function dataURLToBlob(u) { return fetch(u).then(function (r) { return r.blob(); }); }

  function exportData() {
    store.exportBackup().then(function (out) {
      var blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
      var a = document.createElement('a');
      var d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = 'xuetuan-backup-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    });
  }

  function importData(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var obj;
      try { obj = JSON.parse(fr.result); } catch (e) { toast(t('importFail')); return; }
      store.importBackup(obj).then(function (added) {
        if (added < 0) { toast(t('importFail')); return; }
        refreshMap();
        render();
        toast(t('imported', { n: added }));
      });
    };
    fr.onerror = function () { toast(t('importFail')); };
    fr.readAsText(file);
  }

  var lb = { ids: [], i: 0 }, lbRequest = 0;
  function openBulkPhoto(i, j) {
    var g = state.bulk && state.bulk.groups && state.bulk.groups[i];
    if (!g || !g.photos[j]) return;
    var photos = g.photos.map(function (p, k) { return { id: 'bulk-' + i + '-' + k + (videoFile(p.file) ? '.' + (extOf(p.file.type) || 'mp4') : ''), file: p.file, preview: p.url }; });
    lb = { ids: photos.map(function (p) { return p.id; }), photos: photos, i: j, ownedURLs: [] };
    lbOpenBox(); showLightbox(); syncNavGuard();
  }
  function openPlacePhotos(id, photo) {
    var p = placeById(id), ids = p ? placePhotos(p) : [];
    if (!ids.length) return;
    lb = { ids: ids, i: Math.max(0, ids.indexOf(photo)), place: id };
    lbOpenBox(); showLightbox(); syncNavGuard();
  }
  function openClusterPhotos() {
    var ids = [], places = {}, when = {};
    (state.clusterPlaces || []).forEach(function (id) {
      var p = placeById(id); if (!p || !inScope(p) || !passesFilters(p)) return;
      scopedReviews(p.id).forEach(function (r) { (r.photos || []).forEach(function (photo) { if (!(photo in when) || r.createdAt > when[photo]) when[photo] = r.createdAt; }); });
      placePhotos(p).forEach(function (photo) { if (ids.indexOf(photo) === -1) { ids.push(photo); places[photo] = id; } });
    });
    /* 越新的越前面；同一时间的保持原来的顺序 */
    ids = ids.map(function (id, k) { return [id, k]; }).sort(function (a, b) { return (when[b[0]] || 0) - (when[a[0]] || 0) || a[1] - b[1]; }).map(function (x) { return x[0]; });
    if (!ids.length) return;
    lb = { ids: ids, i: 0, placeIds: places };
    lbOpenBox(); showLightbox(); syncNavGuard();
  }
  function openFormPhoto(id) {
    var f = state.form; if (!f) return;
    var photos = f.photos.slice(), ids = photos.map(function (ph) { return ph.id; });
    lb = { ids: ids, i: Math.max(0, ids.indexOf(id)), photos: photos };
    lbOpenBox(); showLightbox(); syncNavGuard();
  }
  function openLightbox(id, group) {
    if (group === 'place' && state.placeId) { openPlacePhotos(state.placeId, id); return; }
    var ids = $$('[data-action="photo"][data-group="' + group + '"]', view).map(function (b) { return b.dataset.id; });
    lb = { ids: ids.length ? ids : [id], i: Math.max(0, ids.indexOf(id)) };
    lbOpenBox();
    showLightbox();
    syncNavGuard();
  }
  /* 打开大图时两侧箭头轻轻晃两下，之后只留淡淡的箭头 */
  function lbOpenBox() {
    var box = $('#lightbox'); box.hidden = false;
    box.classList.remove('lb-nudge'); void box.offsetWidth; box.classList.add('lb-nudge');
  }
  function showLightbox() {
    var request = ++lbRequest;
    (lb.ownedURLs || []).forEach(function (u) { URL.revokeObjectURL(u); });
    if (lb.photos && lb.ownedURLs) lb.photos.forEach(function (p) { if (lb.ownedURLs.indexOf(p.url) !== -1) delete p.url; });
    if (lb.ownedURLs) lb.ownedURLs = [];
    var multi = lb.ids.length > 1;
    $('#lb-navigation').hidden = !multi;
    $('#lb-prev').hidden = !multi; $('#lb-next').hidden = !multi;
    $('#lb-hint-l').hidden = !multi; $('#lb-hint-r').hidden = !multi;
    $('#lb-prev').setAttribute('aria-label', state.lang === 'en' ? 'Previous photo' : '上一张');
    $('#lb-next').setAttribute('aria-label', state.lang === 'en' ? 'Next photo' : '下一张');
    $('#lb-count').textContent = multi ? (lb.i + 1) + ' / ' + lb.ids.length : '';
    var id = lb.ids[lb.i], clip = isClip(id), img = $('#lb-img'), vid = $('#lb-vid');
    var place = lb.place || (lb.placeIds && lb.placeIds[id]);
    var comment = $('#lb-comment'), review = place && scopedReviews(place).find(function (r) { return (r.photos || []).indexOf(id) !== -1; });
    comment.textContent = review ? [lb.placeIds ? placeTitle(placeById(place)) : '', authorLabel(review), review.rating == null ? '' : fmtScore(review.rating) + ' / 5', review.text].filter(Boolean).join(' · ') : '';
    comment.hidden = !comment.textContent;
    img.hidden = clip; vid.hidden = !clip;
    if (clip) img.removeAttribute('src'); else { vid.pause(); vid.removeAttribute('src'); }
    var draft = lb.photos && lb.photos.find(function (ph) { return ph.id === id && !ph.existing; });
    var status = $('#lb-status'), retry = $('#lb-retry');
    status.hidden = false; retry.hidden = true; retry.textContent = state.lang === 'en' ? 'Retry' : '重试';
    $('#lb-status-text').textContent = state.lang === 'en' ? 'Loading…' : '加载中…';
    function current() { return request === lbRequest && !$('#lightbox').hidden && lb.ids[lb.i] === id; }
    function loaded() { if (current()) status.hidden = true; }
    function failed() { if (!current()) return; status.hidden = false; retry.hidden = false; $('#lb-status-text').textContent = state.lang === 'en' ? 'Could not load this photo.' : '这张图片暂时没加载出来'; }
    img.onload = loaded; vid.onloadeddata = loaded; vid.onerror = failed;
    if (!clip) img.removeAttribute('src');
    var pending = null;
    if (draft && draft.file && !draft.url) {
      /* 批量预览只解码一张适合屏幕的大图，原文件留给保存。 */
      if (!clip && !/\.gif$/i.test(draft.file.name || '') && window.createImageBitmap) {
        img.src = draft.preview || '';
        pending = createImageBitmap(draft.file, { resizeWidth: 1280, resizeQuality: 'medium' }).then(function (bm) {
          return frameJpeg(bm, bm.width, bm.height, 1600).then(function (blob) { bm.close(); return blob; }, function (e) { bm.close(); throw e; });
        }).then(function (blob) {
          if (!blob || request !== lbRequest || $('#lightbox').hidden) return null;
          var url = URL.createObjectURL(blob); lb.ownedURLs.push(url); return url;
        }).catch(function () { return draft.preview || null; });
      } else { draft.url = URL.createObjectURL(draft.file); lb.ownedURLs.push(draft.url); }
    }
    var previewTried = false;
    img.onerror = function () { if (!current()) return; if (!previewTried && draft && draft.preview) { previewTried = true; img.src = draft.preview; } else failed(); };
    (pending || (draft ? Promise.resolve(draft.url) : store.photoURL(id))).then(function (u) {
      if (request !== lbRequest || $('#lightbox').hidden || lb.ids[lb.i] !== id) return;
      if (!u) { failed(); return; }
      if (!clip) { img.src = u; return; }
      vid.src = u;
      var pr = vid.play();
      if (pr && pr.catch) pr.catch(function () {});
    }).catch(failed);
  }
  function moveLightbox(delta) { if ($('#lightbox').hidden || lb.ids.length < 2) return; lb.i = (lb.i + delta + lb.ids.length) % lb.ids.length; showLightbox(); }
  (function lightboxGestures() {
    var box = $('#lightbox'), start = null, suppressUntil = 0;
    box.addEventListener('touchstart', function (e) {
      start = null;
      if (e.touches.length !== 1 || lb.ids.length < 2 || e.target.closest('button, video, .lb-comment') || (window.visualViewport && visualViewport.scale > 1.01)) return;
      start = { x:e.touches[0].clientX, y:e.touches[0].clientY, index:lb.i, request:lbRequest, horizontal:false };
    }, { passive:true });
    box.addEventListener('touchmove', function (e) {
      if (!start) return;
      if (e.touches.length !== 1 || (e.scale && e.scale !== 1)) { start = null; return; }
      var dx=e.touches[0].clientX-start.x,dy=e.touches[0].clientY-start.y;
      if (Math.abs(dy)>14 && Math.abs(dy)>Math.abs(dx)) { start=null; return; }
      if (Math.abs(dx)>12 && Math.abs(dx)>Math.abs(dy)*1.2) { start.horizontal=true; if(e.cancelable)e.preventDefault(); }
    }, { passive:false });
    box.addEventListener('touchend', function (e) {
      var s=start;start=null;
      if(!s || !s.horizontal || !e.changedTouches.length || lb.i!==s.index || lbRequest!==s.request)return;
      var dx=e.changedTouches[0].clientX-s.x;
      if(Math.abs(dx)<42)return;
      suppressUntil=performance.now()+350;moveLightbox(dx<0?1:-1);
    }, { passive:true });
    box.addEventListener('touchcancel',function(){start=null;},{passive:true});
    box.addEventListener('click',function(e){if(performance.now()<suppressUntil && !e.target.closest('button')){e.preventDefault();e.stopPropagation();}},true);
    document.addEventListener('keydown',function(e){if(!box.hidden && (e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();moveLightbox(e.key==='ArrowLeft'?-1:1);}});
  })();
  function closeLightbox() {
    lbRequest++;
    (lb.ownedURLs || []).forEach(function (u) { URL.revokeObjectURL(u); });
    lb = { ids: [], i: 0 };
    $('#lb-img').onerror = null;
    $('#lb-img').onload = null; $('#lb-vid').onloadeddata = null; $('#lb-vid').onerror = null; $('#lb-status').hidden = true;
    $('#lightbox').hidden = true; $('#lb-img').removeAttribute('src');
    var vid = $('#lb-vid'); vid.pause(); vid.removeAttribute('src'); vid.hidden = true;
    syncNavGuard();
  }

  /* ================= events ================= */
  /* 拉的时候只改字和“看 N 个地方”，松手再刷新地图和整张筛选卡（重画会打断拖动） */
  function setPriceAbout(el, done) {
    state.priceAbout = PRICE_STOPS[+el.value] || 0;
    var v = $('#flt-price-val');
    if (v) { v.textContent = priceLabel(state.priceAbout); v.classList.toggle('muted', !state.priceAbout); }
    el.style.setProperty('--fill', (+el.value / (PRICE_STOPS.length - 1) * 100) + '%');
    if (done) { refilter(); return; }
    var btn = $('#bsheet-card .bsheet-foot .btn.primary');
    if (btn) btn.textContent = t('filterShow', { n: store.places().filter(function (p) { return inScope(p) && passesFilters(p); }).length });
  }
  document.addEventListener('change', function (e) { if (e.target.id === 'flt-price') setPriceAbout(e.target, true); if (e.target.id === 'pf-avatar-file') { pickAvatarFile(e.target.files && e.target.files[0]); e.target.value = ''; } });
  function refilter() {
    renderFilters(); refreshMap();
    if (state.view === 'feed') render();
    if (state.bsheet) renderBSheet();
  }
  document.addEventListener('click', function (e) {
    if (state.homeFiltersOpen && !e.target.closest('.home-filter-menu')) setHomeFiltersOpen(false);
    var mb = e.target.closest('[data-modal]');
    if (mb) { closeModal(mb.dataset.modal === 'yes'); return; }
    if (e.target.id === 'modal') { closeModal(false); return; }
    if (e.target.id === 'lightbox') { closeLightbox(); return; }
    if (e.target.id === 'bsheet') { closeBSheet(); return; }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action, d = el.dataset;
    if (handleSocialAction(a,el)) return;
    switch (a) {
      case 'price-toggle': e.preventDefault(); e.stopPropagation(); togglePrice(el); break;
      case 'google-retry': retryGoogle(el.closest('.g-search')); break;
      case 'toggle-mode':
        if (state.view !== 'feed') goFeed();
        state.mineBoth = false;
        setMode(state.mode === 'food' ? 'travel' : 'food');
        break;
      case 'tab': setTab(d.tab); if (d.tab === 'home') refreshHome(true); break;
      case 'foot-time': { state.footTime = state.footTime === 'taken' ? 'added' : 'taken'; var fy = view.scrollTop; render(); view.scrollTop = fy; break; }
      case 'home-all-time': state.homeDays = 0; render(); break;
      case 'visit-multi': if (!visibilityBusy) { selectingVisits=!selectingVisits; selectedVisits.clear(); var vy=view.scrollTop; render(); view.scrollTop=vy; } break;
      case 'visit-select': if (!visibilityBusy && store.review(d.id) && isMine(store.review(d.id))) { if(selectedVisits.has(d.id))selectedVisits.delete(d.id);else selectedVisits.add(d.id); var sy=view.scrollTop;render();view.scrollTop=sy; } break;
      case 'visit-all': if (!visibilityBusy) { var all=feedReviews().filter(isMine); var allOn=all.length && all.every(function(r){return selectedVisits.has(r.id);}); all.forEach(function(r){if(allOn)selectedVisits.delete(r.id);else selectedVisits.add(r.id);});var ay=view.scrollTop;render();view.scrollTop=ay; } break;
      case 'visit-privacy': if (d.v === 'public' && guestBlocked()) break; changeVisitVisibility([d.id],d.v); break;
      case 'visit-bulk': if (d.v === 'public' && guestBlocked()) break; changeVisitVisibility(Array.from(selectedVisits),d.v); break;
      case 'home-mode': state.homeMode = ['all','food','travel'].indexOf(d.v) !== -1 ? d.v : 'all'; render(); view.scrollTop = 0; break;
      case 'home-filters': setHomeFiltersOpen(!state.homeFiltersOpen); break;
      case 'my-share': openMyShare(); break;
      case 'moderation': openModeration(d.id); break;
      case 'moderation-confirm': moderateVisit(d.id,d.decision); break;
      case 'moderation-clean': if (isModerator()) store.cleanModerationMedia().then(function (n) { toast(state.lang === 'en' ? 'Media cleanup complete: ' + n : '图片清理完成：' + n); }, function (e) { toast(securitySaveError(e)); }); break;
      case 'app-share': openAppShare(); break;
      case 'app-share-copy': copyAppShare(); break;
      case 'app-share-system': sendAppShare(); break;
      case 'share-theme': if (shareCard && shareCard.own) { shareCard.theme = d.v === 'stats' ? 'stats' : 'atlas'; render(); } break;
      case 'share-card': sendShareCard(); break;
      case 'save-share-card': saveShareCard(); break;
      case 'copy-share-card': copyShareCard(); break;
      case 'home-refresh': refreshHome(true); break;
      case 'home-apply': render(); view.scrollTop = 0; break;
      /* 足迹标题旁边的 去过 / 想去 */
      case 'foot-filters': openBSheet('filters'); break;
      case 'open-favorites': openFavorites(); break;
      case 'favorites-back': closeFavorites(); break;
      case 'mine-sub':
        state.scope = state.mineSub = d.v;
        renderFilters(); refreshMap();
        if (state.view === 'feed') render(); else goFeed();
        if (state.bsheet) renderBSheet();
        break;
      /* 我的里点“去过 / 想去”的数字：去足迹的那一边 */
      case 'foot-sub': if(d.v==='saved') openFavorites(); else setTab('foot'); break;
      case 'open-post': openPost(d.id); break;
      case 'person': openPerson(d.uid); break;
      case 'page-public':
        if (!store.pagePublic(me().id) && guestBlocked()) break;
        store.updateProfile({ page_public: !store.pagePublic(me().id) }).then(function () { if (state.view === 'feed' && state.tab === 'me') { var y = view.scrollTop; render(); view.scrollTop = y; } }, function () { toast(t('saveFail')); });
        break;
      case 'post-place': openPostPlace(d.id); break;
      case 'save-place': { if (!store.signedIn()) toast(state.lang === 'en' ? 'Preparing to save…' : '正在准备收藏，请稍候…'); var spl = d.id; if (requireLogin(function () { savePlace(spl); })) savePlace(spl); break; }
      case 'save-preview': { var spv = state.preview; if (spv && requireLogin(function () { savePreview(spv); })) savePreview(spv); break; }
      case 'cat': if(d.catMode && state.scope==='mine' && state.mineBoth){state.mineBoth=false;state.mode=d.catMode;} state.cat = d.cat; refilter(); break;
      case 'saved-want': state.savedWant = d.v === 'want'; state.savedStatus=d.v; refilter(); break;
      case 'mine-mode': if (state.view !== 'feed') goFeed(); setMineView(d.v); if (state.bsheet) renderBSheet(); break;
      case 'homes-open':
        setTab('explore'); if (state.mode !== 'travel') setMode('travel', { noFly: true });
        state.homesOn = true; goFeed(); refreshMap(); renderFilters(); saveView(); toast(t('homesOpened'));
        if (map) flyTo([108, 12], 3);
        break;
      case 'homes-toggle': closeBSheet(); state.homesOn = !state.homesOn; goFeed(); refreshMap(); renderFilters(); saveView(); toast(t(state.homesOn ? 'homesOpened' : 'homesClosed')); break;
      case 'mine-home-toggle': state.mineHomeOn = !state.mineHomeOn; refreshMap(); renderFilters(); saveView(); if (state.bsheet) renderBSheet(); toast(state.lang === 'en' ? (state.mineHomeOn ? 'My hometown shown' : 'My hometown hidden') : (state.mineHomeOn ? '已显示我的家乡' : '已隐藏我的家乡')); break;
      case 'home-set': openHomeSet(); break;
      case 'acct': switchAccount(d.id); break;
      case 'acct-add': addAccount(); break;
      case 'home-pick': if (requireLogin(function () { startPick({ home: true }); })) startPick({ home: true }); break;
      case 'home-result': var hr = homeQ.results[+d.i]; if (hr) saveHome(hr.name, hr); break;
      case 'home-del':
        store.setHome(null).then(function () { toast(t('homeRemoved')); afterHomeChange(); render(); }, function () { toast(t('saveFail')); });
        break;
      case 'home-public':
        var mh = store.myHome();
        if (mh && !mh.public && guestBlocked()) break;
        if (mh) store.setHome({ city: mh.city, lat: mh.lat, lng: mh.lng, public: !mh.public }).then(function () { afterHomeChange(); render(); }, function () { toast(t('saveFail')); });
        break;
      case 'countries': state.countries = !state.countries; syncCountries(); renderFilters(); saveView(); break;
      case 'filters': openBSheet('filters'); break;
      case 'sheet-close': closeBSheet(); break;
      case 'set-score': state.minScore = +d.v; refilter(); break;
      case 'set-dist': state.dist = d.v; refilter(); break;
      case 'clear-filters': state.cat = 'all'; state.priceAbout = 0; state.minScore = 0; state.dist = 'any'; renderFilters(); refreshMap(); render(); if (state.bsheet) renderBSheet(); break;
      case 'search': rememberFeedSnap(); state.view = 'search'; render(); setSnap('full'); break;
      case 'search-retry': osm.q = ''; osm.ck = ''; queueOsmSearch(); renderSearchResults(); break;
      case 'set-lang': setLang(d.lang); break;
      case 'set-style': setBasemap(d.style); break;
      case 'campus': closeBSheet(); if (state.view === 'search') { toMapTab(); goFeed(); } flyTo([XMUM.lng, XMUM.lat], state.mode === 'travel' ? TRAVEL_ZOOM : 14.6); break;
      case 'locate': closeBSheet(); if (state.view === 'search') { toMapTab(); goFeed(); } locate(); break;
      case 'new-post': if (requireLogin(openPostComposer)) openPostComposer(); break;
      case 'post-location': choosePostLocation(false); break;
      case 'post-map': choosePostLocation(true); break;
      case 'post-mode': if (state.form && !state.form.saving && d.v !== state.mode) { captureFormDraft(); Object.assign(state.form, { placeId:null, loc:null, osm:'', cat:null, lockedName:false }); setMode(d.v, { noFly: true }); returnPostComposer(); } break;
      case 'add': if (requireLogin(openAdd)) openAdd(); break;
      case 'add-pin': startPick({}); break;
      case 'add-existing': startReview(d.id); break;
      case 'pick-cancel': cancelPick(); break;
      case 'pick-confirm': confirmPick(); break;
      case 'pick-campus': if (map) { if(state.picking)state.picking.selected=null; map.resize(); map.jumpTo({center:[XMUM.lng,XMUM.lat],zoom:15.5,padding:{top:0,bottom:0,left:0,right:0}}); updatePickUI(); } break;
      case 'expand': if (isMobile()) setSnap(state.snap === 'peek' ? 'half' : state.snap === 'half' ? 'full' : 'half'); break;
      case 'goto-area': closeBSheet(); if (state.view === 'search') { toMapTab(); goFeed(); } gotoArea(d.id); break;
      case 'save-area': closeBSheet(); openAreaDialog(); break;
      case 'del-area': store.deleteArea(d.id).then(render); break;
      case 'clear-samples': clearSamples(); break;
      case 'open-place': openPlace(d.id); break;
      case 'back': back(); break;
      case 'write-review': { var wpid = state.placeId; if (wpid && requireLogin(function () { startReview(wpid); })) startReview(wpid); break; }
      case 'toggle-save': { if (!store.signedIn()) toast(state.lang === 'en' ? 'Preparing to save…' : '正在准备收藏，请稍候…'); var tpid = d.id || state.placeId; if (tpid && requireLogin(function () { toggleSave(tpid); })) toggleSave(tpid); break; }
      case 'copy-coords': copyCoords(d.c); break;
      case 'photo': openLightbox(d.id, d.group); break;
      /* 点照片任何地方都放大（右下角的放大图标只是提示，用户 2026-11-02） */
      case 'hero-photo': if (state.placeId) openPlacePhotos(state.placeId, d.id); break;
      case 'hero-zoom': { var hs = $('#hero-track'); if (hs && state.placeId) openPlacePhotos(state.placeId, hs.children[heroIndex()].dataset.id); break; }
      case 'edit-profile': pendingAvatar = null; openProfileDialog(); break;
      case 'pf-avatar-pick': $('#pf-avatar-file').click(); break;
      case 'edit-review': { var fromPost = state.view === 'post'; startEdit(d.id); if (fromPost && state.form) state.form.fromPost = true; } break;
      case 'del-review': deleteReview(d.id); break;
      case 'form-cancel': formCancel(); break;
      case 'draft-discard': discardFormDraft(); break;
      case 'repick': captureFormDraft(); startPick({ repick: true }); break;
      case 'pick-go': pickGo(+d.k); break;
      case 'area-repick':
        /* 城市不当地点用：去掉谷歌的城市 id，名字留着，到地图上点具体位置 */
        if (!state.form) break;
        if (formKeepsDraft(state.form)) { choosePostLocation(true); break; }
        captureFormDraft();
        Object.assign(state.form, { osm: '', lockedName: false, placeId: null });
        startPick({ repick: true }); break;
      case 'f-cat': state.form.cat = d.cat; state.form.catSrc = 'user'; setPressed('[data-action="f-cat"]', 'cat', d.cat); if ($('#cat-guess')) $('#cat-guess').hidden = true; break;
      case 'f-prec': state.form.precision = d.prec; setPressed('[data-action="f-prec"]', 'prec', d.prec); break;
      case 'f-share':
        if (state.form.visibility !== 'public' && guestBlocked()) break;
        state.form.visibility = state.form.visibility === 'public' ? 'private' : 'public';
        el.setAttribute('aria-checked', String(state.form.visibility === 'public'));
        if ($('#nick-field')) $('#nick-field').hidden = state.form.visibility !== 'public';
        lsSet(LS_SHARE, state.form.visibility === 'public' ? '1' : '0');
        break;
      case 'f-photo-add': $('#f-file').click(); if (catModelOn() && catNoteFor(state.form)) loadCatModel().catch(function () {}); break;
      case 'bulk-start': if (requireLogin()) $('#bulk-file').click(); break;
      case 'bulk-preview': openBulkPhoto(+d.i, +d.j); break;
      case 'bulk-map': {
        var group = state.bulk && !state.bulk.saving && state.bulk.groups[+d.i];
        if (group) { var sc = view.scrollTop; bulkMapOff(); startPick({ bulkGroup: +d.i, mode: group.mode, scroll: sc }); if (map && group.lat != null && group.lng != null) map.jumpTo({ center: [group.lng, group.lat], zoom: group.mode === 'food' ? 16 : 10 }); }
        break;
      }
      case 'bulk-ph': bulkTogglePhoto(+d.i, +d.j, el); break;
      case 'bulk-cur': bulkCurToggle(+d.i); break;
      case 'bulk-known': bulkKnownPick(+d.i, +d.k); break;
      case 'bulk-merge': bulkMerge(+d.i); break;
      case 'bulk-mode': bulkSetMode(+d.i, d.v); break;
      case 'bulk-share':
        if (!state.bulk.share && guestBlocked()) break;
        state.bulk.share = !state.bulk.share;
        el.setAttribute('aria-checked', String(state.bulk.share));
        if ($('#bk-nick-field')) $('#bk-nick-field').hidden = !state.bulk.share;
        lsSet(LS_SHARE, state.bulk.share ? '1' : '0');
        break;
      case 'bulk-save': bulkSave(); break;
      case 'bulk-files': {
        var dirty = state.bulk && state.bulk.groups && state.bulk.groups.some(function (g) { return g.rating != null; });
        (dirty ? confirmBox(t('bulkLeaveQ'), t('bulkLeave')) : Promise.resolve(true)).then(function (ok) { if (ok) $('#bulk-file-any').click(); });
        break;
      }
      case 'f-photo-preview': openFormPhoto(d.id); break;
      case 'f-photo-del':
        if (!state.form || state.form.saving) break;
        state.form.photos = state.form.photos.filter(function (ph) {
          if (ph.id === d.id) releaseFormPreview(ph);
          return ph.id !== d.id;
        });
        renderFormPhotos(); break;
      case 'nearby-back': if (formKeepsDraft(state.form)) returnPostComposer(); else { state.form = null; goFeed(); } break;
      case 'near-pick': state.form.placeId = d.id; state.view = 'form'; render(); break;
      case 'near-new': state.view = 'form'; render(); break;
      case 'osm-pick': pickOsm(+d.i); break;
      case 'campus-pick': pickResult(campusHits[+d.i]); break;
      case 'login': openLogin(); break;
      case 'login-google': (store.isAnon && store.isAnon() ? store.linkGoogle() : store.signInWithGoogle()).catch(function (err) { toast(t('loginFail', { m: (err && err.message) || '' })); }); break;
      case 'logout': store.signOut().catch(function () {}); break;
      case 'link-google': store.linkGoogle().catch(function (err) { toast(t('loginFail', { m: (err && err.message) || '' })); }); break;
      case 'upload-local': uploadLegacy(); break;
      case 'export': exportData(); break;
      case 'import': if (requireLogin()) $('#import-file').click(); break;
      case 'lb-close': closeLightbox(); break;
      case 'lb-prev': moveLightbox(-1); break;
      case 'lb-next': moveLightbox(1); break;
      case 'lb-retry': if (store.invalidatePhotoURL) store.invalidatePhotoURL(lb.ids[lb.i]); showLightbox(); break;
      case 'cluster-photos': openClusterPhotos(); break;
    }
  });

  document.addEventListener('submit', function (e) {
    if (e.target.id === 'place-form') submitForm(e);
    else if (e.target.id === 'area-form') { e.preventDefault(); saveArea(); }
    else if (e.target.id === 'profile-form') { e.preventDefault(); saveProfileDialog(); }
    else if (e.target.id === 'login-form') { e.preventDefault(); sendLoginLink(); }
  });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'flt-price') { setPriceAbout(el, false); return; }
    if (el.id === 'f-name') { onNameForCat(state.form, el.value); return; }
    if (el.id === 'f-price' && state.form && el.value.trim()) { if (!state.form.priceCurrency) state.form.priceCurrency = formPriceCurrency(); saveFormDraft(); }
    if (el.id === 'pick-q') { queuePickSearch(el.value); return; }
    if (el.id === 'pf-dialog-name') { var pv = $('#pf-preview'); if (pv && !pendingAvatar && !store.avatarOf(me().id)) pv.innerHTML = avatarHTML(el.value.trim() || '?'); return; }
    if (el.id === 'q') { state.query = el.value; queueOsmSearch(); renderSearchResults(); queueGoogle(); }
    else if (el.id === 'home-q') { homeQ.q = el.value; queueHomeSearch(); renderHomeResults(); }
    else if (el.dataset && el.dataset.bkComment != null) { var bc = state.bulk && state.bulk.groups && state.bulk.groups[+el.dataset.bkComment]; if (bc) bc.comment = el.value; }
    else if (el.dataset && el.dataset.bkName != null) { var bg = state.bulk && state.bulk.groups && state.bulk.groups[+el.dataset.bkName]; if (bg) bg.name = el.value; }
    else if (el.dataset && el.dataset.bkQ != null) { var bq = state.bulk && state.bulk.groups && state.bulk.groups[+el.dataset.bkQ]; if (bq) { bq.q = el.value; queueBulkGoogle(bq); } }
    else if (el.dataset && el.dataset.bkPrice != null) { var bp = state.bulk && state.bulk.groups && state.bulk.groups[+el.dataset.bkPrice], pv = parseFloat(el.value); if (bp && !bp.priceCurrency && isFinite(pv)) bp.priceCurrency = bulkPriceCurrency(bp); if (bp) bp.price = isFinite(pv) && pv >= 0 ? Math.min(99999999.99, Math.round(pv * 100) / 100) : null; }
    else if (el.dataset && el.dataset.pf) {
      var patch = {}; patch[el.dataset.pf] = el.value.trim(); store.updateProfile(patch);
      var nm = $('#me-name');
      if (nm && el.dataset.pf === 'name') { nm.textContent = patch.name || t('meNoName'); nm.classList.toggle('muted', !patch.name); }
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'f-price-currency' && state.form) { captureFormDraft(); state.form.priceCurrency = validPriceCurrency(e.target.value); updateFormCurrency(); saveFormDraft(); return; }
    if (e.target.dataset.bkCurrency != null && state.bulk && state.bulk.groups) { var g = state.bulk.groups[+e.target.dataset.bkCurrency]; if (g) { g.priceCurrency = validPriceCurrency(e.target.value); setBulkCur(g); } return; }
    if (e.target.id === 'share-private' && shareCard && shareCard.own) { shareCard.includePrivate = e.target.checked; render(); return; }
    if (e.target.id === 'f-file') { addFormPhotos(e.target.files); e.target.value = ''; }
    else if (e.target.id === 'bulk-file' || e.target.id === 'bulk-file-any') { startBulk(e.target.files); e.target.value = ''; }
    else if (e.target.id === 'import-file') { importData(e.target.files[0]); e.target.value = ''; }
  });
  /* 关掉最上面那一层：大图 → 弹窗 → 底部弹层 → 选点 → 子页面 */
  /* 再往下一层是别的栏的首页：手机返回键回到“首页”这一栏再离开网站（[建议]，像大部分 App）；Esc 不换栏 */
  function stepBack(key) {
    if (state.view==='feed' && state.scope==='saved' && !state.bsheet && $('#modal').hidden && $('#lightbox').hidden) { closeFavorites(); return; }
    if (!$('#lightbox').hidden) closeLightbox();
    else if (!$('#modal').hidden) closeModal(false);
    else if (state.bsheet) closeBSheet();
    else if (state.homeFiltersOpen) { setHomeFiltersOpen(false); var hf = $('[data-action="home-filters"]'); if (key && hf) hf.focus(); }
    else if (state.picking) cancelPick();
    else if (state.view !== 'feed') back();
    else if (!key && state.tab !== 'home') setTab('home');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'pick-q') { e.preventDefault(); if (pickQ.results.length) pickGo(0); return; }
    if (e.key === 'Escape') stepBack(true);
  });
  /* 手机的返回键 / 侧边返回手势：不在首页时，在浏览器历史里垫一条，
     按返回先关掉卡片、弹层，回到首页后再按才离开网站 */
  /* 首页复用已经垫的本页历史，不主动让浏览器后退。 */
  var navGuard = !!(window.history && history.state && history.state.xuetuan), navOwnEntry = navGuard, navTimer = null;
  function atRoot() {
    return state.view === 'feed' && state.tab === 'home' && !state.bsheet && !state.picking && $('#lightbox').hidden && $('#modal').hidden;
  }
  function syncNavGuard() {
    clearTimeout(navTimer);
    navTimer = setTimeout(function () {
      if (!window.history || !history.pushState) return;
      var root = atRoot();
      if (!root && !navGuard) {
        if (navOwnEntry) history.replaceState({ xuetuan: 1 }, ''); else history.pushState({ xuetuan: 1 }, '');
        navGuard = navOwnEntry = true;
      } else if (root && navGuard) {
        /* 发布、关弹层等只更新本页历史，不主动返回，避免手机浏览器退出本站。下次打开表单复用这一条。 */
        history.replaceState(null, ''); navGuard = false;
      }
    }, 30);
  }
  window.addEventListener('popstate', function () {
    navGuard = navOwnEntry = false;
    if (!atRoot()) stepBack();
    syncNavGuard();
  });
  /* 手机 ↔ 桌面：首页的地图预览只在手机上有，重画一下；每一栏的面板高度也不一样 */
  var onBreakpoint = function () {
    if (state.view === 'feed' || state.view === 'post') render();
    if (state.view === 'feed') setSnap(feedSnapNow()); else applySnap();
    if (map) setTimeout(function () { map.resize(); }, 60);
  };
  if (mqMobile.addEventListener) mqMobile.addEventListener('change', onBreakpoint); else mqMobile.addListener(onBreakpoint);
  window.addEventListener('resize', function () { syncViewport(); applySnap(); });
  window.addEventListener('orientationchange', function () { setTimeout(syncViewport, 300); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  document.addEventListener('focusin', function (e) {
    if (e.target.matches('[data-bk-q]')) { warmGoogle(); var g = state.bulk && state.bulk.groups[+e.target.dataset.bkQ]; if (g) queueBulkGoogle(g); }
    setTimeout(syncViewport, 350);
  });
  document.addEventListener('focusout', function () { setTimeout(syncViewport, 350); });
  /* 有的浏览器收起/展开工具栏时不发 resize，隔一会儿量一次（没变就什么都不做） */
  setInterval(syncViewport, 800);
  syncViewport();
  nudgeBrowserBars();

  document.addEventListener('change', function (e) {
    var key = {'home-days':'homeDays','home-min':'homeMin','home-sort':'homeSort'}[e.target.id];
    if (!key) return;
    state[key] = key === 'homeSort' ? (e.target.value === 'rating' ? 'rating' : 'newest') : Number(e.target.value) || 0;
    render(); view.scrollTop = 0;
  });
  /* ================= boot ================= */
  store.onAuthChange(function () {
    selectedVisits.clear(); selectingVisits = false;
    var next = afterAuth;
    afterAuth = null;
    if (next && store.signedIn()) {
      ensureAnonName();
      renderChrome(); refreshMap();
      if (state.view === 'login') goFeed(); else render();
      next();
      return;
    }
    toast(t(store.signedIn() ? (store.isAnon && store.isAnon() ? 'anonReady' : 'loggedIn') : 'loggedOut'));
    if (state.view === 'login' || state.view === 'form') goFeed(); else render();
    renderChrome();
    refreshMap();
  });
  var savedView = loadView();
  if (savedView) {
    if (savedView.lang === 'en' || savedView.lang === 'zh') state.lang = savedView.lang;
    if (savedView.mode === 'travel' || savedView.mode === 'food') state.mode = savedView.mode;
    if (STYLE_URLS[savedView.styleKey]) state.styleKey = savedView.styleKey;
    state.mineBoth = savedView.mineBoth === true; state.countries = savedView.countries === true; state.homesOn = false;
    state.mineHomeOn = savedView.mineHomeOn === true;
  }
  var dataReady = store.init().catch(function () { toast(t('loadFail')); });
  var incomingShare = readSharedCard();
  if (incomingShare) { shareCard = { own: false, data: incomingShare }; state.view = 'share'; }
  applyStaticI18n(); renderChrome(); render(); setSnap(incomingShare ? 'full' : feedSnapNow('peek')); perfStart(); initMap();
  if (incomingShare) loadWorld().then(function () { if (shareCard && !shareCard.own && state.view === 'share') render(); }, function () {});
  dataReady.then(function () {
    state.bootLoading = false;
    if (state.view === 'form') captureFormDraft();
    renderChrome(); refreshMap(); render();
  });

