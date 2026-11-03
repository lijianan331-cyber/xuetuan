"""Managed identity switch: native touch, separate data/admin rights, cached sessions, failed recovery."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002';C='cccccccc-0000-4000-8000-000000000003'
main={'user':{'id':A,'email':'lijianan331@gmail.com','email_confirmed_at':'2026-11-03','is_anonymous':False,'app_metadata':{}},'access_token':'main-access','refresh_token':'main-refresh'}
alt={'user':{'id':B,'email':'xuetuan-alt+'+A+'@accounts.xuetuan.invalid','email_confirmed_at':'2026-11-03','is_anonymous':False,'app_metadata':{'xuetuan_managed_alt':True,'xuetuan_owner':A}},'access_token':'alt-access','refresh_token':'alt-refresh'}
seed={'profiles':[{'id':A,'name':'主号昵称'},{'id':B,'name':'lijianan331的小号'},{'id':C,'name':'别人'}],
'places':[{'id':'main-place','mode':'food','cat':'other','precision':'exact','lat':2.83,'lng':101.70,'name':'主号私密店','created_by':A},{'id':'alt-place','mode':'food','cat':'other','precision':'exact','lat':2.84,'lng':101.71,'name':'小号私密店','created_by':B},{'id':'public-place','mode':'food','cat':'other','precision':'exact','lat':2.85,'lng':101.72,'name':'公开合成店','created_by':C}],
'visits':[{'id':i,'user_id':u,'place_id':p,'rating':4,'text':i,'visibility':v,'created_at':'2026-11-03T01:00:00Z','photos':[]} for i,u,p,v in [('main-private',A,'main-place','private'),('alt-private',B,'alt-place','private'),('public',C,'public-place','public')]]}
n=0
def check(name,ok):
 global n
 assert ok,name
 n+=1;print('PASS '+name,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True);s['route_all'](c,True)
 c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False)+';window.__sbAdmin="'+A+'";window.__identitySessions={"main-refresh":'+json.dumps(main)+',"alt-refresh":'+json.dumps(alt)+'};')
 pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading')
 pg.evaluate("sbClient.auth.setSession(window.__identitySessions['main-refresh']);window.__identityEdge=function(){return Promise.resolve({data:{owner_id:'"+A+"',user_id:'"+B+"',session:{access_token:'alt-access',refresh_token:'alt-refresh'}},error:null});};void 0")
 pg.wait_for_function('me().id==="'+A+'"&&isModerator()');pg.evaluate("setTab('me')");pg.wait_for_selector('[data-action=identity-switch]')
 check('verified owner gets a switch in Me', '当前：主号' in pg.inner_text('.identity-card'))
 check('main sees only its own private records',pg.evaluate('!!store.review("main-private")&&!store.review("alt-private")'))
 pg.locator('[data-action=identity-switch]').tap();pg.wait_for_function('me().id==="'+B+'"&&!identitySwitching');pg.wait_for_selector('.identity-card')
 check('switch activates a distinct account and nickname',pg.evaluate('me().name==="lijianan331的小号"'))
 check('second identity has no administrator privileges',not pg.evaluate('isModerator()') and pg.locator('[data-action=social-reports]').count()==0)
 check('second identity private records are separate',pg.evaluate('!!store.review("alt-private")&&!store.review("main-private")'))
 check('internal login address is not exposed in the interface','accounts.xuetuan.invalid' not in pg.inner_text('#view'))
 pg.evaluate("openPost('public')");pg.wait_for_selector('[data-action=social-like]:enabled');pg.locator('[data-action=social-like]').tap();pg.wait_for_function('socialPanel.data.liked')
 check('likes use the second identity, not the main account',pg.evaluate('window.__sb.db.social_likes[0].user_id==="'+B+'"'))
 pg.evaluate("store.updateProfile({name:'小号新昵称'});setTab('me');void 0");pg.wait_for_function('me().name==="小号新昵称"')
 pg.locator('[data-action=identity-switch]').tap();pg.wait_for_function('me().id==="'+A+'"&&!identitySwitching&&isModerator()')
 check('switching back restores the main name and admin tools',pg.evaluate('me().name==="主号昵称"') and pg.locator('[data-action=social-reports]').count()==1)
 check('main draft and second draft use different keys',pg.evaluate('draftKey().endsWith(":'+A+'")'))
 pg.locator('[data-action=identity-switch]').tap();pg.wait_for_function('me().id==="'+B+'"&&!identitySwitching')
 check('repeat switching reuses the same linked identity/session',pg.evaluate('window.__sb.calls.filter(c=>c[0]==="function").length')==1)
 check('second nickname stays independent across switches',pg.evaluate('me().name==="小号新昵称"'))
 pg.evaluate("var k=IDENTITY_PREFIX+'"+A+":main',d=JSON.parse(localStorage.getItem(k));d.refresh_token='expired';localStorage.setItem(k,JSON.stringify(d));")
 pg.locator('[data-action=identity-switch]').tap();pg.wait_for_function('!identitySwitching&&document.querySelector("#toast").textContent.includes("过期")')
 check('expired main session keeps the active second identity and offers recovery',pg.evaluate('me().id==="'+B+'"') and pg.locator('.identity-card [data-action=login-google]').count()==1)
 pg.evaluate("document.querySelector('#toast').hidden=true")
 pg.locator('.identity-card').scroll_into_view_if_needed();pg.screenshot(path=str(Path(s['SHOTS'])/'managed-alt-mobile.png'))
 pg.locator('[data-action=logout]').tap();pg.wait_for_function('!me().id')
 check('logout clears both locally retained identity sessions',pg.evaluate('Object.keys(localStorage).every(k=>!k.startsWith(IDENTITY_PREFIX))'))
 pg.evaluate("window.__sbLogin('"+C+"','other@example.com',{email_confirmed_at:'2026-11-03'})");pg.wait_for_function('me().id==="'+C+'"');pg.wait_for_timeout(100)
 check('other accounts never get owner identity controls',pg.locator('[data-action=identity-switch]').count()==0)
 check('mobile layout and runtime remain clean',not errors and pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 print(f'{n}/{n} managed identity browser checks passed');b.close()
