"""雪拼（xuepin/）：示例模式能发单申请聊天；接上（假的）Supabase 后，没登录只能看、登录后写进 xp_* 表。
只打印失败；全部通过时最后打印一行 PASS。"""
import http.server, json, os, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / 'tests' / 'shots'
SHOTS.mkdir(exist_ok=True)
fails = []
def check(ok, msg):
    if not ok:
        fails.append(msg); print('FAIL', msg)

# 假 Supabase：内存里的表，记下每次写入。过滤条件只认 eq（其余忽略），够测前端的读写映射。
FAKE_SB = r"""
(function(){
  var now = Date.now();
  var iso = function(ms){ return new Date(ms).toISOString(); };
  var db = window.__xpdb = {
    xp_rides: [
      { id:'r1', owner:'u-other', dir:'out', place:'klia2', alts:[], place_name:'', kind:'at', time:iso(now+86400000), time_end:null, period:'', have:1, need:2, fare:'90.00', note:'有大行李', raw:'明天去klia2 1=2', status:'open', created_at:iso(now-3600000) },
      { id:'r2', owner:'u-other', dir:'back', place:'ioi', alts:[], place_name:'', kind:'at', time:iso(now+7200000), time_end:null, period:'', have:2, need:1, fare:null, note:'', raw:'', status:'open', created_at:iso(now-600000) }
    ],
    xp_joins: [], xp_msgs: [], xp_contacts: [], xp_trips: []
  };
  var writes = window.__xpwrites = [];
  var session = window.__XP_SESSION || null;
  var n = 0;
  function Q(table){ this.t = table; this.f = []; this.op = 'select'; this.sel = '*'; }
  Q.prototype.select = function(s){ if (this.op === 'select') this.sel = s || '*'; else this.ret = s; return this; };
  ['gte','order','limit','in','or'].forEach(function(k){ Q.prototype[k] = function(){ return this; }; });
  Q.prototype.eq = function(c, v){ if (c.indexOf('.') < 0) this.f.push([c, v]); return this; };
  Q.prototype.single = function(){ this.one = true; return this; };
  Q.prototype.insert = function(row){ this.op = 'insert'; this.row = row; return this; };
  Q.prototype.upsert = function(row){ this.op = 'upsert'; this.row = row; return this; };
  Q.prototype.update = function(row){ this.op = 'update'; this.row = row; return this; };
  Q.prototype.delete = function(){ this.op = 'delete'; return this; };
  Q.prototype.then = function(ok, bad){ var r; try { r = this.run(); } catch (e) { r = { data:null, error:{ message:String(e) } }; } return Promise.resolve(r).then(ok, bad); };
  Q.prototype.match = function(x){ return this.f.every(function(p){ return x[p[0]] === p[1]; }); };
  Q.prototype.run = function(){
    var t = db[this.t], self = this, uid = session && session.user.id;
    if (this.op === 'select') {
      var rows = t.filter(function(x){ return self.match(x); }).map(function(x){
        var o = Object.assign({}, x);
        if (/xp_rides\(\*\)/.test(self.sel)) o.xp_rides = db.xp_rides.filter(function(r){ return r.id === x.ride_id; })[0] || null;
        return o;
      });
      return { data: rows, error: null };
    }
    writes.push({ table:this.t, op:this.op, row:this.row, f:this.f });
    if (this.op === 'insert' || this.op === 'upsert') {
      if (!uid) return { data:null, error:{ code:'42501', message:'new row violates row-level security policy' } };
      var row = Object.assign({ id: this.t + '-' + (++n), created_at: iso(Date.now()) }, this.row);
      if (this.t === 'xp_rides') { row.owner = uid; row.status = 'open'; }
      if (this.t === 'xp_joins') { row.uid = uid; row.status = 'pending'; row.decided_at = null; }
      if (this.t === 'xp_msgs' || this.t === 'xp_joins') row.uid = uid;
      if (this.t === 'xp_contacts' || this.t === 'xp_trips') row.user_id = uid;
      if (this.op === 'upsert') db[this.t] = t.filter(function(x){ return x.user_id !== uid; });
      db[this.t].push(row);
      return { data: this.one ? { id: row.id } : [row], error: null };
    }
    if (this.op === 'update') { t.forEach(function(x){ if (self.match(x)) Object.assign(x, self.row); }); return { data:null, error:null }; }
    if (this.op === 'delete') { db[this.t] = t.filter(function(x){ return !self.match(x); }); return { data:null, error:null }; }
  };
  var listeners = [];
  window.supabase = { createClient: function(){
    return {
      from: function(t){ return new Q(t); },
      rpc: function(name, args){
        writes.push({ rpc:name, args:args });
        db.xp_joins.forEach(function(j){ if (j.id === args.join_id) { j.status = args.yes ? 'accepted' : 'declined'; j.decided_at = iso(Date.now()); } });
        return Promise.resolve({ data:'ok', error:null });
      },
      auth: {
        getSession: function(){ return Promise.resolve({ data:{ session: session } }); },
        onAuthStateChange: function(fn){ listeners.push(fn); },
        signInWithOAuth: function(o){ window.__xplogin = 'oauth:' + o.options.redirectTo; return Promise.resolve({}); },
        linkIdentity: function(o){ window.__xplogin = 'link:' + o.options.redirectTo; return Promise.resolve({}); },
        signOut: function(){ session = null; listeners.forEach(function(fn){ fn('SIGNED_OUT', null); }); return Promise.resolve({}); }
      },
      channel: function(){ var c = { on: function(){ return c; }, subscribe: function(){ return c; } }; return c; }
    };
  } };
})();
"""

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:%d/xuepin/' % server.server_port

def ctx_for(browser, session=None, fake=True):
    c = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    def handler(route):
        u = route.request.url
        if '@supabase/supabase-js' in u:
            body = ('window.__XP_SESSION=%s;' % json.dumps(session) + FAKE_SB) if fake else ''
            return route.fulfill(status=200, body=body, headers={'Content-Type': 'application/javascript'})
        if 'fonts.googleapis.com' in u or 'fonts.gstatic.com' in u:
            return route.fulfill(status=200, body='', headers={'Content-Type': 'text/css'})
        if u.startswith('http://127.0.0.1'):
            return route.continue_()
        return route.abort()
    c.route('**/*', handler)
    return c

def errors_of(page):
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    return errs

try:
    with sync_playwright() as p:
        b = p.chromium.launch()

        # ---- 1. 示例模式（没连上服务器）----
        c = ctx_for(b, fake=False); page = c.new_page(); errs = errors_of(page)
        page.goto(URL)
        page.wait_for_selector('.ride')
        check(page.title().startswith('雪拼'), 'title is 雪拼')
        check(page.locator('.brand .logo').is_visible(), 'logo in header')
        check(page.evaluate("getComputedStyle(document.body).backgroundColor") == 'rgb(255, 248, 240)', 'warm light background')
        check(page.locator('link[rel=manifest]').get_attribute('href') == 'manifest.webmanifest', 'manifest linked')
        page.screenshot(path=str(SHOTS / 'xuepin-hall.png'))
        page.fill('#say', '明天上午10点去trx 2=2')
        check('TRX' in page.inner_text('#preview'), 'one-line preview recognises TRX')
        page.click('#sayBtn')
        page.wait_for_selector('#thread:not([hidden])')
        check('TRX' in page.inner_text('#thHead'), 'posting opens the ride chat')
        page.fill('#chat-in', '在 B1 门口等'); page.click('#chatBtn')
        check('在 B1 门口等' in page.inner_text('#thBody'), 'chat message shows')
        page.screenshot(path=str(SHOTS / 'xuepin-thread.png'))
        page.click('[data-act=back]')
        page.click('#tab-trips')
        check(page.locator('.sister a').get_attribute('href') == '../', 'link back to 雪团')
        page.screenshot(path=str(SHOTS / 'xuepin-trips.png'), full_page=True)
        check(not errs, 'no page errors in demo: %s' % errs)
        c.close()

        # ---- 2. 接上数据库，没登录：能看，写操作要登录 ----
        c = ctx_for(b); page = c.new_page(); errs = errors_of(page)
        page.goto(URL + '#r-r1')
        page.wait_for_selector('#sheet:not([hidden])')
        txt = page.inner_text('#sheetBody')
        check('KLIA T2' in txt and 'RM90' in txt and '有大行李' in txt, 'shared ride link opens the ride from the db: ' + txt[:80])
        check(page.locator('#sheetBody [data-act=login]').count() == 1, 'logged-out ride sheet offers login instead of apply')
        page.click('#sheetBody [data-act=login]')
        check(page.evaluate('window.__xplogin || ""').startswith('oauth:' + URL), 'login goes to Google and back to 雪拼')
        page.click('#sheetBody .x')
        check(page.locator('#modeTag[data-act=login]').is_visible(), 'header shows 登录 button when logged out')
        page.fill('#say', '现在去kip 1=1'); page.click('#sayBtn')
        check(page.locator('#sheet:not([hidden])').count() == 1 and '登录' in page.inner_text('#sheetBody'), 'posting while logged out asks to log in')
        check(not any(w.get('op') == 'insert' for w in page.evaluate('window.__xpwrites')), 'nothing written while logged out')
        page.wait_for_timeout(400); page.screenshot(path=str(SHOTS / 'xuepin-login.png'))
        c.close()

        # ---- 3. 游客号：提示绑定谷歌 ----
        c = ctx_for(b, session={'user': {'id': 'u-guest', 'is_anonymous': True}}); page = c.new_page()
        page.goto(URL); page.wait_for_selector('.ride')
        check('绑定谷歌' in page.inner_text('#modeTag'), 'guest sees 绑定谷歌')
        page.click('#modeTag');
        check(page.evaluate('window.__xplogin || ""').startswith('link:'), 'guest links Google instead of a new login')
        c.close()

        # ---- 4. 登录后：发单、申请、聊天都写进 xp_* 表 ----
        c = ctx_for(b, session={'user': {'id': 'u-me', 'is_anonymous': False, 'email': 'me@example.com'}}); page = c.new_page(); errs = errors_of(page)
        page.goto(URL); page.wait_for_selector('.ride')
        check(page.inner_text('#modeText') == '实时', 'signed-in header says 实时')
        page.fill('#say', '明天下午3点去ioi 2=2'); page.click('#sayBtn')
        page.wait_for_selector('#thread:not([hidden])')
        w = [x for x in page.evaluate('window.__xpwrites') if x.get('table') == 'xp_rides' and x.get('op') == 'insert']
        check(len(w) == 1, 'one ride inserted')
        if w:
            row = w[0]['row']
            check(row['place'] == 'ioi' and row['dir'] == 'out' and row['have'] == 2 and row['need'] == 2 and row['kind'] == 'at', 'ride row mapped: %s' % row)
            check('owner' not in row and 'wa' not in row and 'status' not in row, 'ride row has no owner/contacts/status (db fills them)')
        page.fill('#chat-in', '在宿舍楼下'); page.click('#chatBtn')
        page.wait_for_timeout(200)
        check(any(x.get('table') == 'xp_msgs' and x['row'] == {'ride_id': 'xp_rides-1', 'text': '在宿舍楼下'} for x in page.evaluate('window.__xpwrites')), 'chat written to xp_msgs')
        check('在宿舍楼下' in page.inner_text('#thBody'), 'chat shows after reload from db')
        page.click('[data-act=back]'); page.click('#tab-hall')
        page.click('[data-act=dir][data-v=out]')
        page.click('.ride[data-id=r1]')
        page.click('[data-act=apply]')
        page.wait_for_selector('#thread:not([hidden])')
        check(any(x.get('table') == 'xp_joins' and x.get('op') == 'insert' and x['row'] == {'ride_id': 'r1', 'count': 1} for x in page.evaluate('window.__xpwrites')), 'apply written to xp_joins')
        page.click('[data-act=back]'); page.click('#tab-trips')
        page.fill('#p-wx', 'my_wechat'); page.wait_for_timeout(1100)
        check(any(x.get('table') == 'xp_contacts' and x['row'].get('wx') == 'my_wechat' for x in page.evaluate('window.__xpwrites')), 'WeChat id saved to the account')
        check('me@example.com' in page.inner_text('#acct'), 'trips page shows the signed-in account')
        page.screenshot(path=str(SHOTS / 'xuepin-signed-in.png'), full_page=True)
        check(not errs, 'no page errors when signed in: %s' % errs)
        c.close()
        b.close()
finally:
    server.shutdown(); server.server_close()

if fails:
    raise SystemExit('%d xuepin check(s) failed' % len(fails))
print('PASS xuepin: demo, logged-out read-only, guest linking, signed-in writes')
