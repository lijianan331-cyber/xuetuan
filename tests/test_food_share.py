"""Food share summaries use own visits, deduplicate restaurants and keep private locations opt-in."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');scope={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002'
seed={'profiles':[{'id':A,'name':'同学A'},{'id':B,'name':'同学B'}],'places':[{'id':id,'mode':'food','cat':'other','name':id,'lat':lat,'lng':lng,'created_by':A} for id,lat,lng in [('kl',3.14,101.7),('private',2.83,101.7),('jp',35.6,139.7),('others',3.1,101.6)]],'visits':[
 {'id':id,'place_id':pid,'user_id':uid,'rating':r,'visibility':v,'photos':[]} for id,pid,uid,r,v in [('a','kl',A,2,'public'),('b','kl',A,4,'public'),('c','private',A,4.5,'private'),('d','jp',A,5,'public'),('e','others',B,5,'public')]]}
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':390,'height':800},has_touch=True);scope['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed));pg=c.new_page();pg.goto(scope['APP']);pg.wait_for_function('typeof window.__sbLogin==="function"');pg.evaluate("window.__sbLogin('"+A+"','synthetic@example.com')");pg.wait_for_function('window.__map && store.reviews().length===5')
 assert pg.evaluate('foodShareSnapshot(false,true).total')==1
 assert pg.evaluate('foodShareSnapshot(false,true).visits')==2
 assert pg.evaluate('foodShareSnapshot(false,true).points[0].rating')==3
 assert pg.evaluate('foodShareSnapshot(false,false).total')==2
 assert pg.evaluate('foodShareSnapshot(true,false).total')==3
 pg.evaluate("setTab('me');openMyShare()")
 pg.click('[data-v="food-world"]');pg.wait_for_function('shareCard.blob && !document.querySelector("[data-action=save-share-card]").disabled')
 assert pg.evaluate('shareCard.data.foodMap.total')==2
 pg.check('#share-private');assert pg.evaluate('shareCard.data.foodMap.total')==3
 assert pg.evaluate('!new URL(shareCard.url).searchParams.has("card")')
 pg.click('[data-v="stats"]');pg.check('#share-private');pg.click('[data-v="food-world"]');assert not pg.is_checked('#share-private')
 assert pg.locator('[data-v="atlas"]').count()==1
 assert pg.evaluate('foodRatingColor(0)!==foodRatingColor(null) && foodRatingColor(4)!==foodRatingColor(3)')
 pg.screenshot(path='tests/shots/food-world-card.png',full_page=True)
 print('PASS own visited restaurants only, deduplication, rating average, KL/world scope, private opt-in reset and image/link privacy')
 if os.environ.get('XUETUAN_REAL_MAP'):
  c.route('**/maplibre-gl.js',lambda r:r.continue_())
  c.route('https://tiles.openfreemap.org/**',lambda r:r.continue_())
  pg.add_script_tag(url='https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js')
  pg.evaluate('styleCache={};0')
  pg.click('[data-v="food-kl"]');pg.wait_for_function("foodMapImages['food-kl'] && shareCard.blob",timeout=30000)
  assert pg.evaluate("foodMapBounds['food-kl'] && foodMapBounds['food-kl'][0]<101.7 && foodMapBounds['food-kl'][2]>101.7")
  pg.locator('#share-canvas').screenshot(path='tests/shots/food-kl-real.png')
  pg.click('[data-v="food-xmum"]');pg.wait_for_function("foodMapImages['food-xmum'] && shareCard.blob",timeout=30000)
  assert pg.evaluate("shareCard.data.foodMap.total===0")
  pg.check('#share-private');assert pg.evaluate("shareCard.data.foodMap.total===1")
  pg.locator('#share-canvas').screenshot(path='tests/shots/food-xmum-real.png')
  print('PASS real KL and XMUM base maps export with independent cache and matching point projection')
 b.close()
