"""Synthetic full photo frames and compact review details on a phone."""
import json,base64,io
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001'
seed={'profiles':[{'id':A,'name':'合成同学','page_public':True}], 'places':[{'id':'p','mode':'food','cat':'other','cc':'MY','lat':2.83,'lng':101.70,'name':'合成餐厅','created_by':A}], 'visits':[{'id':'r','place_id':'p','user_id':A,'rating':3,'price':16,'price_currency':'MYR','text':'还行能吃，合成评价。','visibility':'public','created_at':'2025-10-08T00:00:00Z','photos':['portrait']}]}
photos={}
for name,size in [('portrait',(400,700)),('landscape',(800,400))]:
 im=Image.new('RGB',size,'#4d91ba');im.paste('#f0bd77',(0,0,size[0]//2,size[1]//2));out=io.BytesIO();im.save(out,format='JPEG');photos[name]='data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':370,'height':780},has_touch=True,is_mobile=True);s['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False));pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading');pg.evaluate('(photos)=>{store.photoURL=id=>Promise.resolve(photos[id]);setTab("home");openPost("r");}',photos);pg.wait_for_function('document.querySelector(".post-gallery img").naturalWidth>0')
 assert pg.evaluate('getComputedStyle(document.querySelector(".post-gallery img")).objectFit==="contain"')
 assert pg.locator('.post-gallery .photo-date').count()==0
 assert pg.locator('.post-actions [data-action=social-focus]').count()==0 and pg.locator('#social-body').count()==1
 assert 'RM 16' in pg.inner_text('.post-score') and '人均' not in pg.inner_text('.post-score') and 'MYR' not in pg.inner_text('.post-score')
 assert pg.inner_text('.post-date')=='2025-10-08' and pg.locator('.post-who small').count()==0
 gap=pg.evaluate('(()=>{let a=document.querySelector(".post-gallery").getBoundingClientRect(),b=document.querySelector(".post-who").getBoundingClientRect();return b.top-a.bottom})()');assert 10<=gap<=18,gap
 assert pg.evaluate('(()=>{let els=[...document.querySelector(".post-body").children];return els.slice(1).every((e,i)=>{let d=e.getBoundingClientRect().top-els[i].getBoundingClientRect().bottom;return d>=8&&d<=12})})()')
 pg.evaluate('document.querySelector("#toast").hidden=true');pg.screenshot(path=str(Path(s['SHOTS'])/'post-detail-clean-portrait.png'))
 pg.locator('.post-gallery img').tap();pg.wait_for_function('!document.querySelector("#lightbox").hidden');pg.locator('[data-action=lb-close]').tap()
 pg.evaluate('store.review("r").photos=["landscape","portrait"];render()');pg.wait_for_function('[...document.querySelectorAll(".post-gallery img")].every(i=>i.naturalWidth>0)')
 assert pg.locator('.post-gallery .ph').count()==2 and pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
 pg.locator('.post-gallery img').first.tap();pg.wait_for_function('!document.querySelector("#lightbox").hidden');assert pg.inner_text('#lb-count')=='1 / 2';pg.locator('#lb-next').tap();assert pg.inner_text('#lb-count')=='2 / 2';pg.locator('[data-action=lb-close]').tap()
 pg.screenshot(path=str(Path(s['SHOTS'])/'post-detail-clean-landscape.png'))
 assert not errors,errors;print('PASS phone portrait/landscape photos contain the full image; dates removed from gallery; original date beside rating; even body spacing; RM price; duplicate comment action removed; gallery and comments remain usable');b.close()
