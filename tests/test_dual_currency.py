"""Synthetic multi-currency prices: input, mixed averages, display toggles and persistence."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');scope={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
A='aaaaaaaa-0000-4000-8000-000000000001'
seed={'profiles':[{'id':A,'name':'合成同学','page_public':True}], 'places':[
 {'id':'jp','mode':'food','cat':'other','precision':'exact','lat':35.68,'lng':139.76,'name':'合成日本店','cc':'JP','created_by':A},
 {'id':'cn','mode':'food','cat':'other','precision':'exact','lat':31.2,'lng':121.4,'name':'合成上海店','cc':'CN','created_by':A}], 'visits':[
 {'id':'local','user_id':A,'place_id':'jp','rating':4,'price':2000,'price_currency':'JPY','text':'原始日元点评','visibility':'public','created_at':'2026-11-02T08:00:00Z','photos':[A+'/synthetic.jpg']},
 {'id':'rm','user_id':A,'place_id':'jp','rating':4,'price':52,'price_currency':'MYR','text':'原始马币点评','visibility':'public','created_at':'2026-11-02T08:01:00Z','photos':[A+'/synthetic2.jpg']}]}
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 c=b.new_context(viewport={'width':390,'height':780},device_scale_factor=2,has_touch=True)
 scope['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False))
 c.route('https://example.invalid/storage/**',lambda r:r.fulfill(status=200,body=Path(scope['photo']).read_bytes(),content_type='image/jpeg'))
 pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(scope['APP']);pg.wait_for_selector('.post-card')
 before=pg.evaluate('JSON.stringify(window.__sb.db.visits)')
 button=pg.locator('[data-price-key="r:local"]').first
 assert '约 MYR 52' in button.inner_text(),button.inner_text()
 button.click();assert 'JPY 2000' in pg.locator('[data-price-key="r:local"]').first.inner_text()
 assert pg.evaluate('state.view')=='feed'
 pg.locator('[data-price-key="r:local"]').first.press('Enter')
 assert '约 MYR 52' in pg.locator('[data-price-key="r:local"]').first.inner_text()
 assert pg.evaluate('JSON.stringify(window.__sb.db.visits)')==before
 assert pg.locator('button button').count()==0
 pg.screenshot(path=str(Path(scope['SHOTS'])/'40-home-price-toggle.png'))
 print('PASS homepage prices switch with mouse and keyboard without opening posts, nesting buttons or writing records')
 pg.evaluate("setTab('explore');openPlace('jp')")
 avg=pg.locator('[data-price-key="avg:jp"]');assert 'MYR 52' in avg.inner_text(),avg.inner_text()
 avg.click();assert '约 JPY 2000' in pg.locator('[data-price-key="avg:jp"]').inner_text()
 assert pg.evaluate("Math.abs(stats(placeById('jp')).avgPrice - 52)<.00001")
 assert pg.evaluate("priceRM(placeById('jp'),stats(placeById('jp')).avgPrice)")==52
 print('PASS mixed MYR/JPY records average and filter in one unit; exploration prices convert independently')
 for cc,unit in [('JP','JPY'),('KR','KRW'),('TH','THB'),('ID','IDR'),('TW','TWD')]:
  pg.evaluate("cc=>{ccCache.set(ccKey(10,80),cc);startNewPlace({lat:10,lng:80},{name:'合成店'});}",cc)
  assert pg.input_value('#f-price-currency')=='MYR'
  assert pg.locator('#f-price-currency option').evaluate_all('(xs)=>xs.map(x=>x.value)')==['MYR',unit]
 print('PASS Japan/Korea/Thailand/Indonesia/Taiwan default to MYR with exactly one optional local currency')
 pg.evaluate("ccCache.set(ccKey(10,80),'ID');startNewPlace({lat:10,lng:80},{name:'合成店'})")
 pg.fill('#f-price','200000');pg.fill('#f-text','保留输入');pg.select_option('#f-price-currency','IDR')
 assert pg.input_value('#f-price')=='200000' and pg.input_value('#f-text')=='保留输入'
 pg.screenshot(path=str(Path(scope['SHOTS'])/'41-form-price-currency.png'))
 pg.evaluate("window.__sbLogin('"+A+"','synthetic@example.com')");pg.wait_for_timeout(300)
 pg.evaluate("startEdit('local')");pg.wait_for_selector('#f-price')
 assert pg.input_value('#f-price-currency')=='JPY' and pg.input_value('#f-price')=='2000'
 pg.fill('#f-text','修改点评保持日元');pg.click('#f-submit');pg.wait_for_function('state.view!=="form"')
 assert pg.evaluate("window.__sb.db.visits.find(r=>r.id==='local').price_currency")=='JPY'
 pg.reload();pg.wait_for_function('store.review("local")')
 assert pg.evaluate("store.review('local').priceCurrency")=='JPY'
 print('PASS selected unit preserves typed values, edit/save/readback keeps the original currency')
 pg.evaluate("ccCache.set(ccKey(31.2,121.4),'CN');startNewPlace({lat:31.2,lng:121.4},{name:'合成上海店'})");assert pg.input_value('#f-price-currency')=='CNY'
 assert pg.locator('#f-price-currency option').evaluate_all('(xs)=>xs.map(x=>x.value)')==['MYR','CNY']
 assert pg.locator('#f-price-currency option:checked').inner_text()=='RMB'
 pg.evaluate("ccCache.set(ccKey(10,80),'ID');state.view='bulk';state.form=null;state.bulk={groups:[{i:0,mode:'food',pick:-1,plat:10,plng:80,price:null,comment:''}]};view.innerHTML=bulkCommentHTML(state.bulk.groups[0])")
 assert pg.input_value('[data-bk-currency="0"]')=='MYR'
 pg.select_option('[data-bk-currency="0"]','IDR');pg.fill('[data-bk-price="0"]','200000')
 assert pg.evaluate('state.bulk.groups[0].price')==200000
 assert pg.evaluate('state.bulk.groups[0].priceCurrency')=='IDR'
 assert pg.locator('[data-bk-price="0"]').evaluate('(el)=>el.checkValidity()')
 print('PASS existing CNY default stays local; batch imports accept optional local currencies and large rupiah amounts')
 assert not errors,errors
 b.close()
