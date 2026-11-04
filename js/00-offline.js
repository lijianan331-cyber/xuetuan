/* Device-local read cache. No auth tokens, private messages or moderation data. */
'use strict';
(function () {
  var enabled = /^https?:$/.test(location.protocol) && !!window.indexedDB;
  var owner, epoch = 0, dbPromise, queue = Promise.resolve(), savedAt = 0, usingCache = false;
  var earlyMapURLs = new Set(), mapReplay = false;
  var blobURLs = new Map(), blobBytes = 0;
  var AGE = 7 * 86400000, PHOTO_BYTES = 48 * 1024 * 1024, PHOTO_COUNT = 350;
  function database() {
    if (!enabled) return Promise.resolve(null);
    if (!dbPromise) dbPromise = new Promise(function (resolve) {
      var req = indexedDB.open('xuetuan-offline-v1', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('items', { keyPath: 'key' }); };
      req.onsuccess = function () { var db = req.result; db.onversionchange = function () { db.close(); }; resolve(db); };
      req.onerror = req.onblocked = function () { resolve(null); };
    });
    return dbPromise;
  }
  function transaction(mode, run) {
    return database().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction('items', mode), result;
        run(tx.objectStore('items'), function (v) { result = v; });
        tx.oncomplete = function () { resolve(result === undefined ? true : result); };
        tx.onerror = tx.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function serial(fn) { queue = queue.then(fn, fn); return queue; }
  function announce() { window.dispatchEvent(new Event('xuetuan-offline')); }
  function releaseURLs() { blobURLs.forEach(function (r) { URL.revokeObjectURL(r.url); }); blobURLs.clear(); blobBytes = 0; }
  function blobURL(key, blob) {
    if (blobURLs.has(key)) return blobURLs.get(key).url;
    while (blobURLs.size && (blobURLs.size >= PHOTO_COUNT || blobBytes + blob.size > PHOTO_BYTES)) {
      var old = blobURLs.keys().next().value, value = blobURLs.get(old);
      URL.revokeObjectURL(value.url); blobBytes -= value.size; blobURLs.delete(old);
      window.dispatchEvent(new CustomEvent('xuetuan-photo-evicted', { detail: value.url }));
    }
    var url = URL.createObjectURL(blob); blobURLs.set(key, { url: url, size: blob.size }); blobBytes += blob.size; return url;
  }
  function setOwner(uid) {
    uid = uid || 'public';
    if (uid === owner) return;
    owner = uid; epoch++; savedAt = 0; usingCache = false; releaseURLs();
    // Keep only this SDK-confirmed identity, including across tabs/reloads.
    serial(function () { return transaction('readwrite', function (s) {
      s.openCursor().onsuccess = function (e) { var c = e.target.result; if (!c) return; if (c.value.owner !== owner || Date.now() - c.value.at > AGE) c.delete(); c.continue(); };
    }); });
    announce();
  }
  function snapshot(value) {
    var actor = owner, ticket = epoch;
    if (actor === undefined) return Promise.resolve(null);
    if (value) {
      // Explicit allowlist: never serialize an SDK session or admin privileges.
      var clean = { places: value.places, reviews: value.reviews, wishlist: value.wishlist, homes: value.homes, profile: value.profile };
      if (JSON.stringify(clean).length > 8 * 1024 * 1024) return Promise.resolve(null);
      var at = Date.now(), paths = new Set();
      clean.reviews.forEach(function (r) { (r.photos || []).forEach(function (p) { paths.add(p); }); });
      return serial(function () { if (ticket !== epoch) return null; return transaction('readwrite', function (s) {
        s.put({ key: actor + ':snapshot', owner: actor, at: at, value: clean });
        // A refreshed RLS snapshot may revoke access: discard removed media too.
        s.openCursor().onsuccess = function (e) { var c = e.target.result; if (!c) return; if (c.value.owner === actor && c.value.path && !paths.has(c.value.path)) c.delete(); c.continue(); };
      }); }).then(function (ok) { if (ok && ticket === epoch) { savedAt = at; usingCache = false; announce(); } });
    }
    return queue.then(function () { return transaction('readonly', function (s, done) { s.get(actor + ':snapshot').onsuccess = function (e) { done(e.target.result); }; }); }).then(function (r) {
      if (ticket !== epoch || !r || Date.now() - r.at > AGE) return null;
      savedAt = r.at; usingCache = true; announce(); return r.value;
    });
  }
  function photo(path, small, url) {
    var actor = owner, ticket = epoch, key = actor + ':photo:' + path + (small ? ':small' : ':full');
    if (!enabled || actor === undefined) return Promise.resolve(url || null);
    if (url && /\.(mp4|mov|webm)$/i.test(path)) return Promise.resolve(url);
    if (!url) return queue.then(function () { return transaction('readonly', function (s, done) {
      s.get(key).onsuccess = function (e) {
        if (e.target.result || !small) { done(e.target.result); return; }
        s.get(actor + ':photo:' + path + ':full').onsuccess = function (e) { done(e.target.result); };
      };
    }); }).then(function (r) {
      return ticket === epoch && r && Date.now() - r.at <= AGE ? blobURL(key, r.blob) : null;
    });
    // Fetch once, then show that same blob. Never persist expiring signed URLs.
    return fetch(url, { cache: 'no-store', credentials: 'omit' }).then(function (r) {
      if (!r.ok || !/^image\//i.test(r.headers.get('Content-Type') || '') || +r.headers.get('Content-Length') > 6 * 1024 * 1024) { if (r.body) r.body.cancel().catch(function () {}); return null; }
      return r.blob();
    }).then(function (blob) {
      if (ticket !== epoch) return null;
      if (!blob || blob.size > 6 * 1024 * 1024) return url;
      serial(function () { if (ticket !== epoch) return null; return transaction('readwrite', function (s) {
        var total = blob.size, rows = [];
        s.openCursor().onsuccess = function (e) {
          var c = e.target.result;
          if (c) { if (c.value.blob && c.key !== key) { total += c.value.blob.size; rows.push({ key: c.key, size: c.value.blob.size, at: c.value.at }); } c.continue(); return; }
          rows.sort(function (a, b) { return a.at - b.at; });
          while (rows.length && (total > PHOTO_BYTES || rows.length >= PHOTO_COUNT)) { var old = rows.shift(); total -= old.size; s.delete(old.key); }
          s.put({ key: key, owner: actor, path: path, at: Date.now(), blob: blob });
        };
      }); });
      return blobURL(key, blob);
    }).catch(function () { return ticket === epoch ? url : null; });
  }
  function clear() {
    epoch++; savedAt = 0; usingCache = false; releaseURLs();
    window.dispatchEvent(new Event('xuetuan-offline-clear'));
    return serial(function () { return transaction('readwrite', function (s) { s.clear(); }); }).then(function () {
      if ('caches' in window) return caches.delete('xuetuan-map-v1');
    }).then(announce);
  }
  function mapUsed(url) {
    if (enabled && 'serviceWorker' in navigator && !navigator.serviceWorker.controller && /^https:\/\/tiles\.openfreemap\.org\//.test(url) && earlyMapURLs.size < 120) earlyMapURLs.add(url);
  }
  window.XueOffline = { enabled: enabled, setOwner: setOwner, snapshot: snapshot, photo: photo, clear: clear, mapUsed: mapUsed,
    status: function () { return { savedAt: savedAt, cached: usingCache }; } };
  if (!enabled) return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (mapReplay || navigator.onLine === false) return; mapReplay = true;
    // On the first visit, the map may precede worker installation. Save only URLs
    // actually requested for that view, using the browser's HTTP cache where possible.
    var urls = Array.from(earlyMapURLs); earlyMapURLs.clear();
    function next() { var url = urls.shift(); if (!url) return; fetch(url, { cache: 'force-cache', credentials: 'omit' }).catch(function () {}).then(next); }
    next(); next(); next();
  });
  function banner() {
    var el = document.getElementById('offline-status');
    if (!el) { el = document.createElement('div'); el.id = 'offline-status'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.hidden = navigator.onLine !== false && !usingCache;
    var en = document.documentElement.lang !== 'zh-CN' && document.documentElement.lang !== 'zh';
    el.textContent = savedAt ? (en ? 'Saved content · ' : '离线缓存 · ') + new Date(savedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : (en ? 'Offline · unseen content needs a connection' : '当前离线 · 未缓存内容需联网');
  }
  ['online', 'offline', 'xuetuan-offline'].forEach(function (e) { window.addEventListener(e, banner); });
  banner();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
  // Existing drafts remain editable; network mutations never pretend to succeed.
  window.addEventListener('click', function (e) {
    var action = e.target.closest('[data-action]');
    if (action && action.dataset.action === 'offline-clear') { e.preventDefault(); clear().then(function () { if (typeof toast === 'function') toast('离线缓存已清除'); }); }
  });
})();
