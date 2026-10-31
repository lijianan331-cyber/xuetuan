"""Touch gallery and map clusters with synthetic photos, no live user data."""
import json,os,io
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
f=Path(__file__).with_name('test_app.py');scope={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002'
seed={'profiles':[{'id':A,'name':'同学A'},{'id':B,'name':'同学B'}], 'places':[
 {'id':'one','mode':'food','cat':'other','precision':'exact','lat':2.832,'lng':101.702,'name':'地点一','created_by':A},
 {'id':'two','mode':'food','cat':'other','precision':'exact','lat':2.832,'lng':101.702,'name':'地点二','created_by':B}], 'visits':[
 {'id':'r1','user_id':A,'place_id':'one','rating':4,'text':'第一条点评','visibility':'public','created_at':'2026-10-30T12:00:00Z','photos':[A+'/one.jpg',A+'/two.jpg']},
 {'id':'r2','user_id':B,'place_id':'two','rating':3,'text':'第二条点评','visibility':'public','created_at':'2026-10-30T12:00:00Z','photos':[B+'/three.jpg']},
 {'id':'private','user_id':B,'place_id':'two','rating':1,'text':'私人点评不可展示','visibility':'private','created_at':'2026-10-30T12:00:00Z','photos':[B+'/secret.jpg']}]}
def swipe(pg,x0,y0,x1,y1):
    c=pg.context.new_cdp_session(pg);c.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x0,'y':y0}]})
    for i in range(1,9):
        c.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x0+(x1-x0)*i/8,'y':y0+(y1-y0)*i/8}]});pg.wait_for_timeout(20)
    c.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});c.detach();pg.wait_for_timeout(100)
with sync_playwright() as p:
    b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
    ctx=b.new_context(viewport={'width':390,'height':720},device_scale_factor=2,has_touch=True,is_mobile=True)
    scope['route_all'](ctx,True);ctx.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False))
    fail={'second':True};requests=[]
    def photo(route):
        u=route.request.url;requests.append(u)
        assert '/secret' not in u,'private photo requested'
        if '/two.jpg?' in u and fail['second']:return route.fulfill(status=503,body='retry',headers={'Cache-Control':'no-store'})
        out=io.BytesIO();Image.new('RGB',(800,600),(90,160,190) if 'one' in u else (170,120,80)).save(out,'JPEG')
        route.fulfill(status=200,body=out.getvalue(),headers={'Content-Type':'image/jpeg','Cache-Control':'no-store'})
    ctx.route('https://example.invalid/storage/**',photo)
    pg=ctx.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(scope['APP']);pg.wait_for_selector('.post-card')
    scope['tab'](pg,'explore')
    pg.evaluate('''()=>{const m=window.__map;m.zoom=16;window.__qrf=[{layer:{id:'cl-circle'},properties:{cluster:true,cluster_id:7},geometry:{type:'Point',coordinates:[101.702,2.832]}},{layer:{id:'cl-photo'},properties:{id:'one',memberIds:'["one","two"]'},geometry:{type:'Point',coordinates:[101.702,2.832]}}];m.fire('click',{point:{x:150,y:250}});}''')
    pg.wait_for_function('!document.querySelector("#lightbox").hidden && document.querySelector("#lb-img").naturalWidth===800')
    assert pg.inner_text('#lb-count')=='1 / 3' and '地点一' in pg.inner_text('#lb-comment')
    assert pg.get_attribute('#panel','data-snap')=='full'
    print('PASS cluster cover opens every visible photo and matching review, with chooser fully expanded')
    assert pg.locator('#lb-next').evaluate('(b)=>{let r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2).closest("button")===b;}')
    pg.click('#lb-next');pg.wait_for_selector('#lb-retry',state='visible')
    assert pg.inner_text('#lb-count')=='2 / 3'
    print('PASS failed second photo has an explicit retry and remains navigable')
    pg.click('#lb-next');pg.wait_for_function('document.querySelector("#lb-img").complete && document.querySelector("#lb-img").naturalWidth>0 && document.querySelector("#lb-status").hidden')
    assert pg.inner_text('#lb-count')=='3 / 3' and '地点二' in pg.inner_text('#lb-comment')
    pg.click('#lb-prev');pg.wait_for_selector('#lb-retry',state='visible');fail['second']=False
    pg.click('#lb-retry');pg.wait_for_function('document.querySelector("#lb-status").hidden')
    assert pg.inner_text('#lb-count')=='2 / 3'
    print('PASS retry reloads the selected photo with renewed authorization')
    swipe(pg,280,300,90,300);assert pg.inner_text('#lb-count')=='3 / 3' and pg.is_visible('#lightbox')
    swipe(pg,90,300,280,300);assert pg.inner_text('#lb-count')=='2 / 3'
    swipe(pg,190,300,190,400);assert pg.inner_text('#lb-count')=='2 / 3'
    print('PASS native phone left/right swipes change photos; vertical motion does not')
    pg.keyboard.press('ArrowRight');assert pg.inner_text('#lb-count')=='3 / 3'
    pg.screenshot(path=str(Path(scope['SHOTS'])/'29-gallery-navigation.png'))
    pg.click('[data-action="lb-close"]');pg.evaluate('window.__qrf=[]')
    rows=pg.locator('.cluster-list [data-action="open-place"]');assert rows.count()==2 and rows.nth(0).is_visible() and rows.nth(1).is_visible()
    pg.screenshot(path=str(Path(scope['SHOTS'])/'30-cluster-chooser.png'))
    pg.click('[data-action="cluster-photos"]');assert pg.inner_text('#lb-count')=='1 / 3'
    pg.click('[data-action="lb-close"]');rows.first.click();assert pg.locator('.place-head').count()==1
    assert not errors,errors
    print('PASS chooser can reopen all photos or select an original place, without private media or script errors')
    b.close()
