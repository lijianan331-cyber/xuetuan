/* Atomic app-shell releases. This worker never caches API/auth/signed-photo requests. */
'use strict';
const VERSION = 'xuetuan-shell-f8d38d75f89911c5';
const MAP_CACHE = 'xuetuan-map-v1';
const ROOT = new URL('./', self.location.href);
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'assets/app-icon-sheet.png', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/search-pin.png', 'assets/xmum-campus.png',
  'data/xmum-cafeterias.js', 'data/halal.js', 'data/i18n-ui.js',
  'js/00-offline.js', 'js/00-reads.js', 'js/01-core.js', 'js/02-map.js', 'js/03-home-layer.js', 'js/04-ui.js', 'js/05-auth.js', 'js/05-feed.js', 'js/05-identity.js', 'js/05-messages.js', 'js/05-social.js', 'js/06-search.js', 'js/07-nav-form.js', 'js/08-bulk.js', 'js/09-actions-boot.js', 'js/09-reads-ui.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js'
].map(p => new URL(p, ROOT).href);
async function checkedFetch(url) {
  const r = await fetch(new Request(url, { cache: 'reload', credentials: new URL(url).origin === ROOT.origin ? 'same-origin' : 'omit' }));
  if (!r.ok) throw Error('Shell unavailable');
  const type = r.headers.get('Content-Type') || '';
  if (/\.js$/.test(url) && !/javascript/.test(type)) throw Error('Unexpected script');
  if (url === ROOT.href || /index\.html$/.test(url)) {
    if (!/text\/html/.test(type) || !(await r.clone().text()).includes('js/09-actions-boot.js')) throw Error('Not the app shell');
  }
  return r;
}
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    try {
      // Modest concurrency; a partial download never becomes an active release.
      for (let i = 0; i < SHELL.length; i += 3) await Promise.all(SHELL.slice(i, i + 3).map(async url => cache.put(url, await checkedFetch(url))));
    } catch (err) { await caches.delete(VERSION); throw err; }
  })());
  // Wait for old tabs to close. Do not reload a composer or mix JS versions.
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('xuetuan-shell-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
let mapQueue = Promise.resolve(), mapIndex = null, mapBytes = 0;
async function mapResponse(request) {
  const cache = await caches.open(MAP_CACHE), hit = await cache.match(request);
  // Cache only normal, user-requested map assets. No background region downloads.
  if (hit && Date.now() - Number(hit.headers.get('x-xuetuan-cached-at') || 0) < 7 * 86400000) return hit;
  try {
    const r = await fetch(request);
    if (!r.ok || r.type === 'opaque') return r;
    const bytes = await r.clone().arrayBuffer();
    if (bytes.byteLength > 3 * 1024 * 1024) return r;
    const h = new Headers(r.headers); h.set('x-xuetuan-cached-at', String(Date.now())); h.set('x-xuetuan-bytes', String(bytes.byteLength));
    // Serialize cache writes and eviction so simultaneous tiles cannot exceed the budget.
    mapQueue = mapQueue.catch(() => {}).then(async () => {
      if (!mapIndex) {
        mapIndex = new Map();
        for (const key of await cache.keys()) { const value = await cache.match(key); if (value) { const size = Number(value.headers.get('x-xuetuan-bytes') || 0); mapIndex.set(key.url, size); mapBytes += size; } }
      }
      await cache.put(request, new Response(bytes, { status: 200, headers: h }));
      mapBytes -= mapIndex.get(request.url) || 0; mapIndex.delete(request.url);
      mapIndex.set(request.url, bytes.byteLength); mapBytes += bytes.byteLength;
      while (mapIndex.size && (mapBytes > 40 * 1024 * 1024 || mapIndex.size > 1200)) {
        const key = mapIndex.keys().next().value; mapBytes -= mapIndex.get(key); mapIndex.delete(key); await cache.delete(key);
      }
    });
    await mapQueue;
    return r;
  } catch (err) { throw err; }
}
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  if (r.mode === 'navigate' && u.origin === ROOT.origin && (u.pathname === ROOT.pathname || u.pathname === ROOT.pathname + 'index.html')) {
    // Query/hash remain on the page for OAuth and Vercel sharing; never cache them as keys.
    e.respondWith(caches.open(VERSION).then(async c => (await c.match(ROOT.href)) || fetch(r))); return;
  }
  const plain = u.origin === ROOT.origin ? u.origin + u.pathname : u.href;
  if (SHELL.includes(plain)) { e.respondWith(caches.open(VERSION).then(async c => (await c.match(plain)) || fetch(r))); return; }
  if (u.origin === 'https://tiles.openfreemap.org') {
    e.respondWith(mapResponse(r)); return;
  }
  // Supabase, Google, messages, avatars and other domains pass through uncached.
});
