/* Bounded server reads. No partial review list is ever used as a place's total. */
'use strict';
window.XueReads = { create: function (client, ctx) {
  var enabled = false, unavailable = false, epoch = 0, actor, ownReady = false, ownWork = null;
  var feed = { key: '', ids: [], more: false, cursor: null }, placesLoaded = new Map(), personLoaded = new Set();
  var authorHomes = new Map();
  var detailWork = new Map(), searchKey = '', homesReady = false, homeCount = null;
  var mapIDs = [], groups = [], mapKey = '', loadedContext = '', loadedZoom = 15, mapTicket = 0, mapController = null;
  var metrics = { calls: 0, failures: 0, aborted: 0, bytes: 0, lastMs: 0, samples: [], mapRows: 0, feedRows: 0 };
  function current(uid, ticket) { return uid === ctx.uid() && ticket === epoch; }
  function changed(kind) { ctx.save(); window.dispatchEvent(new CustomEvent('xuetuan-read-update',{detail:kind})); }
  function call(kind, args, signal) {
    var uid = ctx.uid(), ticket = epoch, started = performance.now(); metrics.calls++;
    var req = client.rpc('xuetuan_read_page', { kind: kind, args: args || {} });
    if (signal && req.abortSignal) req = req.abortSignal(signal);
    return Promise.resolve(req).then(function (r) {
      if (!current(uid, ticket)) throw new Error('Read account changed');
      if (r.error) throw r.error;
      if (!r.data || r.data.version !== 2 || r.data.actor !== uid) throw new Error('Unsupported read API');
      metrics.lastMs = Math.round(performance.now() - started);metrics.samples.push(metrics.lastMs);if(metrics.samples.length>100)metrics.samples.shift();var payload=JSON.stringify(r.data);metrics.bytes+=typeof TextEncoder!=='undefined'?new TextEncoder().encode(payload).length:payload.length;
      return r.data;
    }).catch(function(e){if(e&&(e.name==='AbortError'||/abort|Read account changed/i.test(e.message||'')))metrics.aborted++;else metrics.failures++;throw e;});
  }
  function mergePlaces(rows, scope) {
    var c = ctx.cache(), by = new Map(c.places.map(function (p) { return [p.id, p]; }));
    rows.forEach(function (row) {
      if (!row.place) return;
      var p = ctx.place(row.place), old = by.get(p.id);
      p._overview = Object.assign({}, old && old._overview);
      if (row.summary) p._overview[scope || 'all'] = row.summary;
      if (row.savedSummary) p._overview.saved = row.savedSummary;
      by.set(p.id, Object.assign({}, old, p));
    });
    // Retain current viewport and personal/feed/detail places; discard cold regions.
    var keep = new Set(mapIDs.concat(c.wishlist.map(function (w) { return w.placeId; })));
    c.reviews.forEach(function (r) { keep.add(r.placeId); });
    rows.forEach(function (r) { if (r.place) keep.add(r.place.id); });
    if (by.size > 3000) by.forEach(function (_, id) { if (by.size > 3000 && !keep.has(id)) by.delete(id); });
    c.places = Array.from(by.values());
  }
  function readAuthorHomes(rows) {
    var ids=Array.from(new Set(rows.map(function(r){return r.user_id;}))).filter(function(id){return id&&Date.now()-(authorHomes.get(id)||0)>45000;}).slice(0,250);
    if(!ids.length)return;var uid=ctx.uid(),ticket=epoch;ids.forEach(function(id){authorHomes.set(id,Date.now());});
    client.from('homes').select('user_id,city,lat,lng,is_public,owner:profiles(name)').in('user_id',ids).then(function(r){
      if(!current(uid,ticket)||r.error)return;var c=ctx.cache();c.homes=c.homes.filter(function(h){return ids.indexOf(h.userId)===-1;}).concat((r.data||[]).map(ctx.home));
      while(authorHomes.size>500)authorHomes.delete(authorHomes.keys().next().value);changed('authors');
    },function(){});
  }
  function mergeReviews(rows) {
    var c = ctx.cache(), by = new Map(c.reviews.map(function (r) { return [r.id, r]; }));
    mergePlaces(rows.map(function (r) { return { place: r.place }; }));
    rows.forEach(function (r) { by.set(r.id, ctx.review(r)); });
    var incoming=new Set(rows.map(function(r){return r.id;})),feedIDs=new Set(feed.ids);
    if(by.size>2000)by.forEach(function(r,id){if(by.size>2000&&r.authorId!==ctx.uid()&&!incoming.has(id)&&!feedIDs.has(id)&&!placesLoaded.has(r.placeId)&&!(state.person&&state.person.id===r.authorId))by.delete(id);});
    c.reviews = Array.from(by.values()); readAuthorHomes(rows);
  }
  function feedArgs() { return { mode: state.homeMode, days: state.homeDays, min: state.homeMin, sort: state.homeSort, limit: 20 }; }
  function readFeed(more, guard, replace) {
    var args = feedArgs(), key = JSON.stringify(args), uid = ctx.uid(), ticket = epoch;
    if (more && (feed.key !== key || !feed.more)) return Promise.resolve();
    if (more) args.cursor = feed.cursor;
    return call('feed', args).then(function (r) {
      if (!current(uid, ticket) || (guard && !guard()) || key !== JSON.stringify(feedArgs())) return;
      mergeReviews(r.rows);
      var ids = r.rows.map(function (v) { return v.id; });
      // Refresh replaces the current head; deeper pages remain only on explicit append.
      var previous=feed,retained=!more&&replace===false&&feed.key===key;
      feed = { any:r.any, key: key, ids: more ? Array.from(new Set(feed.ids.concat(ids))) : retained ? Array.from(new Set(ids.concat(feed.ids))) : ids, more: retained ? previous.more : r.more, cursor: retained ? previous.cursor : null };
      var last = r.rows[r.rows.length - 1];
      if (last && !retained) feed.cursor = { id: last.id, at: last.activity_at, rating: last.rating == null ? -1 : last.rating };
      metrics.feedRows = feed.ids.length;
      return true;
    });
  }
  function boundsArgs() {
    var b = typeof viewBounds === 'function' && viewBounds(), z = typeof map !== 'undefined' && map ? map.getZoom() : 15;
    var v = typeof loadView === 'function' && loadView(), center = v && v.center || [101.7029, 2.8329];
    if (!b && v && v.zoom < 10) return { west: -180, east: 180, south: -85, north: 85, zoom: Math.floor(v.zoom) };
    if (!b) return { west: center[0] - .08, east: center[0] + .08, south: center[1] - .08, north: center[1] + .08, zoom: 15 };
    var west = b.getWest(), east = b.getEast();
    if (east - west >= 360) { west = -180; east = 180; }
    else { west = ((west + 180) % 360 + 360) % 360 - 180; east = ((east + 180) % 360 + 360) % 360 - 180; }
    return { west: west, east: east, south: Math.max(-85,b.getSouth()), north: Math.min(85,b.getNorth()), zoom: Math.floor(z) };
  }
  function readMap(force) {
    if (!enabled || navigator.onLine === false || (state.scope !== 'all' && state.scope !== 'saved')) return Promise.resolve();
    var args = Object.assign(boundsArgs(), { mode: state.mode, scope: state.scope, filtered: typeof filtersActive === 'function' && filtersActive() });
    var key = JSON.stringify(args), uid = ctx.uid(), ticket = epoch;
    if (!force && key === mapKey) return Promise.resolve();
    mapKey = key; var seq = ++mapTicket, allRows = [];
    if (mapController) mapController.abort();
    mapController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    function page() {
      return call('map', args, mapController && mapController.signal).then(function (r) {
        if (!current(uid, ticket) || seq !== mapTicket) return;
        allRows = allRows.concat(r.rows);
        if (r.more && r.rows.length) { args.after = r.rows[r.rows.length - 1].place.id; return page(); }
        if (seq !== mapTicket) return;
        mapIDs = allRows.filter(function (r) { return r.place; }).map(function (r) { return r.place.id; });
        groups = allRows.filter(function (r) { return r.group; }).map(function(g){return Object.assign({},g,{mode:args.mode});}); loadedContext=args.scope+':'+args.mode; loadedZoom=args.zoom;
        ctx.cache().mapGroups = args.scope === 'all' ? groups : [];
        mergePlaces(allRows, args.scope); metrics.mapRows = allRows.length; changed('map');
      });
    }
    return page().catch(function (e) { if (seq === mapTicket) mapKey = ''; if (!(e && (e.name === 'AbortError' || /abort/i.test(e.message || '')))) throw e; });
  }
  function fullPerson(kind, id) {
    var uid = ctx.uid(), ticket = epoch, rows = [], args = { id: id };
    function page() { return call(kind, args).then(function (r) {
      if (!current(uid, ticket)) return;
      rows = rows.concat(r.rows);
      if (r.more && r.rows.length) { args.after = r.rows[r.rows.length - 1].id; return page(); }
      // Replace that author's complete scope, removing deleted/withdrawn rows.
      var owner = kind === 'own' ? uid : id, c = ctx.cache();
      c.reviews = c.reviews.filter(function (v) { return v.authorId !== owner || (kind === 'person' && v.visibility !== 'public'); });
      mergeReviews(rows); changed('personal'); return true;
    }); }
    return page();
  }
  function ensureOwn() {
    if (!enabled || ownReady || navigator.onLine === false) return Promise.resolve();
    if (!ownWork) { var uid=ctx.uid(),ticket=epoch,pending=fullPerson('own',uid).then(function () { if(current(uid,ticket))ownReady=true;if(ownWork===pending)ownWork=null; }, function (e) { if(ownWork===pending)ownWork=null;throw e; });ownWork=pending; }
    return ownWork;
  }
  function ensurePlace(id, more) {
    if (!enabled || navigator.onLine === false || (!more && placesLoaded.has(id))) return Promise.resolve();
    var key = 'place:' + id;
    if (detailWork.has(key)) return detailWork.get(key);
    var args = { id: id }, previous = placesLoaded.get(id);
    if (more && previous) { args.after = previous.after; args.at = previous.at; }
    var promise = call('place', args).then(function (r) {
      if (!r.place) throw new Error('Place unavailable');
      if (!more) ctx.cache().reviews = ctx.cache().reviews.filter(function (v) { return v.placeId !== id || v.authorId === ctx.uid(); });
      mergePlaces([{ place: r.place, summary: r.summary, savedSummary: r.savedSummary }]); mergeReviews(r.rows);
      while(placesLoaded.size>=40&&!placesLoaded.has(id))placesLoaded.delete(placesLoaded.keys().next().value);
      placesLoaded.set(id, { more: r.more, after: r.rows.length ? r.rows[r.rows.length - 1].id : null, at: r.rows.length ? r.rows[r.rows.length - 1].activity_at : null }); changed('detail');
    }).then(function (v) { if(detailWork.get(key)===promise)detailWork.delete(key); return v; }, function (e) { if(detailWork.get(key)===promise)detailWork.delete(key); throw e; });
    detailWork.set(key, promise); return promise;
  }
  function ensurePost(id) {
    if (!enabled || navigator.onLine === false) return Promise.resolve();
    return call('post', { id: id }).then(function (r) { if (!r.rows.length) { ctx.cache().reviews = ctx.cache().reviews.filter(function (v) { return v.id !== id; }); throw new Error('Post unavailable'); } mergeReviews(r.rows); changed('detail'); });
  }
  function ensurePerson(id) {
    if (!enabled || navigator.onLine === false || personLoaded.has(id)) return Promise.resolve();
    return fullPerson('person', id).then(function () { personLoaded.add(id); });
  }
  function ensureHomes() {
    if (!enabled || homesReady || navigator.onLine === false) return Promise.resolve();
    return call('homes').then(function (r) { ctx.cache().homes = r.homes.map(ctx.home); homeCount = r.homes.filter(function (h) { return h.is_public; }).length; homesReady = true; changed('homes'); });
  }
  function search(query) {
    var key = query.trim().toLowerCase();
    if (!enabled || navigator.onLine === false || key === searchKey || !key) return Promise.resolve();
    searchKey = key;
    return call('search', { query: key, mode: state.mode }).then(function (r) { if (key !== searchKey) return; mergePlaces(r.rows, 'all'); changed('search'); }, function (e) { if (key === searchKey) searchKey = ''; throw e; });
  }
  function refresh(guard) {
    if (unavailable) return Promise.resolve(false);
    var uid = ctx.uid(), ticket = epoch;
    return call('boot').then(function (r) {
      if (!current(uid,ticket) || (guard && !guard())) return true;
      enabled = true; actor = uid;
      var c = ctx.cache(); c.profile = uid ? Object.assign({},ctx.anon,r.profile || {},{id:uid}) : ctx.anon;
      c.admin = r.admin === true; c.wishlist = r.wishlist.map(function (w) { return {placeId:w.place_id,createdAt:Date.parse(w.created_at)}; });
      if (!homesReady) c.homes = c.homes.filter(function(h){return h.userId!==uid;}).concat(r.homes.map(ctx.home)); homeCount = r.homeCount; c.ccCol = true;
      return Promise.all([readFeed(false,guard),readMap(true)]).then(function () { ctx.save(); return true; });
    }).catch(function (e) {
      if (!enabled && (e.code === 'PGRST202' || e.code === '42883' || /Unsupported read API|no such function|function .* does not exist/i.test(e.message || ''))) { unavailable = true; return false; }
      throw e;
    });
  }
  function reset() {
    epoch++; enabled = false; actor = undefined; ownReady = false; ownWork = null;
    feed = {key:'',ids:[],more:false,cursor:null}; placesLoaded.clear(); personLoaded.clear(); authorHomes.clear(); detailWork.clear(); searchKey = ''; homesReady = false; homeCount = null;
    mapKey = ''; loadedContext = ''; mapIDs = []; groups = []; mapTicket++; if (mapController) mapController.abort();
  }
  function afterWrite() {
    if (!enabled) return;
    placesLoaded.clear(); personLoaded.clear();
    var c = ctx.cache(), ids = new Set(feed.ids);
    c.reviews.forEach(function (r) { if (r.authorId === ctx.uid() && r.visibility === 'public' && r.photos.length) ids.add(r.id); });
    feed.ids = Array.from(ids).filter(function (id) { return c.reviews.some(function (r) { return r.id===id && r.visibility==='public'; }); });
    readMap(true).catch(function () {});
  }
  return { refresh:refresh, reset:reset, enabled:function(){return enabled;}, ownReady:function(){return ownReady;}, ensureOwn:ensureOwn,
    readFeed:readFeed, feedInfo:function(){return feed;}, feedItems:function(){var by=new Map(ctx.cache().reviews.map(function(r){return [r.id,r];}));return feed.ids.map(function(id){return by.get(id);}).filter(Boolean);},
    readMap:readMap, mapPlaces:function(){if(loadedContext!==state.scope+':'+state.mode)return [];var ids=new Set(mapIDs);return ctx.cache().places.filter(function(p){return ids.has(p.id);});}, groups:function(){return loadedContext==='all:'+state.mode&&!(typeof map!=='undefined'&&map&&map.getZoom()>=10&&loadedZoom<10)?groups:[];},
    ensurePlace:ensurePlace, placeInfo:function(id){return placesLoaded.get(id);}, ensurePost:ensurePost, ensurePerson:ensurePerson, ensureHomes:ensureHomes,
    search:search, afterWrite:afterWrite, homeCount:function(){return homeCount;}, metrics:function(){var sorted=metrics.samples.slice().sort(function(a,b){return a-b;});return Object.assign({},metrics,{samples:metrics.samples.slice(),p95:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:0});} };
} };
