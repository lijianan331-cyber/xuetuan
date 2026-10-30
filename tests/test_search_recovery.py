"""Slow-network recovery without paid Google calls or production data."""
import ast,json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
source=Path(__file__).with_name('test_app.py').read_text(encoding='utf-8')
scope={'__file__':str(Path(__file__).with_name('test_app.py'))}
exec(source.split('with sync_playwright() as p:')[0],scope)
google=next(n.value.value for n in ast.walk(ast.parse(source)) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='STUB_GOOGLE' for t in n.targets))
google=google.replace('}, 30);','}, 16000);')
with sync_playwright() as p:
    b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
    c=b.new_context(viewport={'width':390,'height':844},user_agent='Mozilla/5.0 Chrome/130.0.0.0 Mobile MicroMessenger/8.0')
    scope['route_all'](c)
    c.route('**/maps.googleapis.com/**',lambda r:r.fulfill(status=200,body=google,headers={'Content-Type':'application/javascript'}))
    c.add_init_script('''const originalFetch=window.fetch;window.fetch=function(url,...args){if(String(url).includes('wikipedia.org'))return Promise.reject(new Error('offline'));if(String(url).includes('photon.komoot.io/api/')&&String(url).includes('q=late'))return new Promise(resolve=>setTimeout(()=>resolve(new Response('''+json.dumps(scope['PHOTON'])+''',{headers:{'Content-Type':'application/json'}})),4700));return originalFetch.call(this,url,...args);};''')
    pg=c.new_page();pg.goto(scope['APP']);pg.wait_for_function('window.__map && window.__map.getSource("places")')
    scope['tab'](pg,'explore');pg.click('[data-action="search"]');pg.fill('#q','late')
    pg.wait_for_selector('[data-action="search-retry"]',timeout=6000)
    pg.wait_for_selector('#search-results .near-item',timeout=2500)
    assert 'Kafe Ujian' in pg.inner_text('#search-results')
    print('PASS late place responses recover after the soft timeout without another request')
    pg.fill('#q','katsu');pg.wait_for_function('document.querySelector("#g-search").dataset.state==="slow"',timeout=18000)
    assert pg.locator('gmp-place-search').count()==1 and '浏览器中打开' in pg.inner_text('#g-search')
    print('PASS slow Google request keeps its component and shows WeChat browser guidance')
    pg.wait_for_function('document.querySelector("#g-search").dataset.state==="ready"',timeout=4000)
    assert pg.get_attribute('#g-search','data-n')=='1'
    print('PASS Google results arriving after 15 seconds still appear')
    b.close()
