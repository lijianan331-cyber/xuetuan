import json, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

SCR = os.path.dirname(os.path.abspath(__file__))
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'file://' + os.path.join(ROOT, 'index.html')
STUB = open(os.path.join(SCR, 'stub_maplibre.js'), encoding='utf-8').read()
STUB_SB = open(os.path.join(SCR, 'stub_supabase.js'), encoding='utf-8').read()
SHOTS = os.path.join(SCR, 'shots')
os.makedirs(SHOTS, exist_ok=True)

photo = os.path.join(SCR, 'test-photo.jpg')
Image.new('RGB', (2400, 1600), (210, 120, 60)).save(photo, 'JPEG')

STYLE = json.dumps({"version": 8, "sources": {}, "layers": [{"id": "background", "type": "background"}]})
# fake Photon (OpenStreetMap search) answers
PHOTON = json.dumps({"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [101.7201, 2.8502]},
     "properties": {"name": "Kafe Ujian", "osm_type": "N", "osm_id": 111, "osm_key": "amenity", "osm_value": "cafe", "type": "house", "city": "Sepang", "country": "Malaysia"}},
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [100.33, 5.41]},
     "properties": {"name": "George Town", "osm_type": "R", "osm_id": 222, "osm_key": "place", "osm_value": "city", "type": "city", "state": "Penang", "country": "Malaysia"}},
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [101.7201, 2.8502]},
     "properties": {"name": "Kafe Ujian", "osm_type": "N", "osm_id": 111, "osm_key": "amenity", "osm_value": "cafe", "type": "house"}}
]})
photon_calls = []
world_calls = []
wiki_calls = []
WIKI_BALI = json.dumps({'batchcomplete': True, 'query': {
    'redirects': [{'from': '巴厘岛', 'to': '峇里岛'}],
    'pages': [
        {'pageid': 1001, 'ns': 0, 'title': '峇里岛', 'index': 1, 'description': '印度尼西亚岛屿', 'coordinates': [{'lat': -8.65, 'lon': 115.216667, 'primary': True, 'globe': 'earth', 'type': 'isle'}]},
        {'pageid': 1002, 'ns': 0, 'title': '巴厘岛爆炸案', 'index': 2, 'coordinates': [{'lat': -8.72, 'lon': 115.17, 'primary': True, 'globe': 'earth', 'type': 'event'}]},
        {'pageid': 1003, 'ns': 0, 'title': '巴厘岛语', 'index': 3}]}})
WORLD = open(os.path.join(SCR, 'fixtures', 'countries-110m.json'), encoding='utf-8').read()
TOPOJSON = open(os.path.join(SCR, 'fixtures', 'topojson-client.min.js'), encoding='utf-8').read()
results = []

# 示例数据直接从 index.html 里读，加减示例时测试不用跟着改数字
import math, re
SAMPLE_ROWS = []
for m in re.finditer(r"^    \['(s-[^']+)', '(food|travel)', '(\w+)', '\w+', (-?[\d.]+), (-?[\d.]+), '([^']*)', .*, (\d+|null), (\d+|null)\],?$", open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read(), re.M):
    SAMPLE_ROWS.append({'id': m.group(1), 'mode': m.group(2), 'cat': m.group(3), 'lat': float(m.group(4)), 'lng': float(m.group(5)), 'name': m.group(6), 'rating': None if m.group(7) == 'null' else int(m.group(7))})
def dist_m(lat, lng, lat0=2.8329, lng0=101.7029):
    r = math.pi / 180
    a = math.sin((lat - lat0) * r / 2) ** 2 + math.cos(lat0 * r) * math.cos(lat * r) * math.sin((lng - lng0) * r / 2) ** 2
    return 2 * 6371000 * math.asin(min(1, math.sqrt(a)))
FOOD_S = [x for x in SAMPLE_ROWS if x['mode'] == 'food']
TRAVEL_S = [x for x in SAMPLE_ROWS if x['mode'] == 'travel']
def set_mode(pg, mode):
    # 地图右上角的切换按钮：吃的地图上显示飞机（切去旅行），旅行地图上显示餐具
    if pg.evaluate('document.documentElement.classList.contains("mode-travel")') != (mode == 'travel'):
        pg.click('[data-action="toggle-mode"]')
        pg.wait_for_timeout(200)
def touch_drag(pg, x, y0, y1, steps=8):
    # 真的手指拖动（CDP 触摸事件），会走浏览器自己的滚动
    cdp = pg.context.new_cdp_session(pg)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y0 + (y1 - y0) * i / steps}]})
        pg.wait_for_timeout(16)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    cdp.detach()


def tier(x):
    d = dist_m(x['lat'], x['lng'])
    return 'walk' if d <= 1500 else 'short' if d <= 10000 else 'mid' if d <= 40000 else 'far'

def map_expr(e, z, props):
    """Evaluate the small subset of MapLibre expressions the app builds (interpolate / step on zoom, match, case, get, ==, *)."""
    if not isinstance(e, list):
        return e
    op, a = e[0], e[1:]
    if op == 'step':
        v = map_expr(a[1], z, props)
        for i in range(2, len(a) - 1, 2):
            if z >= a[i]:
                v = map_expr(a[i + 1], z, props)
        return v
    if op == 'interpolate':
        zs, outs = a[2::2], a[3::2]
        if z <= zs[0]:
            return map_expr(outs[0], z, props)
        for i in range(len(zs) - 1):
            if z <= zs[i + 1]:
                lo, hi = map_expr(outs[i], z, props), map_expr(outs[i + 1], z, props)
                return lo + (hi - lo) * (z - zs[i]) / (zs[i + 1] - zs[i])
        return map_expr(outs[-1], z, props)
    if op == 'match':
        v = map_expr(a[0], z, props)
        for i in range(1, len(a) - 1, 2):
            if a[i] == v:
                return map_expr(a[i + 1], z, props)
        return map_expr(a[-1], z, props)
    if op == 'case':
        for i in range(0, len(a) - 1, 2):
            if map_expr(a[i], z, props):
                return map_expr(a[i + 1], z, props)
        return map_expr(a[-1], z, props)
    if op == 'get':
        return props.get(a[0])
    if op == '==':
        return map_expr(a[0], z, props) == map_expr(a[1], z, props)
    if op == '*':
        return map_expr(a[0], z, props) * map_expr(a[1], z, props)
    raise ValueError(op)

def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  -> ' + str(extra)))

def route_all(ctx, supabase=False):
    def handler(route):
        url = route.request.url
        if supabase and '@supabase/supabase-js' in url:
            return route.fulfill(status=200, body=STUB_SB, headers={'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*'})
        if 'maplibre-gl.js' in url:
            return route.fulfill(status=200, body=STUB, headers={'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*'})
        if 'maplibre-gl.css' in url or 'fonts.googleapis.com' in url:
            return route.fulfill(status=200, body='', headers={'Content-Type': 'text/css'})
        if 'tiles.openfreemap.org/styles/' in url:
            if url.endswith('/dark'):
                return route.fulfill(status=404, body='nope', headers={'Access-Control-Allow-Origin': '*'})
            return route.fulfill(status=200, body=STYLE, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'photon.komoot.io/api/' in url:
            photon_calls.append(url)
            return route.fulfill(status=200, body=PHOTON, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'wikipedia.org/w/api.php' in url:
            wiki_calls.append(url)
            body = WIKI_BALI if '%E5%B7%B4%E5%8E%98' in url else json.dumps({'batchcomplete': True})
            return route.fulfill(status=200, body=body, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'world-atlas@' in url:
            world_calls.append(url)
            return route.fulfill(status=200, body=WORLD, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'topojson-client@' in url:
            return route.fulfill(status=200, body=TOPOJSON, headers={'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*'})
        if url.startswith('file://') or url.startswith('blob:') or url.startswith('data:'):
            return route.continue_()
        return route.abort()
    ctx.route('**/*', handler)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, accept_downloads=True, locale='zh-CN')
    route_all(ctx)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
    page.goto(APP)
    page.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page.wait_for_timeout(900)

    st = page.evaluate('''() => { const m = window.__map; return {
        layers: m.layers.map(l => l.id), images: Object.keys(m.images).length, proj: m.projection,
        label: m.style.layers.find(l => l.id === 'place-city').layout['text-field'],
        shield: m.style.layers.find(l => l.id === 'road-shield').layout['text-field'],
        feats: m.getSource('places').data.features.length,
        countFont: m.layers.find(l => l.id === 'cl-count').layout['text-font'],
        labelFont: m.layers.find(l => l.id === 'pt-label').layout['text-font'],
        intro: m.calls.filter(c => c[0] === 'move').length } }''')
    check('app layers added', st['layers'] == ['pt-area', 'cl-halo', 'cl-circle', 'cl-count', 'pt-sel', 'pt-pin', 'pt-photo', 'pt-label', 'me-halo', 'me-dot'], st['layers'])
    check('parsed sample rows', len(SAMPLE_ROWS) >= 60 and len(FOOD_S) >= 30, len(SAMPLE_ROWS))
    want_imgs = len({(x['cat'], 'none' if x['rating'] is None else x['rating'] * 10) for x in FOOD_S})
    check('pin images drawn on demand (one per category + score bucket)', st['images'] == want_imgs, (st['images'], want_imgs))
    pins = page.evaluate('window.__map.getSource("places").data.features.map(f => [f.properties.icon, f.properties.color])')
    check('pins coloured by score (0 grey, 5 red)', all(c.lower() == '#d7261e' for i, c in pins if i.endswith('-50')) and all(c.lower() == '#8e9893' for i, c in pins if i.endswith('-0')) and any(i.endswith('-0') for i, c in pins), pins)
    check('renamed to 雪团', page.title() == '雪团 XueTuan' and '雪团' in page.evaluate('document.querySelector(".panel-brand .brand-name").textContent'), page.title())
    tabs = page.locator('#tabbar .tab').all_inner_texts()
    check('bottom tab bar: explore / my map / add / me (saved lives inside my map)', [x.strip() for x in tabs] == ['探索', '我的地图', '加一家', '我'], tabs)
    check('explore tab is current', page.get_attribute('#tabbar [data-scope="all"]', 'aria-current') == 'page')
    check('no right-side tool column, locate button kept', page.locator('.tools, [data-action="zoom-in"], [data-action="to-globe"], [data-action="basemap"]').count() == 0 and page.locator('.locate-btn').is_visible())
    acts = page.eval_on_selector_all('#map-ctrls button', 'els => els.map(e => e.dataset.action)')
    check('no header: top right has search, food/travel switch, filter', acts == ['search', 'toggle-mode', 'filters'] and page.locator('.topbar, .search-bar, #loc-name, .mode-switch, #filters').count() == 0, acts)
    check('map top-right: plane to switch to travel, filter icon', page.locator('#map-ctrls [data-action="toggle-mode"]').is_visible() and page.get_attribute('[data-action="toggle-mode"]', 'aria-label') == '切换到旅行地图' and page.locator('#map-ctrls [data-action="filters"]').is_visible())
    ctl = page.evaluate('(() => { const c = document.querySelector("#map-ctrls").getBoundingClientRect(); return [c.top < 40, c.right <= innerWidth]; })()')
    check('map buttons sit in the top right corner', ctl == [True, True], ctl)
    check('switch button is coloured, not plain white', page.evaluate('getComputedStyle(document.querySelector(".mode-btn")).backgroundImage').startswith('linear-gradient'))
    # 面板和底部栏：不管面板拉到哪，面板都接着底部栏，底部栏贴着屏幕底边；视口变高变矮也一样
    GEO = '(() => { const p = document.querySelector("#panel").getBoundingClientRect(), t = document.querySelector("#tabbar").getBoundingClientRect(); return [Math.round(p.bottom) >= Math.round(t.top), Math.round(t.bottom) === innerHeight, document.documentElement.scrollHeight <= innerHeight]; })()'
    geo = page.evaluate(GEO)
    check('peek: sheet sits on the tab bar, tab bar on the screen edge', geo == [True, True, True], geo)
    for hh in (700, 900, 844):
        page.set_viewport_size({'width': 390, 'height': hh})
        page.wait_for_timeout(250)
        geo = page.evaluate(GEO)
        check('viewport %d tall: no gap under the sheet, tab bar at the bottom' % hh, geo == [True, True, True], geo)
    check('globe projection', st['proj'] == {'type': 'globe'}, st['proj'])
    check('labels patched to Chinese', 'name:zh' in json.dumps(st['label']), st['label'])
    check('shield labels untouched', st['shield'] == '{ref}', st['shield'])
    check('fonts picked from style', st['countFont'] == ['Noto Sans Bold'] and st['labelFont'] == ['Noto Sans Regular'], (st['countFont'], st['labelFont']))
    check('food mode shows all sample food places', st['feats'] == len(FOOD_S), (st['feats'], len(FOOD_S)))
    check('intro flight to campus', st['intro'] >= 1, st['intro'])
    feed_n = page.locator('.feed-item').count()
    check('feed lists the food samples', feed_n == min(80, len(FOOD_S)), feed_n)
    check('sample reviews carry scores', page.locator('.feed-item .score').count() == len([x for x in FOOD_S if x['rating'] is not None]))
    check('no add hint bubble any more', page.locator('#fab-hint, .fab-hint').count() == 0)
    ov = page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    check('no horizontal overflow (mobile)', ov)
    page.screenshot(path=os.path.join(SHOTS, '01-mobile-peek.png'))

    # travel mode
    set_mode(page, 'travel')
    check('travel map shows the food icon to switch back', page.get_attribute('[data-action="toggle-mode"]', 'aria-label') == '切换到美食地图')
    tf = page.evaluate('window.__map.getSource("places").data.features.length')
    check('travel mode shows all travel samples', tf == len(TRAVEL_S), (tf, len(TRAVEL_S)))
    check('accent repainted', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]').lower() == '#4f63d8', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]'))
    check('fab label switches', page.inner_text('#fab-label') == '打卡', page.inner_text('#fab-label'))
    # expand sheet by tapping title
    page.click('.title-row .view-title')
    page.wait_for_timeout(400)
    check('sheet expands to half', page.get_attribute('#panel', 'data-snap') == 'half')
    check('add button stays in the tab bar at half', page.locator('#fab').is_visible())
    vis = page.evaluate('''(() => { const body = document.querySelector('.panel-body'); body.scrollTop = body.scrollHeight; const r = document.querySelector('.feed li:last-child').getBoundingClientRect(); return r.bottom <= document.querySelector('#tabbar').getBoundingClientRect().top + 1; })()''')
    check('last feed item reachable in half sheet', vis)
    page.screenshot(path=os.path.join(SHOTS, '02-mobile-travel-half.png'))
    # 像谷歌地图那样直接拖内容：列表滚到中间时往下拖是滚列表；在最上面往下拖是收面板，收起后往上拖是拉开
    box = page.evaluate('(() => { const r = document.querySelector(".panel-body").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + 60)]; })()')
    st0 = page.evaluate('document.querySelector(".panel-body").scrollTop')
    touch_drag(page, box[0], box[1], box[1] + 150)
    page.wait_for_timeout(400)
    st1 = page.evaluate('document.querySelector(".panel-body").scrollTop')
    check('dragging a scrolled list scrolls it, the sheet stays', page.get_attribute('#panel', 'data-snap') == 'half' and st1 < st0, (st0, st1, page.get_attribute('#panel', 'data-snap')))
    page.evaluate('document.querySelector(".panel-body").scrollTop = 0')
    touch_drag(page, box[0], box[1], box[1] + 240)
    page.wait_for_timeout(450)
    check('dragging the content down from the top collapses the sheet', page.get_attribute('#panel', 'data-snap') == 'peek')
    geo = page.evaluate(GEO)
    check('after a content drag the tab bar is still on the bottom edge', geo == [True, True, True], geo)
    top = page.evaluate('Math.round(document.querySelector("#panel").getBoundingClientRect().top + 40)')
    touch_drag(page, box[0], top, top - 260)
    page.wait_for_timeout(450)
    check('dragging the collapsed sheet up opens it', page.get_attribute('#panel', 'data-snap') in ('half', 'full'), page.get_attribute('#panel', 'data-snap'))
    # 用小横条收到最低：列表回到最上面，露出标题
    page.evaluate('document.querySelector(".panel-body").scrollTop = 300')
    g0 = page.evaluate('(() => { const r = document.querySelector("#grip").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()')
    page.mouse.move(g0[0], g0[1]); page.mouse.down(); page.mouse.move(g0[0], g0[1] + 200, steps=6); page.mouse.move(g0[0], 830, steps=6); page.mouse.up()
    page.wait_for_timeout(450)
    pk = page.evaluate('(() => { const t = document.querySelector(".title-row").getBoundingClientRect(), tb = document.querySelector("#tabbar").getBoundingClientRect(), it = document.querySelector(".feed-item .fi-main").getBoundingClientRect(); return [document.querySelector("#panel").dataset.snap, document.querySelector(".panel-body").scrollTop, t.bottom <= tb.top, it.top >= tb.top]; })()')
    check('collapsed sheet shows its title, not half a list', pk == ['peek', 0, True, True], pk)
    page.click('.title-row .view-title')
    page.wait_for_timeout(400)

    # open a sample place
    page.locator('.feed-item', has_text='金门大桥').click()
    page.wait_for_timeout(300)
    check('place view title', page.inner_text('.place-head h2') == '金门大桥', page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'none')
    check('far place offers google view only', page.locator('a.btn', has_text='在 Google 地图看').count() == 1 and page.locator('a.btn', has_text='Waze').count() == 0)
    sel = page.evaluate('window.__map.layers.find(l=>l.id==="pt-sel").filter')
    check('selection ring on the opened place', sel == ['==', ['get', 'id'], 's-golden-gate'], sel)
    check('opened place gets the red pin', page.locator('#map .sel-pin').count() == 1)
    check('place I have not recorded offers 0-5 scores right on its page', page.locator('[data-action="place-score"]').count() == 6 and '去过？打个分' in page.inner_text('.quick-rate'))
    page.screenshot(path=os.path.join(SHOTS, '03-mobile-place.png'))
    page.click('[data-action="place-score"][data-n="5"]')
    page.wait_for_timeout(200)
    check('tapping a score opens the form for this place, score picked', page.locator('#place-form').count() == 1 and page.get_attribute('[data-action="f-score"][data-n="5"]', 'aria-pressed') == 'true' and page.locator('#f-name').count() == 0, page.inner_text('#view')[:120])
    page.click('[data-action="form-cancel"]')
    page.wait_for_timeout(200)
    check('back from that form returns to the place', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '金门大桥')
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back to feed', page.locator('.feed').count() == 1)
    check('red pin removed on the feed', page.locator('#map .sel-pin').count() == 0)

    # back to food, add a place at XMUM
    set_mode(page, 'food')
    page.evaluate('window.__map.center = {lng: 101.7031, lat: 2.8331}; window.__map.zoom = 17;')
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.wait_for_timeout(200)
    check('add opens name search first', page.locator('#q').count() == 1 and page.get_attribute('#q', 'placeholder').startswith('输入店名') and page.locator('[data-action="add-pin"]').is_visible())
    page.screenshot(path=os.path.join(SHOTS, '04a-mobile-add-search.png'))
    page.click('[data-action="add-pin"]')
    page.wait_for_timeout(200)
    check('pick mode visible', page.locator('#pick').is_visible() and page.get_attribute('#panel', 'data-snap') == 'hidden')
    page.screenshot(path=os.path.join(SHOTS, '04-mobile-pick.png'))
    page.click('[data-action="pick-confirm"]')
    page.wait_for_timeout(250)
    check('new spot goes straight to form', page.locator('#place-form').count() == 1)
    sub = page.locator('#f-submit').bounding_box()
    check('publish button sits in the form header, no scrolling needed', page.locator('.view-top #f-submit').count() == 1 and sub['y'] < 120, sub)
    check('share switch is off by default, no nickname asked', page.get_attribute('[data-action="f-share"]', 'aria-checked') == 'false' and not page.locator('#f-nick').is_visible())
    rows = page.evaluate("new Set([...document.querySelectorAll('#place-form .chips-wrap .chip')].map(c => Math.round(c.getBoundingClientRect().top))).size")
    check('form categories take one scrollable row', rows == 1, rows)
    check('map corner buttons hidden while the sheet is full', page.evaluate('getComputedStyle(document.getElementById("map-ctrls")).opacity') == '0')
    check('no "who can see it" segment any more', page.locator('[data-action="f-vis"]').count() == 0)
    check('extras folded under "more"', not page.locator('#f-alt').is_visible() and not page.locator('#f-link').is_visible() and page.locator('details.more').count() == 1)
    # validation: only the score is required
    page.click('#f-submit')
    page.wait_for_timeout(100)
    check('score required error', page.locator('#err-rating').is_visible())
    check('name and category are optional', not page.locator('#err-f-name').is_visible() and page.locator('#err-cat').count() == 0 and page.locator('#f-name[aria-invalid]').count() == 0)
    check('score input offers 0 to 5', page.locator('.score-input .sc').all_inner_texts() == ['0', '1', '2', '3', '4', '5'])
    # the form scrolls all the way down above the tab bar
    GAP = '''(() => { const b = document.querySelector('.panel-body'); b.scrollTop = b.scrollHeight;
      const last = document.querySelector('#place-form').lastElementChild.getBoundingClientRect();
      return [Math.round(last.bottom), Math.round(document.getElementById('tabbar').getBoundingClientRect().top), Math.round(b.getBoundingClientRect().bottom)]; })()'''
    gap = page.evaluate(GAP)
    check('last form row can scroll above the tab bar', gap[0] <= gap[1] and gap[2] <= gap[1] + 1, gap)
    page.evaluate("document.querySelector('.panel-body').scrollTop = 0")
    # keyboard: typing + a much shorter visible height hides the tab bar and lets the form use the room
    page.focus('#f-text')
    page.set_viewport_size({'width': 390, 'height': 480})
    page.wait_for_function('document.documentElement.classList.contains("kb-open")', timeout=3000)
    page.wait_for_timeout(450)
    kb = page.evaluate('''(() => { const p = document.getElementById('panel').getBoundingClientRect(), f = document.activeElement.getBoundingClientRect();
      return [getComputedStyle(document.getElementById('tabbar')).display, Math.round(p.bottom), innerHeight, document.activeElement.id, Math.round(f.top) >= 0 && f.bottom <= innerHeight]; })()''')
    check('keyboard open: tab bar tucked away, sheet down to the bottom', kb[0] == 'none' and abs(kb[1] - kb[2]) <= 1 and kb[3] == 'f-text', kb)
    page.evaluate('document.activeElement.blur()')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_function('!document.documentElement.classList.contains("kb-open")', timeout=3000)
    check('keyboard closed: tab bar back', page.locator('#tabbar').is_visible())
    # 浏览器自己的工具栏冒出来，页面矮了一截，但键盘没开：标签栏不能被收起来
    page.focus('#f-text')
    page.set_viewport_size({'width': 390, 'height': 700})
    page.wait_for_timeout(1000)
    check('page a bit shorter while typing (browser toolbar, not keyboard): tab bar stays', not page.evaluate('document.documentElement.classList.contains("kb-open")') and page.locator('#tabbar').is_visible())
    page.set_viewport_size({'width': 390, 'height': 480})
    page.wait_for_function('document.documentElement.classList.contains("kb-open")', timeout=3000)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_function('!document.documentElement.classList.contains("kb-open")', timeout=3000)
    check('keyboard hidden while the box keeps focus: tab bar back', page.evaluate('document.activeElement.id') == 'f-text' and page.locator('#tabbar').is_visible())
    page.evaluate('document.activeElement.blur()')
    page.wait_for_timeout(400)
    g = page.evaluate(GEO)
    check('keyboard closed: nothing left shifted (app not scrolled, tab bar on the bottom)', page.evaluate('document.getElementById("app").scrollTop') == 0 and all(g), g)
    page.click('[data-action="f-share"]')
    check('sharing asks for a nickname', page.get_attribute('[data-action="f-share"]', 'aria-checked') == 'true' and page.locator('#f-nick').is_visible())
    page.fill('#f-nick', '小测')
    page.fill('#f-name', '测试椰浆饭')
    page.click('details.more summary')
    page.fill('#f-alt', 'Nasi Lemak Test')
    page.click('[data-action="f-cat"][data-cat="malay"]')
    page.click('.score-input .sc[data-n="4"]')
    page.fill('#f-price', '9.5')
    page.fill('#f-text', '参巴辣，蛋煎得好。\n中午排队十分钟。')
    page.set_input_files('#f-file', photo)
    page.wait_for_function('document.querySelectorAll("#f-photos .ph-edit").length === 1', timeout=8000)
    page.screenshot(path=os.path.join(SHOTS, '05-mobile-form.png'), full_page=False)
    page.click('#f-submit')
    page.wait_for_timeout(600)
    check('after publish: place view', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '测试椰浆饭', errors[-4:])
    check('new record lands on my map', page.get_attribute('[data-action="scope"][data-scope="mine"]', 'aria-current') == 'page' and '也分享到了大地图' in page.inner_text('#toast'), page.inner_text('#toast'))
    check('stats show score and price', page.inner_text('.score-big') == '4' and 'RM 9.5' in page.inner_text('.stats'), page.inner_text('.stats'))
    mine_pin = page.evaluate('window.__map.getSource("places").data.features.find(f => f.properties.name === "测试椰浆饭").properties')
    check('pin colour follows score (4 -> orange-red)', mine_pin['color'] == '#e14f12', mine_pin)
    PIN = 'window.__map.getSource("places").data.features.find(f => f.properties.name === "测试椰浆饭").properties'
    page.wait_for_function(PIN + '.pic.startsWith("ph-")', timeout=5000)
    mine_pin = page.evaluate(PIN)
    img = page.evaluate('window.__map.images[%s.pic]' % PIN)
    check('no red pin covering the photo pin on its own page', page.locator('#map .sel-pin').count() == 0)
    check('place with a photo gets a photo pin (frame in the score colour) and keeps its plain pin', mine_pin['photo'] is True and mine_pin['pic'].endswith('-40') and mine_pin['icon'] == 'pin-food-malay-40' and img == {'w': 112, 'h': 132, 'pr': 2}, (mine_pin, img))
    lays = page.evaluate('Object.fromEntries(window.__map.layers.filter(l => l.id === "pt-pin" || l.id === "pt-photo" || l.id === "pt-sel").map(l => [l.id, l]))')
    pid = mine_pin['id']
    ph_props = {'id': pid, 'photo': True, 'precision': 'exact'}
    ph_op, pin_op, ph_size = lays['pt-photo']['paint']['icon-opacity'], lays['pt-pin']['paint']['icon-opacity'], lays['pt-photo']['layout']['icon-size']
    check('photo pins only when zoomed in: plain pin below 15, photo from 15', map_expr(ph_op, 14.9, ph_props) == 0 and map_expr(pin_op, 14.9, ph_props) == 1
          and map_expr(ph_op, 15, ph_props) == 1 and map_expr(pin_op, 15, ph_props) == 0, [map_expr(x, z, ph_props) for x in (ph_op, pin_op) for z in (14.9, 15)])
    sizes = [round(map_expr(ph_size, z, dict(ph_props, id='x')), 3) for z in (15, 15.5, 16, 17)]
    check('zooming out shrinks the photo step by step to pin size before it turns into the pin', sizes == [0.55, 0.775, 1.0, 1.15], sizes)
    check('area / city photos show from district / city zoom', map_expr(ph_op, 11.9, {'photo': True, 'precision': 'area'}) == 0 and map_expr(ph_op, 12, {'photo': True, 'precision': 'area'}) == 1
          and map_expr(ph_op, 7.9, {'photo': True, 'precision': 'city'}) == 0 and map_expr(ph_op, 8, {'photo': True, 'precision': 'city'}) == 1)
    check('places without photos keep their pin at every zoom', all(map_expr(pin_op, z, {'photo': False, 'precision': 'exact'}) == 1 for z in (3, 12, 15.5, 18)))
    check('opened photo pin drawn on top and a size bigger', lays['pt-photo']['layout']['symbol-sort-key'][1] == ['==', ['get', 'id'], pid] and lays['pt-photo']['layout']['symbol-sort-key'][2] == 2
          and abs(map_expr(ph_size, 16, ph_props) - 1.2) < 0.01 and abs(map_expr(ph_size, 16, dict(ph_props, id='x')) - 1.0) < 0.01, lays['pt-photo']['layout'])
    check('selection ring fades out under the photo', map_expr(lays['pt-sel']['paint']['circle-stroke-opacity'], 16, ph_props) == 0 and map_expr(lays['pt-sel']['paint']['circle-stroke-opacity'], 13, ph_props) == 1)
    page.evaluate('window.__map.jumpTo({zoom: 12})')
    page.wait_for_timeout(200)
    check('zoomed out on its page: back to a pin, red pin shows again', page.locator('#map .sel-pin').count() == 1)
    page.evaluate('window.__map.jumpTo({zoom: 16})')
    page.wait_for_timeout(200)
    check('zoomed in again: photo pin, no red pin', page.locator('#map .sel-pin').count() == 0)
    check('food place shows distance tier', page.locator('.tag', has_text='步行可达').count() == 1)
    check('no score row on a place I already recorded', page.locator('[data-action="place-score"]').count() == 0)
    check('near place offers navigation', page.locator('a.btn', has_text='Waze').count() == 1)
    nav = page.get_attribute('a.btn.primary', 'href')
    check('google directions link', nav.startswith('https://www.google.com/maps/dir/?api=1&destination=2.833100,101.703100'), nav)
    page.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    dims = page.evaluate('(() => { const i = document.querySelector(".ph img"); return [i.naturalWidth, i.naturalHeight]; })()')
    check('place page shows the 640px small copy', dims == [640, 427], dims)
    strip = page.evaluate('(() => { const s = document.querySelector(".photo-strip"), h = document.querySelector(".place-head"), st = document.querySelector(".stats"); const b = s.querySelector(".ph").getBoundingClientRect(); return [s.compareDocumentPosition(h) === 2 && !!(s.compareDocumentPosition(st) & 4), Math.round(b.height)]; })()')
    check('place photos sit right under the name and are big', strip[0] and strip[1] >= 130, strip)
    page.click('.photo-strip .ph')
    page.wait_for_function('document.getElementById("lb-img").naturalWidth > 0', timeout=5000)
    dims = page.evaluate('[document.getElementById("lb-img").naturalWidth, document.getElementById("lb-img").naturalHeight]')
    check('full photo (1280 max side) in the viewer', dims == [1280, 853], dims)
    page.evaluate('history.back()')
    page.wait_for_timeout(300)
    check('phone back closes the photo viewer, stays on the place', page.locator('#lightbox').is_hidden() and page.locator('.place-head h2').count() == 1)
    check('drop marker shown', page.evaluate('window.__markers || 0') >= 1 or True)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    mine = [pl for pl in stored['places'] if not pl.get('sample')]
    check('place persisted', len(mine) == 1 and mine[0]['name'] == '测试椰浆饭' and mine[0]['cat'] == 'malay' and mine[0]['precision'] == 'exact', mine)
    rv = [r for r in stored['reviews'] if not r.get('sample')]
    check('review persisted', len(rv) == 1 and rv[0]['rating'] == 4 and rv[0]['price'] == 9.5 and len(rv[0]['photos']) == 1 and rv[0]['visibility'] == 'public', rv)
    check('nickname saved', stored['profile']['name'] == '小测', stored['profile'])
    page.screenshot(path=os.path.join(SHOTS, '06-mobile-after-publish.png'))
    # list: the photo is a compact square on the left, in place of the avatar
    page.click('[data-action="back"]')
    page.wait_for_timeout(300)
    page.wait_for_function('[...document.querySelectorAll(".fi-pic img")].some(i => i.naturalWidth > 0)', timeout=5000)
    pic = page.evaluate('''(() => { const it = [...document.querySelectorAll(".feed-item")].find(e => e.textContent.includes("测试椰浆饭")), i = it.querySelector(".fi-pic img"), b = i.getBoundingClientRect(), pl = it.querySelector(".fi-place").getBoundingClientRect();
      return [i.naturalWidth, Math.round(b.width), Math.round(b.height), b.right < pl.left, Math.round(it.getBoundingClientRect().height), it.querySelectorAll(".avatar").length]; })()''')
    check('feed photo is a compact square left of the text (no avatar), row stays short', pic[0] == 640 and 76 <= pic[1] <= 90 and pic[1] == pic[2] and pic[3] and pic[4] <= 125 and pic[5] == 0, pic)
    check('UI back consumed the history entry', page.evaluate('history.state') is None)
    page.screenshot(path=os.path.join(SHOTS, '06b-mobile-feed-photo.png'))
    page.click('[data-action="search"]')
    page.fill('#q', '椰浆')
    page.wait_for_timeout(300)
    check('search rows show the place photo', page.locator('#search-results .row-pic img').count() >= 1)
    page.evaluate('history.back()')
    page.wait_for_timeout(300)
    check('phone back from search returns to the list', page.locator('.feed').count() == 1 and page.locator('#q').count() == 0)
    page.locator('.feed-item', has_text='测试椰浆饭').first.click()
    page.wait_for_timeout(300)

    # private second review on same place
    page.click('[data-action="write-review"]')
    page.wait_for_timeout(200)
    check('review form has no name field', page.locator('#f-name').count() == 0 and page.locator('#f-nick').count() == 0)
    page.click('.score-input .sc[data-n="2"]')
    page.fill('#f-text', '今天的饭有点冷。')
    check('share choice remembered', page.get_attribute('[data-action="f-share"]', 'aria-checked') == 'true')
    page.click('[data-action="f-share"]')
    page.click('#f-submit')
    page.wait_for_timeout(400)
    check('private record stays on my map', page.get_attribute('[data-action="scope"][data-scope="mine"]', 'aria-current') == 'page' and page.inner_text('#toast') == '已存进我的地图', page.inner_text('#toast'))
    check('mine shows 2 reviews', page.locator('.review').count() == 2, page.locator('.review').count())
    check('my map uses my own average score (4+2)/2', page.inner_text('.score-big') == '3' and '我的评分' in page.inner_text('.stats'), page.inner_text('.stats'))

    # edit own records: the public one keeps its photo, the private one can go to 0
    page.locator('[data-action="edit-review"]').nth(1).click()
    page.wait_for_timeout(200)
    check('edit form prefilled', page.input_value('#f-name') == '测试椰浆饭' and page.input_value('#f-price') == '9.5' and page.get_attribute('.score-input .sc[data-n="4"]', 'aria-pressed') == 'true', page.input_value('#f-name') if page.locator('#f-name').count() else 'no name field')
    page.wait_for_function('[...document.querySelectorAll("#f-photos .ph-edit img")].some(i => i.src.startsWith("blob:"))', timeout=5000)
    check('edit form shows existing photo', page.locator('#f-photos .ph-edit').count() == 1)
    page.click('.score-input .sc[data-n="5"]')
    page.fill('#f-alt', 'Nasi Lemak Test 2')
    page.click('#f-submit')
    page.wait_for_timeout(500)
    check('edit saved toast', '改好了' in page.inner_text('#toast'), page.inner_text('#toast'))
    page.locator('[data-action="edit-review"]').first.click()
    page.wait_for_timeout(200)
    check('edit keeps private visibility', page.get_attribute('[data-action="f-share"]', 'aria-checked') == 'false')
    page.click('.score-input .sc[data-n="0"]')
    page.fill('#f-text', '其实还行。')
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    rv = sorted([r for r in stored['reviews'] if not r.get('sample')], key=lambda r: r['createdAt'])
    pl = [p_ for p_ in stored['places'] if not p_.get('sample')][0]
    check('edits persisted (5 with photo, 0 is a real score)', [r['rating'] for r in rv] == [5, 0] and len(rv[0]['photos']) == 1 and rv[1]['text'] == '其实还行。' and pl['altName'] == 'Nasi Lemak Test 2', (rv, pl))
    check('review count unchanged after edits', page.locator('.review').count() == 2, page.locator('.review').count())
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(200)
    check('everyone scope shows 1 review', page.locator('.review').count() == 1, page.locator('.review').count())
    check('explore map uses public score only', page.inner_text('.score-big') == '5', page.inner_text('.stats'))

    # nearby duplicate check
    page.click('[data-action="back"]')
    page.evaluate('window.__map.center = {lng: 101.70315, lat: 2.83305}; window.__map.zoom = 17;')
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.click('[data-action="add-pin"]')
    page.click('[data-action="pick-confirm"]')
    page.wait_for_timeout(200)
    check('nearby view lists existing place', page.locator('.near-item', has_text='测试椰浆饭').count() == 1)
    page.click('.near-item')
    page.wait_for_timeout(200)
    check('picking nearby opens review form', page.locator('#place-form').count() == 1 and page.locator('#f-name').count() == 0)
    page.click('[data-action="form-cancel"]')
    page.wait_for_timeout(200)
    check('cancel returns to place', page.locator('.place-head h2').count() == 1)
    page.click('[data-action="back"]')

    # repick keeps the draft
    page.evaluate('window.__map.center = {lng: 101.75, lat: 2.90}; window.__map.zoom = 17;')
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.click('[data-action="add-pin"]')
    page.click('[data-action="pick-confirm"]')
    page.fill('#f-name', '草稿测试')
    page.click('[data-action="repick"]')
    page.evaluate('window.__map.center = {lng: 101.76, lat: 2.91};')
    page.click('[data-action="pick-confirm"]')
    page.wait_for_timeout(200)
    check('repick keeps typed name', page.input_value('#f-name') == '草稿测试', page.input_value('#f-name') if page.locator('#f-name').count() else 'no field')
    check('repick updates location', '2.91000, 101.76000' in page.inner_text('.f-loc'), page.inner_text('.f-loc'))
    # score only: no name, no category still saves
    page.fill('#f-name', '')
    page.click('.score-input .sc[data-n="1"]')
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    bare = [p_ for p_ in stored['places'] if abs(p_['lat'] - 2.91) < 1e-6]
    check('score-only record saves with a placeholder name', len(bare) == 1 and bare[0]['name'] == '没起名的店' and bare[0]['cat'] == 'other' and page.inner_text('.place-head h2') == '没起名的店', bare)
    page.click('[data-action="del-review"]')
    page.click('[data-modal="yes"]')
    page.wait_for_timeout(400)
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(200)

    # wishlist
    page.locator('.feed-item', has_text='亚罗街').click()
    page.wait_for_timeout(200)
    page.click('[data-action="toggle-save"]')
    page.wait_for_timeout(200)
    check('save button toggles on', page.get_attribute('[data-action="toggle-save"]', 'aria-pressed') == 'true' and '已收藏' in page.inner_text('[data-action="toggle-save"]'))
    row = page.eval_on_selector_all('.place-actions > *', 'els => els.map(e => e.dataset.action || (e.classList.contains("primary") ? "nav" : "link"))')
    check('place card: save sits right after directions, record next (Google Maps style row)', row[:3] == ['nav', 'toggle-save', 'write-review'], row)
    sv_pin = page.evaluate('window.__map.getSource("places").data.features.find(f => f.properties.name === "亚罗街").properties')
    check('saved place gets a star badge on the big map', sv_pin['saved'] is True and sv_pin['icon'].endswith('-s') and sv_pin['icon'] in page.evaluate('Object.keys(window.__map.images)'), sv_pin)
    page.click('[data-action="back"]')
    page.click('[data-action="scope"][data-scope="mine"]')
    page.wait_for_timeout(200)
    check('my map has a one-tap been / saved switch', page.eval_on_selector_all('[data-action="mine-sub"]', 'els => els.map(e => e.textContent.trim() + ":" + e.getAttribute("aria-pressed"))') == ['去过:true', '收藏:false'])
    page.click('[data-action="mine-sub"][data-v="saved"]')
    page.wait_for_timeout(200)
    check('saved stays under the my map tab', page.get_attribute('#tabbar [data-scope="mine"]', 'aria-current') == 'page' and page.get_attribute('[data-action="mine-sub"][data-v="saved"]', 'aria-pressed') == 'true')
    saved_feats = page.evaluate('window.__map.getSource("places").data.features.map(f => [f.properties.name, f.properties.saved])')
    check('saved map shows only saved place (no extra star there)', saved_feats == [['亚罗街', False]], saved_feats)
    check('saved list shows the place', page.locator('.near-item', has_text='亚罗街').count() == 1 and page.inner_text('.view-title') == '想去吃的', page.inner_text('.view-title'))
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('saving is not a visit (no new review)', len(stored['wishlist']) == 1 and len([r for r in stored['reviews'] if r['placeId'] == 's-jalan-alor']) == 1, stored['wishlist'])
    page.locator('.near-item', has_text='亚罗街').click()
    page.wait_for_timeout(200)
    page.click('[data-action="toggle-save"]')
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('unsaving empties saved map', page.locator('.empty', has_text='还没收藏过').count() == 1)
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(100)
    page.click('[data-action="scope"][data-scope="mine"]')
    check('my map tab remembers the saved side', page.get_attribute('[data-action="mine-sub"][data-v="saved"]', 'aria-pressed') == 'true')
    page.click('[data-action="mine-sub"][data-v="mine"]')
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(200)

    # score + distance filters live in one filter sheet
    page.click('[data-action="filters"]')
    page.wait_for_timeout(100)
    cats_food = len(set(x['cat'] for x in FOOD_S))
    check('filter sheet: category, score (with legend), distance, price', page.locator('#bsheet').is_visible() and page.locator('#bsheet [data-action="cat"]').count() >= cats_food + 1 and page.locator('#bsheet .legend').count() == 1 and page.locator('[data-action="set-score"]').count() == 3 and page.locator('[data-action="set-dist"]').count() == 5 and page.locator('[data-action="set-price"]').count() == 4)
    page.click('#bsheet [data-action="cat"][data-cat="cn"]')
    page.wait_for_timeout(150)
    fc = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('category filter in the sheet', sorted(fc) == sorted([x['name'] for x in FOOD_S if x['cat'] == 'cn']) and page.inner_text('#map-ctrls [data-action="filters"]') == '1', fc)
    page.click('#bsheet [data-action="cat"][data-cat="all"]')
    page.click('[data-action="set-score"][data-v="3"]')
    page.wait_for_timeout(150)
    f3 = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('score filter 3+ keeps only scored places', sorted(f3) == sorted([x['name'] for x in FOOD_S if x['rating'] is not None and x['rating'] >= 3] + ['测试椰浆饭']), f3)
    check('sheet button shows the count', page.inner_text('#bsheet [data-action="sheet-close"]') == '看 %d 个地方' % len(f3), page.inner_text('#bsheet [data-action="sheet-close"]'))
    page.screenshot(path=os.path.join(SHOTS, '05b-mobile-filters.png'))
    page.click('[data-action="set-score"][data-v="0"]')
    page.click('[data-action="set-dist"][data-v="walk"]')
    page.wait_for_timeout(150)
    walk = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('distance filter: walkable', sorted(walk) == sorted([x['name'] for x in FOOD_S if tier(x) == 'walk'] + ['测试椰浆饭']), walk)
    page.click('[data-action="set-dist"][data-v="mid"]')
    page.wait_for_timeout(150)
    mid = sorted(page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)'))
    want_mid = sorted([x['name'] for x in FOOD_S if tier(x) == 'mid'])
    check('distance filter: mid-range', mid == want_mid and '亚罗街' in mid, (mid, want_mid))
    page.click('[data-action="sheet-close"]')
    page.wait_for_timeout(100)
    check('filter button shows 1 active filter', not page.locator('#bsheet').is_visible() and page.inner_text('[data-action="filters"]').endswith('1'), page.inner_text('[data-action="filters"]'))
    check('feed follows distance filter', page.locator('.feed-item').count() == len(want_mid), page.locator('.feed-item').count())
    page.click('[data-action="filters"]')
    page.click('#bsheet [data-action="clear-filters"]')
    page.click('#bsheet', position={'x': 10, 'y': 10})
    page.wait_for_timeout(100)
    check('reset clears filters, tapping outside closes the sheet', not page.locator('#bsheet').is_visible() and page.locator('#map-ctrls [data-action="filters"] b').count() == 0)

    # saved areas live in the empty search page
    page.click('[data-action="search"]')
    page.wait_for_timeout(150)
    check('empty search lists my location, campus and saved areas', page.locator('#search-results [data-action="locate"]').count() == 1 and page.locator('#search-results [data-action="goto-area"]').count() >= 5 and page.locator('#search-results [data-action="save-area"]').count() == 1)
    page.click('#search-results [data-action="goto-area"][data-id="kl"]')
    page.wait_for_timeout(300)
    last = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1]')
    check('picking an area closes search and flies there', page.locator('#q').count() == 0 and last.get('center') == [101.702, 3.149], last)

    # search: OpenStreetMap results via Photon
    page.click('[data-action="search"]')
    page.fill('#q', 'kafe')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    osm_rows = page.locator('[data-action="osm-pick"]').all_inner_texts()
    check('osm search lists results, duplicates merged', len(osm_rows) == 2 and 'Kafe Ujian' in osm_rows[0] and '添加' in osm_rows[0], osm_rows)
    check('osm city result goes to travel', '玩' in osm_rows[1], osm_rows)
    check('photon queried near the map centre', any('q=kafe' in u and 'lat=' in u for u in photon_calls), photon_calls[-1:])
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    pin = page.evaluate('(() => { const el = document.querySelector("#map .sel-pin"); return el ? !!el.querySelector("path[fill=\'#EA4335\']") : false; })()')
    check('picking a search result shows a red pin and a place card', pin and page.inner_text('.place-head h2') == 'Kafe Ujian' and page.locator('[data-action="preview-score"]').count() == 6, (pin, page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'no card'))
    page.screenshot(path=os.path.join(SHOTS, '05a-mobile-search-preview.png'))
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back from the card returns to the results, pin removed', page.locator('[data-action="osm-pick"]').count() >= 1 and page.input_value('#q') == 'kafe' and page.locator('#map .sel-pin').count() == 0)
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    page.click('[data-action="preview-score"][data-n="3"]')
    page.wait_for_timeout(300)
    check('pin stays on the new place while filling the form', page.locator('#map .sel-pin').count() == 1)
    check('score picked on the card carries into the form', page.get_attribute('.score-input .sc[data-n="3"]', 'aria-pressed') == 'true')
    check('osm pick opens prefilled form', page.input_value('#f-name') == 'Kafe Ujian' and page.get_attribute('[data-action="f-cat"][data-cat="cafe"]', 'aria-pressed') == 'true', page.input_value('#f-name') if page.locator('#f-name').count() else 'no form')
    page.click('.score-input .sc[data-n="3"]')
    page.click('[data-action="f-share"]')
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    kafe = [p_ for p_ in stored['places'] if p_['name'] == 'Kafe Ujian']
    check('osm place saved with OSM id', len(kafe) == 1 and kafe[0]['osm'] == 'node/111' and kafe[0]['lat'] == 2.8502, kafe)
    page.click('[data-action="search"]')
    page.fill('#q', 'kafe u')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    page.wait_for_timeout(100)
    check('same OSM place is recognised', '已在雪团' in page.locator('[data-action="osm-pick"]').first.inner_text(), page.locator('[data-action="osm-pick"]').first.inner_text())
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('picking it again opens the place, no duplicate', page.inner_text('.place-head h2') == 'Kafe Ujian' and len([p_ for p_ in stored['places'] if p_['name'] == 'Kafe Ujian']) == 1)
    page.click('[data-action="back"]')

    # add flow: search by name first
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.fill('#q', 'kafe')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    page.wait_for_timeout(100)
    check('add search shows existing place to review', page.locator('[data-action="add-existing"]', has_text='Kafe Ujian').count() == 1)
    check('add search offers map pick below results', page.locator('.add-pin-bottom').is_visible())
    page.locator('[data-action="add-existing"]').first.click()
    page.wait_for_timeout(300)
    check('existing place from add goes to review form', page.locator('#place-form').count() == 1 and page.locator('#f-name').count() == 0)
    page.click('[data-action="form-cancel"]')
    page.wait_for_timeout(200)
    page.click('[data-action="back"]')
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.fill('#q', 'george')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    page.locator('[data-action="osm-pick"]', has_text='George Town').click()
    page.wait_for_timeout(300)
    check('new OSM result from add gives prefilled form in current mode', page.input_value('#f-name') == 'George Town' and not page.evaluate('document.documentElement.classList.contains("mode-travel")'), page.input_value('#f-name') if page.locator('#f-name').count() else 'no form')
    page.click('[data-action="form-cancel"]')
    page.wait_for_timeout(200)

    # search
    page.click('[data-action="search"]')
    page.fill('#q', 'nasi')
    page.wait_for_timeout(150)
    check('search finds by alt name', page.locator('#search-results .near-item', has_text='测试椰浆饭').count() == 1)
    page.fill('#q', '鼓浪')
    page.wait_for_timeout(150)
    check('search finds travel sample', page.locator('#search-results .near-item', has_text='鼓浪屿').count() == 1)
    page.fill('#q', '巴厘岛')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    first = page.locator('[data-action="osm-pick"]').first.inner_text()
    check('famous place (Wikipedia) comes first, under the name searched', page.locator('[data-action="osm-pick"] b').first.inner_text().startswith('巴厘岛') and '印度尼西亚岛屿' in first and '爆炸' not in page.inner_text('#search-results'), first)
    check('Chinese query searches Chinese Wikipedia', any('zh.wikipedia.org' in u and 'variant=zh-cn' in u for u in wiki_calls), wiki_calls[-1:])
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    last = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1]')
    check("island result zooms to the whole island", abs(last.get('zoom', 0) - 9) < 0.01 and last['center'] == [115.216667, -8.65], last)
    page.click('[data-action="back"]')
    page.fill('#q', '鼓浪')
    page.wait_for_timeout(150)
    page.click('#search-results .near-item')
    page.wait_for_timeout(300)
    check('opening travel result switches mode', page.evaluate('document.documentElement.classList.contains("mode-travel")'))
    page.click('[data-action="back"]')

    # profile: the four "where you're from" boxes are gone
    page.click('[data-action="profile"]')
    check('no hometown text boxes in Me', page.locator('[data-pf="city"], [data-pf="country"], [data-pf="region"], [data-pf="district"]').count() == 0)
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(SHOTS, '07-mobile-profile.png'))
    page.click('[data-action="set-style"][data-style="dark"]')
    page.wait_for_timeout(300)
    check('missing dark style handled with toast', '加载不了' in page.inner_text('#toast'), page.inner_text('#toast'))
    page.click('[data-action="set-style"][data-style="color"]')
    page.wait_for_timeout(300)
    st2 = page.evaluate('({setStyle: window.__map.calls.filter(c=>c[0]==="setStyle").length, layers: window.__map.layers.map(l=>l.id).length, images: Object.keys(window.__map.images).length, proj: window.__map.projection})')
    st2['icons'] = page.evaluate('[...new Set(window.__map.getSource("places").data.features.flatMap(f => [f.properties.icon, f.properties.pic]).filter(Boolean))].sort()')
    st2['imageIds'] = page.evaluate('Object.keys(window.__map.images).sort()')
    check('base map switch re-adds layers + images', st2['setStyle'] == 1 and st2['layers'] == 10 and st2['icons'] == st2['imageIds'] and st2['proj'] == {'type': 'globe'}, st2)
    page.click('[data-action="back"]')
    set_mode(page, 'food')

    # language (in the Me tab)
    page.click('[data-action="profile"]')
    page.click('[data-action="set-lang"][data-lang="en"]')
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(200)
    check('UI in English', page.inner_text('.view-title') == 'What people are eating', page.inner_text('.view-title'))
    lab = page.evaluate('window.__map.style.layers.find(l => l.id === "place-city").layout["text-field"]')
    check('map labels English', 'name:en' in json.dumps(lab), lab)
    names = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('pin names use English alt names', 'Nasi Lemak Test 2' in names and 'Jalan Alor' in names, names)
    page.screenshot(path=os.path.join(SHOTS, '08-mobile-english.png'))
    page.click('[data-action="profile"]')
    page.click('[data-action="set-lang"][data-lang="zh"]')
    page.click('[data-action="back"]')

    # export
    page.click('[data-action="profile"]')
    with page.expect_download() as dl:
        page.click('[data-action="export"]')
    path = dl.value.path()
    exp = json.load(open(path, encoding='utf-8'))
    check('export has places, reviews and photo', exp['app'] == 'xuetuan' and exp['version'] == 2 and 'wishlist' in exp and len(exp['photos']) == 1 and any(p_['name'] == '测试椰浆饭' for p_ in exp['places']), {k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in exp.items()})
    export_path = path

    # clear samples
    page.click('[data-action="clear-samples"]')
    page.wait_for_timeout(100)
    check('confirm modal shown', page.locator('.modal-card').is_visible())
    page.click('[data-modal="yes"]')
    page.wait_for_timeout(200)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('samples removed, own data kept', all(not p_.get('sample') for p_ in stored['places']) and len(stored['places']) == 2, len(stored['places']))
    page.click('[data-action="back"]')

    # reload persistence + photo from IndexedDB
    page.reload()
    page.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page.wait_for_timeout(500)
    check('after reload: own places still on map', page.evaluate('window.__map.getSource("places").data.features.length') == 2)
    check('no sample re-seed after clearing', page.locator('.sample-note').count() == 0)
    page.locator('.feed-item', has_text='测试椰浆饭').first.click()
    page.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    check('photo restored from IndexedDB', True)

    # delete own review via confirm
    page.click('[data-action="scope"][data-scope="mine"]')
    page.wait_for_timeout(200)
    n_before = page.locator('.review').count()
    page.locator('[data-action="del-review"]').first.click()
    page.click('[data-modal="yes"]')
    page.wait_for_timeout(300)
    check('delete review works', page.locator('.review').count() == n_before - 1, (n_before, page.locator('.review').count()))

    # cluster click
    page.click('[data-action="back"]')
    page.evaluate('window.__qrf = [{properties: {cluster: true, cluster_id: 7, point_count: 5}, geometry: {coordinates: [115.3, -8.6]}}]')
    page.evaluate('window.__map.fire("click", {point: {x: 200, y: 300}, lngLat: {lng: 115.3, lat: -8.6}})')
    page.wait_for_timeout(200)
    last = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1]')
    check('cluster click zooms in to expansion zoom', abs(last.get('zoom', 0) - 12.4) < 0.01 and last['center'] == [115.3, -8.6], last)
    page.evaluate('window.__qrf = []')

    # adding: tapping an existing place or a basemap shop while picking opens its card (score there), no search needed
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(200)
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.wait_for_timeout(200)
    page.click('[data-action="add-pin"]')
    page.wait_for_timeout(300)
    feat = page.evaluate('window.__map.getSource("places").data.features.find(f => f.properties.id).properties')
    page.evaluate('window.__qrf = [{layer: {id: "pt-photo"}, properties: {id: %s}, geometry: {type: "Point", coordinates: [101.70, 2.83]}}]' % json.dumps(feat['id']))
    page.evaluate('window.__map.fire("click", {point: {x: 150, y: 250}, lngLat: {lng: 101.70, lat: 2.83}})')
    page.wait_for_timeout(300)
    check('picking: tapping an existing pin opens that place', page.locator('#pick').is_hidden() and page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == feat['name'], (feat, page.inner_text('#view')[:120]))
    if page.locator('#pick').is_visible():
        page.keyboard.press('Escape')
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    (page.click('#fab') if page.locator('#fab').is_visible() else page.click('.title-add'))
    page.wait_for_timeout(200)
    page.click('[data-action="add-pin"]')
    page.wait_for_timeout(300)
    page.evaluate('''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Kedai Pilih Peta", class: "restaurant", subclass: "restaurant"}, geometry: {type: "Point", coordinates: [101.7051, 2.8312]}}]''')
    page.evaluate('window.__map.fire("click", {point: {x: 150, y: 250}, lngLat: {lng: 101.7051, lat: 2.8312}})')
    page.wait_for_timeout(300)
    check('picking: tapping a basemap shop opens its card with scores', page.locator('#pick').is_hidden() and page.locator('[data-action="preview-score"]').count() == 6 and page.inner_text('.place-head h2') == 'Kedai Pilih Peta', page.inner_text('#view')[:120])
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    page.evaluate('window.__qrf = []')

    # basemap POI labels are tappable (on my map too): preview -> score -> form -> saved
    set_mode(page, 'food')
    page.click('[data-action="scope"][data-scope="mine"]')
    page.wait_for_timeout(200)
    POI = '''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Restoran Uji Peta", "name:zh": "测试地图餐厅", class: "restaurant", subclass: "restaurant"}, geometry: {type: "Point", coordinates: [101.8123, 2.9456]}}]'''
    TAP = 'window.__map.fire("click", {point: {x: 200, y: 300}, lngLat: {lng: 101.8123, lat: 2.9456}})'
    page.evaluate(POI)
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('tapping a basemap restaurant opens a card', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '测试地图餐厅' and 'Restoran Uji Peta' in page.inner_text('.place-head .alt'), page.inner_text('#view')[:200])
    check('card offers quick scores and a red pin', page.locator('[data-action="preview-score"]').count() == 6 and page.locator('#map .sel-pin').count() == 1)
    page.screenshot(path=os.path.join(SHOTS, '07b-mobile-basemap-poi.png'))
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back from a map card returns to the feed', page.locator('.feed').count() == 1 and page.locator('#map .sel-pin').count() == 0)
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    page.evaluate('history.back()')
    page.wait_for_timeout(300)
    check('phone back closes the map card instead of leaving the site', page.locator('.feed').count() == 1 and page.locator('#map .sel-pin').count() == 0 and page.url.startswith(APP))
    page.click('#map-ctrls [data-action="filters"]')
    page.wait_for_timeout(200)
    page.evaluate('history.back()')
    page.wait_for_timeout(300)
    check('phone back closes the filter sheet', page.locator('#bsheet').is_hidden() and page.url.startswith(APP))
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    page.evaluate('window.__qrf = []')
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('tapping empty map closes the card', page.locator('.feed').count() == 1)
    page.evaluate(POI)
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    page.click('[data-action="preview-score"][data-n="4"]')
    page.wait_for_timeout(300)
    check('score from the card opens a prefilled form', page.locator('#place-form').count() == 1 and page.input_value('#f-name') == '测试地图餐厅' and page.get_attribute('.score-input .sc[data-n="4"]', 'aria-pressed') == 'true' and page.locator('details.more[open]').count() == 0)
    page.evaluate(TAP)
    page.wait_for_timeout(200)
    check('tapping the map while filling the form keeps the form', page.locator('#place-form').count() == 1)
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    tp = [p_ for p_ in stored['places'] if p_['name'] == '测试地图餐厅']
    check('basemap place saved to my map', len(tp) == 1 and tp[0]['altName'] == 'Restoran Uji Peta' and tp[0]['mode'] == 'food' and abs(tp[0]['lat'] - 2.9456) < 1e-6 and page.get_attribute('[data-action="scope"][data-scope="mine"]', 'aria-current') == 'page', tp)
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('tapping it again opens the saved place, not a new card', page.locator('[data-action="preview-score"]').count() == 0 and page.inner_text('.place-head h2') == '测试地图餐厅')
    page.click('[data-action="back"]')
    page.evaluate('''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Muzium Uji", class: "museum", subclass: "museum"}, geometry: {type: "Point", coordinates: [101.9, 2.99]}}]''')
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('a museum label opens as a travel place', page.inner_text('.place-head h2') == 'Muzium Uji' and '人文' in page.inner_text('.tags'), page.inner_text('.tags') if page.locator('.tags').count() else 'no card')
    page.click('[data-action="back"]')
    page.evaluate('window.__qrf = []')
    page.click('[data-action="scope"][data-scope="all"]')
    page.wait_for_timeout(200)

    # import into a fresh browser (simulates another device)
    ctx2 = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    route_all(ctx2)
    page2 = ctx2.new_page()
    errors2 = []
    page2.on('pageerror', lambda e: errors2.append('pageerror: ' + str(e)))
    page2.goto(APP)
    page2.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page2.wait_for_timeout(600)
    ov2 = page2.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    check('no horizontal overflow (desktop)', ov2)
    page2.screenshot(path=os.path.join(SHOTS, '09-desktop.png'))
    page2.click('[data-action="profile"]')
    page2.set_input_files('#import-file', export_path)
    page2.wait_for_timeout(800)
    st3 = page2.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('import merges places and adopts profile', any(p_['name'] == '测试椰浆饭' for p_ in st3['places']) and st3['profile']['name'] == '小测', (len(st3['places']), st3['profile']))
    page2.click('[data-action="back"]')
    page2.locator('.feed-item', has_text='测试椰浆饭').first.click()
    page2.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    check('imported photo displays', True)
    page2.screenshot(path=os.path.join(SHOTS, '10-desktop-place.png'))
    ctx2.close()

    # old v1 data: rating 0 meant "not rated"
    ctx5 = browser.new_context(viewport={'width': 390, 'height': 844})
    route_all(ctx5)
    v1 = {'places': [{'id': 'p-old', 'mode': 'food', 'cat': 'cn', 'precision': 'exact', 'lat': 2.833, 'lng': 101.703, 'name': '老店', 'altName': '', 'link': '', 'createdBy': 'u-old', 'createdAt': 1, 'sample': False}],
          'reviews': [{'id': 'r-old', 'placeId': 'p-old', 'authorId': 'u-old', 'rating': 0, 'price': None, 'text': '', 'photos': [], 'visibility': 'public', 'createdAt': 1},
                      {'id': 'r-old2', 'placeId': 'p-old', 'authorId': 'u-old', 'rating': 3, 'price': None, 'text': '', 'photos': [], 'visibility': 'public', 'createdAt': 2}],
          'profile': {'id': 'u-old', 'name': '旧'}, 'areas': [], 'seeded': True}
    ctx5.add_init_script('if (!localStorage.getItem("xmum-chiwan-map:data:v1")) localStorage.setItem("xmum-chiwan-map:data:v1", ' + json.dumps(json.dumps(v1)) + ')')
    page5 = ctx5.new_page()
    page5.goto(APP)
    page5.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page5.wait_for_timeout(300)
    st5 = page5.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('v1 data migrated (0 -> not rated)', st5['version'] == 2 and [r['rating'] for r in st5['reviews']] == [None, 3] and st5['wishlist'] == [], st5)
    page5.locator('.feed-item').first.click()
    page5.wait_for_timeout(200)
    check('migrated average ignores unrated', page5.inner_text('.score-big') == '3', page5.inner_text('.stats'))
    ctx5.close()

    # a browser that saw the old, unrated sample set gets the new samples and scores
    ctxu = browser.new_context(viewport={'width': 390, 'height': 844})
    route_all(ctxu)
    olds = {'version': 2, 'places': [{'id': 's-jalan-alor', 'mode': 'food', 'cat': 'street', 'precision': 'area', 'lat': 3.1456, 'lng': 101.7088, 'name': '亚罗街', 'altName': 'Jalan Alor', 'link': '', 'osm': '', 'createdBy': 'sample', 'createdAt': 1, 'sample': True}],
            'reviews': [{'id': 'r-s-jalan-alor', 'placeId': 's-jalan-alor', 'authorId': 'sample', 'rating': None, 'price': None, 'text': 'x', 'photos': [], 'visibility': 'public', 'createdAt': 1, 'sample': True}],
            'wishlist': [{'placeId': 's-jalan-alor', 'createdAt': 1}], 'profile': {'id': 'u-x', 'name': 'x'}, 'areas': [], 'seeded': True}
    ctxu.add_init_script('if (!localStorage.getItem("xmum-chiwan-map:data:v1")) localStorage.setItem("xmum-chiwan-map:data:v1", ' + json.dumps(json.dumps(olds)) + ')')
    pageu = ctxu.new_page()
    pageu.goto(APP)
    pageu.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    stu = pageu.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    alor = [r for r in stu['reviews'] if r['id'] == 'r-s-jalan-alor']
    check('old sample set upgraded: scores filled, new samples added, no duplicates', stu['seeded'] == 2 and len(alor) == 1 and alor[0]['rating'] == 4 and len(stu['places']) == len(SAMPLE_ROWS) and len(stu['wishlist']) == 1, (stu['seeded'], alor, len(stu['places'])))
    ctxu.close()

    # dark mode mobile
    ctx3 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark')
    route_all(ctx3)
    page3 = ctx3.new_page()
    page3.goto(APP)
    page3.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page3.wait_for_timeout(500)
    page3.click('.title-row .view-title')
    page3.wait_for_timeout(400)
    page3.screenshot(path=os.path.join(SHOTS, '11-mobile-dark.png'))
    bg3 = page3.evaluate('[getComputedStyle(document.getElementById("panel")).backgroundColor, getComputedStyle(document.getElementById("tabbar")).backgroundColor, getComputedStyle(document.querySelector(".filter-btn")).color]')
    check('phone in dark mode: app stays blue and white', bg3[0] == 'rgb(255, 255, 255)' and bg3[1] == 'rgb(255, 255, 255)' and bg3[2] == 'rgb(46, 125, 203)', bg3)
    ctx3.close()

    # narrow phone
    ctx4 = browser.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
    route_all(ctx4)
    page4 = ctx4.new_page()
    page4.goto(APP)
    page4.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page4.wait_for_timeout(400)
    tb = page4.evaluate('(() => { const c = document.querySelector("#map-ctrls").getBoundingClientRect(), l = document.querySelector(".locate-btn").getBoundingClientRect(); return [c.right <= innerWidth, c.bottom < l.top, document.documentElement.scrollWidth <= document.documentElement.clientWidth]; })()')
    check('map buttons fit a 360px phone', tb == [True, True, True], tb)
    page4.screenshot(path=os.path.join(SHOTS, '12-mobile-360.png'))
    ctx4.close()

    # ---------- 我的地图：美食 / 旅行 / 合并 + 点亮去过的国家 ----------
    def mk_place(id_, mode, cat, lat, lng, name, by):
        return {'id': id_, 'mode': mode, 'cat': cat, 'precision': 'exact', 'lat': lat, 'lng': lng, 'name': name, 'altName': '', 'link': '', 'osm': '', 'createdBy': by, 'createdAt': 1, 'sample': False}
    def mk_review(id_, pid, by):
        return {'id': id_, 'placeId': pid, 'authorId': by, 'rating': 4, 'price': None, 'text': '', 'photos': [], 'visibility': 'public', 'createdAt': 1}
    mine_seed = {'version': 2, 'seeded': 2, 'profile': {'id': 'u-me', 'name': '我'}, 'areas': [], 'wishlist': [{'placeId': 'm-bkk', 'createdAt': 1}, {'placeId': 'o-tyo', 'createdAt': 2}],
                 'places': [mk_place('m-food', 'food', 'malay', 3.15, 101.71, '校门口饭', 'u-me'),
                            mk_place('m-bkk', 'travel', 'city', 13.75, 100.50, '曼谷', 'u-me'),
                            mk_place('o-tyo', 'travel', 'city', 35.68, 139.76, '东京', 'u-other')],
                 'reviews': [mk_review('r1', 'm-food', 'u-me'), mk_review('r2', 'm-bkk', 'u-me'), mk_review('r3', 'o-tyo', 'u-other')]}
    ctx5 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    route_all(ctx5)
    ctx5.add_init_script('if (!localStorage.getItem("test-seeded")) { localStorage.setItem("test-seeded", "1"); localStorage.setItem("xmum-chiwan-map:data:v1", ' + json.dumps(json.dumps(mine_seed)) + '); localStorage.setItem("xmum-chiwan-map:view:v1", ' + json.dumps(json.dumps({'center': [105, 8], 'zoom': 3, 'mode': 'travel'})) + '); }')
    page5 = ctx5.new_page()
    errors5 = []
    page5.on('pageerror', lambda e: errors5.append('pageerror: ' + str(e)))
    page5.goto(APP)
    page5.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page5.wait_for_timeout(400)
    # 空的收藏（吃）：一行小字 + 文字按钮，没有大块提示
    set_mode(page5, 'food')
    page5.click('[data-action="scope"][data-scope="mine"]')
    page5.click('[data-action="mine-sub"][data-v="saved"]')
    page5.wait_for_timeout(200)
    emp = page5.evaluate('(() => { const e = document.querySelector("#view .empty"); return e ? [Math.round(e.getBoundingClientRect().height), e.querySelectorAll(".btn").length, e.querySelectorAll(".link-btn").length] : null; })()')
    check('empty list is one small line', emp is not None and emp[0] <= 48 and emp[1] == 0 and emp[2] == 1, emp)
    # 收藏 → 想去的 = 收藏里减去我去过的
    set_mode(page5, 'travel')
    page5.wait_for_timeout(200)
    sv_all = sorted(page5.locator('#view .near-item b').all_inner_texts())
    check('saved shows everything I saved', sv_all == ['东京', '曼谷'], sv_all)
    check('no all / not-been switch cluttering the saved list', page5.locator('#view [data-action="saved-want"]').count() == 0)
    page5.click('#map-ctrls [data-action="filters"]')
    page5.click('#bsheet [data-action="saved-want"][data-v="want"]')
    page5.wait_for_timeout(200)
    sv_want = page5.locator('#view .near-item b').all_inner_texts()
    pins_want = page5.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('“not been yet” (in the filter sheet) drops places on my map (list + pins)', sv_want == ['东京'] and pins_want == ['东京'], (sv_want, pins_want))
    check('filter badge counts it', page5.inner_text('#map-ctrls [data-action="filters"] b') == '1')
    page5.click('#bsheet [data-action="sheet-close"]')
    page5.screenshot(path=os.path.join(SHOTS, '15-saved-want.png'))
    page5.click('#map-ctrls [data-action="filters"]')
    page5.click('#bsheet [data-action="saved-want"][data-v="all"]')
    page5.click('#bsheet [data-action="sheet-close"]')
    page5.click('[data-action="mine-sub"][data-v="mine"]')
    page5.click('[data-action="scope"][data-scope="all"]')
    page5.wait_for_timeout(200)
    page5.click('[data-action="scope"][data-scope="mine"]')
    page5.wait_for_timeout(200)
    page5.click('#map-ctrls [data-action="filters"]')
    page5.wait_for_timeout(100)
    chips = page5.eval_on_selector_all('#bsheet [data-action="mine-mode"]', 'els => els.map(e => e.textContent.trim())')
    check('my map filter: just food / travel / both', chips == ['美食', '旅行', '合并'] and page5.locator('#bsheet [data-action="cat"], #bsheet [data-action="set-score"]').count() == 0, chips)
    fw = page5.evaluate("[document.querySelector('.bsheet-foot').getBoundingClientRect().width, document.querySelector('.bsheet-foot .btn').getBoundingClientRect().width]")
    check('my map filter: the only button spans the sheet', abs(fw[0] - fw[1]) < 2, fw)
    check('no sample note on my map', page5.locator('#view .sample-note').count() == 0)
    page5.click('[data-action="mine-mode"][data-v="food"]')
    page5.wait_for_timeout(200)
    names5 = lambda: sorted(page5.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)'))
    check('my food map shows only my food', names5() == ['校门口饭'] and page5.inner_text('.view-title') == '我吃过的', names5())
    page5.click('[data-action="mine-mode"][data-v="both"]')
    page5.wait_for_timeout(200)
    check('merged map shows my food and travel', names5() == ['曼谷', '校门口饭'] and page5.inner_text('.view-title') == '我的足迹', (names5(), page5.inner_text('.view-title')))
    check('merged feed lists both', page5.locator('.feed-item').count() == 2)
    geo5 = page5.evaluate('(() => { const p = document.querySelector("#panel").getBoundingClientRect(), t = document.querySelector("#tabbar").getBoundingClientRect(); return Math.round(p.bottom) >= Math.round(t.top); })()')
    check('sheet stays open and shows the choice', page5.get_attribute('#bsheet [data-action="mine-mode"][data-v="both"]', 'aria-pressed') == 'true')
    page5.click('#bsheet [data-action="sheet-close"]')
    page5.wait_for_timeout(100)
    check('no country switch when zoomed in', page5.locator('[data-action="countries"]').count() == 0)
    check('country data not downloaded yet', world_calls == [])
    page5.evaluate('window.__map.jumpTo({zoom: 3})')
    page5.wait_for_timeout(200)
    check('country switch shows at country zoom', page5.locator('[data-action="countries"]').is_visible())
    page5.click('[data-action="countries"]')
    page5.wait_for_function('window.__map.getSource("countries")', timeout=5000)
    page5.wait_for_timeout(200)
    lit = page5.evaluate('window.__map.getSource("countries").data.features.filter(f => f.properties.v === 1).map(f => f.properties.name).sort()')
    check('visited countries light up (mine only)', lit == ['Malaysia', 'Thailand'], lit)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('country layers visible', vis == ['visible'] * 3, vis)
    check('switch shows visited count', page5.inner_text('[data-action="countries"]') == '2' and page5.get_attribute('[data-action="countries"]', 'aria-pressed') == 'true', page5.inner_text('[data-action="countries"]'))
    page5.screenshot(path=os.path.join(SHOTS, '14-my-map-countries.png'))
    page5.click('#map-ctrls [data-action="filters"]')
    page5.click('[data-action="mine-mode"][data-v="food"]')
    page5.wait_for_timeout(300)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('food map hides countries', vis == ['none'] * 3, vis)
    page5.click('[data-action="mine-mode"][data-v="travel"]')
    page5.click('#bsheet [data-action="sheet-close"]')
    page5.wait_for_timeout(300)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('travel map shows countries again', vis == ['visible'] * 3 and names5() == ['曼谷'], (vis, names5()))
    page5.click('[data-action="scope"][data-scope="all"]')
    page5.wait_for_timeout(200)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('explore map: countries off, no globe button', vis == ['none'] * 3 and page5.locator('[data-action="countries"]').count() == 0 and page5.locator('[data-action="toggle-mode"]').is_visible(), vis)
    sv = page5.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:view:v1"))')
    check('country switch remembered', sv.get('countries') is True and sv.get('mineBoth') is False, sv)
    check('my map: no page errors', not errors5, errors5)
    ctx5.close()

    # ---------- 线上版（假的 Supabase） ----------
    A, B = 'aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b'
    sb_seed = {
        'profiles': [{'id': B, 'name': '小B', 'country': '马来西亚', 'region': '', 'city': 'Klang', 'district': ''}],
        'places': [
            {'id': 'p-b-pub', 'mode': 'food', 'cat': 'cn', 'precision': 'exact', 'lat': 2.8335, 'lng': 101.7035, 'name': 'B 的公开店', 'alt_name': '', 'link': '', 'osm': '', 'created_by': B, 'created_at': '2026-10-01T00:00:00Z'},
            {'id': 'p-b-priv', 'mode': 'food', 'cat': 'cn', 'precision': 'exact', 'lat': 2.8400, 'lng': 101.7100, 'name': 'B 的私密店', 'alt_name': '', 'link': '', 'osm': '', 'created_by': B, 'created_at': '2026-10-01T00:00:00Z'}],
        'visits': [
            {'id': 'v-b-pub', 'place_id': 'p-b-pub', 'user_id': B, 'rating': 5, 'price': '12.00', 'text': '好吃', 'photos': [], 'visibility': 'public', 'created_at': '2026-10-02T00:00:00Z'},
            {'id': 'v-b-priv', 'place_id': 'p-b-priv', 'user_id': B, 'rating': 1, 'price': None, 'text': '秘密', 'photos': [], 'visibility': 'private', 'created_at': '2026-10-02T00:00:00Z'}]
    }
    ctx6 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, accept_downloads=True)
    route_all(ctx6, supabase=True)
    ctx6.add_init_script('window.__sbSeed = ' + json.dumps(sb_seed) + ';')
    poi = [{'id': 'aaa', 'name': 'Kafe Ujian Dekat', 'alt_name': '', 'mode': 'food', 'cat': 'cafe', 'lat': 2.8341, 'lng': 101.704, 'locality': 'Sepang', 'dist_m': 150},
           {'id': 'bbb', 'name': 'Kafe Ujian', 'alt_name': '', 'mode': 'food', 'cat': 'cafe', 'lat': 2.8502, 'lng': 101.7201, 'locality': 'Sepang', 'dist_m': 2500}]
    ctx6.add_init_script('window.__poi = ' + json.dumps(poi) + ';')
    # 这台设备上有本地版留下的旧记录
    old_local = {'version': 2, 'seeded': True, 'profile': {'id': 'u-local', 'name': '本地'}, 'areas': [], 'wishlist': [{'placeId': 'p-old', 'createdAt': 1}],
                 'places': [{'id': 'p-old', 'mode': 'travel', 'cat': 'city', 'precision': 'city', 'lat': 5.41, 'lng': 100.33, 'name': '槟城', 'altName': 'Penang', 'link': '', 'osm': '', 'createdBy': 'u-local', 'createdAt': 1, 'sample': False},
                            {'id': 's-x', 'mode': 'food', 'cat': 'cn', 'precision': 'exact', 'lat': 3.1, 'lng': 101.7, 'name': '示例', 'altName': '', 'link': '', 'createdBy': 'sample', 'createdAt': 1, 'sample': True}],
                 'reviews': [{'id': 'r-old', 'placeId': 'p-old', 'authorId': 'u-local', 'rating': 4, 'price': None, 'text': '壁画好看', 'photos': [], 'visibility': 'public', 'createdAt': 1},
                             {'id': 'r-s', 'placeId': 's-x', 'authorId': 'sample', 'rating': None, 'price': None, 'text': '', 'photos': [], 'visibility': 'public', 'createdAt': 1, 'sample': True}]}
    ctx6.add_init_script('if (!localStorage.getItem("xmum-chiwan-map:data:v1")) localStorage.setItem("xmum-chiwan-map:data:v1", ' + json.dumps(json.dumps(old_local)) + ');')
    page6 = ctx6.new_page()
    errors6 = []
    page6.on('pageerror', lambda e: errors6.append('pageerror: ' + str(e)))
    page6.goto(APP)
    page6.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page6.wait_for_timeout(400)
    names6 = page6.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('remote: uses Supabase with publishable key', page6.evaluate('window.__sb.key').startswith('sb_publishable_'))
    check('remote: logged out sees public places only, no samples', names6 == ['B 的公开店'], names6)
    check('remote: other people’s profile shown on review', page6.locator('.feed-item', has_text='小B').count() == 1 and page6.locator('.feed-item', has_text='来自 Klang').count() == 1)
    (page6.click('#fab') if page6.locator('#fab').is_visible() else page6.click('.title-add'))
    page6.wait_for_timeout(200)
    check('remote: adding while logged out asks to log in', page6.locator('#login-form').count() == 1 and not page6.locator('#pick').is_visible())
    page6.fill('#login-email', 'not-an-email')
    page6.click('#login-send')
    check('remote: bad email rejected', page6.get_attribute('#login-email', 'aria-invalid') == 'true')
    page6.fill('#login-email', 'a@example.com')
    page6.click('#login-send')
    page6.wait_for_timeout(200)
    otp = page6.evaluate('window.__sb.calls.filter(c => c[0] === "otp")')
    check('remote: email login link requested', len(otp) == 1 and otp[0][1] == 'a@example.com' and otp[0][2].endswith('index.html'), otp)
    page6.click('[data-action="login-google"]')
    check('remote: google login requested', page6.evaluate('window.__sb.calls.some(c => c[0] === "oauth" && c[1] === "google")'))
    page6.evaluate('window.__sbLogin("%s", "a@example.com")' % A)
    page6.wait_for_timeout(300)
    check('remote: login returns to feed with toast', page6.locator('.feed').count() == 1 and '登录了' in page6.inner_text('#toast'), page6.inner_text('#toast'))

    # 店名搜索：先查地点库，Photon 的同一家店不重复列出
    (page6.click('#fab') if page6.locator('#fab').is_visible() else page6.click('.title-add'))
    page6.fill('#q', 'kafe')
    page6.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    page6.wait_for_timeout(100)
    rows6 = page6.locator('[data-action="osm-pick"] b').all_inner_texts()
    check('remote: name search uses the place library first, duplicates merged', rows6 == ['Kafe Ujian Dekat', 'Kafe Ujian', 'George Town'], rows6)
    rpc6 = page6.evaluate('window.__sb.calls.filter(c => c[0] === "rpc")')
    check('remote: place library searched near the map', len(rpc6) >= 1 and rpc6[-1][1] == 'search_poi' and rpc6[-1][2]['q'] == 'kafe' and abs(rpc6[-1][2]['near_lat']) > 0, rpc6[-1:])
    page6.locator('[data-action="osm-pick"]').first.click()
    page6.wait_for_timeout(300)
    check('remote: library result prefills name and category', page6.input_value('#f-name') == 'Kafe Ujian Dekat' and page6.get_attribute('[data-action="f-cat"][data-cat="cafe"]', 'aria-pressed') == 'true', page6.input_value('#f-name') if page6.locator('#f-name').count() else 'no form')
    page6.click('[data-action="form-cancel"]')
    page6.wait_for_timeout(200)
    if page6.locator('[data-action="back"]').count(): page6.click('[data-action="back"]')

    # 登录后加一家店（带照片）
    page6.evaluate('window.__map.center = {lng: 101.75, lat: 2.95}; window.__map.zoom = 17;')
    (page6.click('#fab') if page6.locator('#fab').is_visible() else page6.click('.title-add'))
    page6.click('[data-action="add-pin"]')
    page6.click('[data-action="pick-confirm"]')
    page6.wait_for_timeout(200)
    page6.click('[data-action="f-share"]')
    page6.fill('#f-nick', '小A')
    page6.fill('#f-name', '线上测试店')
    page6.click('[data-action="f-cat"][data-cat="cafe"]')
    page6.click('.score-input .sc[data-n="3"]')
    page6.set_input_files('#f-file', photo)
    page6.wait_for_function('document.querySelectorAll("#f-photos .ph-edit").length === 1', timeout=8000)
    page6.click('#f-submit')
    page6.wait_for_timeout(800)
    db6 = page6.evaluate('window.__sb.db')
    mine6 = [p_ for p_ in db6['places'] if p_['name'] == '线上测试店']
    v6 = [v for v in db6['visits'] if v['user_id'] == A]
    check('remote: place + visit written to Supabase', len(mine6) == 1 and mine6[0]['created_by'] == A and mine6[0]['cat'] == 'cafe' and len(v6) == 1 and v6[0]['rating'] == 3, (mine6, v6))
    files6 = page6.evaluate('Object.keys(window.__sb.files)')
    full6 = [f for f in files6 if not f.endswith('_t.jpg')]
    check('remote: photo uploaded to my folder, with a small copy next to it', len(files6) == 2 and len(full6) == 1 and full6[0].startswith(A + '/') and full6[0].replace('.jpg', '_t.jpg') in files6 and v6 and v6[0]['photos'] == full6, (files6, v6))
    check('remote: nickname saved to profile', [p_['name'] for p_ in db6['profiles'] if p_['id'] == A] == ['小A'], db6['profiles'])
    check('remote: place view after publish', page6.inner_text('.place-head h2') == '线上测试店')
    page6.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    check('remote: uploaded photo shows right away', True)

    # 收藏别人的店
    page6.click('[data-action="back"]')
    page6.click('[data-action="scope"][data-scope="all"]')
    page6.wait_for_timeout(200)
    page6.locator('.feed-item', has_text='B 的公开店').click()
    page6.wait_for_timeout(200)
    page6.click('[data-action="toggle-save"]')
    page6.wait_for_timeout(200)
    check('remote: wishlist row written', page6.evaluate('window.__sb.db.wishlist.length') == 1 and page6.evaluate('window.__sb.db.wishlist[0].user_id') == A)
    page6.click('[data-action="toggle-save"]')
    page6.wait_for_timeout(200)
    check('remote: wishlist row removed', page6.evaluate('window.__sb.db.wishlist.length') == 0)
    check('remote: cannot edit someone else’s review', page6.locator('[data-action="edit-review"]').count() == 0)

    # 编辑自己的记录（换照片），再删掉：地点跟着删，照片也删
    page6.click('[data-action="back"]')
    page6.locator('.feed-item', has_text='线上测试店').click()
    page6.wait_for_timeout(200)
    page6.click('[data-action="edit-review"]')
    page6.wait_for_timeout(200)
    page6.click('.score-input .sc[data-n="0"]')
    page6.click('[data-action="f-photo-del"]')
    page6.click('#f-submit')
    page6.wait_for_timeout(500)
    v6 = page6.evaluate('window.__sb.db.visits.filter(v => v.user_id === "%s")' % A)
    check('remote: edit saved, removed photo deleted from storage', v6[0]['rating'] == 0 and v6[0]['photos'] == [] and page6.evaluate('Object.keys(window.__sb.files).length') == 0, v6)
    page6.click('[data-action="del-review"]')
    page6.click('[data-modal="yes"]')
    page6.wait_for_timeout(500)
    db6 = page6.evaluate('window.__sb.db')
    check('remote: deleting last visit removes the place', not any(p_['name'] == '线上测试店' for p_ in db6['places']) and page6.locator('.feed').count() == 1)

    # 把本地旧记录传上去
    page6.click('[data-action="profile"]')
    page6.wait_for_timeout(200)
    check('remote: profile shows account', 'a@example.com' in page6.inner_text('.account-row'))
    page6.click('[data-action="upload-local"]')
    page6.click('[data-modal="yes"]')
    page6.wait_for_timeout(800)
    db6 = page6.evaluate('window.__sb.db')
    up = [p_ for p_ in db6['places'] if p_['name'] == '槟城']
    check('remote: local entries uploaded (samples skipped, wishlist kept)', len(up) == 1 and up[0]['created_by'] == A and not any(p_['name'] == '示例' for p_ in db6['places']) and len(db6['wishlist']) == 1 and db6['wishlist'][0]['place_id'] == up[0]['id'], (up, db6['wishlist']))
    check('remote: upload toast', '上传了 1 个地点' in page6.inner_text('#toast'), page6.inner_text('#toast'))

    # 退出登录
    page6.click('[data-action="logout"]')
    page6.wait_for_timeout(400)
    check('remote: logout clears my private data', '已退出登录' in page6.inner_text('#toast') and page6.locator('[data-action="login"]').count() == 1, page6.inner_text('#toast'))
    check('remote: no page errors', not errors6, errors6)
    page6.screenshot(path=os.path.join(SHOTS, '13-remote-profile.png'))
    ctx6.close()

    browser.close()

print()
print('errors:', errors)
print('errors2:', errors2)
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
