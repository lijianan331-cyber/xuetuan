"""Unified messages with synthetic recipients; never calls production."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002';G='eeeeeeee-0000-4000-8000-000000000004'
seed={'profiles':[{'id':A,'name':'合成甲','page_public':True},{'id':B,'name':'合成乙','page_public':True},{'id':G,'name':'合成游客'}], 'places':[{'id':'pub','mode':'food','cat':'other','precision':'exact','lat':2.83,'lng':101.70,'name':'合成咖啡店','created_by':A}], 'visits':[{'id':'post','user_id':A,'place_id':'pub','rating':4,'title':'合成分享','text':'测试文字','visibility':'public','created_at':'2026-11-03T08:00:00Z','photos':[]}]}
n=0
def check(label,ok):
 global n
 assert ok,label
 n+=1;print('PASS '+label,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True);s['route_all'](c,True)
 c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False)+';')
 pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading')
 for file in ['stub_messages.js','stub_activity.js','stub_feedback.js']:pg.evaluate(Path(__file__).with_name(file).read_text(encoding='utf-8'))
 pg.evaluate('(id)=>{for(let i=1;i<=35;i++)__activity.rows.push({recipient:id,seq:i,event_type:i===35?"like":i===34?"reply":"comment",visit_id:"post",title:"合成分享",body:"<img src=x onerror=alert(1)> 测试评论 "+i,name:"合成同学",created_at:"2026-11-03T08:00:00Z",is_read:false,total:3});}',A)
 def login(user,guest=False):
  pg.evaluate('(v)=>__sbLogin(v[0],v[1]?"":"synthetic@example.com",{is_anonymous:v[1]})',[user,guest]);pg.wait_for_function('(id)=>me().id===id',arg=user)
 def ready(kind):pg.wait_for_function('(k)=>dmPanel&&dmPanel.kind===k&&dmPanel.data&&!dmPanel.loading',arg=kind)
 def tab(kind):pg.locator('[data-action=dm-tab][data-kind='+kind+']').tap();ready(kind)
 login(A);pg.evaluate("setTab('me');openMessages()");ready('inbox');pg.wait_for_function('activityUnread.comments===34')
 check('three compact message tabs',pg.locator('.message-tabs button').count()==3 and pg.locator('.message-tabs').inner_text().find('私信')>=0)
 check('combined entry badge includes activity',pg.evaluate('messageTotal()')==35)
 tab('comments');check('bounded reminder page',pg.locator('[data-action=dm-activity-open]').count()==30)
 check('untrusted comments remain text',pg.locator('.activity-list img').count()==0 and '<img src=x' in pg.inner_text('.activity-list'))
 pg.screenshot(path=str(Path(s['SHOTS'])/'unified-messages-mobile.png'))
 check('phone layout fits',pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 pg.locator('[data-action=dm-more]').tap();pg.wait_for_function('dmPanel.rows.length===34&&!dmPanel.loading')
 check('pagination has no duplicates',pg.evaluate('new Set(dmPanel.rows.map(r=>r.seq)).size===34'))
 pg.locator('[data-action=dm-activity-open]').first.tap();pg.wait_for_function('state.view==="post"')
 check('notification opens exact original share',pg.evaluate('state.postId==="post"&&__activity.rows.find(r=>r.seq===34).is_read'))
 pg.evaluate('openMessages()');ready('inbox');tab('comments');pg.locator('[data-action=dm-activity-clear]').tap();pg.wait_for_function('!dmPanel.marking&&activityUnread.comments===0')
 check('clear section leaves likes unread',pg.evaluate('activityUnread.likes===1'))
 tab('likes');check('like bundle displays total','3 个赞' in pg.inner_text('.activity-list'))
 pg.evaluate('__activity.fail="seen"');pg.locator('[data-action=dm-activity-clear]').tap();pg.wait_for_function('!!dmPanel.error&&!dmPanel.marking')
 check('read failure stays retryable',pg.evaluate('activityUnread.likes===1') and pg.locator('[data-action=dm-activity-clear]').is_enabled())
 pg.evaluate('__activity.fail=null;__activity.rows.find(r=>r.seq===35).hidden=true');pg.locator('[data-action=dm-activity-open]').tap();pg.wait_for_function('!dmPanel.marking')
 check('withdrawn notification never opens stale cached share',pg.evaluate('state.view==="messages"'))
 pg.evaluate('dmLoad(false)');pg.wait_for_function('!dmPanel.loading&&dmPanel.rows.length===0')
 check('withdrawn activity vanishes on refresh',pg.evaluate('activityUnread.likes===0'))
 tab('comments');pg.evaluate('__activity.hold="comments";dmLoad(false);void 0');pg.wait_for_function('dmPanel.loading')
 login(B);pg.evaluate('openMessages()');ready('inbox');pg.evaluate('__activity.hold=null;__activity.release()');
 check('late old identity results are discarded',pg.evaluate('dmPanel.owner===me().id&&dmPanel.rows.length===0'))
 login(G,True);pg.evaluate('(id)=>__activity.rows.push({recipient:id,seq:80,event_type:"reply",visit_id:"post",title:"合成分享",body:"回复游客",name:"合成同学",is_read:false})',G)
 pg.evaluate('openMessages()');ready('comments');check('guest can receive replies',pg.locator('[data-action=dm-activity-open]').count()==1)
 pg.evaluate('(id)=>openMessages(id,"合成同学")',B);pg.wait_for_selector('#modal:not([hidden])')
 check('guest private chat still requires binding',pg.evaluate('dmPanel.kind==="comments"') and '私信需要登录' in pg.inner_text('#modal'))
 pg.locator('[data-modal=no]').tap();pg.locator('[data-action=back]').tap();pg.wait_for_function('state.view!=="messages"')
 check('root activity returns to original screen',pg.evaluate('dmPanel===null'))
 pg.evaluate('__sbLogout()');pg.wait_for_function('!me().id');pg.evaluate('openMessages()');ready('comments')
 check('first-time root creates a guest without Google login',pg.evaluate('isGuest()&&store.signedIn()') and pg.locator('#modal:not([hidden])').count()==0)
 check('no runtime errors',not errors);print(f'{n}/{n} unified-message mobile checks passed');b.close()
