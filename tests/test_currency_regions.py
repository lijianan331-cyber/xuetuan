"""Currency region regressions with synthetic Photon results; no live account or writes."""
import json, os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

f = Path(__file__).with_name('test_app.py'); scope = {'__file__': str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], scope)
with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL', 'msedge'), headless=True)
    c = b.new_context(viewport={'width': 390, 'height': 780})
    scope['route_all'](c)
    calls = []
    def reverse(route):
        q = parse_qs(urlparse(route.request.url).query); lat = float(q['lat'][0]); lng = float(q['lon'][0])
        calls.append((lat, lng))
        region = '广东省' if lat > 22.5 or (lng < 113.7 and lat > 22.24) else '澳門 Macau' if lng < 113.7 else '香港 Hong Kong'
        props = {'countrycode': 'CN', 'state': region, 'name': '香港茶餐厅' if region == '广东省' else 'synthetic'}
        route.fulfill(status=200, body=json.dumps({'features': [{'properties': props}]}), content_type='application/json')
    c.route('**/photon.komoot.io/reverse?**', reverse)
    pg = c.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(scope['APP']); pg.wait_for_function('window.__map')
    got = pg.evaluate('''async () => {
      let result = await Promise.all([ccAt(22.282,114.158), ccAt(22.1987,113.5439), ccAt(22.54,114.06), ccAt(22.27,113.57)]);
      return [result, money({cc:'CN',lat:22.282,lng:114.158},80), money({cc:'CN',lat:22.1987,lng:113.5439},90), money({cc:'CN',lat:22.54,lng:114.06},25), priceRM({cc:'HK'},100), priceRM({cc:'MO'},100)];
    }''')
    assert got == [['HK','MO','CN','CN'], 'HKD 80', 'MOP 90', 'RMB 25', 52, 50], got
    print('PASS CN-coded Hong Kong/Macao use local units; Shenzhen/Zhuhai remain CNY; budget filtering uses approximate RM')
    assert len(calls) == 4
    pg.evaluate('Promise.all([ccAt(22.282,114.158),ccAt(22.282,114.158),ccAt(22.282,114.158)])')
    assert len(calls) == 4
    print('PASS resolved regional currency is cached without extra requests')
    pg.evaluate("startNewPlace({lat:22.3,lng:114.18},{name:'合成地点',lockedName:true})")
    pg.wait_for_selector('#f-text'); pg.fill('#f-text','保留点评'); pg.fill('#f-price','88')
    pg.wait_for_function('document.querySelector("label[for=f-price]").textContent.includes("HKD")')
    assert pg.input_value('#f-text') == '保留点评' and pg.input_value('#f-price') == '88'
    print('PASS regional lookup updates the add form unit without losing typed comment or price')
    pg.evaluate('''() => {
      state.view = 'bulk'; state.bulk = {groups:null};
      curSym({cc:'CN',lat:22.205,lng:113.55});
      curSym({cc:'CN',lat:22.205,lng:113.55});
    }''')
    pg.wait_for_function('ccNow(22.205,113.55) === "MO"'); pg.wait_for_timeout(180)
    assert calls.count((22.205,113.55)) == 1
    assert not errors, errors
    print('PASS legacy CN records resolve on demand, deduplicate requests, and tolerate a still-loading photo import')
    b.close()
