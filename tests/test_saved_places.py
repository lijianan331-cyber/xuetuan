"""Real touch clicks, anonymous save, busy/failure recovery and both place-entry tabs."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');scope={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002'
seed={'profiles':[{'id':A,'name':'合成A'},{'id':B,'name':'合成B'}],'places':[
 {'id':'pub','mode':'food','cat':'other','precision':'exact','lat':2.83,'lng':101.70,'name':'合成公开店','created_by':B},
 {'id':'mine','mode':'food','cat':'other','precision':'exact','lat':2.84,'lng':101.71,'name':'合成私人店','created_by':A}], 'visits':[
 {'id':'public','user_id':B,'place_id':'pub','rating':4,'text':'公开','visibility':'public','created_at':'2026-11-02T08:00:00Z','photos':[]},
 {'id':'private','user_id':A,'place_id':'mine','rating':4,'text':'私人','visibility':'private','created_at':'2026-11-02T08:00:00Z','photos':[]}]}
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True)
 scope['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False))
 pg=c.new_page();pg.set_default_timeout(5000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(scope['APP']);pg.wait_for_function('store.place("pub")')
 pg.evaluate("setTab('explore');openPlace('pub');setSnap('full')");pg.locator('[data-action=toggle-save]').tap()
 pg.wait_for_function("store.isSaved('pub')")
 assert pg.get_attribute('[data-action=toggle-save]','aria-pressed')=='true'
 assert len(pg.evaluate("window.__sb.db.wishlist.filter(w=>w.place_id==='pub')"))==1
 print('PASS exploration touch save automatically creates an anonymous account and updates the button')
 pg.locator('[data-action=toggle-save]').tap();pg.wait_for_function("!store.isSaved('pub')")
 assert pg.get_attribute('[data-action=toggle-save]','aria-pressed')=='false'
 pg.evaluate("window.__sbLogin('"+A+"','synthetic@example.com')");pg.wait_for_timeout(300);pg.wait_for_function("!!store.place('mine')")
 pg.evaluate("setTab('foot');openPlace('mine');setSnap('full');window.__originalSetSaved=store.setSaved;window.__saveCount=0;store.setSaved=function(id,on){window.__saveCount++;return new Promise(resolve=>window.__releaseSave=()=>window.__originalSetSaved(id,on).then(resolve));};void 0")
 pg.locator('[data-action=toggle-save]').tap();pg.wait_for_function('window.__saveCount===1')
 assert pg.locator('[data-action=toggle-save]').is_disabled()
 assert '收藏中' in pg.inner_text('[data-action=toggle-save]')
 pg.dispatch_event('[data-action=toggle-save]','click')
 assert pg.evaluate('window.__saveCount')==1
 pg.evaluate('window.__releaseSave()');pg.wait_for_function("store.isSaved('mine')")
 assert pg.get_attribute('[data-action=toggle-save]','aria-pressed')=='true'
 print('PASS footprints save works for my private place and repeated taps produce one write')
 pg.evaluate("store.setSaved=function(){return Promise.reject(new Error('network offline'));};void 0")
 pg.locator('[data-action=toggle-save]').tap();pg.wait_for_function('document.querySelector("#toast").textContent.includes("没有保存成功")')
 assert not pg.locator('[data-action=toggle-save]').is_disabled()
 assert pg.get_attribute('[data-action=toggle-save]','aria-pressed')=='true'
 pg.evaluate('store.setSaved=window.__originalSetSaved;void 0')
 pg.locator('[data-action=toggle-save]').tap();pg.wait_for_function("!store.isSaved('mine')")
 assert pg.get_attribute('[data-action=toggle-save]','aria-pressed')=='false'
 assert not errors,errors
 print('PASS failure is visible, preserves saved state, releases the button and supports retry')
 b.close()
