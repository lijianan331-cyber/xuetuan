"""Synthetic edit timestamps, individual photo dates, categories and long translations."""
import json,os,datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001'
def b36(n):
 out=''
 while n:n,r=divmod(n,36);out='0123456789abcdefghijklmnopqrstuvwxyz'[r]+out
 return out
first=1760000000000;second=1761000000000
ids=[A+'/ph-'+b36(t)+'abcde.jpg' for t in [first,second]]
seed={'profiles':[{'id':A,'name':'合成同学'}],'places':[{'id':'p','created_by':A,'name':'合成风景','mode':'travel','cat':'nature','precision':'exact','lat':2.83,'lng':101.7}], 'visits':[{'id':'r','place_id':'p','user_id':A,'rating':4,'text':'合成评价','photos':ids,'visibility':'public','created_at':'2025-01-01T00:00:00Z','updated_at':'2026-11-03T08:00:00Z'}]}
n=0
def check(label,ok):
 global n
 assert ok,label
 n+=1;print('PASS '+label,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':370,'height':780},has_touch=True,is_mobile=True);s['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False));pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading');pg.evaluate('(id)=>__sbLogin(id,"synthetic@example.com")',A);pg.wait_for_function('(id)=>me().id===id',arg=A)
 check('historical text edit timestamp does not promote record',pg.evaluate('reviewActivityAt(store.review("r"))')==second)
 before=pg.evaluate('reviewTimeLabel(store.review("r"))')
 pg.evaluate("async()=>{const r=store.review('r');await store.updateReview(r.id,{rating:3,text:'修改评论',visibility:'public'},r.photos.slice(),[]);}")
 check('score and caption edit keeps original display time',pg.evaluate('reviewTimeLabel(store.review("r"))')==before)
 pg.evaluate("async()=>{const r=store.review('r');await store.updateReview(r.id,{rating:3,text:'修改评论',visibility:'public'},r.photos.slice(),[{id:uid('ph'),blob:new Blob(['synthetic'],{type:'image/jpeg'})}]);}")
 check('appending a photo advances displayed activity',pg.evaluate('Date.now()-reviewActivityAt(store.review("r"))<10000'))
 pg.evaluate("setTab('explore');openPlace('p');setSnap('full')")
 dates=pg.locator('.hero-slide .photo-date').all_text_contents();check('each image shows its own stable date',len(dates)==3 and dates[0]!=dates[1])
 pg.locator('.hero-slide').first.tap();pg.wait_for_function('!document.querySelector("#lightbox").hidden');check('viewer includes current image date',pg.inner_text('#lb-comment').startswith('添加 '));pg.locator('[data-action=lb-close]').tap()
 pg.evaluate("state.mode='food';startEdit('r')");check('scenery editing never inherits food categories',not any(x in pg.locator('[data-action=f-cat]').all_text_contents() for x in ['中餐','日式','日料']) and pg.locator('[data-action=f-cat]').count()>0 and pg.locator('#f-price').count()==0)
 pg.screenshot(path=str(Path(s['SHOTS'])/'scenery-edit-categories.png'))
 pg.evaluate("state.form=null;state.posting=false;setTab('home')")
 for lang in ['kk','id','en','zh']:
  pg.locator('.home-lang').tap();pg.wait_for_selector('#bsheet:not([hidden])');pg.locator('[data-action=pick-lang][data-lang='+lang+']').tap();pg.wait_for_timeout(150)
  check(lang+' ENG stays compact and all controls fit',pg.inner_text('.home-lang')=='ENG' and pg.evaluate('document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".home-filter-row button")].every(b=>b.getBoundingClientRect().right<=innerWidth&&b.getBoundingClientRect().left>=0)'))
  pg.locator('[data-action=home-filters]').tap();check(lang+' filter popover stays inside screen',pg.evaluate('(()=>{let b=document.querySelector("#home-filter-panel").getBoundingClientRect();return b.left>=0&&b.right<=innerWidth})()'));pg.locator('[data-action=home-filters]').tap()
  if lang=='kk':pg.screenshot(path=str(Path(s['SHOTS'])/'home-kazakh-fit.png'))
 check('no runtime errors',not errors);print(f'{n}/{n} edit/date/layout checks passed');b.close()
