"""Synthetic profile camera, one-field posting, and own-review privacy controls."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');ns={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],ns)
A='aaaaaaaa-0000-4000-8000-000000000001'
places=[{'id':str(i),'created_by':A,'name':'合成地点'+str(i),'mode':'food','cat':'other','precision':'exact','lng':lng,'lat':lat} for i,(lng,lat) in enumerate([(114,22),(-79,44),(174,-41)])]
seed={'profiles':[{'id':A,'name':'合成同学','page_public':True}],'places':places,'visits':[{'id':'v'+str(i),'user_id':A,'place_id':str(i),'visibility':'public','rating':4,'text':'合成体验','photos':[],'created_at':'2026-10-01T00:00:00Z'} for i in range(3)]}
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True);ns['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False));pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(ns['APP']);pg.wait_for_function('!state.bootLoading');pg.evaluate('(id)=>window.__sbLogin(id,"synthetic@example.com")',A);pg.wait_for_function('(id)=>me().id===id',arg=A)
 pg.evaluate('(id)=>openPerson(id)',A);pg.wait_for_function('state.person&&state.person.globe')
 camera=pg.evaluate('window.__map.calls.filter(c=>c[0]==="move").at(-1)[1]')
 assert camera['center']==[120,20] and camera['bearing']==0 and camera['pitch']==0 and .85<=camera['zoom']<=1.4
 half=camera['padding']['bottom'];pg.evaluate("setSnap('peek')");camera=pg.evaluate('window.__map.calls.filter(c=>c[0]==="move").at(-1)[1]');assert camera['padding']['bottom']<half
 pg.evaluate("window.__map.jumpTo({center:[100,10]});setSnap('half')");camera=pg.evaluate('window.__map.calls.filter(c=>c[0]==="move").at(-1)[1]');assert camera['center']==[100,10]
 print('PASS global profile starts facing UTC+8, with upright camera and panel-aware padding; user rotation retained',flush=True)
 pg.evaluate("setTab('explore');openPlace('0');setSnap('full')");pg.locator('.review-visibility[data-id=v0]').click();pg.wait_for_function('store.review("v0").visibility==="private"&&!visibilityBusy')
 assert pg.locator('.review-visibility[data-id=v0]').count()==1 and pg.locator('.review-visibility[data-id=v0]').get_attribute('aria-checked')=='false'
 pg.locator('.review-visibility[data-id=v0]').click();pg.wait_for_function('store.review("v0").visibility==="public"&&!visibilityBusy')
 assert pg.evaluate('store.review("v0").text')=='合成体验';
 switch=pg.locator('.review-visibility[data-id=v0]')
 switch.dispatch_event('pointerdown',{'pointerId':1,'clientX':100,'clientY':100});pg.dispatch_event('body','pointerup',{'pointerId':1,'clientX':70,'clientY':100});pg.wait_for_function('store.review("v0").visibility==="private"&&!visibilityBusy')
 switch=pg.locator('.review-visibility[data-id=v0]');switch.dispatch_event('pointerdown',{'pointerId':2,'clientX':70,'clientY':100});pg.dispatch_event('body','pointerup',{'pointerId':2,'clientX':100,'clientY':100});pg.wait_for_function('store.review("v0").visibility==="public"&&!visibilityBusy')
 pg.locator('.review-visibility[data-id=v0]').dispatch_event('click');assert pg.evaluate('store.review("v0").visibility==="public"')
 assert pg.evaluate('(()=>{let a=document.querySelector("[data-action=del-review]").getBoundingClientRect(),b=document.querySelector(".review-visibility").getBoundingClientRect();return b.left>a.right&&Math.abs(b.top-a.top)<5})()')
 assert pg.evaluate('(()=>{let y=[...document.querySelectorAll(".stats .stat small")].map(e=>e.getBoundingClientRect().top);return Math.max(...y)-Math.min(...y)<1})()')
 pg.screenshot(path=str(Path(ns['SHOTS'])/'review-inline-public-switch.png'))
 print('PASS own review privacy toggles both ways without losing the review or text',flush=True)
 pg.evaluate("setTab('home');openPostComposer()");assert pg.locator('#f-text').count()==0
 assert pg.evaluate('document.querySelector("#f-photos").compareDocumentPosition(document.querySelector("#post-location"))&Node.DOCUMENT_POSITION_FOLLOWING')
 assert pg.evaluate('document.querySelector("#post-location").compareDocumentPosition(document.querySelector("#f-title"))&Node.DOCUMENT_POSITION_FOLLOWING')
 pg.locator('#f-title').fill('合成分享第一行\n第二行补充体验');pg.set_input_files('#f-file',ns['photo']);pg.wait_for_function('document.querySelector("#f-photos .ph-edit")&&!document.querySelector("#f-submit").disabled')
 pg.evaluate("captureFormDraft();state.form.placeId='0';state.form.rating=3.5;render()")
 assert pg.input_value('#f-title')=='合成分享第一行\n第二行补充体验'
 pg.screenshot(path=str(Path(ns['SHOTS'])/'post-composer-compact.png'));assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.locator('#f-submit').click();pg.wait_for_function('window.__sb.db.visits.some(v=>v.title==="合成分享第一行")')
 row=pg.evaluate('window.__sb.db.visits.find(v=>v.title==="合成分享第一行")');assert row['text']=='第二行补充体验' and row['rating']==3.5 and len(row['photos'])==1
 pg.evaluate('(id)=>startEdit(id)',row['id']);assert pg.input_value('#f-title')=='合成分享第一行\n第二行补充体验'
 print('PASS combined caption survives rerenders, publishes once and reopens with both parts intact; location is below photos',flush=True)
 assert not errors,errors;b.close()
