"""OAuth collision recovery and guest-session preservation. Synthetic sessions; no Google/cloud writes."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001';G='eeeeeeee-0000-4000-8000-000000000004'
seed={'profiles':[{'id':A,'name':'合成老账号'},{'id':G,'name':'合成游客'}],
 'places':[{'id':'guest-place','name':'合成游客地点','mode':'food','cat':'other','lat':2.83,'lng':101.70,'created_by':G}],
 'visits':[{'id':'guest-visit','place_id':'guest-place','user_id':G,'rating':4,'visibility':'private','text':'游客记录保留','photos':[]}]}
extra='''
window.__identitySessions={};
for(const [id,guest,key] of [['GUEST',true,'guest-refresh'],['MAIN',false,'main-refresh']])window.__identitySessions[key]={access_token:'fixture-'+id,refresh_token:key,user:{id,email:guest?'':'synthetic@example.com',is_anonymous:guest,email_confirmed_at:guest?null:'2026-11-03'}};
const create=window.supabase.createClient;
window.supabase.createClient=function(...args){const c=create(...args);if(args[2]&&args[2].auth&&args[2].auth.persistSession===false)return c;
 const get=c.auth.getSession;c.auth.getSession=()=>get().then(r=>{const sess=r.data&&r.data.session;if(sess){const fixture=Object.values(window.__identitySessions).find(v=>v.user.id===sess.user.id);if(fixture){sess.access_token=fixture.access_token;sess.refresh_token=fixture.refresh_token;}}return r;});
 c.auth.signInWithOAuth=o=>{window.__lastOAuth=o;window.__sb.calls.push(['oauth',o.provider]);return window.__holdOAuth?new Promise(resolve=>window.__finishOAuth=()=>resolve({data:{},error:null})):Promise.resolve({data:{},error:null});};return c;};
window.__sbLogin('GUEST','',{is_anonymous:true});
'''.replace('GUEST',G).replace('MAIN',A)
n=0
def check(name,ok):
 global n
 assert ok,name
 n+=1;print('PASS '+name,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 def context():
  c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True,user_agent='Mozilla/5.0 Mobile MicroMessenger/8.0')
  s['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False))
  c.route('https://cdn.jsdelivr.net/npm/@supabase/**',lambda r:r.fulfill(body=s['STUB_SB']+'\n'+extra,content_type='application/javascript'))
  return c
 c=context();pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.set_default_timeout(6000)
 url=s['APP']+'?_vercel_share=public_test_token_123456789&unrelated=discard#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user'
 pg.goto(url);pg.wait_for_function('!state.bootLoading&&me().id==="'+G+'"');pg.wait_for_selector('#modal:not([hidden])')
 check('Google identity collision becomes a visible recovery dialog','这个 Google 已有雪团账号' in pg.inner_text('#modal'))
 check('failed callback leaves the guest and its private records intact',pg.evaluate('isGuest()&&store.reviews().some(r=>r.id==="guest-visit")'))
 check('OAuth error parameters are removed while share token survives',pg.evaluate('!location.hash&&!location.search.includes("error")&&location.search.includes("_vercel_share")'))
 check('failed linking never loops or automatically starts a new login',pg.evaluate('__sb.calls.filter(c=>c[0]==="oauth"||c[0]==="link").length===0'))
 check('WeChat-specific browser guidance is shown','在浏览器打开' in pg.inner_text('#modal'))
 pg.evaluate('window.__holdOAuth=true');pg.locator('#modal [data-action=login-google]').tap();pg.wait_for_function('!!window.__lastOAuth')
 backup=pg.evaluate('JSON.parse(localStorage.getItem(AUTH_GUEST_KEY))')
 check('existing-account login uses OAuth instead of linking',pg.evaluate('__sb.calls.filter(c=>c[0]==="oauth").length===1&&!__sb.calls.some(c=>c[0]==="link")'))
 check('guest session is preserved before leaving for Google',backup['uid']==G and backup['refresh_token']=='guest-refresh')
 check('callback URL retains only the share token',pg.evaluate('__lastOAuth.options.redirectTo.includes("_vercel_share=public_test_token_123456789")&&!__lastOAuth.options.redirectTo.includes("unrelated")&&!__lastOAuth.options.redirectTo.includes("#")'))
 pg.dispatch_event('#modal [data-action=login-google]','click');check('repeat taps cannot create overlapping OAuth redirects',pg.evaluate('__sb.calls.filter(c=>c[0]==="oauth").length===1'))
 pg.evaluate('window.__holdOAuth=false;window.__finishOAuth()');pg.wait_for_function('!authSigninBusy');pg.locator('[data-modal=no]').tap()
 pg.evaluate('window.__sbLogin("'+A+'","synthetic@example.com")');pg.wait_for_function('me().id==="'+A+'"');pg.evaluate("setTab('me')")
 check('signed-in account shows a way back to guest records',pg.locator('[data-action=auth-return-guest]').count()==1)
 check('guest records are never silently merged into the existing account',pg.evaluate('!store.reviews().some(r=>r.id==="guest-visit")'))
 pg.locator('[data-action=auth-return-guest]').tap();pg.wait_for_function('me().id==="'+G+'"&&!authReturningGuest')
 check('returning guest validates the session and restores its own records',pg.evaluate('isGuest()&&store.reviews().some(r=>r.id==="guest-visit")'))
 check('guest restore consumes its backup pointer',pg.evaluate('!localStorage.getItem(AUTH_GUEST_KEY)'))
 check('guest account clearly offers separate existing-login and linking actions',pg.locator('.auth-guest [data-action=login-google]').count()==1 and pg.locator('.auth-guest [data-action=link-google]').count()==1)
 pg.locator('.auth-guest [data-action=link-google]').tap();pg.wait_for_function('__sb.calls.filter(c=>c[0]==="link").length===1')
 check('linking still calls linkIdentity to keep the same guest ID',pg.evaluate('me().id==="'+G+'"'))
 check('linking also preserves a way back if Google returns an error',pg.evaluate('JSON.parse(localStorage.getItem(AUTH_GUEST_KEY)).uid==="'+G+'"'))
 pg.evaluate('window.__sbLogin("'+G+'","bound@example.com",{is_anonymous:false})');pg.wait_for_selector('.account-row [data-action=logout]')
 check('binding the same UUID refreshes the UI to the bound account',pg.evaluate('!isGuest()&&store.review("guest-visit").authorId===me().id'))
 check('successful same-UUID binding clears the obsolete guest backup',pg.evaluate('!localStorage.getItem(AUTH_GUEST_KEY)'))
 # Failed or forged recovery must leave the logged-in account untouched.
 pg.evaluate('localStorage.setItem(AUTH_GUEST_KEY,JSON.stringify({uid:"'+G+'",access_token:"fixture",refresh_token:"expired"}));window.__sbLogin("'+A+'","synthetic@example.com")');pg.wait_for_function('me().id==="'+A+'"');pg.locator('[data-action=auth-return-guest]').tap();pg.wait_for_function('!authReturningGuest')
 check('expired guest recovery keeps the current account',pg.evaluate('me().id==="'+A+'"'))
 pg.evaluate('localStorage.setItem(AUTH_GUEST_KEY,JSON.stringify({uid:"'+G+'",access_token:"fixture",refresh_token:"main-refresh"}));render()');pg.locator('[data-action=auth-return-guest]').tap();pg.wait_for_function('!authReturningGuest')
 check('a non-guest session cannot masquerade as guest recovery',pg.evaluate('me().id==="'+A+'"'))
 pg.locator('[data-action=logout]').tap();pg.wait_for_function('!me().id');check('explicit logout clears the saved guest credentials',pg.evaluate('!localStorage.getItem(AUTH_GUEST_KEY)'))
 # Saving must succeed before switching away; never discard a guest when storage is blocked.
 pg.evaluate('window.__sbLogin("'+G+'","",{is_anonymous:true})');pg.wait_for_function('me().id==="'+G+'"')
 pg.evaluate("window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===AUTH_GUEST_KEY)throw Error('blocked');return window.__storageSet.call(this,k,v);};void 0")
 before=pg.evaluate('__sb.calls.filter(c=>c[0]==="oauth").length');pg.locator('.auth-guest [data-action=login-google]').tap();pg.wait_for_function('!authSigninBusy&&document.querySelector("#toast").textContent.includes("存储")')
 check('blocked storage prevents OAuth and keeps the guest session',pg.evaluate('isGuest()&&__sb.calls.filter(c=>c[0]==="oauth").length')==before)
 pg.evaluate('Storage.prototype.setItem=window.__storageSet;document.querySelector("#toast").hidden=true;void 0');pg.screenshot(path=str(Path(s['SHOTS'])/'google-login-guest.png'))
 check('guest account controls fit a narrow phone',pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 check('no runtime errors',not errors)
 c.close()
 c=context();pg=c.new_page();pg.goto(s['APP']+'#error=access_denied&error_description=%3Cimg+src=x+onerror=alert(1)%3E');pg.wait_for_selector('#modal:not([hidden])')
 check('cancelled or unknown OAuth errors are visible without reflecting attacker HTML','登录没有完成' in pg.inner_text('#modal') and pg.locator('#modal img').count()==0)
 check('cancelled callback preserves the guest identity',pg.evaluate('isGuest()'))
 c.close();b.close();print(f'{n}/{n} Google login checks passed')
