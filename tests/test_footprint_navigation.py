"""Footprints, separate saved places and real filters. Synthetic users and places only."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');scope={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002'
seed={'profiles':[{'id':A,'name':'同学A'},{'id':B,'name':'同学B'}], 'places':[
 {'id':'mine','name':'已去过的店','mode':'food','cat':'cn','lat':2.832,'lng':101.703,'created_by':A},
 {'id':'want','name':'想去的店','mode':'food','cat':'cafe','lat':3.14,'lng':101.7,'created_by':B},
 {'id':'book','name':'去过的书店','mode':'travel','cat':'books','lat':3.14,'lng':101.7,'created_by':A}], 'visits':[
 {'id':'high','place_id':'mine','user_id':A,'rating':4,'price':12,'price_currency':'MYR','text':'自己的好评','visibility':'private','photos':[]},
 {'id':'low','place_id':'mine','user_id':A,'rating':1,'price':50,'price_currency':'MYR','text':'自己的低评','visibility':'private','photos':[]},
 {'id':'other','place_id':'want','user_id':B,'rating':5,'price':30,'text':'别人的记录','visibility':'public','photos':[]},
 {'id':'reading','place_id':'book','user_id':A,'rating':4,'text':'书店足迹','visibility':'private','photos':[]}], 'wishlist':[
 {'place_id':'mine','user_id':A},{'place_id':'want','user_id':A}]}
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 c=b.new_context(viewport={'width':370,'height':780},has_touch=True,is_mobile=True)
 scope['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False))
 pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(scope['APP']);pg.wait_for_function('typeof window.__sbLogin === "function"')
 pg.evaluate("window.__sbLogin('"+A+"','synthetic@example.com')");pg.wait_for_function("store.reviews().some(r=>r.id==='high')")
 pg.evaluate("setTab('foot');setMineView('food');setSnap('full')")
 assert pg.locator('.foot-mode-group [data-action=mine-mode]').count()==3
 assert pg.locator('.feed-item').count()==2
 assert pg.locator('#view [data-action=saved-want],#view [data-action=mine-sub]').count()==0
 assert '别人的记录' not in pg.inner_text('#view')
 pg.evaluate("setSnap('peek')");pg.wait_for_timeout(300)
 assert pg.locator('.foot-tools [data-action=open-favorites]').evaluate('(el)=>{let r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest("button")===el;}')
 before=pg.evaluate('JSON.stringify(window.__sb.db.visits)')
 pg.click('.foot-tools [data-action=open-favorites]')
 assert pg.inner_text('.view-title')=='我的收藏' and pg.locator('.saved-status [data-action=saved-want]').count()==3
 pg.click('.saved-status [data-v=want]');assert '想去的店' in pg.inner_text('#view') and '已去过的店' not in pg.inner_text('#view')
 pg.click('.saved-status [data-v=been]');assert '已去过的店' in pg.inner_text('#view') and '想去的店' not in pg.inner_text('#view')
 assert pg.evaluate('JSON.stringify(window.__sb.db.visits)')==before
 pg.screenshot(path=str(Path(scope['SHOTS'])/'43-saved-visited.png'))
 pg.click('#tabbar [data-tab=foot]');assert pg.evaluate('state.scope')=='mine'
 assert pg.get_attribute('#panel','data-snap')=='peek'
 pg.evaluate("setSnap('full')")
 print('PASS footprints contain only my visits; saved places independently filter want/been without creating visits; Footprints tab returns to visits')
 pg.click('[data-action=foot-filters]')
 assert pg.locator('#bsheet [data-action=cat]').count()>3 and pg.locator('#flt-price').is_visible()
 assert pg.locator('#bsheet [data-action=mine-sub],#bsheet [data-action=mine-mode],#bsheet [data-action=saved-want]').count()==0
 pg.wait_for_timeout(250);pg.screenshot(path=str(Path(scope['SHOTS'])/'44-real-footprint-filters.png'))
 pg.click('#bsheet [data-action=set-score][data-v="3"]')
 pg.evaluate("state.priceAbout=15;refilter()")
 pg.click('#bsheet [data-action=sheet-close]')
 assert pg.locator('.feed-item').count()==1 and '自己的好评' in pg.inner_text('#view')
 assert pg.evaluate("stats(placeById('mine')).score")==4
 pg.screenshot(path=str(Path(scope['SHOTS'])/'42-footprint-filters.png'))
 print('PASS advanced filters include real categories, distance and prices; mine uses the matching own visit rather than others or unmatched visits')
 pg.evaluate("setTab('explore')");assert pg.evaluate('state.minScore===0 && state.priceAbout===0')
 pg.evaluate("state.minScore=4;state.cat='cafe';setTab('foot')")
 assert pg.evaluate("state.minScore===3 && state.priceAbout===15 && state.cat==='all'")
 pg.evaluate("state.cat='all';state.minScore=0;state.priceAbout=0;state.dist='any';setMineView('travel');setSnap('full')")
 assert '去过的书店' in pg.inner_text('#view')
 pg.click('[data-action=foot-filters]');assert '书店阅读' in pg.inner_text('#bsheet-card')
 pg.click('#bsheet [data-action=sheet-close]')
 pg.evaluate("setTab('home')");assert pg.locator('.home-favorites[data-action=open-favorites]').is_visible()
 pg.click('.home-favorites');assert pg.evaluate('state.scope')=='saved'
 pg.keyboard.press('Escape');assert pg.evaluate("state.tab==='home' && state.scope==='all'")
 pg.evaluate("setTab('explore');openPlace('want');setSnap('full')")
 pg.click('[data-action=toggle-save]');pg.wait_for_function("!store.isSaved('want')")
 pg.click('[data-action=toggle-save]');pg.wait_for_function("store.isSaved('want') && document.querySelector('#toast').textContent.includes('点击星星')")
 pg.evaluate("setTab('foot');setLang('en');setSnap('full')")
 assert 'Things to do' in pg.inner_text('.foot-mode-group')
 assert pg.locator('.foot-tools').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
 print('PASS independent scope filters, bookstore category, home star, contextual back and compact English controls')
 assert pg.evaluate("googleTypesMode(['book_store'])==='travel' && googleTypesMode(['botanical_garden'])==='travel' && googleTypesMode(['art_gallery'])==='travel'")
 assert not errors,errors
 b.close()
