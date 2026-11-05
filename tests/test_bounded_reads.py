"""Mobile UI + throttled HTTP, using real isolated PostgreSQL/RLS and 10k fake posts."""
import io, json, os, subprocess, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
test = ROOT / 'tests/test_app.py'
s = {'__file__': str(test)}
exec(test.read_text(encoding='utf8').split('with sync_playwright() as p:')[0], s)
PGLITE = os.environ.get('XUETUAN_TEST_PGLITE', 'C:/Users/gtl/AppData/Local/Temp/xue-security-check/node_modules/@electric-sql/pglite/dist/index.js')
log = open(ROOT / 'tests/shots/bounded-server-errors.txt', 'w', encoding='utf8')
server = subprocess.Popen(['node', 'tests/bounded_fixture_server.mjs', PGLITE], cwd=ROOT, stdout=subprocess.PIPE, stderr=log, text=True, encoding='utf8', creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
checks = 0
def check(value, label):
    global checks
    assert value, label
    checks += 1; print('PASS ' + label, flush=True)

try:
    config = json.loads(server.stdout.readline()); endpoint = f'http://127.0.0.1:{config["port"]}'
    hook = """window.__readActor=null;window.__readDelay=0;window.__readCalls=[];
window.__boundedRpc=function(req){var actor=window.__readActor,delay=window.__readDelay,signal;window.__readCalls.push({kind:req.kind,args:JSON.parse(JSON.stringify(req.args)),actor});return {abortSignal:function(s){signal=s;return this;},then:function(ok,bad){return fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:req.kind,args:req.args,actor:actor,delay:delay}),signal:signal}).then(r=>r.json()).then(ok,bad);}};};""".replace('ENDPOINT', json.dumps(endpoint))
    out = io.BytesIO(); Image.new('RGB', (640, 440), '#72a8cc').save(out, 'JPEG'); jpeg = out.getvalue()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL', 'msedge'), headless=True)
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        s['route_all'](ctx, True)
        ctx.route('http://127.0.0.1:*/**', lambda route: route.continue_())
        ctx.route('https://example.invalid/**', lambda route: route.fulfill(body=jpeg, content_type='image/jpeg'))
        ctx.add_init_script('window.__sbSeed='+json.dumps({'profiles':[{'id':config['peer'],'name':'Synthetic'}],'homes':[{'user_id':config['peer'],'city':'Synthetic hometown','lat':30,'lng':110,'is_public':True}]})+';'+hook)
        pg = ctx.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.set_default_timeout(12000)
        cdp = ctx.new_cdp_session(pg); cdp.send('Network.enable')
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 150, 'downloadThroughput': 75000, 'uploadThroughput': 40000})
        began = time.monotonic(); pg.goto(s['APP']); pg.wait_for_function('!state.bootLoading && store.pagedReads()')
        elapsed = time.monotonic() - began
        check(pg.locator('.post-card').count() == 20, '10k-post homepage initially renders only 20 cards over throttled HTTP')
        check(elapsed < 8, f'weak-network synthetic cold boot finishes in {elapsed:.2f}s')
        check(pg.evaluate('store.reviews().length===20 && store.places().length<50'), 'startup does not fetch or keep all global reviews/places')
        check(pg.evaluate('!__readCalls.some(c=>c.kind==="own"||c.kind==="person"||c.kind==="homes")'), 'personal and hometown data stay lazy until requested')
        check(pg.evaluate('!__sb.calls.some(c=>c[1]==="select"&&["places","visits"].includes(c[0]))'), 'new API avoids the legacy global table downloads')
        pg.evaluate("state.homeDays=1;render()");pg.wait_for_function('JSON.parse(store.reader().feedInfo().key).days===1 && homeEligible().length===0')
        check(pg.locator('[data-action="home-all-time"]').count()==1, 'an empty recent page still offers older shares')
        pg.click('[data-action="home-all-time"]');pg.wait_for_function('homeEligible().length===20')
        pg.wait_for_function('store.homes().some(h=>h.city==="Synthetic hometown")')
        check(pg.evaluate('homeEligible().every(r=>authorFrom(r)==="Synthetic hometown")'), 'public author hometown labels remain available without downloading all hometowns')
        pg.click('[data-action="read-feed-more"]'); pg.wait_for_function('homeEligible().length===40')
        check(pg.locator('.post-card').count() == 40 and pg.evaluate('new Set(homeEligible().map(r=>r.id)).size===40'), 'load-more appends one page without duplicate posts')
        pg.evaluate("state.homeMode='travel';render()")
        pg.wait_for_function('homeEligible().length===20 && homeEligible().every(r=>placeById(r.placeId).mode==="travel")')
        check(pg.evaluate('store.reader().feedInfo().key.includes("travel")'), 'mode change restarts server-side pagination')
        pg.evaluate("state.homeDays=0;state.homeMin=4;state.homeSort='rating';render()")
        pg.wait_for_function('store.reader().feedInfo().key.includes("rating") && homeEligible().every(r=>r.rating>=4)')
        check(pg.locator('.post-card').count() == 20, 'time/rating/sort filters query the server rather than filtering one old page')
        pg.screenshot(path=str(ROOT / 'tests/shots/bounded-home-mobile.png'))
        place = '50000000-0000-4000-8000-000000000002'
        pg.evaluate('(id)=>openPlace(id,{fly:false})', place)
        pg.wait_for_function('state.view==="place" && state.placeId==="'+place+'"')
        check(pg.evaluate('stats(placeById(state.placeId)).count===46 && scopedReviews(state.placeId,"saved").length===20'), 'place shows the exact 46-review total while loading only twenty reviews')
        pg.locator('[data-action="read-place-more"]').click(); pg.wait_for_function('scopedReviews(state.placeId,"saved").length===40')
        check(pg.evaluate('stats(placeById(state.placeId)).count===46'), 'loading another page never changes aggregate score/count')
        pg.locator('[data-action="read-place-more"]').click(); pg.wait_for_function('scopedReviews(state.placeId,"saved").length===46')
        check(pg.locator('[data-action="read-place-more"]').count() == 0, 'final detail page contains all reviews and removes load-more')
        check(pg.evaluate('placePhotoCount(placeById(state.placeId))===46'), 'map/photo count includes every photo independently of detail paging')
        pg.screenshot(path=str(ROOT / 'tests/shots/bounded-place-mobile.png'))
        # Explicitly change map bounds; the stub renderer is deterministic, HTTP uses real SQL.
        pg.evaluate("setTab('explore');state.mode='food';viewBounds=()=>({getWest:()=>-180,getEast:()=>180,getSouth:()=>-85,getNorth:()=>85,contains:()=>true});map.zoom=2;map.getZoom=()=>map.zoom")
        pg.evaluate('store.reader().readMap(true)'); pg.wait_for_function('store.reader().groups().length>0')
        check(pg.evaluate('placesGeoJSON().features.reduce((n,f)=>n+f.properties.locationCount,0)===5000'), 'world aggregation preserves all public food locations without downloading full posts')
        check(pg.evaluate('placesGeoJSON().features.length<600'), 'world map uses a small overview, not ten thousand full records')
        pg.evaluate('''()=>{const g=placesGeoJSON().features.find(f=>f.properties.serverGroup);map.queryRenderedFeatures=()=>[{...g,layer:{id:'cl-circle'}}];onMapClick({point:{x:100,y:100}});}''')
        check(pg.evaluate('map.getZoom()>2'), 'tapping a server group zooms toward its members')
        # Stale viewport responses must not overwrite the latest query.
        pg.evaluate('''()=>{state.mode='food';__readDelay=700;window.stale=store.reader().readMap(true).catch(()=>{});state.mode='travel';__readDelay=0;window.fresh=store.reader().readMap(true);}''')
        pg.evaluate('fresh'); pg.wait_for_timeout(850)
        check(pg.evaluate('store.reader().mapPlaces().every(p=>p.mode==="travel")'), 'cancelled/late food responses cannot overwrite the scenery map')
        # Same SDK/session path as the real app; all users and records are synthetic.
        pg.evaluate('(id)=>{__readActor=id;__sbLogin(id,"synthetic@example.invalid");}', config['owner'])
        pg.wait_for_function('store.me().id==="'+config['owner']+'"')
        pg.evaluate("setTab('foot')"); pg.wait_for_function('state.tab==="foot" && store.reader().ownReady()')
        check(pg.evaluate('store.reviews().filter(r=>r.authorId===me().id).length===10'), 'personal view loads all ten own visits, including five private visits')
        check(pg.evaluate('new Set(store.reviews().filter(r=>r.authorId===me().id).map(r=>r.placeId)).size===10'), 'global personal footprint counts stay complete')
        pg.evaluate('openMyShare()'); pg.wait_for_function('state.view==="share"')
        check(pg.evaluate('shareSnapshot(true).places===10 && shareSnapshot(false).places===5'), 'share image counts preserve public/private choices after lazy loading')
        pg.evaluate('(id)=>{__readActor=id;__sbLogin(id,"other-synthetic@example.invalid");}', config['peer'])
        pg.wait_for_function('store.me().id==="'+config['peer']+'"')
        check(pg.evaluate('(id)=>!store.reviews().some(r=>r.authorId===id&&r.visibility==="private")', config['owner']), 'changing account removes the previous identity’s private records')
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
        pg.evaluate("setTab('foot')");pg.wait_for_function('state.tab==="foot" && store.reader().ownReady()',timeout=45000)
        pg.evaluate("setMineView('both');render()")
        check(pg.evaluate('store.reviews().filter(r=>r.authorId===me().id).length===10045'), 'a large owner retains all 10,045 visits across server cursor pages')
        check(pg.locator('.feed > li').count()==80 and pg.locator('[data-action="read-own-more"]').count()==1, 'large personal lists render eighty rows at a time while keeping full totals')
        pg.click('[data-action="read-own-more"]');check(pg.locator('.feed > li').count()==160, 'personal load-more exposes the next rows without truncating the map')
        check(pg.evaluate('store.reader().metrics().p95>0 && store.reader().metrics().bytes>0'), 'local diagnostics expose bounded request latency and payload usage')
        check(not errors, 'no browser JavaScript errors: '+str(errors))
        stats = json.load(urllib.request.urlopen(endpoint + '/stats'))
        (ROOT/'tests/shots/bounded-client-results.json').write_text(json.dumps({'boot_seconds': elapsed, 'checks': checks, 'http': stats}, indent=2), encoding='utf8')
        ctx.close()
        late=browser.new_context(viewport={'width':390,'height':844})
        s['route_all'](late,True);late.route('http://127.0.0.1:*/**',lambda route:route.continue_())
        late.add_init_script(hook)
        def delayed_script(route):
            time.sleep(1)
            route.fulfill(body=(ROOT/'js/09-reads-ui.js').read_text(encoding='utf8'),content_type='application/javascript')
        late.route('**/js/09-reads-ui.js',delayed_script)
        lp=late.new_page();lp.goto(s['APP']);lp.wait_for_function('store.pagedReads()&&!state.bootLoading')
        check(lp.locator('[data-action="read-feed-more"]').count()==1,'a late UI module still installs pagination after boot finishes')
        late.close();browser.close()
    print(f'{checks}/{checks} bounded browser checks passed', flush=True)
finally:
    server.terminate()
    try: server.wait(timeout=8)
    except subprocess.TimeoutExpired: server.kill()
    log.close()
