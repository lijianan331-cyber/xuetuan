"""Mobile post discussion: native taps, safe text, retries, pagination, accounts and moderation."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],s)
A='aaaaaaaa-0000-4000-8000-000000000001';B='bbbbbbbb-0000-4000-8000-000000000002';C='cccccccc-0000-4000-8000-000000000003'
seed={'profiles':[{'id':A,'name':'合成管理员','page_public':True},{'id':B,'name':'合成作者','page_public':True},{'id':C,'name':'合成读者','page_public':True}],
'places':[{'id':'pub','mode':'food','cat':'other','precision':'exact','lat':2.83,'lng':101.70,'name':'合成咖啡店','created_by':B}],
'visits':[{'id':'post','user_id':B,'place_id':'pub','rating':4,'text':'合成帖子，测试留言和回复。','title':'校园附近的一顿饭','visibility':'public','created_at':'2026-11-02T08:00:00Z','photos':[]}],
'social_comments':[{'id':'root','visit_id':'post','user_id':B,'body':'这家店周末也营业吗？','deleted':False,'parent_id':None,'created_at':'2026-11-02T09:00:00Z'}]}
n=0
def check(name,ok):
 global n
 assert ok,name
 n+=1;print('PASS '+name,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
 c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True)
 s['route_all'](c,True);c.add_init_script('window.__sbSeed='+json.dumps(seed,ensure_ascii=False)+';window.__sbAdmin="'+A+'";')
 pg=c.new_page();pg.set_default_timeout(6000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(s['APP']);pg.wait_for_function('store.review("post")')
 pg.wait_for_function('!state.bootLoading');pg.evaluate("setTab('explore');openPlace('pub');setSnap('full')")
 pg.locator('[data-action=social-open][data-id=post]').tap()
 try: pg.wait_for_selector('[data-action=social-like]:enabled')
 except Exception:
  print('DEBUG',errors,pg.evaluate('({view:state.view,panel:typeof socialPanel!=="undefined"&&socialPanel,calls:window.__sb.calls})'),pg.locator('#post-social').inner_text() if pg.locator('#post-social').count() else 'no panel',flush=True);raise
 check('place reviews open the same discussion as home posts',pg.evaluate('state.view==="post"&&state.postId==="post"'))
 pg.locator('[data-action=social-like]').tap();pg.wait_for_selector('#modal:not([hidden])')
 check('logged-out users get a binding gate without creating guest accounts',not any(x[0]=='anon' for x in pg.evaluate('window.__sb.calls')))
 pg.locator('[data-modal=no]').tap()
 pg.evaluate("window.__sbLogin('"+C+"','reader@example.com')");pg.wait_for_function('me().id==="'+C+'"');pg.wait_for_selector('[data-action=social-like]:enabled')
 check('readers do not receive public like totals',pg.locator('.social-private-count').count()==0)
 pg.locator('[data-action=social-like]').tap();pg.wait_for_function('document.querySelector("[data-action=social-like]").getAttribute("aria-pressed")==="true"')
 check('native touch like works',len(pg.evaluate('window.__sb.db.social_likes'))==1)
 pg.locator('[data-action=social-like]').tap();pg.wait_for_function('!socialPanel.data.liked')
 check('unlike updates immediately',len(pg.evaluate('window.__sb.db.social_likes'))==0)
 pg.evaluate("window.__savedSocialWrite=store.socialWrite;store.socialWrite=function(){return new Promise(resolve=>window.__finishOldLike=resolve);};void 0")
 pg.locator('[data-action=social-like]').tap();pg.wait_for_function('!!window.__finishOldLike')
 pg.evaluate("window.__sbLogin('"+B+"','author@example.com')");pg.wait_for_function('me().id==="'+B+'"');pg.wait_for_selector('[data-action=social-like]:enabled')
 pg.evaluate("window.__finishOldLike({liked:true});store.socialWrite=window.__savedSocialWrite;void 0");pg.wait_for_timeout(80)
 check('late like result cannot change a newly signed-in account',not pg.evaluate('socialPanel.data.liked'))
 pg.evaluate("window.__sbLogin('"+C+"','reader@example.com')");pg.wait_for_function('me().id==="'+C+'"');pg.wait_for_selector('[data-action=social-like]:enabled')
 pg.locator('#social-body').fill('刷新失败也保留')
 pg.evaluate("window.__socialFail='xuetuan_post_social'");pg.locator('[data-action=social-refresh]').tap();pg.wait_for_function('socialPanel.error.includes("加载不了")')
 check('read failure is recoverable and preserves typed text',pg.input_value('#social-body')=='刷新失败也保留')
 pg.evaluate('window.__socialFail=null');pg.locator('.social-status [data-action=social-refresh]').tap();pg.wait_for_function('!socialPanel.loading&&!socialPanel.error')
 pg.locator('#social-body').fill('<img src=x onerror=alert(1)> 好吃吗？')
 pg.evaluate("window.__socialFail='comment'");pg.locator('[data-action=social-send]').tap();pg.wait_for_function('socialPanel.error.includes("没有保存成功")')
 check('failed send keeps text and releases submit',pg.input_value('#social-body').endswith('好吃吗？') and pg.locator('[data-action=social-send]').is_enabled())
 req=pg.evaluate('socialDrafts.get(socialPanel.key).request')
 pg.evaluate("window.__socialFail=null;window.__socialHold='comment'")
 pg.locator('[data-action=social-send]').tap();pg.wait_for_function('!!window.__releaseSocial')
 check('sending disables repeat submits',pg.locator('[data-action=social-send]').is_disabled())
 pg.dispatch_event('[data-action=social-send]','click')
 pg.evaluate("window.__socialHold=null;window.__releaseSocial()")
 pg.wait_for_function('socialPanel.rows.length===2 && !socialPanel.loading')
 check('retry retains request UUID and inserts once',sum(x['id']==req for x in pg.evaluate('window.__sb.db.social_comments'))==1)
 check('repeated send taps do not start extra writes',pg.evaluate('(id)=>window.__sb.calls.filter(c=>c[0]==="rpc"&&c[1]==="xuetuan_social_write"&&c[2].request_id===id).length',req)==2)
 check('comment text is escaped, never interpreted as HTML',pg.locator('.social-comments img').count()==0 and '<img src=x' in pg.inner_text('.social-comments'))
 pg.locator('[data-comment=root] [data-action=social-reply]').tap()
 pg.locator('#social-body').fill('周末也营业，我刚去过。');pg.locator('[data-action=social-send]').tap()
 pg.wait_for_function('socialPanel.rows.length===3 && !socialPanel.loading')
 check('one-level reply shows its target',pg.locator('.social-reply-label').count()==1 and pg.locator('.social-reply-label').inner_text()=='回复 合成作者')
 check('ordinary reader cannot delete author comment',pg.locator('[data-comment=root] [data-action=social-delete]').count()==0)
 pg.locator('[data-comment=root] [data-action=social-report]').tap();pg.locator('[data-action=social-report-send][data-reason=spam]').tap();pg.wait_for_function('document.querySelector("#modal").hidden')
 check('report submits privately',len(pg.evaluate('window.__sb.db.social_reports'))==1)
 mine=pg.evaluate('socialPanel.rows.find(c=>c.user_id===me().id&&!c.parent_id).id')
 pg.locator('[data-comment="'+mine+'"] [data-action=social-delete]').tap();pg.locator('[data-action=social-delete-confirm]').tap()
 pg.wait_for_function('(id)=>socialPanel.rows.find(c=>c.id===id).deleted',arg=mine)
 check('own deletion leaves a tombstone','这条留言已删除' in pg.locator('[data-comment="'+mine+'"]').inner_text())
 pg.evaluate("window.__sbLogin('"+B+"','author@example.com')");pg.wait_for_function('me().id==="'+B+'"');pg.wait_for_selector('.social-private-count')
 check('only post author sees like total','仅你可见' in pg.inner_text('.social-private-count'))
 check('post author can delete reader replies',pg.locator('[data-action=social-delete]').count()>=2)
 # More than one page with identical timestamps; the cursor ID prevents duplicates.
 pg.evaluate("window.__sb.db.social_comments.push(...Array.from({length:65},(_,i)=>({id:'older-'+String(i).padStart(3,'0'),visit_id:'post',user_id:'"+C+"',body:'合成分页 '+i,deleted:false,created_at:'2026-10-01T00:00:00Z'})))")
 pg.locator('[data-action=social-refresh]').tap();pg.wait_for_function('socialPanel.rows.length===30&&!socialPanel.loading')
 pg.locator('[data-action=social-more]').tap();pg.wait_for_function('socialPanel.rows.length===60&&!socialPanel.loading')
 check('older comments paginate without duplicates',pg.evaluate('new Set(socialPanel.rows.map(c=>c.id)).size===60'))
 pg.evaluate("window.__sbLogin('"+A+"','admin@example.com')");pg.wait_for_function('isModerator()');pg.evaluate("setTab('me')")
 pg.locator('[data-action=social-reports]').tap();pg.wait_for_selector('#social-reports [data-action=social-mod-open]')
 pg.locator('#social-reports [data-action=social-mod-open]').first.tap();pg.locator('[data-action=social-mod-confirm][data-decision=delete]').tap();pg.wait_for_function('document.querySelector("#modal").hidden')
 check('administrator reviews reports and removes comment',pg.evaluate('window.__sb.db.social_comments.find(c=>c.id==="root").deleted'))
 pg.evaluate("openPost('post')");pg.wait_for_selector('[data-action=social-like]:enabled');pg.locator('#social-body').fill('账号切换前草稿')
 pg.evaluate('window.__sbLogout()');pg.wait_for_function('!me().id');pg.wait_for_selector('#social-body')
 check('logout clears the former account draft',pg.input_value('#social-body')=='')
 pg.evaluate("window.__sb.db.visits[0].visibility='private'");pg.locator('[data-action=social-refresh]').tap();pg.wait_for_function('!socialPanel.data&&!socialPanel.loading')
 check('withdrawn public post clears cached discussion',pg.locator('.social-comment').count()==0 and pg.locator('[data-action=social-like]').is_disabled())
 # A fresh public view for a mobile screenshot without private/real content.
 pg.evaluate("window.__sb.db.visits[0].visibility='public';window.__sb.db.social_comments=window.__sb.db.social_comments.filter(c=>c.id==='root'||c.parent_id==='root');window.__sb.db.social_comments.find(c=>c.id==='root').deleted=false;window.__sb.db.social_comments.find(c=>c.id==='root').body='这家店周末也营业吗？';window.__sbLogin('"+B+"','author@example.com');socialPanel=null;openPost('post')")
 pg.wait_for_selector('[data-action=social-like]:enabled');pg.wait_for_timeout(100)
 pg.evaluate("document.querySelector('#toast').hidden=true;view.scrollTop+=document.querySelector('#post-social').getBoundingClientRect().top-view.getBoundingClientRect().top-16;")
 pg.wait_for_timeout(150);pg.screenshot(path=str(Path(s['SHOTS'])/'post-social-mobile.png'))
 check('mobile discussion stays within the viewport',pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
 check('no runtime errors',not errors)
 print(f'{n}/{n} browser discussion checks passed');b.close()
