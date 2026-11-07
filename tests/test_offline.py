"""Real HTTP + service-worker offline reload, synthetic accounts/media only."""
import io, json, os, threading, time
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STUB = (ROOT / 'tests/stub_supabase.js').read_text(encoding='utf8')
MAP = (ROOT / 'tests/stub_maplibre.js').read_text(encoding='utf8')
out = io.BytesIO(); Image.new('RGB', (80, 60), '#74add6').save(out, 'PNG'); PHOTO = out.getvalue()
CDNS = {
    'vendor/maplibre-gl-5.24.0/maplibre-gl.js': '/vendor/map.js',
    'vendor/maplibre-gl-5.24.0/maplibre-gl.css': '/vendor/map.css',
    'vendor/supabase-js-2.117.3.js': '/vendor/sb.js',
}
seed = {
    'profiles': [{'id': 'alpha', 'name': 'Synthetic A'}, {'id': 'beta', 'name': 'Synthetic B'}],
    'places': [{'id': 'p', 'name': 'Synthetic cache cafe', 'mode': 'food', 'cat': 'other', 'precision': 'exact', 'lat': 2.83, 'lng': 101.7, 'created_at': '2026-10-01'}],
    'visits': [{'id': 'v', 'place_id': 'p', 'user_id': 'alpha', 'visibility': 'private', 'rating': 4, 'text': 'Private synthetic review', 'photos': ['alpha/pic.jpg'], 'created_at': '2026-10-01'}],
}
# Weak signal: every read (and, with fixture-slow-auth, the token refresh) hangs for the first N ms after load.
SLOW = """
(function(){var cc=window.supabase.createClient;window.supabase.createClient=function(){
  var c=cc.apply(this,arguments),slow=+localStorage.getItem('fixture-slow')||0;if(!slow)return c;
  var hold=function(){var left=slow-performance.now();return new Promise(function(r){setTimeout(r,Math.max(0,left));});};
  var from=c.from;c.from=function(t){var q=from.call(c,t),then=q.then;q.then=function(a,b){var self=this;return hold().then(function(){return then.call(self,a,b);});};return q;};
  var rpc=c.rpc;c.rpc=function(){var args=arguments;return hold().then(function(){return rpc.apply(c,args);});};
  if(localStorage.getItem('fixture-slow-auth')){var gs=c.auth.getSession;c.auth.storageKey='fixture-auth';
    gs.call(c.auth).then(function(r){localStorage.setItem('fixture-auth',JSON.stringify(r.data.session));});
    c.auth.getSession=function(){return hold().then(function(){return gs.call(c.auth);});};}
  return c;};})();"""
requests = []
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = urlsplit(self.path).path
        requests.append(path)
        origin = f'http://127.0.0.1:{self.server.server_port}'
        mime = 'application/javascript'
        if path == '/vendor/map.js': body = MAP
        elif path == '/vendor/map.css': body = ''; mime = 'text/css'
        elif path == '/vendor/sb.js':
            body = STUB.replace('https://example.invalid', origin) + "\nif(localStorage.getItem('fixture-uid')!=='public')__sbLogin(localStorage.getItem('fixture-uid')||'alpha','synthetic@example.invalid');" + SLOW
        elif path.startswith('/storage/') or path == '/photo.png': body = PHOTO; mime = 'image/png'
        elif path == '/large.png': body = PHOTO + b'0' * (4 * 1024 * 1024); mime = 'image/png'
        elif path.startswith('/map/styles/'):
            body = json.dumps({'version': 8, 'sources': {'om': {'type': 'vector', 'tiles': [origin + '/map/{z}/{x}/{y}.pbf'], 'maxzoom': 14}}, 'layers': [{'id': 'background', 'type': 'background'}]}); mime = 'application/json'
        elif path.startswith('/map/'): body = b'synthetic tile'; mime = 'application/x-protobuf'
        elif path == '/api/private': body = '{"secret":"not cached"}'; mime = 'application/json'
        else:
            file = ROOT / (path.lstrip('/') or 'index.html')
            if not file.is_file(): self.send_error(404); return
            body = file.read_bytes()
            mime = {'.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json'}.get(file.suffix, 'application/javascript')
            if file.suffix in ('.html', '.js'):
                body = body.decode('utf8')
                for a, b in CDNS.items(): body = body.replace(a, origin + b)
                body = body.replace('https://tiles.openfreemap.org/styles/', origin + '/map/styles/')
                body = body.replace("u.origin === 'https://tiles.openfreemap.org'", "u.origin === ROOT.origin && u.pathname.startsWith('/map/')")
        if isinstance(body, str): body = body.encode('utf8')
        self.send_response(200); self.send_header('Content-Type', mime); self.send_header('Content-Length', str(len(body))); self.end_headers()
        self.wfile.write(body)

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
checks = 0
def check(value, message):
    global checks
    assert value, message
    checks += 1; print('PASS ' + message, flush=True)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL', 'msedge'), headless=True)
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='allow')
        ctx.add_init_script('window.__sbSeed=' + json.dumps(seed) + ';')
        pg = ctx.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_function('!state.bootLoading && store.me().id === "alpha"')
        pg.wait_for_function('navigator.serviceWorker.controller !== null', timeout=45000)
        check(pg.evaluate('store.reviews().length===1'), 'online RLS-visible synthetic review loaded')
        check(pg.evaluate('''async()=>{areaWarmed=false;warmArea();await new Promise(r=>setTimeout(r,800));return localStorage.getItem("xuetuan:map-warm")===null && !(await (await caches.open('xuetuan-map-v1')).keys()).some(r=>/map.1[0-4].(12820|800)./.test(r.url));}'''), 'campus map pre-download stays off in automated browsers')
        pg.evaluate('window.__mapWarm=true;areaWarmed=false;warmArea()')
        pg.wait_for_function('localStorage.getItem("xuetuan:map-warm")!==null', timeout=20000)
        check(pg.evaluate('''async()=>{const c=await caches.open('xuetuan-map-v1'),keys=(await c.keys()).map(r=>r.url);return keys.some(u=>u.endsWith('/map/14/12820/8062.pbf')) && keys.some(u=>u.endsWith('/map/10/800/503.pbf')) && keys.length>=40 && keys.length<=170;}'''), 'campus and KL map tiles pre-downloaded into the offline cache once')
        pg.evaluate('delete window.__mapWarm')
        pg.evaluate('store.photoURL("alpha/pic.jpg",true)'); pg.wait_for_timeout(300)
        pg.evaluate('''async()=>{await XueOffline.snapshot({places:store.places(),reviews:store.reviews(),wishlist:[],homes:[],profile:me()});await fetch('/map/14/1/2.pbf');await fetch('/api/private');}''')
        check(pg.evaluate('''async()=>{const keys=await caches.keys();const c=await caches.open(keys.find(k=>k.startsWith('xuetuan-shell-')));return (await c.keys()).length>=28;}'''), 'complete coherent shell and pinned SDKs installed')
        check(pg.evaluate("""async()=>{const from=sbClient.from;sbClient.from=function(table){const q=from.call(sbClient,table);q.then=function(resolve,reject){return Promise.resolve({error:{message:'TypeError: Failed to fetch'}}).then(resolve,reject);};return q;};try{await store.refresh();window.__sbSignFail=true;const u=await store.photoURL('alpha/pic.jpg',true);return navigator.onLine && XueOffline.status().cached && !!u && (await fetch(u)).ok;}finally{sbClient.from=from;window.__sbSignFail=false;await store.refresh();}}"""), 'Wi-Fi connected without working internet still restores cached data and photos')
        check(pg.evaluate("""async()=>{const from=sbClient.from;sbClient.from=function(table){const q=from.call(sbClient,table);q.then=function(resolve,reject){return Promise.resolve({error:{code:'42501',message:'permission denied'}}).then(resolve,reject);};return q;};try{await store.refresh();return false;}catch(e){return e.code==='42501' && !XueOffline.status().cached;}finally{sbClient.from=from;await store.refresh();}}"""), 'permission failures are not disguised as offline cache hits')
        pg.evaluate("localStorage.setItem('fixture-slow','12000')"); t0 = time.time(); pg.reload()
        pg.wait_for_function('!state.bootLoading', timeout=9000)
        check(time.time() - t0 < 8 and pg.evaluate('store.me().id==="alpha" && store.reviews()[0].text==="Private synthetic review" && XueOffline.status().cached'), 'weak signal: cached posts show within seconds instead of waiting for the network')
        pg.wait_for_function('!XueOffline.status().cached', timeout=20000)
        check(pg.evaluate('store.reviews().length===1 && store.reviews()[0].text==="Private synthetic review"'), 'weak signal: fresh data replaces the cache once it arrives')
        pg.evaluate("localStorage.setItem('fixture-slow-auth','1')"); t0 = time.time(); pg.reload()
        pg.wait_for_function('!state.bootLoading', timeout=9000)
        check(time.time() - t0 < 8 and pg.evaluate('store.me().id==="alpha" && store.reviews().length===1 && XueOffline.status().cached'), 'expired login on a weak signal still opens the cached account view')
        pg.wait_for_function('!XueOffline.status().cached', timeout=20000)
        pg.evaluate("localStorage.removeItem('fixture-slow');localStorage.removeItem('fixture-slow-auth');localStorage.removeItem('fixture-auth')")
        pg.reload(); pg.wait_for_function('!state.bootLoading && store.me().id === "alpha"')
        ctx.set_offline(True); pg.reload(); pg.wait_for_function('!state.bootLoading')
        check(pg.evaluate('store.me().id==="alpha" && store.reviews()[0].text==="Private synthetic review"'), 'offline reload restores only the SDK-confirmed account snapshot')
        check(pg.evaluate('XueOffline.status().cached && !store.isAdmin()'), 'offline status shown and moderation privileges not restored')
        check(pg.evaluate('''async()=>{const u=await store.photoURL('alpha/pic.jpg',true);return !!u && (await fetch(u)).ok;}'''), 'previously loaded photo available without a signed-URL network request')
        check(pg.evaluate('''async()=>{try{return (await fetch('/map/14/1/2.pbf')).ok;}catch(e){return false;}}'''), 'viewed map tile available offline')
        check(pg.evaluate('''async()=>{const c=await caches.open('xuetuan-map-v1'),k=(await c.keys()).find(r=>r.url.endsWith('/map/14/1/2.pbf')),old=await c.match(k),h=new Headers(old.headers);h.set('x-xuetuan-cached-at',String(Date.now()-30*86400000));await c.put(k,new Response(await old.arrayBuffer(),{headers:h}));try{const r=await fetch('/map/14/1/2.pbf');return r.ok && (await r.text())==='synthetic tile';}catch(e){return false;}}'''), 'map tiles older than seven days still show offline instead of a blank map')
        check(pg.evaluate('''async()=>{try{await fetch('/api/private');return false;}catch(e){return true;}}'''), 'private API responses are never HTTP cached')
        check(pg.evaluate('''async()=>{try{await store.setSaved('p',true);return false;}catch(e){return /Offline/.test(e.message) && !store.isSaved('p');}}'''), 'offline writes rejected without optimistic success')
        check(pg.evaluate('''async()=>!(await store.photoURL('alpha/unseen.jpg',true))'''), 'unseen photos remain unavailable rather than fetching another account')
        check(pg.evaluate('''async()=>{const real=Date.now;Date.now=()=>real()+8*86400000;try{return !(await XueOffline.snapshot()) && !(await XueOffline.photo('alpha/pic.jpg',true));}finally{Date.now=real;}}'''), 'expired records and photos are not restored after seven days')
        pg.screenshot(path=str(ROOT / 'tests/shots/offline-mobile.png'))
        ctx.set_offline(False); pg.wait_for_timeout(400)
        check(pg.evaluate('!XueOffline.status().cached'), 'reconnect successfully revalidates the snapshot')
        pg.evaluate("localStorage.setItem('fixture-uid','beta');__sbLogin('beta','synthetic-b@example.invalid')")
        pg.wait_for_function('store.me().id==="beta"'); pg.wait_for_timeout(150)
        ctx.set_offline(True)
        check(pg.evaluate('''async()=>store.reviews().length===0 && !(await XueOffline.photo('alpha/pic.jpg',true))'''), 'account switching clears previous private rows and photo blobs')
        pg.evaluate("localStorage.setItem('fixture-uid','public');__sbLogout()")
        pg.wait_for_timeout(150)
        check(pg.evaluate('store.reviews().length===0 && !store.me().id'), 'sign-out immediately clears private in-memory data offline')
        ctx.set_offline(False)
        # Test cache limits and sanitization with synthetic blobs only, no cloud writes.
        pg.evaluate('''async()=>{XueOffline.setOwner('budget');await XueOffline.snapshot({places:[],reviews:[],wishlist:[],homes:[],profile:{id:'budget'},admin:true,session:{access_token:'DO-NOT-PERSIST'}});for(let i=0;i<13;i++)await XueOffline.photo('budget/'+i,true,'/large.png');await XueOffline.snapshot();}''')
        stats = pg.evaluate('''async()=>new Promise(resolve=>{const q=indexedDB.open('xuetuan-offline-v1');q.onsuccess=()=>{const db=q.result,tx=db.transaction('items'),r=tx.objectStore('items').getAll();r.onsuccess=()=>{let rows=r.result;resolve({bytes:rows.reduce((n,r)=>n+(r.blob?r.blob.size:0),0),photos:rows.filter(r=>r.blob).length,safe:!JSON.stringify(rows).includes('DO-NOT-PERSIST')&&!JSON.stringify(rows).includes('"admin"')});db.close();};};})''')
        check(stats['bytes'] <= 48*1024*1024 and stats['photos'] < 13, 'photo cache evicts old entries within 48 MiB budget')
        check(stats['safe'], 'snapshot allowlist excludes session tokens and administrator flags')
        pg.evaluate('''async()=>{await XueOffline.photo('budget/original',false,'/photo.png');await XueOffline.snapshot();}''')
        check(pg.evaluate('''async()=>!!(await XueOffline.photo('budget/original',true))'''), 'offline thumbnail falls back to an already cached original')
        pg.evaluate("XueOffline.setOwner('alpha');XueOffline.snapshot({places:[],reviews:[],wishlist:[],homes:[],profile:{id:'alpha'}});XueOffline.setOwner('beta')")
        check(pg.evaluate('''async()=>!(await XueOffline.snapshot())'''), 'pending saves from a previous identity cannot repopulate its cache')
        pg.evaluate('XueOffline.clear()')
        check(pg.evaluate('''async()=>!(await XueOffline.snapshot()) && !(await XueOffline.photo('budget/12',true))'''), 'clear-cache removes snapshots and cached media')
        check(not errors, 'no browser JavaScript errors: ' + str(errors))
        ctx.close()
        blocked = browser.new_context(); page = blocked.new_page()
        page.goto(url + 'privacy.html')
        page.evaluate("Object.defineProperty(window,'indexedDB',{value:{open(){throw Error('storage denied')}}})")
        page.add_script_tag(url=url + 'js/00-offline.js')
        check(page.evaluate('''async()=>{XueOffline.setOwner('blocked');await XueOffline.snapshot({places:[],reviews:[],wishlist:[],homes:[],profile:{id:'blocked'}});return !(await XueOffline.snapshot()) && !XueOffline.status().savedAt;}'''), 'storage refusal degrades gracefully without claiming a saved cache')
        blocked.close(); browser.close()
    print(f'{checks}/{checks} offline checks passed', flush=True)
finally:
    server.shutdown(); server.server_close()
