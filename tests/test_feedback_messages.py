"""Guest feedback into owner's ordinary inbox and replies back to the same identity."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002'
seed={'profiles':[{'id':A,'name':'合成主理人'},{'id':B,'name':'合成同学'}],'places':[],'visits':[]}
n=0
def check(label,ok):
 global n
 assert ok,label
 n+=1;print('PASS '+label,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':370,'height':780},has_touch=True,is_mobile=True);s['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False)+';window.__sbAdmin="'+A+'";');pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading')
 for file in ['stub_messages.js','stub_activity.js','stub_feedback.js']:pg.evaluate(Path(__file__).with_name(file).read_text(encoding='utf8'))
 def ready(kind):pg.wait_for_function('(k)=>dmPanel&&dmPanel.kind===k&&dmPanel.data&&!dmPanel.loading',arg=kind)
 def login(id,guest=False):pg.evaluate('(v)=>__sbLogin(v[0],v[1]?"":"synthetic@example.com",{is_anonymous:v[1]})',[id,guest]);pg.wait_for_function('(id)=>me().id===id',arg=id)
 pg.evaluate("setTab('me')");pg.locator('.data-details').evaluate('e=>e.open=true');pg.locator('[data-action=dm-feedback]').tap();ready('feedback');guest=pg.evaluate('me().id')
 check('feedback entry prepares a guest without Google',pg.evaluate('isGuest()') and pg.locator('#modal:not([hidden])').count()==0)
 check('feedback explains private delivery and reply location','消息 → 私信' in pg.inner_text('.dm-notice'))
 pg.locator('#dm-body').fill('合成反馈：希望地图更快 <script>');pg.evaluate('__feedback.fail="send"');pg.locator('[data-action=dm-send]').tap();pg.wait_for_function('dmPanel.error&&!dmBusy(dmPanel)')
 check('failed feedback retains draft',pg.input_value('#dm-body').startswith('合成反馈'))
 pg.evaluate('__feedback.fail=null');pg.locator('[data-action=dm-send]').tap();ready('thread')
 check('retry sends feedback only once',pg.evaluate('__dm.messages.length===1&&dmPanel.feedback'))
 pg.screenshot(path=str(Path(s['SHOTS'])/'feedback-guest-mobile.png'))
 login(A);pg.evaluate("setTab('me');openMessages()");ready('inbox');check('owner receives feedback as unread private conversation',pg.locator('.dm-conversation').count()==1 and '[意见反馈]' in pg.inner_text('.dm-conversation'))
 pg.locator('[data-action=dm-thread]').tap();ready('thread');pg.locator('#dm-body').fill('合成回复：收到，会优化');pg.locator('[data-action=dm-send]').tap();pg.wait_for_function('__dm.messages.length===2&&!dmBusy(dmPanel)')
 login(guest,True);pg.evaluate('openMessages()');ready('comments');pg.locator('[data-action=dm-tab][data-kind=inbox]').tap();ready('inbox');check('guest sees feedback reply in Messages Chats',pg.locator('.dm-conversation').count()==1 and '合成回复' in pg.inner_text('.dm-conversation'))
 pg.locator('[data-action=dm-thread]').tap();ready('thread');check('feedback reply renders safely',pg.locator('.dm-message').count()==2 and '<script>' in pg.inner_text('.dm-messages') and pg.locator('.dm-messages script').count()==0)
 check('guest read confirmation reaches shared inbox',pg.evaluate('(__dm.threads[0].read[me().id]||0)===2'))
 pg.evaluate('(id)=>openMessages(id,"合成同学")',B);pg.wait_for_selector('#modal:not([hidden])');check('guest ordinary peer messaging remains gated','私信需要登录' in pg.inner_text('#modal'));pg.locator('[data-modal=no]').tap()
 pg.evaluate('__feedback.hold="read";dmLoad(false);void 0');pg.wait_for_function('dmPanel.loading');login(B);pg.evaluate('openMessages()');ready('inbox');pg.evaluate('__feedback.hold=null;__feedback.release()')
 check('late feedback never leaks into another account',pg.evaluate('dmPanel.rows.length===0&&dmPanel.owner===me().id'))
 check('mobile layout stays within screen',pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 check('no runtime errors',not errors);print(f'{n}/{n} feedback mobile checks passed');b.close()
