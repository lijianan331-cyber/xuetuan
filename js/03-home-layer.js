/* 雪团 js/03-home-layer.js：index.html 按顺序加载 js/ 下的文件，所有文件共用一个全局作用域。 */
'use strict';
  /* ================= 我的家 =================
   * 玩乐大地图：大家公开的家乡画成小红针（左上角“同学的家乡”小签说明，点它开关），离得近的合成一根带人数的；
   * 我的地图 · 玩乐：只画我自己的家，是小房子，公不公开都画（用户 2026-10-27） */
  var HOME_COLOR = '#4F63D8';
  /* 小房子：白底蓝房子；我自己的是蓝底白房子 */
  function drawHome(mine, raised) {
    var s = 44, cx = raised ? 86 : 22, cy = 22, cv = document.createElement('canvas');
    cv.width = Math.round((raised ? 108 : s) * DPR); cv.height = Math.round(s * DPR);
    var g = cv.getContext('2d');
    g.scale(DPR, DPR);
    if (raised) {
      g.beginPath(); g.moveTo(54, cy); g.lineTo(71, cy);
      g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.stroke();
      g.strokeStyle = HOME_COLOR; g.lineWidth = 1.5; g.stroke();
    }
    g.save();
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 4; g.shadowOffsetY = 1.5;
    g.beginPath(); g.arc(cx, cy, 13.5, 0, Math.PI * 2);
    g.fillStyle = mine ? HOME_COLOR : '#ffffff'; g.fill();
    g.restore();
    g.lineWidth = 2; g.strokeStyle = mine ? '#ffffff' : HOME_COLOR; g.stroke();
    var c = mine ? '#ffffff' : HOME_COLOR;
    g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - 7, cy - 0.5); g.lineTo(cx, cy - 6.5); g.lineTo(cx + 7, cy - 0.5); g.stroke();
    g.beginPath(); g.moveTo(cx - 4.7, cy - 1.5); g.lineTo(cx - 4.7, cy + 6.5); g.lineTo(cx + 4.7, cy + 6.5); g.lineTo(cx + 4.7, cy - 1.5); g.lineTo(cx, cy - 5.4); g.closePath(); g.fill();
    g.fillStyle = mine ? HOME_COLOR : '#ffffff';
    g.fillRect(cx - 1.4, cy + 1.6, 2.8, 4.9);
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  function homeImage(mine) {
    var id = mine ? 'home-me' : 'home';
    if (map && !map.hasImage(id)) map.addImage(id, drawHome(mine), { pixelRatio: DPR });
    return id;
  }
  var homePlacement = null;
  function updateHomePlacement() {
    if (!map || !map.getLayer('home-pin')) return;
    /* 小房子就画在家的位置，不再挪到旁边（用户 2026-11-01：挪开加连线太怪）；盖在数字圈上面 */
    var raised = false;
    if (homePlacement === raised) return;
    homePlacement = raised;
    if (raised && !map.hasImage('home-me-raised')) map.addImage('home-me-raised', drawHome(true, true), { pixelRatio: DPR });
    map.setLayoutProperty('home-pin', 'icon-image', raised ? 'home-me-raised' : ['get', 'icon']);
    map.setLayoutProperty('home-pin', 'icon-anchor', raised ? 'left' : 'center');
  }
  /* 家乡红针：比地点图钉小一圈，谷歌红、深红描边、针头一个白点（地点图钉是白描边、白圈里画表情）。
     合在一起的针头大一点，里面写人数 */
  var HOMETOWN_RED = '#EA4335';
  var HOMETOWN_PIN = '<svg viewBox="0 0 22 28" aria-hidden="true"><path d="M11 26.4C8.8 22.2 3 18 3 11a8 8 0 0 1 16 0c0 7-5.8 11.2-8 15.4z" fill="' + HOMETOWN_RED + '" stroke="#B31412" stroke-width="1.2"/><circle cx="11" cy="11" r="2.9" fill="#fff"/></svg>';
  function drawHometown(count) {
    var r = 8, w = count ? 38 : 22, cx = 11, cy = r + 3, tip = cy + 1.93 * r, h = count ? 38 : 30;
    var cv = document.createElement('canvas');
    cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
    var g = cv.getContext('2d');
    g.scale(DPR, DPR);
    g.save();
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
    g.beginPath();
    g.moveTo(cx, tip);
    g.bezierCurveTo(cx - 0.27 * r, cy + 1.4 * r, cx - r, cy + 0.87 * r, cx - r, cy);
    g.arc(cx, cy, r, Math.PI, 0);
    g.bezierCurveTo(cx + r, cy + 0.87 * r, cx + 0.27 * r, cy + 1.4 * r, cx, tip);
    g.closePath();
    g.fillStyle = HOMETOWN_RED; g.fill();
    g.restore();
    g.lineWidth = 1.2; g.strokeStyle = '#B31412'; g.stroke();
    g.fillStyle = '#ffffff';
    if (count) {
      g.beginPath(); g.arc(27, 27, 10, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f3c7c2'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#9f3329'; g.font = '700 ' + (String(count).length > 2 ? 8.5 : 10.5) + 'px ' + getComputedStyle(document.body).fontFamily;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(count), 27, 27.5);
    } else {
      g.beginPath(); g.arc(cx, cy, 2.9, 0, Math.PI * 2); g.fill();
    }
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  function hometownImage(count) {
    var id = count > 1 ? 'hometown-n-' + count : 'hometown';
    if (map && !map.hasImage(id)) map.addImage(id, drawHometown(count > 1 ? String(count) : null), { pixelRatio: DPR });
    return id;
  }
  /* 合在一起的红针按人数要图片，地图要的时候再画 */
  function onImageMissing(e) {
    var m = /^hometown(?:-n-(.+))?$/.exec(e.id || '');
    if (m && !map.hasImage(e.id)) map.addImage(e.id, drawHometown(m[1] || null), { pixelRatio: DPR });
    var c = /^cg:(\d+):(.+)$/.exec(e.id || '');
    if (c && !map.hasImage(e.id)) {
      try {
        var ref = JSON.parse(c[2]), thumb = pinThumbs.get(ref[0]);
        if (thumb && thumb !== 'loading') {map.addImage(e.id, drawPhotoPin(thumb, ref[1] == null ? DOT_NONE : scoreColor(ref[1]), ref[2], Number(c[1])), { pixelRatio: DPR });managedPinImages.set(e.id,ref[0]);trimPinImages();}
      } catch (err) { /* An unavailable cover falls back to the count circle. */ }
    }
  }
  function hometownMode() { return state.tab === 'explore' && state.scope === 'all' && state.homesOn; }
  function homesShown() {
    if (state.scope === 'all') return hometownMode();
    return state.tab === 'foot' && state.scope === 'mine' && state.mineHomeOn;
  }
  function homesOnMap() {
    if (!homesShown()) return [];
    if (state.scope !== 'all') { var mine = store.myHome(); return mine ? [mine] : []; }
    return store.homes().filter(function (h) { return h.public; });
  }
  function homesFC() {
    var grouped = [], myId = me().id;
    homesOnMap().forEach(function (h) {
      /* 大家的家乡里，我自己的家单独画成小房子，别人的是小红针（用户 2026-11-01） */
      if (state.scope === 'all' && h.userId === myId) { grouped.push({ city: '', lng: h.lng, lat: h.lat, ids: [h.userId], house: true }); return; }
      var group = state.scope === 'all' && grouped.find(function (g) { return !g.house && g.city === (h.city || '').trim().toLowerCase() && Math.abs(g.lng - h.lng) < 0.3 && Math.abs(g.lat - h.lat) < 0.3; });
      if (group) group.ids.push(h.userId);
      else grouped.push({ city: (h.city || '').trim().toLowerCase(), lng: h.lng, lat: h.lat, ids: [h.userId] });
    });
    return {
      type: 'FeatureCollection',
      features: grouped.map(function (h) {
        var mine = h.ids.indexOf(me().id) !== -1, pin = state.scope === 'all' && !h.house;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [h.lng, h.lat] }, properties: { uid: h.ids[0], uids: JSON.stringify(h.ids), students: h.ids.length, mine: mine, icon: pin ? hometownImage(h.ids.length) : homeImage(mine), pin: pin } };
      })
    };
  }
  function publicHomeCount() { return store.homes().filter(function (h) { return h.public; }).length; }

  function meFC() {
    return { type: 'FeatureCollection', features: state.me ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [state.me.lng, state.me.lat] }, properties: {} }] : [] };
  }

  /* 打开的那家画在最上面 */
  function pinSortKey(selId) {
    return ['case', ['==', ['get', 'id'], selId || '__none__'], 2, ['get', 'photo'], 1, 0];
  }

  var placeClusterProfiles = new WeakMap();
  var PLACE_CLUSTER_RADIUS = 80; // 保留聚合留白，防止相邻封面相互覆盖。
  var CLUSTER_PHOTO_ZOOM = PHOTO_ZOOM;
  function whenClusterPhoto(photo, circle) { return ['step', ['zoom'], circle, CLUSTER_PHOTO_ZOOM, ['case', ['!=', ['get', 'photoRef'], ''], photo, circle]]; }
  /* 放大到街道（17 级起）就不再合并：隔壁两家店各自一个照片针，针尖在店的真实位置（用户 2026-11-01：nomu 和隔壁南洋 cafe 被合成一个“2”）。
     再往外才合并，免得照片框互相盖住 */
  function placeClusterMaxZoom() { return 16; }
  /* 学校是例外（用户 2026-11-02：LY3 那排店和 D6 太早合成一个数）：看着学校一带时合并的范围小一点，
     LY3 和 D6（相距约 350 米，15 级约 74 像素）在 15 级还分开，再缩小才合并；离开学校一带恢复原来的范围 */
  var CAMPUS_CLUSTER_RADIUS = 68;
  function placeClusterRadius() {
    if (!map || !map.getCenter) return PLACE_CLUSTER_RADIUS;
    var c = map.getCenter();
    return haversine(XMUM, { lat: c.lat, lng: c.lng }) < 2500 ? CAMPUS_CLUSTER_RADIUS : PLACE_CLUSTER_RADIUS;
  }
  function placeClusterProfile() { return placeClusterMaxZoom() + ':' + placeClusterRadius(); }
  function syncPlaceCluster() {
    var src = map && map.getSource && map.getSource('places'), want = placeClusterProfile();
    if (!src || typeof src.setClusterOptions !== 'function' || placeClusterProfiles.get(src) === want) return;
    placeClusterProfiles.set(src, want);
    Promise.resolve(src.setClusterOptions({ cluster: true, clusterMaxZoom: placeClusterMaxZoom(), clusterRadius: placeClusterRadius() })).catch(function () { placeClusterProfiles.delete(src); });
  }
  function addAppLayers() {
    var fonts = pickFonts();
    /* 数字圈用雪团的浅冰蓝，不跟着玩乐地图变深（用户 2026-10-28） */
    var accent = CLUSTER_BLUE;
    homePlacement = null;
    map.addSource('places', { type: 'geojson', data: placesGeoJSON(), cluster: true, clusterMaxZoom: placeClusterMaxZoom(), clusterRadius: placeClusterRadius(),
      clusterProperties: { photoRef: [['case', ['!=', ['accumulated'], ''], ['accumulated'], ['get', 'photoRef']], ['get', 'photoRef']], photoTotal: ['+', ['get', 'photoCount']], locationCount: ['+', ['get', 'locationCount']] } });
    placeClusterProfiles.set(map.getSource('places'), placeClusterProfile());
    map.addSource('me', { type: 'geojson', data: meFC() });
    map.addSource('homes', { type: 'geojson', data: homesFC(), cluster: true, clusterMaxZoom: 11, clusterRadius: 36, clusterProperties: { students: ['+', ['get', 'students']] } });
    /* 地点库里的店：放大后才出，小圆点 + 店名，垫在所有图钉下面 */
    map.addSource('libpoi', { type: 'geojson', data: libFC() });
    map.addLayer({
      id: 'lib-dot', type: 'circle', source: 'libpoi', minzoom: LIB_MINZOOM,
      paint: { 'circle-radius': 4.5, 'circle-color': ['case', ['==', ['get', 'mode'], 'travel'], '#3F9C8A', '#E8833A'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 }
    });
    map.addLayer({
      id: 'lib-label', type: 'symbol', source: 'libpoi', minzoom: LIB_MINZOOM,
      layout: { 'text-field': ['get', 'name'], 'text-font': fonts.regular, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.5], 'text-max-width': 8, 'text-optional': true, 'text-padding': 3 },
      paint: { 'text-color': ['case', ['==', ['get', 'mode'], 'travel'], '#2F7D6E', '#B4581B'], 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.4 }
    });
    /* 城市、片区的地点不再画范围圈，和具体地点一样只有图钉（用户 2026-10-27） */
    map.addLayer({
      id: 'cl-halo', type: 'circle', source: 'places', filter: ['has', 'point_count'],
      paint: { 'circle-radius': ['step', ['get', 'locationCount'], 22, 10, 26, 50, 31, 200, 37], 'circle-color': accent, 'circle-opacity': whenClusterPhoto(0, 0.2) }
    });
    /* 大地图上的家乡红针垫在地点数字圈下面：缩小看全国时两者常叠在一起，针头露在圈上面，不挡住圈里的数字。
       合在一起的只会是红针（我的地图只有自己一个家） */
    map.addLayer({
      id: 'hometown-pin', type: 'symbol', source: 'homes', filter: ['any', ['has', 'point_count'], ['==', ['get', 'pin'], true]],
      layout: {
        'icon-image': ['case', ['has', 'point_count'], ['concat', 'hometown-n-', ['to-string', ['get', 'students']]], ['get', 'icon']],
        'icon-anchor': 'top-left', 'icon-offset': [-11, -27], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 5, 0.85, 10, 1]
      }
    });
    map.addLayer({
      id: 'cl-circle', type: 'circle', source: 'places', filter: ['has', 'point_count'],
      paint: { 'circle-radius': ['step', ['get', 'locationCount'], 15, 10, 19, 50, 23, 200, 27], 'circle-color': accent, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': whenClusterPhoto(0, 1), 'circle-stroke-opacity': whenClusterPhoto(0, 1) }
    });
    map.addLayer({
      id: 'cl-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'],
      layout: { 'text-field': ['to-string', ['get', 'locationCount']], 'text-font': fonts.bold, 'text-size': 12.5, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#ffffff', 'text-opacity': whenClusterPhoto(0, 1) }
    });
    map.addLayer({
      id: 'cl-photo', type: 'symbol', source: 'places', minzoom: CLUSTER_PHOTO_ZOOM,
      filter: ['all', ['has', 'point_count'], ['!=', ['get', 'photoRef'], '']],
      layout: { 'icon-image': ['concat', 'cg:', ['to-string', ['get', 'photoTotal']], ':', ['get', 'photoRef']], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-size': photoPinSize(null) }
    });
    /* 我的地图上自己的小房子盖在地点的数字圈上面（缩小看全国时两者常常叠在一起），但在单个地点图钉下面 */
    map.addLayer({
      id: 'home-pin', type: 'symbol', source: 'homes', filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'pin'], true]],
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 10, 1] }
    });
    map.addLayer({
      id: 'pt-pin', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'icon'], 'icon-anchor': 'center', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'symbol-sort-key': pinSortKey(null), 'icon-size': pinSize(null)
      },
      paint: { 'icon-opacity': whenPhoto(0, 1) }
    });
    map.addLayer({
      id: 'pt-photo', type: 'symbol', source: 'places', minzoom: PHOTO_ZOOM, filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'photo'], true]],
      layout: {
        'icon-image': ['get', 'pic'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-pitch-alignment': 'viewport', 'icon-rotation-alignment': 'viewport',
        'symbol-sort-key': pinSortKey(null), 'icon-size': photoPinSize(null)
      },
      /* readiness 已由 filter 处理；不混用 feature/zoom opacity，真实引擎会在整数级之间插值而提前露图。 */
      paint: { 'icon-opacity': ['step', ['zoom'], 0, PHOTO_ZOOM, 1] }
    });
    map.addLayer({
      id: 'pt-label', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']], minzoom: 13,
      layout: { 'text-field': ['get', 'name'], 'text-font': fonts.regular, 'text-size': 11.5, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 9, 'text-optional': true },
      paint: { 'text-color': '#18211C', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 }
    });
    map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 17, 'circle-color': '#2F7BF6', 'circle-opacity': 0.18 } });
    map.addLayer({ id: 'me-dot', type: 'circle', source: 'me', paint: { 'circle-radius': 6.5, 'circle-color': '#2F7BF6', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
  }

  function refreshMap() {
    var src = map && map.getSource && map.getSource('places');
    syncPlaceCluster();
    if (src) setMapSourceData(src,placesGeoJSON());
    refreshLib();
    queueLib();
    var hs = map && map.getSource && map.getSource('homes');
    if (hs) setMapSourceData(hs,homesFC());
    updateHomePlacement();
    syncCountries();
  }
  function repaintAccent() {
    if (!map || !map.getLayer('cl-circle')) return;
    var a = CLUSTER_BLUE;
    ['cl-circle', 'cl-halo'].forEach(function (id) { try { map.setPaintProperty(id, 'circle-color', a); } catch (e) { /* ignore */ } });
  }
  /* 红针只给还没人记录过的地方用（搜索结果预览、正在第一次记录的新地点）。
     雪团里已经有的地点一律用自己的图钉，不再插红针（用户 2026-10-26） */
  var selPin = null;
  function selPinLoc() {
    var v = state.view, f = state.form;
    if (v === 'preview') return state.preview;
    if ((v === 'form' || v === 'nearby') && f && !f.placeId) return f.loc;
    /* 收藏了、还没人记录的地方：地图上没有它的图钉，也插红针 */
    if (v === 'place') {
      var p = placeById(state.placeId);
      if (p && !scopedReviews(p.id, 'saved').length && !(inScope(p) && passesFilters(p))) return p;
    }
    return null;
  }
  var SEL_PIN_SVG = '<svg viewBox="0 0 30 43" width="30" height="43" aria-hidden="true"><path d="M15 42c-1.4-6-5-9.6-8.6-14A14 14 0 1 1 23.6 28c-3.6 4.4-7.2 8-8.6 14z" fill="#EA4335" stroke="#B31412" stroke-width="1.5"/><circle cx="15" cy="15" r="5" fill="#7A0C0C"/></svg>';
  function updateSelPin() {
    if (!map || !window.maplibregl || !maplibregl.Marker) return;
    var loc = selPinLoc();
    if (!loc) { if (selPin) selPin.remove(); return; }
    if (!selPin) {
      var el = document.createElement('div');
      el.className = 'sel-pin';
      el.innerHTML = SEL_PIN_SVG;
      selPin = new maplibregl.Marker({ element: el, anchor: 'bottom' });
    }
    selPin.setLngLat([loc.lng, loc.lat]).addTo(map);
  }
  var selDrawn = null;
  function updateSelection(force) {
    if (!map || !map.getLayer('pt-pin')) return;
    var id = state.view === 'place' && state.placeId ? state.placeId : null;
    if (id === selDrawn && !force) return;
    selDrawn = id;
    map.setLayoutProperty('pt-pin', 'symbol-sort-key', pinSortKey(id));
    map.setLayoutProperty('pt-pin', 'icon-size', pinSize(id));
    map.setLayoutProperty('pt-photo', 'symbol-sort-key', pinSortKey(id));
    map.setLayoutProperty('pt-photo', 'icon-size', photoPinSize(id));
  }

  function mapPadding() {
    if (mapInCard()) return { top: 10, bottom: 10, left: 10, right: 10 };
    var top = 24;
    if (!isMobile()) return { top: top + 12, bottom: 40, left: 40, right: 70 };
    return { top: top, bottom: snapVisible(state.snap) + tabbarH() + 12, left: 20, right: 64 };
  }
  function flyTo(center, zoom, instant) {
    if (!map) return;
    var opts = { center: center, zoom: zoom, padding: mapPadding(), essential: true };
    if (reduceMotion || instant) map.jumpTo(opts);
    else { opts.speed = 1.4; opts.curve = 1.42; map.flyTo(opts); }
  }

  function clusterZoom(src, id) {
    return new Promise(function (resolve) {
      try {
        var r = src.getClusterExpansionZoom(id, function (err, z) { resolve(err ? null : z); });
        if (r && typeof r.then === 'function') r.then(resolve, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  function placeIdAt(pt) {
    var layers = ['pt-photo', 'pt-pin', 'pt-label'].filter(function (id) { return map.getLayer(id); });
    var hits = layers.length ? map.queryRenderedFeatures([[pt.x - 12, pt.y - 12], [pt.x + 12, pt.y + 10]], { layers: layers }) : [];
    for (var i = 0; i < hits.length; i++) if (hits[i].properties && hits[i].properties.id) return hits[i].properties.id;
    return null;
  }
  function onMapClick(e) {
    if (mapEl.parentNode && mapEl.parentNode.classList.contains('bk-map')) return; /* 批量加卡片里的小地图：可以拖、缩放核对位置，点了不跳去别的页面 */
    if (state.picking) {
      if (!state.picking.home) {
        var pid = placeIdAt(e.point), poi0 = !pid && basePoiAt(e.point);
        if (pid || poi0) {
          var existing = pid ? placeById(pid) : osmExisting(poi0);
          var picked = existing ? { place:existing.id, name:placeTitle(existing), alt:existing.altName || '', osm:existing.osm || '', lat:existing.lat, lng:existing.lng, mode:existing.mode, cat:existing.cat, precision:existing.precision } : poi0;
          state.picking.selected = picked;
          map.easeTo({ center:[picked.lng,picked.lat], padding:{top:0,bottom:0,left:0,right:0}, duration:reduceMotion?0:250 });
          updatePickUI();
          return;
        }
      }
      state.picking.selected = null; updatePickUI();
      var c = map.getContainer();
      map.panBy([e.point.x - c.clientWidth / 2, e.point.y - c.clientHeight / 2], { duration: 350 });
      return;
    }
    var layers = ['cl-photo', 'cl-circle', 'pt-photo', 'pt-pin', 'pt-label'].filter(function (id) { return map.getLayer(id); });
    var box = [[e.point.x - 12, e.point.y - 12], [e.point.x + 12, e.point.y + 10]];
    var hits = layers.length ? map.queryRenderedFeatures(box, { layers: layers }) : [];
    if (hits.length) {
      var f = hits.find(function (x) { return map.getZoom() >= PHOTO_ZOOM && x.layer && (x.layer.id === 'pt-photo' || x.layer.id === 'cl-photo'); }) || hits[0];
      if (f.properties && f.properties.serverGroup) {
        map.easeTo({center:f.geometry.coordinates,zoom:Math.max(map.getZoom()+1,+f.properties.zoom),padding:mapPadding(),duration:reduceMotion?0:500});return;
      }
      if (f.properties && f.properties.cluster) {
        var src = map.getSource('places');
        if (map.getZoom() >= CLUSTER_PHOTO_ZOOM) { openPlaceCluster(src, f.properties.cluster_id, f.layer && f.layer.id === 'cl-photo'); return; }
        clusterZoom(src, f.properties.cluster_id).then(function (z) {
          map.easeTo({ center: f.geometry.coordinates, zoom: (z == null ? map.getZoom() + 2 : z) + 0.4, duration: reduceMotion ? 0 : 600, padding: mapPadding() });
        });
      } else if (f.properties && f.properties.id) {
        var members = []; try { members = JSON.parse(f.properties.memberIds || '[]'); } catch (err) {}
        if (members.length > 1) { showPlaceGroup(members, f.layer && f.layer.id === 'cl-photo'); return; }
        /* 点地图上的照片：直接到地点总览（照片在中间，下面是评论），要放大再点照片上的小按钮（用户 2026-11-01） */
        openPlace(f.properties.id, { fly: false, photo: f.layer && f.layer.id === 'pt-photo' });
      }
      return;
    }
    var homeLayers = ['hometown-pin', 'home-pin'].filter(function (id) { return map.getLayer(id); });
    var homes = homeLayers.length ? map.queryRenderedFeatures([[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]], { layers: homeLayers }) : [];
    if (homes.length) { openHomesAt(homes); return; }
    if (hometownMode()) return;
    /* 底图上自带的店名、景点名也能点：还不在雪团的先预览，打个分就能记进我的地图 */
    var poi = (state.view === 'feed' || state.view === 'place' || state.view === 'preview') && basePoiAt(e.point);
    if (poi) { openBasePoi(poi); return; }
    if (state.view === 'preview' && state.preview && state.preview.fromMap) { state.preview = null; goFeed('peek'); return; }
    if (isMobile() && state.snap !== 'peek' && (state.view === 'feed' || state.view === 'place')) {
      if (state.view === 'place') goFeed('peek'); else setSnap(feedSnapNow('peek'));
    }
  }

  /* 点小房子：合在一起的列出里面所有人；同一个城市叠在一起的也都列出来 */
  function clusterLeaves(src, id) {
    return new Promise(function (resolve) {
      try {
        var r = src.getClusterLeaves(id, 200, 0, function (err, fs) { resolve(err ? [] : fs); });
        if (r && typeof r.then === 'function') r.then(resolve, function () { resolve([]); });
      } catch (e) { resolve([]); }
    });
  }
  var clusterTap = 0;
  function showPlaceGroup(ids, photos) {
    ids = ids.filter(function (id, i) { var p = placeById(id); return p && inScope(p) && passesFilters(p) && ids.indexOf(id) === i; });
    if (!ids.length) return;
    if (ids.length === 1) { openPlace(ids[0], { fly: false, photo: photos }); return; }
    rememberFeedSnap(); state.clusterPlaces = ids; state.view = 'cluster'; render(); setSnap('full');
    if (photos) openClusterPhotos();
  }
  function openPlaceCluster(src, id, photos) {
    var seq = ++clusterTap, tab = state.tab, scope = state.scope, mode = state.mode;
    clusterLeaves(src, id).then(function (features) {
      if (seq !== clusterTap || state.tab !== tab || state.scope !== scope || state.mode !== mode || state.picking || map.getSource('places') !== src) return;
      var ids = [];
      features.forEach(function (f) { var pr = f.properties || {}, members = [pr.id]; try { members = JSON.parse(pr.memberIds || '[]'); if (!members.length) members = [pr.id]; } catch (e) {} members.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); }); });
      showPlaceGroup(ids, photos);
    });
  }
  function openHomesAt(hits) {
    var src = map.getSource('homes'), tab = state.tab, scope = state.scope;
    Promise.all(hits.map(function (f) {
      return f.properties && f.properties.cluster ? clusterLeaves(src, f.properties.cluster_id) : Promise.resolve([f]);
    })).then(function (lists) {
      if (state.tab !== tab || state.scope !== scope || !homesShown()) return;
      var ids = [];
      lists.forEach(function (l) { l.forEach(function (f) { var pr = f.properties || {}, us = [pr.uid]; try { if (pr.uids) us = JSON.parse(pr.uids); } catch (e) {} us.forEach(function (u) { if (u && ids.indexOf(u) === -1) ids.push(u); }); }); });
      var list = ids.map(homeOf).filter(function (h) { return h && (h.public || (state.scope === 'mine' && h.userId === me().id && state.mineHomeOn)); });
      if (!list.length) return;
      rememberFeedSnap();
      state.homes = list.map(function (h) { return h.userId; });
      state.view = 'homes';
      render();
      setSnap('half');
    });
  }

  /* 底图（OpenMapTiles）的 poi 层：不同底图的图层名不一样，按 source-layer 找；换底图时重新找 */
  var poiLayerIds = null;
  /* ================= 地点库的店画在底图上（用户 2026-10-28：雪团底图放大了很空，谷歌上有的餐厅这里没有）=================
   * 底图（OpenStreetMap）在马来西亚的店很少；我们的地点库（Overture，Supabase poi 表）多得多。
   * 放大到 14.5 级以后，按 13 级瓦片分块去取看得到的那几块（同一块只取一次），美食地图只要吃的，玩乐地图只要玩的；
   * 雪团里已经有的店不重复画（它有自己的评分图钉）。点了和点搜索结果一样，出预览、能打分 */
  var LIB_MINZOOM = 14.5, LIB_TILE_Z = 13, libTiles = {}, libTimer = null;
  function libFC() {
    var feats = [], seen = {};
    if (!map || GMAP || hometownMode()) return { type: 'FeatureCollection', features: feats };
    Object.keys(libTiles).forEach(function (k) {
      if (k.split('/')[0] !== state.mode || !Array.isArray(libTiles[k])) return;
      libTiles[k].forEach(function (r) {
        if (seen[r.osm] || ownPlaceFor(r) || baseHas(r)) return;
        seen[r.osm] = 1;
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { osm: r.osm, name: r.name, alt: r.alt, mode: r.mode, cat: r.cat || '', where: r.where } });
      });
    });
    return { type: 'FeatureCollection', features: feats };
  }
  /* 底图（OSM）和地点库（Overture）常有同一家，位置差几十米，画两遍像两家店（用户 2026-10-28「两个星巴克？」）：
     底图的店出来以后（15 级起），附近 150 米内底图已有同名的，地点库的点就不画，留底图那个（有图标，也能点开） */
  var baseNames = null, baseNamesKey = '';
  function normName(n) { return String(n || '').toLowerCase().replace(/[\s'’`.,\-()&@!·]+/g, ''); }
  function collectBaseNames() {
    if (!map || GMAP || !map.querySourceFeatures) return;
    var names = null, key = '';
    if (map.getZoom() >= BASE_POI_MINZOOM) {
      var ids = basePoiLayers(), l = ids.length && map.getLayer(ids[0]), feats = [];
      if (!l || !l.source) return;
      try { feats = map.querySourceFeatures(l.source, { sourceLayer: 'poi' }) || []; } catch (e) { return; }
      var keep = state.mode === 'travel' ? BASE_TRAVEL : BASE_FOOD, parts = [];
      names = {};
      feats.forEach(function (f) {
        var p = f.properties || {}, g = f.geometry;
        if (!g || g.type !== 'Point' || keep.indexOf(p['class']) === -1) return;
        [p.name, p['name:en'], p['name:latin']].forEach(function (nm) {
          nm = normName(nm);
          if (!nm) return;
          (names[nm] = names[nm] || []).push({ lng: g.coordinates[0], lat: g.coordinates[1] });
          parts.push(nm + '@' + g.coordinates[0].toFixed(4) + ',' + g.coordinates[1].toFixed(4));
        });
      });
      key = state.mode + ':' + parts.sort().join('|');
    }
    if (key === baseNamesKey) return;
    baseNamesKey = key; baseNames = names;
    refreshLib();
  }
  function baseHas(r) {
    if (!baseNames) return false;
    return [r.name, r.alt].some(function (nm) {
      var list = nm && baseNames[normName(nm)];
      return !!list && list.some(function (c) { return haversine(c, r) < 150; });
    });
  }
  function ownPlaceFor(r) {
    return store.places().some(function (p) {
      if (!knownToMe(p)) return false;
      return p.osm === r.osm || (haversine(p, r) < 80 && (sameName(p.name, r.name) || sameName(p.name, r.alt)));
    });
  }
  function refreshLib() { var src = map && map.getSource && map.getSource('libpoi'); if (src) src.setData(libFC()); }
  function queueLib() { clearTimeout(libTimer); libTimer = setTimeout(loadLib, 250); }
  function loadLib() {
    if (!map || GMAP || !sbClient || !map.getSource('libpoi') || map.getZoom() < LIB_MINZOOM) return;
    var b = viewBounds();
    if (!b) return;
    var n = Math.pow(2, LIB_TILE_Z), nw = merc(b.getWest(), b.getNorth()), se = merc(b.getEast(), b.getSouth());
    var x0 = Math.floor(nw.x * n), x1 = Math.floor(se.x * n), y0 = Math.floor(nw.y * n), y1 = Math.floor(se.y * n);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 12) return;
    var mode = state.mode, jobs = [];
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) {
      var key = mode + '/' + x + '/' + y;
      if (libTiles[key]) continue;
      libTiles[key] = 'loading';
      (function (key, x, y) {
        var a = unmerc(x / n, y / n), c = unmerc((x + 1) / n, (y + 1) / n);
        jobs.push(sbClient.from('poi').select('id, name, alt_name, mode, cat, lat, lng, locality').eq('mode', mode)
          .gte('lat', c.lat).lte('lat', a.lat).gte('lng', a.lng).lte('lng', c.lng).limit(400)
          .then(function (r) { if (r.error) throw r.error; libTiles[key] = (r.data || []).map(poiRow); },
            function () { delete libTiles[key]; }));
      })(key, x, y);
    }
    if (jobs.length) Promise.all(jobs).then(refreshLib);
  }
  function libAt(pt) {
    if (!map.getLayer('lib-dot')) return null;
    var hits = map.queryRenderedFeatures([[pt.x - 10, pt.y - 10], [pt.x + 10, pt.y + 10]], { layers: ['lib-dot', 'lib-label'] });
    if (!hits.length) return null;
    var pr = hits[0].properties || {}, co = hits[0].geometry.coordinates;
    return { osm: pr.osm, name: pr.name, alt: pr.alt || '', lng: round6(co[0]), lat: round6(co[1]), mode: pr.mode, cat: pr.cat || null, precision: 'exact', where: pr.where || '' };
  }

  function basePoiLayers() {
    if (poiLayerIds) return poiLayerIds;
    var st = map && map.getStyle();
    poiLayerIds = st && st.layers ? st.layers.filter(function (l) { return l.type === 'symbol' && l['source-layer'] === 'poi'; }).map(function (l) { return l.id; }) : [];
    return poiLayerIds;
  }
  function basePoiAt(pt) {
    var lib = libAt(pt);
    if (lib) return lib;
    var layers = basePoiLayers();
    if (!layers.length) return null;
    var hits = map.queryRenderedFeatures([[pt.x - 10, pt.y - 10], [pt.x + 10, pt.y + 10]], { layers: layers });
    for (var i = 0; i < hits.length; i++) { var r = poiFromFeature(hits[i]); if (r) return r; }
    return null;
  }
  var POI_FOOD_CLASS = ['restaurant', 'fast_food', 'cafe', 'bar', 'beer', 'ice_cream', 'bakery'];
  var POI_HISTORIC = ['castle', 'monument', 'memorial', 'ruins', 'archaeological_site', 'fort'];
  function poiFromFeature(f) {
    var pr = f.properties || {}, co = f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates;
    var local = pr.name || pr['name:latin'] || pr.name_en || '';
    var own = pr['name:' + state.lang] || (state.lang === 'en' ? pr.name_en || pr['name:latin'] : '') || '';
    var name = (own || local).trim();
    if (!name || !co) return null;
    var cls = pr.class || '', v = pr.subclass || cls;
    var food = OSM_FOOD.amenity.indexOf(v) !== -1 || OSM_FOOD.shop.indexOf(v) !== -1 || POI_FOOD_CLASS.indexOf(cls) !== -1;
    var k = food ? (OSM_FOOD.shop.indexOf(v) !== -1 ? 'shop' : 'amenity')
      : cls === 'lodging' ? 'tourism' : POI_HISTORIC.indexOf(v) !== -1 ? 'historic' : cls === 'shop' ? 'shop' : 'leisure';
    if (food && OSM_FOOD[k].indexOf(v) === -1) v = 'restaurant';
    var g = guessFromOsm({ osm_key: k, osm_value: v });
    return {
      osm: '', fromMap: true, name: name, alt: local && local !== name ? local : '',
      lng: round6(co[0]), lat: round6(co[1]), mode: g.mode, cat: g.cat, precision: 'exact', where: ''
    };
  }
  function sameName(a, b) { return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase(); }
  function openBasePoi(r) {
    /* 雪团里已经有了（同名、离得很近）就直接打开那一页 */
    var hit = osmExisting(r);
    if (hit) { openPlace(hit.id, { fly: false }); return; }
    state.preview = r;
    state.view = 'preview';
    render();
    setSnap('half');
    if (map) map.easeTo({ center: [r.lng, r.lat], padding: mapPadding(), duration: reduceMotion ? 0 : 450 });
  }

  function dropMarker(p) {
    if (!map || reduceMotion || !maplibregl.Marker) return;
    var el = document.createElement('div');
    el.innerHTML = '<div class="drop-pulse"></div>';
    var mk = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    setTimeout(function () { mk.remove(); }, 1500);
  }

  function setBasemap(key) {
    if (!map || GMAP) return;
    loadStyle(key).then(function (style) {
      state.styleKey = key; saveView();
      map.setStyle(style, { diff: false });
      toast(t('basemapNow', { s: t(styleLabelKey(key)) }));
      if (onMeRoot()) render();
    }).catch(function () { toast(t('basemapFail')); });
  }
  function styleLabelKey(k) { return { light: 'styleLight', color: 'styleColor', dark: 'styleDark' }[k]; }

  function locate() {
    if (!navigator.geolocation) { toast(t('locateFail')); return; }
    toast(t('locating'));
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.me = { lng: pos.coords.longitude, lat: pos.coords.latitude };
      if (map && map.getSource('me')) map.getSource('me').setData(meFC());
      flyTo([state.me.lng, state.me.lat], Math.max(map ? map.getZoom() : 15, 15));
    }, function () { toast(t('locateFail')); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

