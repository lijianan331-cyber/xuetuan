"""Compact Me, accessible edit entry, private account details and readable share maps."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001'
seed={'profiles':[{'id':A,'name':'合成同学'}],'places':[{'id':str(i),'mode':'food','cat':'other','name':'合成餐厅'+str(i),'lat':3.14+i*.0001,'lng':101.70,'created_by':A} for i in range(3)],'visits':[{'id':'v'+str(i),'place_id':str(i),'user_id':A,'rating':4,'visibility':'public','photos':[]} for i in range(3)]}
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':390,'height':820},has_touch=True,is_mobile=True);s['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed))
 pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading');pg.evaluate("window.__sbLogin('"+A+"','synthetic@example.com')");pg.wait_for_function('me().id==="'+A+'"');pg.evaluate("setTab('me')")
 assert pg.locator('#pf-name,[data-style=dark]').count()==0 and pg.locator('.me-headrow .me-lang [data-action=set-lang]').count()==2
 assert pg.locator('#me-name .me-pencil svg').count()==1
 assert 'synthetic@example.com' not in pg.inner_text('#view') and 'sy***@example.com' in pg.inner_text('.me-account') and pg.locator('.me-account [data-action=logout]').count()==1
 pg.locator('.me-edit').click();pg.fill('#pf-dialog-name','新昵称');pg.locator('#profile-form button[type=submit]').click();pg.wait_for_function('me().name==="新昵称"')
 pg.evaluate('view.scrollTop=0');pg.screenshot(path='tests/shots/me-compact.png')
 assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.locator('[data-action=my-share]').click();assert pg.locator('[data-action=share-theme]').last.get_attribute('data-v')=='stats'
 pg.click('[data-v=food-world]');pg.wait_for_function('shareCard.blob')
 assert pg.evaluate('shareCard.data.foodMap.total')==3
 pg.locator('#share-canvas').screenshot(path='tests/shots/food-map-readable.png')
 assert not errors,errors
 print('PASS compact settings, hidden account info, pencil edit, no duplicate controls, map theme order and preserved counts')
 b.close()
