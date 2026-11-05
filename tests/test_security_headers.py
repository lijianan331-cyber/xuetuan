"""Exercise deployed-header configuration in a real browser, using synthetic SDKs."""
import http.server,json,threading,os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
scope={'__file__':str(root/'tests/test_app.py')}
exec((root/'tests/test_app.py').read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
headers=json.loads((root/'vercel.json').read_text())['headers'][0]['headers']
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def log_message(self,*args):pass
    def end_headers(self):
        for h in headers:self.send_header(h['key'],h['value'])
        super().end_headers()
    def do_GET(self):
        if self.path=='/frame-parent':
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<iframe src="/?local"></iframe>')
        else:super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url='http://127.0.0.1:'+str(server.server_port)
try:
    with sync_playwright() as p:
        b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
        c=b.new_context(viewport={'width':390,'height':844});scope['route_all'](c)
        c.route(url+'/**',lambda route:route.continue_())
        page=c.new_page();response=page.goto(url+'/?local')
        page.wait_for_function('window.__map && window.__map.getSource("places")')
        for h in headers:assert response.headers[h['key'].lower()]==h['value']
        print('PASS security headers: main app, map and navigation remain available')
        scope['tab'](page,'home');page.click('[data-action="app-share"]')
        assert page.locator('#app-share-link').is_visible()
        print('PASS security headers: sharing remains available')
        errors=[];page.on('console',lambda m:errors.append(m.text));page.goto(url+'/frame-parent');page.wait_for_timeout(400)
        assert any('frame-ancestors' in m or 'X-Frame-Options' in m for m in errors),errors
        print('PASS security headers: embedding the app in another page is refused')
        b.close()
finally:server.shutdown();server.server_close()
