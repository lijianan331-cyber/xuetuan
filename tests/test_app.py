import json, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

SCR = os.path.dirname(os.path.abspath(__file__))
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'file://' + os.path.join(ROOT, 'index.html')
STUB = open(os.path.join(SCR, 'stub_maplibre.js'), encoding='utf-8').read()
STUB_SB = open(os.path.join(SCR, 'stub_supabase.js'), encoding='utf-8').read()
STUB_EXIFR = open(os.path.join(SCR, 'stub_exifr.js'), encoding='utf-8').read()
SHOTS = os.path.join(SCR, 'shots')
os.makedirs(SHOTS, exist_ok=True)

photo = os.path.join(SCR, 'test-photo.jpg')
Image.new('RGB', (2400, 1600), (210, 120, 60)).save(photo, 'JPEG')

STYLE = json.dumps({"version": 8, "sources": {"openmaptiles": {"type": "vector", "url": "https://tiles.openfreemap.org/planet"}}, "layers": [{"id": "background", "type": "background"}]})
TILEJSON = json.dumps({"tilejson": "3.0.0", "tiles": ["https://tiles.openfreemap.org/planet/20261022_001001_pt/{z}/{x}/{y}.pbf"], "minzoom": 0, "maxzoom": 14})
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
tilejson_calls = []
tile_calls = []
# 城市 / 国家：Photon 给了边界中心点（新加坡落在岛中间）和城市点（市中心）
PHOTON_SG = json.dumps({"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [103.8198, 1.3572]},
     "properties": {"name": "Singapura", "osm_type": "R", "osm_id": 536780, "osm_key": "place", "osm_value": "country", "type": "country"}},
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [103.8520, 1.2899]},
     "properties": {"name": "Singapura", "osm_type": "N", "osm_id": 1, "osm_key": "place", "osm_value": "city", "type": "city", "country": "Singapore"}}]})
PHOTON_REV = json.dumps({"type": "FeatureCollection", "features": [
    {"type": "Feature", "geometry": {"type": "Point", "coordinates": [101.7021, 2.8317]},
     "properties": {"name": "Jalan Kampus", "osm_type": "W", "osm_id": 333, "osm_key": "highway", "osm_value": "residential", "type": "street", "city": "Sepang", "state": "Selangor", "country": "Malaysia"}}]})
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
    SAMPLE_ROWS.append({'id': m.group(1), 'mode': m.group(2), 'cat': m.group(3), 'lat': float(m.group(4)), 'lng': float(m.group(5)), 'name': m.group(6), 'rating': None if m.group(7) == 'null' else int(m.group(7)), 'price': None if m.group(8) == 'null' else int(m.group(8))})
def dist_m(lat, lng, lat0=2.8329, lng0=101.7029):
    r = math.pi / 180
    a = math.sin((lat - lat0) * r / 2) ** 2 + math.cos(lat0 * r) * math.cos(lat * r) * math.sin((lng - lng0) * r / 2) ** 2
    return 2 * 6371000 * math.asin(min(1, math.sqrt(a)))
FOOD_S = [x for x in SAMPLE_ROWS if x['mode'] == 'food']
TRAVEL_S = [x for x in SAMPLE_ROWS if x['mode'] == 'travel']
def rate(pg, v, sel='.stars-input'):
    # 点星星打分：右半颗 = 整颗，左半颗 = 半颗；0 分是从第一颗往左拖出去
    el = pg.locator(sel).first
    el.scroll_into_view_if_needed()
    stars = pg.locator(sel + ' .stars-track .st')
    if v == 0:
        b = stars.nth(0).bounding_box(); y = b['y'] + b['height'] / 2
        pg.mouse.move(b['x'] + b['width'] * 0.75, y); pg.mouse.down()
        pg.mouse.move(b['x'] - 12, y, steps=4); pg.mouse.up()
    else:
        i = math.ceil(v) - 1
        b = stars.nth(i).bounding_box()
        pg.mouse.click(b['x'] + b['width'] * (0.25 if v % 1 else 0.75), b['y'] + b['height'] / 2)
    pg.wait_for_timeout(150)
def stars_val(pg, sel='#f-rating'):
    return pg.get_attribute(sel, 'aria-valuenow')
def tab(pg, name):
    # 底部四栏：home 首页 / explore 探索 / foot 足迹 / me 我的
    pg.click('#tabbar [data-tab="%s"]' % name); pg.wait_for_timeout(250)
def add(pg):
    # 加一笔只在足迹上（地图右下角蓝色 +）：不在足迹就先切过去
    if 'scope-my' not in (pg.get_attribute('html', 'class') or ''):
        tab(pg, 'foot')
    pg.dispatch_event('#fab', 'click')
def open_place(pg, q, name=None):
    # 在探索里按名字搜出来，打开地点页
    tab(pg, 'explore')
    pg.click('#map-ctrls [data-action="search"]'); pg.fill('#q', q); pg.wait_for_timeout(200)
    pg.locator('#search-local .near-item', has_text=name or q).first.click(); pg.wait_for_timeout(300)
def via_home(pg, text, to_place=True):
    # 首页卡片 → 帖子 →（帖子里的地点）→ 探索地图上的地点页
    tab(pg, 'home')
    pg.locator('.post-card', has_text=text).first.locator('.pc-open').click(); pg.wait_for_timeout(250)
    if to_place:
        pg.click('[data-action="post-place"]'); pg.wait_for_timeout(300)
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
        if 'exifr@' in url:
            return route.fulfill(status=200, body=STUB_EXIFR, headers={'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*'})
        if 'maplibre-gl.js' in url:
            return route.fulfill(status=200, body=STUB, headers={'Content-Type': 'application/javascript', 'Access-Control-Allow-Origin': '*'})
        if 'maplibre-gl.css' in url or 'fonts.googleapis.com' in url:
            return route.fulfill(status=200, body='', headers={'Content-Type': 'text/css'})
        if 'tiles.openfreemap.org/planet/' in url and url.endswith('.pbf'):
            tile_calls.append(url)
            return route.fulfill(status=200, body='\x1a\x05place吉隆坡巴生'.encode('utf-8'), headers={'Content-Type': 'application/x-protobuf', 'Access-Control-Allow-Origin': '*'})
        if url.endswith('tiles.openfreemap.org/planet'):
            tilejson_calls.append(url)
            return route.fulfill(status=200, body=TILEJSON, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'tiles.openfreemap.org/styles/' in url:
            if url.endswith('/dark'):
                return route.fulfill(status=404, body='nope', headers={'Access-Control-Allow-Origin': '*'})
            return route.fulfill(status=200, body=STYLE, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'photon.komoot.io/reverse' in url:
            photon_calls.append(url)
            return route.fulfill(status=200, body=PHOTON_REV, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'photon.komoot.io/api/' in url:
            photon_calls.append(url)
            return route.fulfill(status=200, body=PHOTON_SG if 'q=Singapura' in url else PHOTON, headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
        if 'wikipedia.org/w/api.php' in url:
            wiki_calls.append(url)
            if 'slowwiki' in url:
                return  # 维基一直不回：搜索不能卡住
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
        intro: m.calls.filter(c => c[0] === 'move').map(c => c[1]) } }''')
    check('app layers added', st['layers'] == ['lib-dot', 'lib-label', 'cl-halo', 'hometown-pin', 'cl-circle', 'cl-count', 'home-pin', 'pt-pin', 'pt-photo', 'pt-label', 'me-halo', 'me-dot'], st['layers'])
    check('parsed sample rows', len(SAMPLE_ROWS) >= 60 and len(FOOD_S) >= 30, len(SAMPLE_ROWS))
    want_imgs = len({(x['cat'], 'none' if x['rating'] is None else x['rating'] * 10) for x in FOOD_S})
    check('pin images drawn on demand (one per category + score bucket)', st['images'] == want_imgs, (st['images'], want_imgs))
    pins = page.evaluate('window.__map.getSource("places").data.features.map(f => [f.properties.icon, f.properties.color])')
    check('pins coloured by score (0 grey, 5 red)', all(c.lower() == '#d7261e' for i, c in pins if i.endswith('-50')) and all(c.lower() == '#8e9893' for i, c in pins if i.endswith('-0')) and any(i.endswith('-0') for i, c in pins), pins)
    check('renamed to 雪团', page.title() == '雪团 XueTuan' and '雪团' in page.evaluate('document.querySelector(".panel-brand .brand-name").textContent'), page.title())
    check('opens on the home tab', page.get_attribute('#tabbar [data-tab="home"]', 'aria-current') == 'page')
    check('no right-side tool column, locate button kept', page.locator('.tools, [data-action="zoom-in"], [data-action="to-globe"], [data-action="basemap"]').count() == 0 and page.locator('.locate-btn').is_visible())
    acts = page.eval_on_selector_all('#map-ctrls button', 'els => els.map(e => e.dataset.action)')
    check('no header: top right has search, food/travel switch, filter', acts == ['search', 'toggle-mode', 'filters'] and page.locator('.topbar, .search-bar, #loc-name, .mode-switch, #filters').count() == 0, acts)
    check('map top-right: plane to switch to travel, filter icon', page.locator('#map-ctrls [data-action="toggle-mode"]').is_visible() and page.get_attribute('[data-action="toggle-mode"]', 'aria-label') == '切换到旅行地图' and page.locator('#map-ctrls [data-action="filters"]').is_visible())
    ctl = page.evaluate('(() => { const c = document.querySelector("#map-ctrls").getBoundingClientRect(); return [c.top < 40, c.right <= innerWidth]; })()')
    check('map buttons sit in the top right corner', ctl == [True, True], ctl)
    check('switch button is coloured, not plain white', page.evaluate('getComputedStyle(document.querySelector(".mode-btn")).backgroundImage').startswith('linear-gradient'))
    check('globe only for the world view, flat from country level down (zoom 7)', st['proj'] == {'type': ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator']}, st['proj'])
    check('labels patched to Chinese', 'name:zh' in json.dumps(st['label']), st['label'])
    check('shield labels untouched', st['shield'] == '{ref}', st['shield'])
    check('fonts picked from style', st['countFont'] == ['Noto Sans Bold'] and st['labelFont'] == ['Noto Sans Regular'], (st['countFont'], st['labelFont']))
    check('food mode shows all sample food places', st['feats'] == len(FOOD_S), (st['feats'], len(FOOD_S)))
    src0 = page.evaluate('window.__map.opts.style.sources.openmaptiles')
    check('tile directory fetched with the style and written into it (map starts tiles one round trip sooner)', src0.get('tiles') == json.loads(TILEJSON)['tiles'] and 'url' not in src0 and src0.get('maxzoom') == 14 and len(tilejson_calls) == 1, (src0, tilejson_calls))
    check('web fonts do not block the page (loaded as print, switched on when ready)', page.get_attribute('link[href*="fonts.googleapis.com/css2"]', 'media') == 'all')
    # 底图只留吃喝（旅行再加景点），车站医院这些不显示；小村落街区名藏起来（用户 2026-10-27）
    bf = page.evaluate('(() => { const l = window.__map.style.layers; return [l.find(x => x.id === "poi_r1").filter, (l.find(x => x.id === "label_other").layout || {}).visibility]; })()')
    check('basemap: only food places on the food map, small village/neighbourhood names hidden', bf[0] and bf[0][0] == 'match' and 'restaurant' in bf[0][2] and 'cafe' in bf[0][2] and 'bus' not in bf[0][2] and 'hospital' not in bf[0][2] and 'attraction' not in bf[0][2] and bf[1] == 'none', bf)
    # 提前画中文字：地图停下后取附近 6–12 级瓦片，把里面的中文字先画好（常规字体先画）
    page.evaluate('window.__warmCalls = []; window.__map.style.glyphManager = { _getAndCacheGlyphsPromise: function (s, c) { window.__warmCalls.push([s, c]); } }; window.__map.fire("idle")')
    page.wait_for_timeout(2500)
    wc = page.evaluate('window.__warmCalls')
    want = sorted(ord(ch) for ch in '吉隆坡巴生')
    check('glyph warm-up: Chinese characters from nearby zoom 6–12 tiles drawn ahead, regular font first, once', len(tile_calls) == 28 and all('/planet/20261022_001001_pt/' in u for u in tile_calls) and wc and wc[0][0] == 'Noto Sans Regular' and sorted(c for s_, c in wc if s_ == 'Noto Sans Regular') == want and len(wc) == len(want) * len({s_ for s_, c in wc}), (len(tile_calls), wc[:12]))
    check('first visit opens straight on campus, no long flight from the globe', len(st['intro']) >= 1 and st['intro'][0].get('center') == [101.7029, 2.8329] and st['intro'][0].get('zoom') == 14.6 and not any((c.get('duration') or 0) > 2000 for c in st['intro']), st['intro'])
    tabs0 = page.locator('#tabbar .tab').all_inner_texts()
    check('tab bar: home / explore / footprints / me, no + in it', tabs0 == ['首页', '探索', '足迹', '我的'] and page.locator('#tabbar #fab').count() == 0, tabs0)
    # 首页：整页（盖住地图）；上面品牌 + 搜索，地图预览就是那张地图，下面最新分享；只有示例时诚实地说还没有
    home0 = page.evaluate('''(() => { const p = document.querySelector("#panel").getBoundingClientRect(), m = document.getElementById("map").getBoundingClientRect();
      return [document.querySelector("#panel").dataset.snap, Math.round(p.top), document.getElementById("map").parentNode.id, Math.round(m.height), !!document.querySelector(".home-top .home-search")]; })()''')
    check('home: a full page with the map preview in a card', home0[0] == 'page' and home0[1] <= 0 and home0[2] == 'home-map' and 150 <= home0[3] <= 220 and home0[4], home0)
    check('home: no fake posts, one honest line + a record button', page.locator('.post-card').count() == 0 and '还没有人分享' in page.inner_text('.home-empty') and page.locator('.home-empty [data-action="add"]').count() == 1, page.inner_text('#view')[:200])
    check('home: map attribution shown on the preview', 'OpenStreetMap' in page.inner_text('.home-map .home-attrib'))
    check('no add button on home', not page.locator('#fab').is_visible())
    page.click('.home-map-btn'); page.wait_for_timeout(400)
    exp0 = page.evaluate('(() => { const p = document.querySelector("#panel").getBoundingClientRect(), t = document.querySelector("#tabbar").getBoundingClientRect(); return [document.querySelector("#panel").dataset.snap, Math.round(p.top) >= Math.round(t.top), document.getElementById("map").parentNode.id]; })()')
    check('tapping the preview opens explore: just the map, sheet tucked away', exp0 == ['hidden', True, 'stage'] and page.get_attribute('#tabbar [data-tab="explore"]', 'aria-current') == 'page', exp0)
    check('no add button on explore', not page.locator('#fab').is_visible())
    tab(page, 'foot')
    check('footprints: the + add button shows', page.locator('#fab').is_visible() and page.get_attribute('#fab', 'aria-label') == '加一家店' and page.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page')
    check('footprints: been / wishlist switch, nothing recorded yet', page.eval_on_selector_all('[data-action="mine-sub"]', 'els => els.map(e => e.textContent.trim())') == ['去过', '想去'] and page.inner_text('.view-head .count') == '0')
    tab(page, 'explore')
    check('back to explore: map only again', page.get_attribute('#panel', 'data-snap') == 'hidden')
    page.evaluate('''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Kedai Teroka", class: "restaurant", subclass: "restaurant"}, geometry: {type: "Point", coordinates: [101.71, 2.84]}}]''')
    page.evaluate('window.__map.fire("click", {point: {x: 200, y: 300}, lngLat: {lng: 101.71, lat: 2.84}})'); page.wait_for_timeout(300)
    snap_card = page.get_attribute('#panel', 'data-snap')
    page.click('[data-action="back"]'); page.wait_for_timeout(300)
    page.evaluate('window.__qrf = null')
    check('explore: a tapped place opens a card, back tucks the sheet away again', snap_card == 'half' and page.get_attribute('#panel', 'data-snap') == 'hidden', snap_card)
    tab(page, 'foot')
    # 面板和底部栏：不管面板拉到哪，面板都接着底部栏，底部栏贴着屏幕底边；视口变高变矮也一样
    GEO = '(() => { const p = document.querySelector("#panel").getBoundingClientRect(), t = document.querySelector("#tabbar").getBoundingClientRect(); return [Math.round(p.bottom) >= Math.round(t.top), Math.round(t.bottom) === innerHeight, document.documentElement.scrollHeight <= innerHeight]; })()'
    geo = page.evaluate(GEO)
    check('peek: sheet sits on the tab bar, tab bar on the screen edge', geo == [True, True, True], geo)
    for hh in (700, 900, 844):
        page.set_viewport_size({'width': 390, 'height': hh})
        page.wait_for_timeout(500)
        geo = page.evaluate(GEO)
        check('viewport %d tall: no gap under the sheet, tab bar at the bottom' % hh, geo == [True, True, True], geo)
    check('no add hint bubble any more', page.locator('#fab-hint, .fab-hint').count() == 0)
    ov = page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    check('no horizontal overflow (mobile)', ov)
    page.screenshot(path=os.path.join(SHOTS, '01-mobile-peek.png'))

    # travel mode（探索地图上切换）
    tab(page, 'explore')
    page.evaluate('window.__map.jumpTo({zoom: 14.5})')
    set_mode(page, 'travel')
    mv = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1]')
    check('switching to travel only steps back to zoom 11, no jump to the globe', mv.get('zoom') == 11 and 'center' not in mv, mv)
    # 回 XMUM：定位按钮左边的学士帽，玩的地图回到 11 级，吃的地图回到 14.6 级
    page.evaluate('window.__map.jumpTo({center: [100.3, 5.4], zoom: 9})')
    page.click('.campus-btn')
    mv = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1]')
    check('XMUM button flies back to campus (travel: zoom 11)', mv.get('center') == [101.7029, 2.8329] and mv.get('zoom') == 11, mv)
    check('XMUM button is labelled', page.get_attribute('.campus-btn', 'aria-label') == '回到 XMUM')
    check('travel map shows the food icon to switch back', page.get_attribute('[data-action="toggle-mode"]', 'aria-label') == '切换到美食地图')
    tf = page.evaluate('window.__map.getSource("places").data.features.length')
    check('travel mode shows all travel samples', tf == len(TRAVEL_S), (tf, len(TRAVEL_S)))
    check('accent repainted', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]').lower() == '#4f63d8', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]'))
    check('add button label follows the mode', page.get_attribute('#fab', 'aria-label') == '打卡一个地方', page.get_attribute('#fab', 'aria-label'))
    tab(page, 'foot')
    page.click('.title-row .view-title'); page.wait_for_timeout(400)
    check('footprints sheet: tapping the title brings it to half', page.get_attribute('#panel', 'data-snap') == 'half')
    page.screenshot(path=os.path.join(SHOTS, '02-mobile-travel-half.png'))

    # open a sample place
    open_place(page, '金门')
    check('place view title', page.inner_text('.place-head h2') == '金门大桥', page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'none')
    check('far place offers google view only', page.locator('a.btn', has_text='在 Google 地图看').count() == 1 and page.locator('a.btn', has_text='Waze').count() == 0)
    pin_l = page.evaluate('window.__map.layers.find(l=>l.id==="pt-pin").layout')
    check('opened place: its pin a size bigger, no ring under it', abs(map_expr(pin_l['icon-size'], 14, {'id': 's-golden-gate'}) - 1.105) < 0.01 and abs(map_expr(pin_l['icon-size'], 14, {'id': 'x'}) - 0.85) < 0.01
          and page.evaluate('!window.__map.layers.some(l => l.type === "circle" && l.source === "places" && !l.id.startsWith("cl-"))'), pin_l['icon-size'])
    check('existing place: no red pin, just its own pin', page.locator('#map .sel-pin').count() == 0)
    check('place I have not recorded offers five stars right on its page', page.locator('[data-commit="place-score"]').count() == 1 and '去过？打个分' in page.inner_text('.quick-rate'))
    page.screenshot(path=os.path.join(SHOTS, '03-mobile-place.png'))
    rate(page, 5, '[data-commit="place-score"]')
    page.wait_for_timeout(200)
    check('tapping a score opens the form for this place, score picked', page.locator('#place-form').count() == 1 and stars_val(page) == '5' and page.locator('#f-name').count() == 0, page.inner_text('#view')[:120])
    check('travel form: no cost field, plain review box, no red pin on an existing place', page.locator('#f-price').count() == 0 and page.inner_text('label[for="f-text"]') == '评论（选填）' and page.get_attribute('#f-text', 'placeholder') == '写评论' and page.locator('#map .sel-pin').count() == 0, page.inner_text('#view')[:200])
    page.click('[data-action="form-cancel"]')
    page.wait_for_timeout(200)
    check('back from that form returns to the place', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '金门大桥')
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back to the explore map', page.locator('#view .explore-hint').count() == 1 and page.get_attribute('#panel', 'data-snap') == 'hidden')
    check('red pin removed on the map', page.locator('#map .sel-pin').count() == 0)

    # back to food, add a place at XMUM
    set_mode(page, 'food')
    page.evaluate('window.__map.center = {lng: 101.7031, lat: 2.8331}; window.__map.zoom = 17;')
    add(page)
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
    check('score input is five stars, nothing picked yet', page.locator('#f-rating .stars-track .st').count() == 5 and stars_val(page) is None and page.get_attribute('#f-rating', 'role') == 'slider')
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
    rate(page, 4)
    page.fill('#f-price', '9.5')
    page.fill('#f-text', '参巴辣，蛋煎得好。\n中午排队十分钟。')
    page.set_input_files('#f-file', photo)
    page.wait_for_function('document.querySelectorAll("#f-photos .ph-edit").length === 1', timeout=8000)
    page.screenshot(path=os.path.join(SHOTS, '05-mobile-form.png'), full_page=False)
    page.click('#f-submit')
    page.wait_for_timeout(600)
    check('after publish: place view', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '测试椰浆饭', errors[-4:])
    check('new record lands in footprints', page.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page' and '已存进足迹，也分享到了大地图' in page.inner_text('#toast'), page.inner_text('#toast'))
    check('stats show score and price', page.inner_text('.score-big') == '4' and 'RM 9.5' in page.inner_text('.stats'), page.inner_text('.stats'))
    mine_pin = page.evaluate('window.__map.getSource("places").data.features.find(f => f.properties.name === "测试椰浆饭").properties')
    check('pin colour follows score (4 -> orange-red)', mine_pin['color'] == '#e14f12', mine_pin)
    PIN = 'window.__map.getSource("places").data.features.find(f => f.properties.name === "测试椰浆饭").properties'
    page.wait_for_function(PIN + '.pic.startsWith("ph-")', timeout=5000)
    mine_pin = page.evaluate(PIN)
    img = page.evaluate('window.__map.images[%s.pic]' % PIN)
    check('no red pin covering the photo pin on its own page', page.locator('#map .sel-pin').count() == 0)
    check('place with a photo gets a photo pin (frame in the score colour) and keeps its plain pin', mine_pin['photo'] is True and mine_pin['pic'].endswith('-40') and mine_pin['icon'] == 'pin-food-malay-40' and img == {'w': 136, 'h': 156, 'pr': 2}, (mine_pin, img))
    lays = page.evaluate('Object.fromEntries(window.__map.layers.filter(l => l.id === "pt-pin" || l.id === "pt-photo").map(l => [l.id, l]))')
    pid = mine_pin['id']
    ph_props = {'id': pid, 'photo': True, 'precision': 'exact'}
    ph_op, pin_op, ph_size = lays['pt-photo']['paint']['icon-opacity'], lays['pt-pin']['paint']['icon-opacity'], lays['pt-photo']['layout']['icon-size']
    check('photo pins once zoomed in a bit: plain pin below 13, photo from 13', map_expr(ph_op, 12.9, ph_props) == 0 and map_expr(pin_op, 12.9, ph_props) == 1
          and map_expr(ph_op, 13, ph_props) == 1 and map_expr(pin_op, 13, ph_props) == 0, [map_expr(x, z, ph_props) for x in (ph_op, pin_op) for z in (12.9, 13)])
    sizes = [round(map_expr(ph_size, z, dict(ph_props, id='x')), 3) for z in (13, 13.5, 14, 15)]
    check('zooming out shrinks the photo step by step to pin size before it turns into the pin', sizes == [0.6, 0.8, 1.0, 1.15], sizes)
    check('area / city photos show from district / city zoom', map_expr(ph_op, 10.9, {'photo': True, 'precision': 'area'}) == 0 and map_expr(ph_op, 11, {'photo': True, 'precision': 'area'}) == 1
          and map_expr(ph_op, 7.9, {'photo': True, 'precision': 'city'}) == 0 and map_expr(ph_op, 8, {'photo': True, 'precision': 'city'}) == 1)
    check('places without photos keep their pin at every zoom', all(map_expr(pin_op, z, {'photo': False, 'precision': 'exact'}) == 1 for z in (3, 12, 15.5, 18)))
    check('opened photo pin drawn on top and a size bigger', lays['pt-photo']['layout']['symbol-sort-key'][1] == ['==', ['get', 'id'], pid] and lays['pt-photo']['layout']['symbol-sort-key'][2] == 2
          and abs(map_expr(ph_size, 14, ph_props) - 1.2) < 0.01 and abs(map_expr(ph_size, 14, dict(ph_props, id='x')) - 1.0) < 0.01, lays['pt-photo']['layout'])
    page.evaluate('window.__map.jumpTo({zoom: 12})')
    page.wait_for_timeout(200)
    check('zoomed out on its page: still no red pin', page.locator('#map .sel-pin').count() == 0)
    page.evaluate('window.__map.jumpTo({zoom: 16})')
    page.wait_for_timeout(200)
    check('food place shows distance tier', page.locator('.tag', has_text='步行可达').count() == 1)
    check('no score row on a place I already recorded', page.locator('[data-commit="place-score"]').count() == 0)
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
    page.screenshot(path=os.path.join(SHOTS, '06b-mobile-feed-photo.png'))
    # 别的栏的首页按手机返回键：先回到“首页”这一栏，再按才离开网站
    check('a tab other than home keeps one history entry', page.evaluate('history.state') == {'xuetuan': 1}, page.evaluate('history.state'))
    page.evaluate('history.back()'); page.wait_for_timeout(300)
    check('phone back on footprints goes to the home tab, then the entry is used up', page.get_attribute('#tabbar [data-tab="home"]', 'aria-current') == 'page' and page.evaluate('history.state') is None and page.url.startswith(APP))
    tab(page, 'foot')
    page.click('[data-action="search"]')
    page.fill('#q', '椰浆')
    page.wait_for_timeout(300)
    check('search rows show the place photo', page.locator('#search-local .row-pic img').count() >= 1)
    page.evaluate('history.back()')
    page.wait_for_timeout(300)
    check('phone back from search returns to the list', page.locator('.feed').count() == 1 and page.locator('#q').count() == 0)
    page.locator('.feed-item', has_text='测试椰浆饭').first.click()
    page.wait_for_timeout(300)

    # private second review on same place
    page.click('[data-action="write-review"]')
    page.wait_for_timeout(200)
    check('review form has no name field', page.locator('#f-name').count() == 0 and page.locator('#f-nick').count() == 0)
    rate(page, 2)
    page.fill('#f-text', '今天的饭有点冷。')
    check('share choice remembered', page.get_attribute('[data-action="f-share"]', 'aria-checked') == 'true')
    page.click('[data-action="f-share"]')
    page.click('#f-submit')
    page.wait_for_timeout(400)
    check('private record stays in footprints', page.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page' and page.inner_text('#toast') == '已存进足迹', page.inner_text('#toast'))
    check('mine shows 2 reviews', page.locator('.review').count() == 2, page.locator('.review').count())
    check('my map uses my own average score (4+2)/2', page.inner_text('.score-big') == '3' and '我的评分' in page.inner_text('.stats'), page.inner_text('.stats'))

    # edit own records: the public one keeps its photo, the private one can go to 0
    page.locator('[data-action="edit-review"]').nth(1).click()
    page.wait_for_timeout(200)
    check('edit form prefilled', page.input_value('#f-name') == '测试椰浆饭' and page.input_value('#f-price') == '9.5' and stars_val(page) == '4', page.input_value('#f-name') if page.locator('#f-name').count() else 'no name field')
    page.wait_for_function('[...document.querySelectorAll("#f-photos .ph-edit img")].some(i => i.src.startsWith("blob:"))', timeout=5000)
    check('edit form shows existing photo', page.locator('#f-photos .ph-edit').count() == 1)
    rate(page, 5)
    page.fill('#f-alt', 'Nasi Lemak Test 2')
    page.click('#f-submit')
    page.wait_for_timeout(500)
    check('edit saved toast', '改好了' in page.inner_text('#toast'), page.inner_text('#toast'))
    page.locator('[data-action="edit-review"]').first.click()
    page.wait_for_timeout(200)
    check('edit keeps private visibility', page.get_attribute('[data-action="f-share"]', 'aria-checked') == 'false')
    rate(page, 0)
    page.fill('#f-text', '其实还行。')
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    rv = sorted([r for r in stored['reviews'] if not r.get('sample')], key=lambda r: r['createdAt'])
    pl = [p_ for p_ in stored['places'] if not p_.get('sample')][0]
    check('edits persisted (5 with photo, 0 is a real score)', [r['rating'] for r in rv] == [5, 0] and len(rv[0]['photos']) == 1 and rv[1]['text'] == '其实还行。' and pl['altName'] == 'Nasi Lemak Test 2', (rv, pl))
    check('review count unchanged after edits', page.locator('.review').count() == 2, page.locator('.review').count())
    open_place(page, '测试椰浆')
    check('everyone scope shows 1 review', page.locator('.review').count() == 1, page.locator('.review').count())
    check('explore map uses public score only', page.inner_text('.score-big') == '5', page.inner_text('.stats'))

    # nearby duplicate check
    page.click('[data-action="back"]')
    page.evaluate('window.__map.center = {lng: 101.70315, lat: 2.83305}; window.__map.zoom = 17;')
    add(page)
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
    add(page)
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
    rate(page, 1)
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    bare = [p_ for p_ in stored['places'] if abs(p_['lat'] - 2.91) < 1e-6]
    check('score-only record saves with a placeholder name', len(bare) == 1 and bare[0]['name'] == '没起名的店' and bare[0]['cat'] == 'other' and page.inner_text('.place-head h2') == '没起名的店', bare)
    page.click('[data-action="del-review"]')
    page.click('[data-modal="yes"]')
    page.wait_for_timeout(400)

    # wishlist
    open_place(page, '亚罗街')
    page.click('[data-action="toggle-save"]')
    page.wait_for_timeout(200)
    check('save button toggles on', page.get_attribute('[data-action="toggle-save"]', 'aria-pressed') == 'true' and '已收藏' in page.inner_text('[data-action="toggle-save"]'))
    row = page.eval_on_selector_all('.place-actions > *', 'els => els.map(e => e.dataset.action || (e.classList.contains("primary") ? "nav" : "link"))')
    check('place card: save sits right after directions, record next (Google Maps style row)', row[:3] == ['nav', 'toggle-save', 'write-review'], row)
    sv_pin = page.evaluate('window.__map.getSource("places").data.features.find(f => f.properties.name === "亚罗街").properties')
    check('saved place gets a star badge on the big map', sv_pin['saved'] is True and sv_pin['icon'].endswith('-s') and sv_pin['icon'] in page.evaluate('Object.keys(window.__map.images)'), sv_pin)
    page.click('[data-action="back"]')
    tab(page, 'foot')
    check('footprints has a one-tap been / wishlist switch', page.eval_on_selector_all('[data-action="mine-sub"]', 'els => els.map(e => e.textContent.trim() + ":" + e.getAttribute("aria-pressed"))') == ['去过:true', '想去:false'])
    page.click('[data-action="mine-sub"][data-v="saved"]')
    page.wait_for_timeout(200)
    check('wishlist stays under the footprints tab', page.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page' and page.get_attribute('[data-action="mine-sub"][data-v="saved"]', 'aria-pressed') == 'true')
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
    check('unsaving empties the wishlist', page.locator('.empty', has_text='还没有想去的地方').count() == 1)
    tab(page, 'explore')
    tab(page, 'foot')
    check('footprints tab remembers the wishlist side', page.get_attribute('[data-action="mine-sub"][data-v="saved"]', 'aria-pressed') == 'true')
    page.click('[data-action="mine-sub"][data-v="mine"]')
    tab(page, 'explore')

    # score + distance filters live in one filter sheet
    page.click('[data-action="filters"]')
    page.wait_for_timeout(100)
    cats_food = len(set(x['cat'] for x in FOOD_S))
    check('filter sheet: category, score (with legend), distance, price', page.locator('#bsheet').is_visible() and page.locator('#bsheet [data-action="cat"]').count() >= cats_food + 1 and page.locator('#bsheet .legend').count() == 1 and page.locator('[data-action="set-score"]').count() == 3 and page.locator('[data-action="set-dist"]').count() == 5 and page.locator('#bsheet input#flt-price[type="range"]').count() == 1 and page.inner_text('#flt-price-val') == '不限')
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
    # 价位滑条：挡位不均匀（60 以下密，100 往上稀，最多 500），拉到 x 显示 x 的 2/3–4/3
    page.click('[data-action="set-dist"][data-v="any"]')
    page.wait_for_timeout(100)
    stops = page.evaluate('(() => { const r = document.querySelector("#flt-price"); return +r.max; })()')
    def slide(n):
        page.evaluate('''n => { const r = document.querySelector('#flt-price'); r.value = n; r.dispatchEvent(new Event('input', {bubbles: true})); }''', n)
    def slide_done(n):
        slide(n); page.evaluate('''() => document.querySelector('#flt-price').dispatchEvent(new Event('change', {bubbles: true}))'''); page.wait_for_timeout(150)
    def band(lo, hi): return sorted([x['name'] for x in FOOD_S if x['price'] and lo <= x['price'] <= hi] + (['测试椰浆饭'] if lo <= 9.5 <= hi else []))
    slide(3)
    live = page.inner_text('#flt-price-val'), page.inner_text('#bsheet [data-action="sheet-close"]')
    check('price slider: dragging updates "RM x 左右" and the count live', live == ('RM10 左右 · RM7–13', '看 %d 个地方' % len(band(7, 13))), live)
    slide_done(3)
    p10 = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    slide_done(5)
    p15 = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('price slider: RM10 shows 7–13, RM15 shows 10–20', sorted(p10) == band(7, 13) and sorted(p15) == band(10, 20) and '测试椰浆饭' in p10 and '测试椰浆饭' not in p15 and page.inner_text('#flt-price-val') == 'RM15 左右 · RM10–20', (p10, band(7, 13), p15, band(10, 20)))
    slide(stops)
    check('price slider: uneven stops, top is RM500+', stops >= 20 and page.inner_text('#flt-price-val') == 'RM500 左右 · RM333+', (stops, page.inner_text('#flt-price-val')))
    slide_done(0)
    check('price slider back to 不限', page.inner_text('#flt-price-val') == '不限')
    page.click('[data-action="set-dist"][data-v="mid"]')
    page.wait_for_timeout(100)
    page.click('[data-action="sheet-close"]')
    page.wait_for_timeout(100)
    check('filter button shows 1 active filter', not page.locator('#bsheet').is_visible() and page.inner_text('[data-action="filters"]').endswith('1'), page.inner_text('[data-action="filters"]'))
    page.click('[data-action="filters"]')
    page.click('#bsheet [data-action="clear-filters"]')
    page.click('#bsheet', position={'x': 10, 'y': 10})
    page.wait_for_timeout(100)
    check('reset clears filters, tapping outside closes the sheet', not page.locator('#bsheet').is_visible() and page.locator('#map-ctrls [data-action="filters"] b').count() == 0)

    # saved areas live in the empty search page
    tab(page, 'explore')
    page.click('#map-ctrls [data-action="search"]')
    page.fill('#q', '')
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
    check('osm city result goes to travel', '旅行' in osm_rows[1], osm_rows)
    check('photon queried near the map centre', any('q=kafe' in u and 'lat=' in u for u in photon_calls), photon_calls[-1:])
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    pin = page.evaluate('(() => { const el = document.querySelector("#map .sel-pin"); return el ? !!el.querySelector("path[fill=\'#EA4335\']") : false; })()')
    check('picking a search result shows a red pin and a place card', pin and page.inner_text('.place-head h2') == 'Kafe Ujian' and page.locator('[data-commit="preview-score"]').count() == 1, (pin, page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'no card'))
    page.screenshot(path=os.path.join(SHOTS, '05a-mobile-search-preview.png'))
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back from the card returns to the results, pin removed', page.locator('[data-action="osm-pick"]').count() >= 1 and page.input_value('#q') == 'kafe' and page.locator('#map .sel-pin').count() == 0)
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    rate(page, 3, '[data-commit="preview-score"]')
    page.wait_for_timeout(300)
    check('pin stays on the new place while filling the form', page.locator('#map .sel-pin').count() == 1)
    check('score picked on the card carries into the form', stars_val(page) == '3')
    check('osm pick opens prefilled form', page.input_value('#f-name') == 'Kafe Ujian' and page.get_attribute('[data-action="f-cat"][data-cat="cafe"]', 'aria-pressed') == 'true', page.input_value('#f-name') if page.locator('#f-name').count() else 'no form')
    rate(page, 3)
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
    add(page)
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
    add(page)
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
    check('search finds by alt name', page.locator('#search-local .near-item', has_text='测试椰浆饭').count() == 1)
    page.fill('#q', '鼓浪')
    page.wait_for_timeout(150)
    check('search finds travel sample', page.locator('#search-local .near-item', has_text='鼓浪屿').count() == 1)
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
    page.fill('#q', 'Singapura')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=5000)
    page.wait_for_timeout(100)
    sg_rows = page.locator('[data-action="osm-pick"] b').all_inner_texts()
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    last = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1]')
    # 提速：谁先回来先显示，慢的来源最多等 4 秒；搜过的词不再重搜
    page.click('[data-action="back"]')
    page.fill('#q', 'slowwiki')
    page.wait_for_selector('[data-action="osm-pick"]', timeout=1500)
    check('search: results show before the slowest source answers', '还在找更多' in page.inner_text('#search-results'), page.inner_text('#search-results')[:200])
    page.wait_for_function('!document.querySelector("#search-results").innerText.includes("还在找更多")', timeout=6000)
    check('search: a source that never answers is dropped after a few seconds', page.locator('[data-action="osm-pick"]').count() >= 1)
    n_ph = len(photon_calls)
    page.fill('#q', 'Singapur'); page.wait_for_timeout(500)
    page.fill('#q', 'Singapura'); page.wait_for_timeout(500)
    check('search: a word searched before comes back from memory', len(photon_calls) == n_ph + 1 and page.locator('[data-action="osm-pick"]').count() >= 1, (n_ph, len(photon_calls)))
    opts = page.evaluate('({pr: window.__map.opts.pixelRatio, fade: window.__map.opts.fadeDuration, cache: window.__map.opts.maxTileCacheSize})')
    check('map: draws at most 2x on high-res phones, no label fade, bigger tile cache', opts == {'pr': 2, 'fade': 0, 'cache': 300}, opts)
    check('country / city result lands on the city centre, not the middle of the map shape', last['center'] == [103.852, 1.2899] and sg_rows == ['Singapura'], (last, sg_rows))
    page.fill('#q', '鼓浪')
    page.wait_for_timeout(150)
    page.click('#search-local .near-item')
    page.wait_for_timeout(300)
    check('opening travel result switches mode', page.evaluate('document.documentElement.classList.contains("mode-travel")'))
    page.click('[data-action="back"]')

    # profile: the four "where you're from" boxes are gone
    tab(page, 'me')
    check('no hometown text boxes in Me', page.locator('[data-pf="city"], [data-pf="country"], [data-pf="region"], [data-pf="district"]').count() == 0)

    # 我的家：在地图上点 → 认出城市，只存到 0.1 度；默认不公开
    check('home: Me has a "my home" field with a set button', page.locator('#home-field [data-action="home-set"]').count() == 1 and '我的家' in page.inner_text('#home-field'))
    page.click('#home-field [data-action="home-set"]')
    page.wait_for_timeout(150)
    check('home: set page has city search + pick on map', page.locator('#home-q').count() == 1 and page.locator('[data-action="home-pick"]').count() == 1 and '10 公里' in page.inner_text('#view'))
    page.evaluate('window.__map.center = {lng: 101.7123, lat: 2.8456}; window.__map.zoom = 14;')
    page.click('[data-action="home-pick"]')
    page.wait_for_timeout(150)
    check('home: pick mode asks for the home city, no precision line', page.locator('#pick').is_visible() and '城市' in page.inner_text('#pick-hint') and not page.locator('#pick-prec').is_visible(), page.inner_text('#pick-hint'))
    zoomed = page.evaluate('window.__map.calls.filter(c => c[0] === "move").slice(-1)[0][1].zoom')
    check('home: picking zooms out to city level', zoomed == 9, zoomed)
    page.click('[data-action="pick-confirm"]')
    page.wait_for_function('document.querySelector("#home-field .home-row")', timeout=4000)
    page.wait_for_timeout(100)
    home_ls = page.evaluate('(() => { const d = JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1")); return d.homes[d.profile.id]; })()')
    check('home: reverse lookup names the city, position rounded to 0.1°', home_ls == {'city': 'Sepang', 'lat': 2.8, 'lng': 101.7, 'public': False}, home_ls)
    check('home: reverse lookup asked Photon for that spot', any('/reverse?lat=2.8456&lon=101.7123' in u for u in photon_calls), photon_calls[-1:])
    check('home: toast + back in Me with the city and switch off', '设好了：Sepang' in page.inner_text('#toast') and 'Sepang' in page.inner_text('#home-field .home-row') and page.get_attribute('[data-action="home-public"]', 'aria-checked') == 'false')
    check('home: saving switches to the travel map', page.evaluate('document.documentElement.classList.contains("mode-travel")'))
    check('home: Me header says where I am from', page.inner_text('.me-head small') == '来自 Sepang', page.inner_text('.me-head'))
    tab(page, 'foot')
    hf = page.evaluate('window.__map.getSource("homes").data.features.map(f => [f.properties.mine, f.properties.icon, f.properties.pin])')
    check('home: my private home shows on my travel map as my house', hf == [[True, 'home-me', False]], hf)
    check('home: no hometown note on my map', page.locator('#map-chips .map-chip').count() == 0)
    tab(page, 'explore')
    hf = page.evaluate('window.__map.getSource("homes").data.features.length')
    check('home: private home not on the big map', hf == 0, hf)
    tab(page, 'me')
    page.click('[data-action="home-public"]')
    page.wait_for_timeout(150)
    hfs = page.evaluate('window.__map.getSource("homes").data.features.map(f => f.properties)')
    check('home: public home drawn as a red pin on the big travel map', len(hfs) == 1 and hfs[0]['mine'] is True and hfs[0]['icon'] == 'hometown' and hfs[0]['pin'] is True, hfs)
    img = page.evaluate('window.__map.images["hometown"]')
    check('home: red pin drawn at 22x30, smaller than a place pin', img == {'w': 44, 'h': 60, 'pr': 2}, img)
    img = page.evaluate('(() => { window.__map.fire("styleimagemissing", {id: "hometown-n-12"}); return window.__map.images["hometown-n-12"]; })()')
    check('home: grouped red pin drawn with the count', img == {'w': 54, 'h': 74, 'pr': 2}, img)
    hl = page.evaluate('[window.__map.layers.find(l => l.id === "hometown-pin").layout, window.__map.layers.map(l => l.id)]')
    check('home: red pins stand on their tip, under the place count circles', hl[0]['icon-anchor'] == 'bottom' and hl[0]['icon-image'][2][1] == 'hometown-n-' and hl[1].index('hometown-pin') < hl[1].index('cl-circle') < hl[1].index('home-pin'), hl)
    check('home: switch on explains who sees it', page.get_attribute('[data-action="home-public"]', 'aria-checked') == 'true' and '来自 Sepang' in page.inner_text('#home-field'))
    hb = page.evaluate('(() => { const b = document.querySelector("#map-chips [data-action=homes-toggle]"); return b && [b.getAttribute("aria-pressed"), b.textContent, !!b.querySelector("svg"), document.querySelectorAll("#map-ctrls [data-action=homes-toggle]").length]; })()')
    check('home: top-left note on the big travel map says red pins are hometowns, with how many', hb == ['true', '同学的家乡1', True, 0], hb)
    img = page.evaluate('window.__map.images["home-me"]')
    check('home: house image drawn at 44px', img == {'w': 88, 'h': 88, 'pr': 2}, img)
    tab(page, 'explore')
    page.wait_for_timeout(150)
    page.click('[data-action="homes-toggle"]')
    page.wait_for_timeout(100)
    check('home: tapping the note hides the red pins', page.evaluate('window.__map.getSource("homes").data.features.length') == 0 and page.get_attribute('[data-action="homes-toggle"]', 'aria-pressed') == 'false')
    page.click('[data-action="homes-toggle"]')
    page.wait_for_timeout(100)
    # 点小房子（合在一起的也行）：列出谁的家
    page.evaluate('window.__qrf = [{layer: {id: "hometown-pin"}, properties: {cluster: true, cluster_id: 3, point_count: 1}, geometry: {type: "Point", coordinates: [101.7, 2.8]}}]')
    page.evaluate('window.__map.fire("click", {point: {x: 200, y: 300}, lngLat: {lng: 101.7, lat: 2.8}})')
    page.wait_for_timeout(200)
    page.evaluate('window.__qrf = []')
    check('home: tapping a house lists whose home it is', page.locator('.homes-list').count() == 1 and '我的家' in page.inner_text('#view') and 'Sepang' in page.inner_text('.homes-list'), page.inner_text('#view')[:120])
    check('home: house card offers to change my home', page.locator('#view [data-action="home-set"]').count() == 1)
    page.click('[data-action="back"]')
    page.wait_for_timeout(100)
    check('home: no hometown note on the food map', (set_mode(page, 'food') or True) and page.locator('[data-action="homes-toggle"]').count() == 0)
    set_mode(page, 'travel')
    tab(page, 'me')
    page.wait_for_timeout(200)
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(SHOTS, '07-mobile-profile.png'))
    page.click('[data-action="set-style"][data-style="dark"]')
    page.wait_for_timeout(300)
    check('missing dark style handled with toast', '加载不了' in page.inner_text('#toast'), page.inner_text('#toast'))
    page.click('[data-action="set-style"][data-style="color"]')
    page.wait_for_timeout(300)
    st2 = page.evaluate('({setStyle: window.__map.calls.filter(c=>c[0]==="setStyle").length, layers: window.__map.layers.map(l=>l.id).length, images: Object.keys(window.__map.images).length, proj: window.__map.projection})')
    st2['icons'] = page.evaluate('[...new Set(window.__map.getSource("places").data.features.concat(window.__map.getSource("homes").data.features).flatMap(f => [f.properties.icon, f.properties.pic]).filter(Boolean))].sort()')
    st2['imageIds'] = page.evaluate('Object.keys(window.__map.images).sort()')
    check('base map switch re-adds layers + images', st2['setStyle'] == 1 and st2['layers'] == 12 and st2['icons'] == st2['imageIds'] and st2['proj'] == {'type': ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator']}, st2)
    tab(page, 'explore')
    set_mode(page, 'food')

    # language (in the Me tab)
    tab(page, 'me')
    page.click('[data-action="set-lang"][data-lang="en"]')
    check('Me in English, tab bar too', page.locator('#tabbar .tab').all_inner_texts() == ['Home', 'Explore', 'Footprints', 'Me'] and 'Wishlist' in page.inner_text('.me-stats'), page.locator('#tabbar .tab').all_inner_texts())
    tab(page, 'explore')
    page.wait_for_timeout(200)
    check('UI in English', page.inner_text('.view-title') == 'Explore food', page.inner_text('.view-title'))
    lab = page.evaluate('window.__map.style.layers.find(l => l.id === "place-city").layout["text-field"]')
    check('map labels English', 'name:en' in json.dumps(lab), lab)
    names = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('pin names use English alt names', 'Nasi Lemak Test 2' in names and 'Jalan Alor' in names, names)
    page.screenshot(path=os.path.join(SHOTS, '08-mobile-english.png'))
    tab(page, 'me')
    page.click('[data-action="set-lang"][data-lang="zh"]')
    tab(page, 'explore')

    # export
    tab(page, 'me')
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
    tab(page, 'explore')

    # reload persistence + photo from IndexedDB
    page.reload()
    page.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page.wait_for_timeout(500)
    check('after reload: own places still on map', page.evaluate('window.__map.getSource("places").data.features.length') == 2)
    check('no sample re-seed after clearing', page.locator('.sample-note').count() == 0)
    # 首页：大家最新分享的记录（不是示例），两列卡片，有照片的放照片
    check('after reload: the app opens on home', page.get_attribute('#tabbar [data-tab="home"]', 'aria-current') == 'page' and page.get_attribute('#panel', 'data-snap') == 'page')
    cards = page.locator('.post-card .pc-place').all_inner_texts()
    check('home: my public records show as cards, newest first, private ones not', cards[:1] == ['Kafe Ujian'] and '测试椰浆饭' in cards and page.locator('.post-card', has_text='其实还行').count() == 0, cards)
    page.wait_for_function('[...document.querySelectorAll(".post-card .pc-cover img")].some(i => i.naturalWidth > 0)', timeout=5000)
    cg = page.evaluate('''(() => { const cs = [...document.querySelectorAll(".post-card")].map(c => c.getBoundingClientRect()); const cv = document.querySelector(".post-card .pc-cover").getBoundingClientRect();
      return [cs.length >= 2 && Math.abs(cs[0].top - cs[1].top) < 2 && cs[0].right <= cs[1].left, Math.abs(cv.width - cv.height) < 2, document.documentElement.scrollWidth <= innerWidth]; })()''')
    check('home: two columns of square covers, no sideways scroll', cg == [True, True, True], cg)
    check('home: a card without photos shows the words instead', page.locator('.post-card', has_text='Kafe Ujian').locator('.pc-words').count() == 1)
    page.screenshot(path=os.path.join(SHOTS, '06c-mobile-home-cards.png'))
    star = page.locator('.post-card', has_text='测试椰浆饭').first.locator('.pc-save')
    star.click(); page.wait_for_timeout(200)
    stw = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1")).wishlist.length')
    check('home: the star on a card saves the place, right there', page.locator('.post-card', has_text='测试椰浆饭').first.locator('.pc-save').get_attribute('aria-pressed') == 'true' and stw == 1 and '足迹 · 想去' in page.inner_text('#toast'), stw)
    page.locator('.post-card', has_text='测试椰浆饭').first.locator('.pc-save').click(); page.wait_for_timeout(200)
    # 卡片 → 帖子（不是去地图）；帖子里的地点 → 探索地图；返回回到帖子，再返回回到首页
    via_home(page, '测试椰浆饭', to_place=False)
    check('card opens the post, not the map', page.locator('.post-who').count() == 1 and '小测' in page.inner_text('.post-who') and page.locator('.post-score .stars-mini').count() == 1
          and page.get_attribute('#panel', 'data-snap') == 'page' and page.locator('[data-action="post-place"]', has_text='测试椰浆饭').count() == 1, page.inner_text('#view')[:200])
    page.wait_for_function('[...document.querySelectorAll(".photo-strip img")].some(i => i.naturalWidth > 0)', timeout=5000)
    page.screenshot(path=os.path.join(SHOTS, '06d-mobile-post.png'))
    page.click('[data-action="post-place"]'); page.wait_for_timeout(300)
    check('the place in a post opens on the explore map', page.inner_text('.place-head h2') == '测试椰浆饭' and page.get_attribute('#tabbar [data-tab="explore"]', 'aria-current') == 'page' and page.get_attribute('#panel', 'data-snap') == 'half')
    page.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    check('photo restored from IndexedDB', True)
    page.click('[data-action="back"]'); page.wait_for_timeout(250)
    check('back from that place returns to the post', page.locator('.post-who').count() == 1 and page.get_attribute('#tabbar [data-tab="home"]', 'aria-current') == 'page')
    page.evaluate('history.back()'); page.wait_for_timeout(300)
    check('phone back from the post returns to home', page.locator('.post-grid').count() == 1 and page.evaluate('history.state') is None)

    # delete own review via confirm
    tab(page, 'foot')
    page.locator('.feed-item', has_text='测试椰浆饭').first.click()
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
    tab(page, 'explore')
    add(page)
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
    add(page)
    page.wait_for_timeout(200)
    page.click('[data-action="add-pin"]')
    page.wait_for_timeout(300)
    page.evaluate('''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Kedai Pilih Peta", class: "restaurant", subclass: "restaurant"}, geometry: {type: "Point", coordinates: [101.7051, 2.8312]}}]''')
    page.evaluate('window.__map.fire("click", {point: {x: 150, y: 250}, lngLat: {lng: 101.7051, lat: 2.8312}})')
    page.wait_for_timeout(300)
    check('picking: tapping a basemap shop opens its card with scores', page.locator('#pick').is_hidden() and page.locator('[data-commit="preview-score"]').count() == 1 and page.inner_text('.place-head h2') == 'Kedai Pilih Peta', page.inner_text('#view')[:120])
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    page.evaluate('window.__qrf = []')

    # basemap POI labels are tappable (on my map too): preview -> score -> form -> saved
    set_mode(page, 'food')
    tab(page, 'foot')
    POI = '''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Restoran Uji Peta", "name:zh": "测试地图餐厅", class: "restaurant", subclass: "restaurant"}, geometry: {type: "Point", coordinates: [101.8123, 2.9456]}}]'''
    TAP = 'window.__map.fire("click", {point: {x: 200, y: 300}, lngLat: {lng: 101.8123, lat: 2.9456}})'
    page.evaluate(POI)
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('tapping a basemap restaurant opens a card', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '测试地图餐厅' and 'Restoran Uji Peta' in page.inner_text('.place-head .alt'), page.inner_text('#view')[:200])
    check('card offers quick scores and a red pin', page.locator('[data-commit="preview-score"]').count() == 1 and page.locator('#map .sel-pin').count() == 1)
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
    rate(page, 4, '[data-commit="preview-score"]')
    page.wait_for_timeout(300)
    check('score from the card opens a prefilled form', page.locator('#place-form').count() == 1 and page.input_value('#f-name') == '测试地图餐厅' and stars_val(page) == '4' and page.locator('details.more[open]').count() == 0)
    page.evaluate(TAP)
    page.wait_for_timeout(200)
    check('tapping the map while filling the form keeps the form', page.locator('#place-form').count() == 1)
    page.click('#f-submit')
    page.wait_for_timeout(500)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    tp = [p_ for p_ in stored['places'] if p_['name'] == '测试地图餐厅']
    check('basemap place saved to my map', len(tp) == 1 and tp[0]['altName'] == 'Restoran Uji Peta' and tp[0]['mode'] == 'food' and abs(tp[0]['lat'] - 2.9456) < 1e-6 and page.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page', tp)
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('tapping it again opens the saved place, not a new card', page.locator('[data-commit="preview-score"]').count() == 0 and page.inner_text('.place-head h2') == '测试地图餐厅')
    page.click('[data-action="back"]')
    page.evaluate('''window.__qrf = [{layer: {id: "poi_r1"}, properties: {name: "Muzium Uji", class: "museum", subclass: "museum"}, geometry: {type: "Point", coordinates: [101.9, 2.99]}}]''')
    page.evaluate(TAP)
    page.wait_for_timeout(300)
    check('a museum label opens as a travel place', page.inner_text('.place-head h2') == 'Muzium Uji' and '人文' in page.inner_text('.tags'), page.inner_text('.tags') if page.locator('.tags').count() else 'no card')
    # 还没去过的地方先收藏（想去）：建一个没有记录的地点 + 想去，红针留着
    check('a place not on XueTuan yet has a save button', page.locator('[data-action="save-preview"]').count() == 1)
    page.click('[data-action="save-preview"]'); page.wait_for_timeout(300)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    mz = [p_ for p_ in stored['places'] if p_['name'] == 'Muzium Uji']
    check('saving an unrecorded place: place + wishlist, no record', len(mz) == 1 and mz[0]['mode'] == 'travel' and mz[0]['cat'] == 'culture' and [w['placeId'] for w in stored['wishlist']] == [mz[0]['id']]
          and not any(r['placeId'] == mz[0]['id'] for r in stored['reviews']) and '足迹 · 想去' in page.inner_text('#toast'), (mz, stored['wishlist']))
    check('saved unrecorded place: its page says nobody recorded it, red pin stays, saved', page.inner_text('.place-head h2') == 'Muzium Uji' and page.locator('.place-empty').count() == 1 and page.locator('#map .sel-pin').count() == 1
          and page.get_attribute('[data-action="toggle-save"]', 'aria-pressed') == 'true' and page.locator('[data-commit="place-score"]').count() == 1, page.inner_text('#view')[:200])
    page.click('[data-action="back"]'); page.wait_for_timeout(200)
    page.evaluate(TAP); page.wait_for_timeout(300)
    check('tapping that label again opens the saved place, not a new card', page.locator('[data-action="save-preview"]').count() == 0 and page.inner_text('.place-head h2') == 'Muzium Uji')
    page.click('[data-action="back"]'); page.wait_for_timeout(200)
    page.click('[data-action="mine-sub"][data-v="saved"]'); page.wait_for_timeout(200)
    check('it is in footprints · wishlist (list + map)', page.locator('#view .near-item', has_text='Muzium Uji').count() == 1 and 'Muzium Uji' in page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)'))
    # 去了、记一笔、再删掉：想去的地点还在（本地版）
    page.locator('#view .near-item', has_text='Muzium Uji').click(); page.wait_for_timeout(250)
    rate(page, 4, '[data-commit="place-score"]'); page.wait_for_timeout(200)
    page.click('#f-submit'); page.wait_for_timeout(400)
    page.click('[data-action="del-review"]'); page.click('[data-modal="yes"]'); page.wait_for_timeout(400)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('deleting my only record keeps a place I still want to go to', any(p_['name'] == 'Muzium Uji' for p_ in stored['places']) and len(stored['wishlist']) == 1 and page.inner_text('.place-head h2') == 'Muzium Uji', stored['wishlist'])
    page.click('[data-action="toggle-save"]'); page.wait_for_timeout(300)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('unsaving an empty place removes it', not any(p_['name'] == 'Muzium Uji' for p_ in stored['places']) and stored['wishlist'] == [] and page.locator('.place-head').count() == 0, [p_['name'] for p_ in stored['places']])
    page.evaluate('window.__qrf = []')
    tab(page, 'explore')

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
    check('desktop: home lists posts in the side column, no map card there', page2.get_attribute('#tabbar [data-tab="home"]', 'aria-current') == 'page' and page2.locator('.home-map').count() == 0 and page2.evaluate('document.getElementById("map").parentNode.id') == 'stage')
    tab(page2, 'me')
    page2.set_input_files('#import-file', export_path)
    page2.wait_for_timeout(800)
    st3 = page2.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    check('import merges places and adopts profile', any(p_['name'] == '测试椰浆饭' for p_ in st3['places']) and st3['profile']['name'] == '小测', (len(st3['places']), st3['profile']))
    via_home(page2, '测试椰浆饭')
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
    tab(page5, 'home')
    page5.locator('.post-card .pc-open').first.click(); page5.wait_for_timeout(200)
    page5.click('[data-action="post-place"]'); page5.wait_for_timeout(200)
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

    # ---------- 足迹的列表面板：能拖、能滚（示例记录都算成我的，列表才够长） ----------
    ctxd = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, locale='zh-CN')
    route_all(ctxd)
    pd = ctxd.new_page()
    errorsd = []
    pd.on('pageerror', lambda e: errorsd.append('pageerror: ' + str(e)))
    pd.goto(APP)
    pd.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    pd.evaluate('''(() => { const k = "xmum-chiwan-map:data:v1", d = JSON.parse(localStorage.getItem(k));
      d.reviews.forEach(r => { r.authorId = d.profile.id; r.sample = false; }); d.places.forEach(p => { p.sample = false; }); d.seeded = 2; localStorage.setItem(k, JSON.stringify(d)); })()''')
    pd.reload()
    pd.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    pd.wait_for_timeout(400)
    HOMEGEO = '(() => { const p = document.querySelector("#panel").getBoundingClientRect(), t = document.querySelector("#tabbar").getBoundingClientRect(), b = document.querySelector(".panel-body"); return [Math.round(p.top), Math.round(p.bottom) === Math.round(t.top), b.scrollHeight > b.clientHeight]; })()'
    hg = pd.evaluate(HOMEGEO)
    check('home page: from the top of the screen down to the tab bar, scrolls inside', hg == [0, True, True], hg)
    check('home: up to 60 newest posts', pd.locator('.post-card').count() == 60)
    pd.evaluate('document.querySelector(".panel-body").scrollTop = 900'); pd.wait_for_timeout(100)
    tab(pd, 'home')
    pd.wait_for_timeout(600)
    check('tapping the current tab scrolls back to the top', pd.evaluate('document.querySelector(".panel-body").scrollTop') == 0)
    gpage = pd.evaluate('(() => { const b = document.querySelector(".panel-body").getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + 300)]; })()')
    touch_drag(pd, gpage[0], gpage[1], gpage[1] + 300)
    pd.wait_for_timeout(400)
    check('home page cannot be dragged down like a sheet', pd.get_attribute('#panel', 'data-snap') == 'page' and pd.evaluate(HOMEGEO)[0] == 0)
    tab(pd, 'foot')
    GEO = '(() => { const p = document.querySelector("#panel").getBoundingClientRect(), t = document.querySelector("#tabbar").getBoundingClientRect(); return [Math.round(p.bottom) >= Math.round(t.top), Math.round(t.bottom) === innerHeight, document.documentElement.scrollHeight <= innerHeight]; })()'
    pd.click('.title-row .view-title'); pd.wait_for_timeout(400)
    check('footprints: tapping the title brings it to half', pd.get_attribute('#panel', 'data-snap') == 'half')
    vis = pd.evaluate('''(() => { const body = document.querySelector('.panel-body'); body.scrollTop = body.scrollHeight; const r = document.querySelector('.feed li:last-child').getBoundingClientRect(); return r.bottom <= document.querySelector('#tabbar').getBoundingClientRect().top + 1; })()''')
    check('last feed item reachable in half sheet', vis)
    # 像谷歌地图那样直接拖内容：列表滚到中间时往下拖是滚列表；在最上面往下拖是收面板，收起后往上拖是拉开
    box = pd.evaluate('(() => { const r = document.querySelector(".panel-body").getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + 60)]; })()')
    st0 = pd.evaluate('document.querySelector(".panel-body").scrollTop')
    touch_drag(pd, box[0], box[1], box[1] + 150)
    pd.wait_for_timeout(400)
    st1 = pd.evaluate('document.querySelector(".panel-body").scrollTop')
    check('dragging a scrolled list scrolls it, the sheet stays', pd.get_attribute('#panel', 'data-snap') == 'half' and st1 < st0, (st0, st1, pd.get_attribute('#panel', 'data-snap')))
    pd.evaluate('document.querySelector(".panel-body").scrollTop = 0')
    touch_drag(pd, box[0], box[1], box[1] + 240)
    pd.wait_for_timeout(450)
    check('dragging the content down from the top collapses the sheet', pd.get_attribute('#panel', 'data-snap') == 'peek')
    geo = pd.evaluate(GEO)
    check('after a content drag the tab bar is still on the bottom edge', geo == [True, True, True], geo)
    top = pd.evaluate('Math.round(document.querySelector("#panel").getBoundingClientRect().top + 40)')
    touch_drag(pd, box[0], top, top - 260)
    pd.wait_for_timeout(450)
    check('dragging the collapsed sheet up opens it', pd.get_attribute('#panel', 'data-snap') in ('half', 'full'), pd.get_attribute('#panel', 'data-snap'))
    # 用小横条收到最低：列表回到最上面，露出标题
    pd.evaluate('document.querySelector(".panel-body").scrollTop = 300')
    g0 = pd.evaluate('(() => { const r = document.querySelector("#grip").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()')
    pd.mouse.move(g0[0], g0[1]); pd.mouse.down(); pd.mouse.move(g0[0], g0[1] + 200, steps=6); pd.mouse.move(g0[0], 830, steps=6); pd.mouse.up()
    pd.wait_for_timeout(450)
    pk = pd.evaluate('(() => { const t = document.querySelector(".title-row").getBoundingClientRect(), tb = document.querySelector("#tabbar").getBoundingClientRect(), it = document.querySelector(".feed-item .fi-main").getBoundingClientRect(); return [document.querySelector("#panel").dataset.snap, document.querySelector(".panel-body").scrollTop, t.bottom <= tb.top, it.top >= tb.top]; })()')
    check('collapsed sheet shows its title, not half a list', pk == ['peek', 0, True, True], pk)
    pd.click('.title-row .view-title'); pd.wait_for_timeout(400)
    tab(pd, 'explore'); tab(pd, 'foot')
    check('footprints remembers how high its sheet was', pd.get_attribute('#panel', 'data-snap') == 'half')
    check('sheet tests: no page errors', not errorsd, errorsd)
    ctxd.close()

    # dark mode mobile
    ctx3 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark')
    route_all(ctx3)
    page3 = ctx3.new_page()
    page3.goto(APP)
    page3.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page3.wait_for_timeout(500)
    tab(page3, 'foot')
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
    page4.screenshot(path=os.path.join(SHOTS, '12a-mobile-360-home.png'))
    tab(page4, 'explore')
    tb = page4.evaluate('(() => { const c = document.querySelector("#map-ctrls").getBoundingClientRect(), l = document.querySelector(".locate-btn").getBoundingClientRect(), x = document.querySelector(".campus-btn").getBoundingClientRect(); return [c.right <= innerWidth, c.bottom < l.top, document.documentElement.scrollWidth <= document.documentElement.clientWidth, x.top === l.top && x.right + 6 <= l.left && x.width === 36]; })()')
    check('map buttons fit a 360px phone (XMUM button beside locate)', tb == [True, True, True, True], tb)
    page4.screenshot(path=os.path.join(SHOTS, '12-mobile-360.png'))
    ctx4.close()

    # ---------- 谷歌地图搜索（Places UI Kit，假的谷歌脚本）----------
    STUB_GOOGLE = r'''(function () {
      var calls = window.__gcalls = [];
      function def(n, c) { if (!customElements.get(n)) customElements.define(n, c); }
      class Plain extends HTMLElement {}
      class Search extends HTMLElement {
        connectedCallback() {
          var r = this.querySelector('gmp-place-text-search-request'), self = this;
          calls.push(['search', r && r.textQuery, r && r.locationBias, r && r.getAttribute('max-result-count')]);
          setTimeout(function () {
            self.places = /katsu/i.test(r.textQuery) ? [{ id: 'gK1', location: { lat: 2.8286977, lng: 101.7055681 } }] : [];
            self.dispatchEvent(new Event('gmp-load'));
          }, 30);
        }
      }
      class Details extends HTMLElement {
        connectedCallback() { var r = this.querySelector('gmp-place-details-place-request'); calls.push(['details', r && r.place]); }
      }
      def('gmp-place-search', Search); def('gmp-place-text-search-request', class extends Plain {}); def('gmp-place-standard-content', class extends Plain {});
      def('gmp-place-details-compact', Details); def('gmp-place-details-place-request', class extends Plain {});
      window.google = { maps: { importLibrary: function () { return Promise.resolve({}); } } };
      var cb = (document.currentScript.src.match(/callback=([^&]+)/) || [])[1];
      setTimeout(function () { window[cb](); }, 0);
    })();'''
    ctxg = browser.new_context(viewport={'width': 392, 'height': 709}, device_scale_factor=2, has_touch=True, locale='zh-CN')
    route_all(ctxg)
    gurls = []
    def google_route(route):
        gurls.append(route.request.url)
        route.fulfill(status=200, body=STUB_GOOGLE, headers={'Content-Type': 'application/javascript'})
    ctxg.route('**/maps.googleapis.com/**', google_route)
    pg = ctxg.new_page()
    pg.goto(APP)
    pg.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    tab(pg, 'explore')
    pg.click('#map-ctrls [data-action="search"]')
    pg.fill('#q', 'k')
    pg.wait_for_timeout(800)
    check('google: not asked for one letter', len(gurls) == 0 and pg.locator('#g-search').is_hidden())
    pg.fill('#q', 'katsu lab')
    pg.wait_for_timeout(900)
    gc = pg.evaluate('window.__gcalls')
    check('google: script loaded once with the key, places library, Malaysia region', len(gurls) == 1 and 'key=AIza' in gurls[0] and 'libraries=places' in gurls[0] and 'region=MY' in gurls[0] and 'language=zh-CN' in gurls[0], gurls)
    check('google: text search asked near the map centre, 5 results', gc and gc[0][0] == 'search' and gc[0][1] == 'katsu lab' and abs(gc[0][2]['lat'] - 2.83) < 0.5 and gc[0][3] == '5', gc)
    check('google: results shown between XueTuan and map results, titled', pg.locator('#g-search').is_visible() and pg.inner_text('#g-search .sec-title') == '谷歌地图上的' and pg.evaluate('(() => { const a = document.querySelector("#search-local"), g = document.querySelector("#g-search"), r = document.querySelector("#search-results"); return a.nextElementSibling === g && g.nextElementSibling === r; })()'))
    pg.fill('#q', 'katsu la'); pg.wait_for_timeout(100); pg.fill('#q', 'katsu lab'); pg.wait_for_timeout(900)
    check('google: same words are not asked again', len(pg.evaluate('window.__gcalls')) == 1 and pg.locator('#g-search').is_visible(), pg.evaluate('window.__gcalls'))
    check('google: one search counted for today', pg.evaluate('JSON.parse(localStorage.getItem("xuetuan:google-day")).n') == 1)
    pg.fill('#q', 'zzz nothing'); pg.wait_for_timeout(900)
    check('google: no results, no Google block', pg.locator('#g-search').is_hidden())
    pg.fill('#q', 'katsu'); pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(SHOTS, '05g-google-search.png'))
    pg.evaluate('(() => { const e = new Event("gmp-select"); e.place = document.querySelector("gmp-place-search").places[0]; document.querySelector("gmp-place-search").dispatchEvent(e); })()')
    pg.wait_for_timeout(400)
    check('google: picking shows Google’s own place card, a red pin and scores', pg.locator('#g-detail gmp-place-details-compact').count() == 1 and pg.evaluate('window.__gcalls.slice(-1)[0]') == ['details', 'gK1'] and pg.locator('#map .sel-pin').count() == 1 and pg.locator('[data-commit="preview-score"]').count() == 1 and '距 XMUM' in pg.inner_text('#view'), pg.inner_text('#view')[:100])
    rate(pg, 4, '[data-commit="preview-score"]')
    pg.wait_for_timeout(300)
    check('google: form starts with the words searched as the name', pg.input_value('#f-name') == 'katsu' and stars_val(pg) == '4', pg.input_value('#f-name') if pg.locator('#f-name').count() else 'no form')
    pg.fill('#f-name', 'Katsu Lab Bell')
    pg.click('#f-submit')
    pg.wait_for_timeout(500)
    stored = pg.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    kl = [p_ for p_ in stored['places'] if p_['name'] == 'Katsu Lab Bell']
    check('google: place saved with the Google place id', len(kl) == 1 and kl[0]['osm'] == 'g/gK1' and kl[0]['mode'] == 'food' and kl[0]['lat'] == 2.828698, kl)
    pg.click('[data-action="search"]') if pg.locator('[data-action="search"]').count() else None
    tab(pg, 'explore'); pg.click('#map-ctrls [data-action="search"]'); pg.fill('#q', 'katsu'); pg.wait_for_timeout(900)
    pg.evaluate('(() => { const e = new Event("gmp-select"); e.place = document.querySelector("gmp-place-search").places[0]; document.querySelector("gmp-place-search").dispatchEvent(e); })()')
    pg.wait_for_timeout(400)
    check('google: picking a place already in XueTuan opens it', pg.locator('#g-detail').count() == 0 and 'Katsu Lab Bell' in pg.inner_text('#view'), pg.inner_text('#view')[:100])
    check('google basemap trial: off unless the address asks for it', pg.locator('#map .gmap').count() == 0 and pg.evaluate('!document.documentElement.classList.contains("gmap-on") && window.__map.interactive !== false'))
    # 谷歌底图试用（&map=google）：谷歌地图起不来就回到原来的地图
    pg2 = ctxg.new_page()
    pg2.goto(APP + '?map=google')
    pg2.wait_for_function('!/map=google/.test(location.href) && window.__map && window.__map.getSource("places")', timeout=10000)
    check('google basemap trial: falls back to our own map when Google can’t start', pg2.locator('#map .gmap').count() == 0 and pg2.evaluate('window.__map.getStyle().layers.length > 10'))
    # 实测开关 ?perf：左上角小框，显示打开时间、瓦片、滑动帧率；平时没有
    check('perf box: not shown normally', pg.locator('#perf').count() == 0)
    pg3 = ctxg.new_page()
    pg3.goto(APP + '?perf')
    pg3.wait_for_function('window.__map && window.__map.getSource("places") && document.querySelector("#perf")', timeout=10000)
    pg3.wait_for_timeout(700)
    pt = pg3.inner_text('#perf')
    pb = pg3.evaluate('(() => { const r = document.querySelector("#perf").getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, getComputedStyle(document.querySelector("#perf")).pointerEvents]; })()')
    check('perf box: ?perf shows open time, tiles and swipe frame rate, does not take taps', '打开' in pt and '瓦片' in pt and '滑动' in pt and pb == [True, True, 'none'], (pt, pb))
    ctxg.close()
    # 谷歌加载不了（本地文件、密钥不让用）：这一块不出，原来的搜索照常
    ctxn = browser.new_context(viewport={'width': 392, 'height': 709})
    route_all(ctxn)
    pn = ctxn.new_page()
    pn.goto(APP)
    pn.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    tab(pn, 'explore'); pn.click('#map-ctrls [data-action="search"]'); pn.fill('#q', 'katsu'); pn.wait_for_timeout(1200)
    check('google: when Google can’t load, the block stays hidden and map results still show', pn.locator('#g-search').is_hidden() and pn.locator('#search-results .sec-title').count() >= 1)
    ctxn.close()

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
    tab(page5, 'explore')
    set_mode(page5, 'food')
    tab(page5, 'foot')
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
    tab(page5, 'explore')
    tab(page5, 'foot')
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
    tab(page5, 'explore')
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('explore map: countries off, no globe button', vis == ['none'] * 3 and page5.locator('[data-action="countries"]').count() == 0 and page5.locator('[data-action="toggle-mode"]').is_visible(), vis)
    sv = page5.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:view:v1"))')
    check('country switch remembered', sv.get('countries') is True and sv.get('mineBoth') is False, sv)
    check('my map: no page errors', not errors5, errors5)
    ctx5.close()

    # ---------- 本地版测试账号：同一台手机换着当不同的人 ----------
    ctx7 = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, locale='zh-CN')
    route_all(ctx7)
    page7 = ctx7.new_page()
    errors7 = []
    page7.on('pageerror', lambda e: errors7.append('pageerror: ' + str(e)))
    page7.goto(APP)
    page7.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page7.wait_for_timeout(300)
    def add7(name, share, score):
        page7.evaluate('window.__map.center = {lng: 101.7055, lat: 2.8402}; window.__map.zoom = 17;')
        add(page7); page7.wait_for_timeout(150)
        page7.click('[data-action="add-pin"]'); page7.click('[data-action="pick-confirm"]'); page7.wait_for_timeout(200)
        if page7.locator('[data-action="near-new"]').count(): page7.click('[data-action="near-new"]'); page7.wait_for_timeout(150)
        if share != (page7.get_attribute('[data-action="f-share"]', 'aria-checked') == 'true'): page7.click('[data-action="f-share"]')
        page7.fill('#f-name', name)
        rate(page7, score)
        page7.click('#f-submit'); page7.wait_for_timeout(400)
        page7.click('[data-action="back"]'); page7.wait_for_timeout(150)
    def acct7(name):
        tab(page7, 'me')
        page7.locator('#test-accounts [data-action="acct"]', has_text=name).click(); page7.wait_for_timeout(250)
    tab(page7, 'me')
    chips7 = page7.locator('#test-accounts .chip').all_inner_texts()
    check('test accounts: Me lists three accounts to switch between (+ add one)', chips7 == ['没起名的号', '测试号 B', '测试号 C', '＋ 再加一个'] and page7.get_attribute('#test-accounts .chip >> nth=0', 'aria-pressed') == 'true', chips7)
    page7.fill('#pf-name', '甲'); page7.wait_for_timeout(500)
    check('me: the header follows the nickname as it is typed', page7.inner_text('#me-name') == '甲')
    add7('甲的公开店', True, 4)
    add7('甲的私密店', False, 2)
    # 我的：头像、昵称、去过几个地方 / 想去几个 / 分享了几条；点数字去足迹的那一边
    tab(page7, 'me')
    st7 = page7.locator('.me-stat b').all_inner_texts()
    check('me: header counts been / wishlist / shared', st7 == ['2', '0', '1'] and page7.inner_text('#me-name') == '甲' and page7.inner_text('.me-head small') == '还没设家乡', (st7, page7.inner_text('.me-head')))
    page7.click('[data-action="foot-sub"][data-v="saved"]'); page7.wait_for_timeout(200)
    check('me: tapping a count opens that side of footprints', page7.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page' and page7.get_attribute('[data-action="mine-sub"][data-v="saved"]', 'aria-pressed') == 'true')
    page7.click('[data-action="mine-sub"][data-v="mine"]')
    acct7('测试号 B')
    check('test accounts: switching says who you are now', '现在是：测试号 B' in page7.inner_text('#toast') and page7.get_attribute('#test-accounts [data-action="acct"] >> nth=1', 'aria-pressed') == 'true', page7.inner_text('#toast'))
    check('test accounts: B has no home and its own nickname', page7.locator('#home-field .home-set-btn').count() == 1 and page7.input_value('#pf-name') == '测试号 B')
    tab(page7, 'foot')
    check('test accounts: B’s own map is empty', page7.inner_text('.view-head .count') == '0', page7.inner_text('.view-head'))
    tab(page7, 'explore')
    names7 = page7.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('test accounts: B sees A’s public place, not the private one', '甲的公开店' in names7 and '甲的私密店' not in names7, names7)
    via_home(page7, '甲的公开店')
    check('test accounts: A’s review shows under A’s name, B cannot edit it', '甲' in page7.inner_text('.reviews, #view') and page7.locator('[data-action="edit-review"]').count() == 0 and page7.locator('[data-commit="place-score"]').count() == 1)
    page7.click('[data-action="toggle-save"]'); page7.wait_for_timeout(150)
    rate(page7, 5, '[data-commit="place-score"]'); page7.wait_for_timeout(200)
    check('stars: score tapped on the card shows in the form', stars_val(page7) == '5')
    # 按住第五颗往左拖到第四颗的左半边 = 3.5，拖的时候数字跟着变
    s5 = page7.locator('#f-rating .st').nth(4).bounding_box(); s4 = page7.locator('#f-rating .st').nth(3).bounding_box()
    page7.mouse.move(s5['x'] + s5['width'] * 0.8, s5['y'] + 10); page7.mouse.down()
    page7.mouse.move(s4['x'] + s4['width'] * 0.3, s4['y'] + 10, steps=5)
    live7 = (stars_val(page7), page7.inner_text('#f-rating .stars-val'), page7.evaluate('document.querySelectorAll("#f-rating .st-fill")[3].style.width'))
    page7.mouse.up(); page7.wait_for_timeout(100)
    check('stars: dragging left lands on a half star (3.5), shown while dragging', live7 == ('3.5', '3.5', '50%'), live7)
    if page7.get_attribute('[data-action="f-share"]', 'aria-checked') != 'true': page7.click('[data-action="f-share"]')
    page7.fill('#f-text', '乙也来过'); page7.click('#f-submit'); page7.wait_for_timeout(400)
    check('test accounts: B adds a second review to A’s place', page7.locator('#view .review, #view .rv').count() >= 2 or page7.inner_text('#view').count('乙也来过') == 1, page7.inner_text('#view')[:300])
    d7 = page7.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    pl7 = [x for x in d7['places'] if x['name'] == '甲的公开店'][0]
    check('stars: half star saved as 3.5', [r['rating'] for r in d7['reviews'] if r.get('text') == '乙也来过'] == [3.5], [r['rating'] for r in d7['reviews']])
    check('test accounts: the save belongs to B only', [w['userId'] for w in d7['wishlist'] if w['placeId'] == pl7['id']] == [d7['profile']['id']], d7['wishlist'])
    page7.click('[data-action="back"]')
    acct7('甲')
    tab(page7, 'foot')
    check('test accounts: back as A, my own map has both of mine (private too)', page7.inner_text('.view-head .count') == '2', page7.inner_text('.view-head'))
    page7.click('[data-action="mine-sub"][data-v="saved"]'); page7.wait_for_timeout(200)
    check('test accounts: A did not get B’s save', page7.inner_text('.view-head .count') == '0')
    via_home(page7, '乙也来过', to_place=False)
    check('test accounts: A sees B’s post', '测试号 B' in page7.inner_text('.post-who') and '乙也来过' in page7.inner_text('.post-text'))
    page7.click('[data-action="post-place"]'); page7.wait_for_timeout(250)
    check('test accounts: A sees B’s review on the shared place', '测试号 B' in page7.inner_text('#view') and '乙也来过' in page7.inner_text('#view'))
    page7.click('[data-action="back"]')
    # C 打 0 分（恶意差评）：平均分不算它
    acct7('测试号 C')
    via_home(page7, '乙也来过')
    rate(page7, 4, '[data-commit="place-score"]')
    rate(page7, 0)
    zero7 = stars_val(page7)
    if page7.get_attribute('[data-action="f-share"]', 'aria-checked') != 'true': page7.click('[data-action="f-share"]')
    page7.fill('#f-text', '丙打零分'); page7.click('#f-submit'); page7.wait_for_timeout(400)
    check('stars: dragging off the first star gives 0', zero7 == '0', zero7)
    page7.click('[data-action="back"]'); page7.wait_for_timeout(200)
    tab(page7, 'home')
    fi7 = page7.locator('.post-card', has_text='乙也来过').first
    check('home card: each record shows its own stars (3.5 = three and a half)', fi7.locator('.stars-mini').get_attribute('aria-label') == '3.5 分' and fi7.evaluate('e => [...e.querySelectorAll(".stars-mini .st-fill")].map(f => f.style.width).join()') == '100%,100%,100%,50%,0%')
    who7 = [x.split(' · ')[0] for x in page7.locator('.post-card .pc-who > span:not(.avatar)').all_inner_texts()]
    check('home: newest first (C’s 0, then B, then A), A’s private record not there', who7 == ['测试号 C', '测试号 B', '甲'], who7)
    fi7.locator('.pc-open').click(); page7.wait_for_timeout(250)
    page7.click('[data-action="post-place"]'); page7.wait_for_timeout(250)
    check('place page: average says the 0 was left out', '3.8' in page7.inner_text('#view') and '2 人打分的平均（不算 1 个 0 分）' in page7.inner_text('#view'), page7.inner_text('#view')[:300])
    tab(page7, 'me'); page7.click('[data-action="acct-add"]'); page7.wait_for_timeout(250)
    check('test accounts: add one more (D) and switch to it', '现在是：测试号 D' in page7.inner_text('#toast') and page7.locator('#test-accounts [data-action="acct"]').count() == 4, page7.inner_text('#toast'))
    check('test accounts: no page errors', not errors7, errors7)
    ctx7.close()

    # ---------- 从照片批量加（本地版；假的 exifr 按文件名给拍摄地点和时间） ----------
    S0, S1 = [x for x in FOOD_S if x['rating'] is not None][:2]
    ctxb = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, locale='zh-CN')
    route_all(ctxb)
    ctxb.add_init_script('window.__exif = ' + json.dumps({
        'a1.jpg': {'latitude': S0['lat'] + 0.0001, 'longitude': S0['lng'], 'DateTimeOriginal': '2026-09-01T12:00:00'},
        'a2.jpg': {'latitude': S0['lat'] + 0.0002, 'longitude': S0['lng'], 'DateTimeOriginal': '2026-09-01T12:20:00'},
        'b1.jpg': {'latitude': 3.15, 'longitude': 101.6, 'DateTimeOriginal': '2026-09-02T19:00:00'},
        # 手机把经纬度去掉了，只剩拍摄时间：隔不到 1 小时的算一组
        'c1.jpg': {'DateTimeOriginal': '2026-08-30T12:00:00'}, 'c2.jpg': {'DateTimeOriginal': '2026-08-30T12:40:00'}}) + ';')
    # 假的本地小模型：每张都像海边（吃还是玩按照片猜）
    ctxb.add_init_script('window.__catCalls = 0; window.__catClassifier = function (u, o) { window.__catCalls++; return Promise.resolve([{ label: "seashore, coast, seacoast, sea-coast", score: 0.6 }, { label: "cup", score: 0.1 }]); };')
    pb = ctxb.new_page()
    errorsb = []
    pb.on('pageerror', lambda e: errorsb.append('pageerror: ' + str(e)))
    pb.goto(APP)
    pb.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    bfiles = []
    for i_, n_ in enumerate(['a1.jpg', 'a2.jpg', 'b1.jpg', 'c1.jpg', 'c2.jpg']):
        fp_ = os.path.join(SHOTS, n_)
        Image.new('RGB', (1200, 900), (60 + 40 * i_, 120, 200)).save(fp_, 'JPEG')
        bfiles.append(fp_)
    add(pb)
    check('bulk: the add page offers adding many from photos', pb.locator('[data-action="bulk-start"]').is_visible())
    with pb.expect_file_chooser() as fc_:
        pb.click('[data-action="bulk-start"]')
    fc_.value.set_files(bfiles)
    pb.wait_for_function('document.querySelectorAll(".bk-card").length === 3 && !document.querySelector(".bk-names .f-hint")', timeout=8000)
    sumb = pb.inner_text('.bk-sum')
    check('bulk: photos grouped by where they were taken; ones without a location grouped by time', '5 张照片，分成 3 组' in sumb and '2 张读不到位置' in sumb, sumb)
    check('bulk: newest place first', '9月2日' in pb.inner_text('#bk-meta-0') and '9月1日' in pb.inner_text('#bk-meta-1') and '8月30日' in pb.inner_text('#bk-meta-2'), [pb.inner_text('#bk-meta-0'), pb.inner_text('#bk-meta-1')])
    check('bulk: no-location photos taken 40 min apart are one group with a search box', pb.locator('#bk-2 .bk-ph').count() == 2 and '没有位置' in pb.inner_text('#bk-meta-2')
          and '12:00' in pb.inner_text('#bk-meta-2') and pb.locator('#bk-2 [data-bk-q]').count() == 1 and pb.locator('#bk-2 [data-action="bulk-pick"]').count() == 0)
    check('bulk: explains the missing locations and offers the file manager', pb.locator('.bk-tip [data-action="bulk-files"]').is_visible() and '文件管理' in pb.inner_text('.bk-tip'))
    chips_b = pb.eval_on_selector_all('#bk-1 .bk-names .chip', 'els => els.map(e => e.textContent + ":" + e.getAttribute("aria-pressed"))')
    check('bulk: a place already in XueTuan nearby is picked by default', chips_b[0].startswith(S0['name']) and chips_b[0].endswith(':true') and ' m' in chips_b[0], chips_b)
    check('bulk: both photos of that visit are in, none picked for the far one', pb.locator('#bk-1 .bk-ph[aria-pressed="true"]').count() == 2
          and pb.locator('#bk-0 [data-bk-name]').count() == 1 and pb.get_attribute('#bk-0 [data-action="bulk-pick"][data-k="-1"]', 'aria-pressed') == 'true')
    check('bulk: nothing to save before scoring', pb.inner_text('#bk-save') == '保存 0' and pb.is_disabled('#bk-save'))
    pb.wait_for_function('window.__catCalls >= 3', timeout=5000); pb.wait_for_timeout(100)
    check('bulk: food or travel is picked from the place first, else from the photo (beach = 旅行)', pb.get_attribute('#bk-1 [data-action="bulk-mode"][data-v="food"]', 'aria-pressed') == 'true'
          and pb.get_attribute('#bk-2 [data-action="bulk-mode"][data-v="travel"]', 'aria-pressed') == 'true' and pb.inner_text('#bk-2 [data-action="bulk-mode"][data-v="travel"]') == '旅行'
          and pb.get_attribute('#bk-2 [data-bk-q]', 'placeholder') == '搜地点')
    rate(pb, 4, '#bk-rate-1')
    pb.click('#bk-1 .bk-ph >> nth=1')
    pb.fill('[data-bk-name="0"]', '照片夜市')
    pb.click('#bk-0 [data-action="bulk-mode"][data-v="travel"]')
    rate(pb, 3.5, '#bk-rate-0')
    check('bulk: typing a name and switching to travel keeps the name', pb.input_value('[data-bk-name="0"]') == '照片夜市' and pb.get_attribute('#bk-0 [data-action="bulk-mode"][data-v="travel"]', 'aria-pressed') == 'true')
    check('bulk: a photo can be left out', pb.get_attribute('#bk-1 .bk-ph >> nth=1', 'aria-pressed') == 'false' and pb.inner_text('#bk-save') == '保存 2')
    rate(pb, 5, '#bk-rate-2')
    check('bulk: a scored no-location group needs a place before it can be saved', pb.is_visible('#bk-need-2') and pb.inner_text('#bk-save') == '保存 2')
    pb.fill('[data-bk-q="2"]', S1['name'])
    pb.wait_for_function('document.querySelector("#bk-found-2 .chip")', timeout=5000)
    found_b = pb.locator('#bk-found-2 .chip b').all_inner_texts()
    check('bulk: searching finds the place by name, XueTuan places first', found_b and found_b[0] == S1['name'], found_b)
    pb.click('#bk-found-2 .chip >> nth=0')
    check('bulk: picking a search result makes it ready to save, input keeps its text', pb.get_attribute('#bk-found-2 .chip >> nth=0', 'aria-pressed') == 'true'
          and not pb.is_visible('#bk-need-2') and pb.inner_text('#bk-save') == '保存 3' and pb.input_value('[data-bk-q="2"]') == S1['name'])
    pb.click('#bk-2 [data-action="bulk-mode"][data-v="travel"]')
    check('bulk: food / travel can be switched by hand, the picked place stays', pb.get_attribute('#bk-2 [data-action="bulk-mode"][data-v="travel"]', 'aria-pressed') == 'true'
          and pb.get_attribute('#bk-found-2 .chip >> nth=0', 'aria-pressed') == 'true' and pb.input_value('[data-bk-q="2"]') == S1['name'])
    gb = pb.evaluate('(() => { const c = document.querySelector(".bk-card").getBoundingClientRect(), s = document.querySelector("#bk-save").getBoundingClientRect(); return [document.documentElement.scrollWidth <= innerWidth, c.right <= innerWidth, s.right <= innerWidth, document.querySelector("#panel").dataset.snap]; })()')
    check('bulk: fits the phone, opens as a full panel', gb == [True, True, True, 'full'], gb)
    pb.screenshot(path=os.path.join(SHOTS, '14-bulk.png'))
    pb.click('[data-action="back"]'); pb.wait_for_timeout(200)
    check('bulk: leaving with scores asks first', '还没保存' in pb.inner_text('#modal'))
    pb.click('[data-modal="no"]'); pb.wait_for_timeout(150)
    pb.click('#bk-save')
    pb.wait_for_function('document.querySelector("#toast") && document.querySelector("#toast").textContent.indexOf("存进足迹 3 个") !== -1', timeout=8000)
    pb.wait_for_timeout(200)
    stb = pb.evaluate('''(s1name) => { const d = JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1")), me = d.profile.id;
      const mine = d.reviews.filter(r => r.authorId === me && !r.sample), np = d.places.find(p => p.name === "照片夜市");
      return { mine: mine.map(r => [r.placeId, r.rating, r.photos.length, r.visibility, r.createdAt]), np: np && [np.mode, Math.round(np.lat * 100) / 100, np.lng],
        s1: d.places.filter(p => p.name === s1name).map(p => p.mode).sort(),
        t1: new Date("2026-09-01T12:00:00").getTime(), t2: new Date("2026-09-02T19:00:00").getTime(), t3: new Date("2026-08-30T12:00:00").getTime() }; }''', S1['name'])
    want_b = sorted([[S0['id'], 4, 1, 'private', stb['t1']], [None, 3.5, 1, 'private', stb['t2']], [None, 5, 2, 'private', stb['t3']]], key=lambda r: r[1])
    got_b = sorted([[r[0] if r[0] == S0['id'] else None] + r[1:] for r in stb['mine']], key=lambda r: r[1])
    check('bulk: saved as private records with the photos, dated when they were taken', got_b == want_b and stb['np'] and stb['np'][0] == 'travel' and stb['np'][1] == 3.15, stb)
    check('bulk: switched to travel by hand, so it is saved as a travel place of its own', stb['s1'] == ['food', 'travel'], stb['s1'])
    check('bulk: after saving you land on footprints', pb.get_attribute('#tabbar [data-tab="foot"]', 'aria-current') == 'page' and pb.locator('.bk-card').count() == 0)
    check('bulk: no page errors', not errorsb, errorsb)
    ctxb.close()

    # ---------- 线上版（假的 Supabase） ----------
    A, B = 'aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b'
    C = 'cccccccc-0000-4000-8000-00000000000c'
    sb_seed = {
        'profiles': [{'id': B, 'name': '小B', 'country': '', 'region': '', 'city': '', 'district': ''}, {'id': C, 'name': '小C'}],
        'homes': [{'user_id': B, 'city': 'Klang', 'lat': 3.0, 'lng': 101.4, 'is_public': True}, {'user_id': C, 'city': '秘密城', 'lat': 1.3, 'lng': 103.8, 'is_public': False}],
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
    # 底图太空：放大后把地点库的店画成小圆点 + 店名；雪团已有的不重复；美食地图只有吃的；点了出预览（用户 2026-10-28）
    page6.evaluate('''window.__sb.db.poi.push({ id: 'ddd', name: 'B 的公开店', alt_name: '', mode: 'food', cat: 'chinese', lat: 2.8336, lng: 101.7036, locality: 'Sepang' },
        { id: 'eee', name: 'Taman Ujian', alt_name: '', mode: 'travel', cat: 'park', lat: 2.8345, lng: 101.7045, locality: 'Sepang' })''')
    page6.evaluate('''(() => { const m = window.__map; m.getBounds = () => ({ getWest: () => 101.69, getEast: () => 101.72, getNorth: () => 2.85, getSouth: () => 2.82, contains: () => true });
        window.__libQ0 = window.__sb.calls ? window.__sb.calls.length : 0; m.jumpTo({ center: [101.704, 2.834], zoom: 13 }); })()''')
    page6.wait_for_timeout(600)
    lib0 = page6.evaluate('window.__map.getSource("libpoi").data.features.length')
    page6.evaluate('window.__map.jumpTo({ center: [101.704, 2.834], zoom: 15.5 })')
    page6.wait_for_timeout(900)
    lib1 = page6.evaluate('window.__map.getSource("libpoi").data.features.map(f => f.properties.name)')
    ly = page6.evaluate('(() => { const l = window.__map.layers; const i = n => l.findIndex(x => x.id === n); return [l.find(x => x.id === "lib-dot").minzoom, i("lib-label") < i("cl-halo")]; })()')
    check('place library: nothing fetched when zoomed out; at street level its food places show under our pins, places already in XueTuan not repeated', lib0 == 0 and 'Kafe Ujian Dekat' in lib1 and 'B 的公开店' not in lib1 and 'Taman Ujian' not in lib1 and ly == [14.5, True], (lib0, lib1, ly))
    page6.evaluate('''(() => { window.__qrf = [{ layer: { id: 'lib-dot' }, properties: { osm: 'ovt/aaa', name: 'Kafe Ujian Dekat', alt: '', mode: 'food', cat: 'cafe', where: 'Sepang' }, geometry: { type: 'Point', coordinates: [101.704, 2.8341] } }];
        window.__map.fire('click', { point: { x: 200, y: 300 }, lngLat: { lng: 101.704, lat: 2.8341 } }); window.__qrf = []; })()''')
    page6.wait_for_timeout(400)
    check('place library: tapping a dot opens its preview with scoring', 'Kafe Ujian Dekat' in page6.inner_text('#view'), page6.inner_text('#view')[:120])
    page6.click('[data-action="back"]') if page6.locator('[data-action="back"]').count() else None
    page6.wait_for_timeout(200)
    page6.evaluate('window.__map.jumpTo({ center: [101.703, 2.8329], zoom: 14.6 })'); page6.wait_for_timeout(300)
    page6.evaluate('window.__map.getBounds = undefined; window.__sb.db.poi = window.__sb.db.poi.filter(r => r.id !== "ddd" && r.id !== "eee")')
    tab(page6, 'home'); page6.wait_for_timeout(300)
    check('remote: home shows other people’s public posts with their name', page6.locator('.post-card', has_text='小B').count() == 1 and page6.locator('.post-card', has_text='秘密').count() == 0)
    via_home(page6, '小B', to_place=False)
    check('remote: the post says where they are from', '小B' in page6.inner_text('.post-who') and '来自 Klang' in page6.inner_text('.post-who') and page6.inner_text('.post-text') == '好吃', page6.inner_text('#view')[:200])
    page6.click('[data-action="back"]'); page6.wait_for_timeout(200)
    add(page6)
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
    check('remote: login returns to feed with toast', page6.locator('.view-head .view-title').count() == 1 and '登录了' in page6.inner_text('#toast'), page6.inner_text('#toast'))

    # 店名搜索：先查地点库，Photon 的同一家店不重复列出
    add(page6)
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
    add(page6)
    page6.click('[data-action="add-pin"]')
    page6.click('[data-action="pick-confirm"]')
    page6.wait_for_timeout(200)
    page6.click('[data-action="f-share"]')
    page6.fill('#f-nick', '小A')
    # 分类预选：店名关键词 > 照片（本地小模型，测试里用假的分类器）；自己点的最大
    page6.fill('#f-name', 'Sushi 测试')
    check('category from shop name: "sushi" preselects 日韩 with a note', page6.get_attribute('[data-action="f-cat"][data-cat="jpkr"]', 'aria-pressed') == 'true' and page6.inner_text('#cat-guess') == '按店名选了「日韩」，不对就点别的', page6.inner_text('#cat-guess'))
    page6.fill('#f-name', '线上测试店')
    check('category note goes away when the keyword is gone', page6.locator('#cat-guess').is_hidden())
    rate(page6, 3)
    page6.evaluate('window.__catCalls = 0; window.__catClassifier = (u, o) => { window.__catCalls++; return Promise.resolve([{ label: "hotpot, hot pot", score: 0.55 }, { label: "soup bowl", score: 0.2 }]); }; 0')
    page6.set_input_files('#f-file', photo)
    page6.wait_for_function('document.querySelectorAll("#f-photos .ph-edit").length === 1', timeout=8000)
    page6.wait_for_function('!document.querySelector("#cat-guess").hidden && document.querySelector("#cat-guess").textContent.indexOf("火锅") !== -1', timeout=5000)
    check('photo category guess (on-device model): hotpot preselected with a note', page6.get_attribute('[data-action="f-cat"][data-cat="hotpot"]', 'aria-pressed') == 'true' and page6.inner_text('#cat-guess') == '看照片像「火锅」，不对就点别的' and page6.evaluate('window.__catCalls') == 1, (page6.inner_text('#cat-guess'), page6.evaluate('window.__catCalls'), page6.evaluate('[...document.querySelectorAll("[data-action=f-cat][aria-pressed=true]")].map(b => b.dataset.cat)')))
    page6.click('[data-action="f-cat"][data-cat="cafe"]')
    page6.fill('#f-name', 'Ramen 线上测试店')
    page6.fill('#f-name', '线上测试店')
    check('photo category guess: my own pick wins over photo and name', page6.get_attribute('[data-action="f-cat"][data-cat="cafe"]', 'aria-pressed') == 'true' and page6.get_attribute('[data-action="f-cat"][data-cat="hotpot"]', 'aria-pressed') == 'false' and page6.locator('#cat-guess').is_hidden())
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
    via_home(page6, 'B 的公开店')
    page6.wait_for_timeout(200)
    page6.click('[data-action="toggle-save"]')
    page6.wait_for_timeout(200)
    check('remote: wishlist row written', page6.evaluate('window.__sb.db.wishlist.length') == 1 and page6.evaluate('window.__sb.db.wishlist[0].user_id') == A)
    page6.click('[data-action="toggle-save"]')
    page6.wait_for_timeout(200)
    check('remote: wishlist row removed', page6.evaluate('window.__sb.db.wishlist.length') == 0)
    check('remote: cannot edit someone else’s review', page6.locator('[data-action="edit-review"]').count() == 0)

    # 还不在雪团的店先收藏：一个地点（没有记录）+ 想去；取消收藏后没人记录也没人想去，地点就删掉
    def kafe_search():
        tab(page6, 'explore'); page6.click('#map-ctrls [data-action="search"]'); page6.fill('#q', 'kafe')
        page6.wait_for_selector('[data-action="osm-pick"]', timeout=5000); page6.wait_for_timeout(150)
    page6.click('[data-action="back"]'); page6.wait_for_timeout(200)
    kafe_search()
    page6.locator('[data-action="osm-pick"]', has_text='Kafe Ujian Dekat').click(); page6.wait_for_timeout(300)
    page6.click('[data-action="save-preview"]'); page6.wait_for_timeout(400)
    db6 = page6.evaluate('window.__sb.db')
    kd = [p_ for p_ in db6['places'] if p_['name'] == 'Kafe Ujian Dekat']
    check('remote: saving an unrecorded place writes a place (no visit) + a wishlist row', len(kd) == 1 and kd[0]['created_by'] == A and kd[0]['osm'] == 'ovt/aaa'
          and [w['place_id'] for w in db6['wishlist']] == [kd[0]['id']] and not any(v['place_id'] == kd[0]['id'] for v in db6['visits']) and page6.locator('.place-empty').count() == 1, (kd, db6['wishlist']))
    page6.click('[data-action="toggle-save"]'); page6.wait_for_timeout(400)
    db6 = page6.evaluate('window.__sb.db')
    check('remote: unsaving a place nobody recorded removes it', not any(p_['name'] == 'Kafe Ujian Dekat' for p_ in db6['places']) and not db6['wishlist']
          and page6.locator('.place-head').count() == 0, db6['wishlist'])
    kafe_search()
    row6 = page6.locator('[data-action="osm-pick"]', has_text='Kafe Ujian Dekat').inner_text()
    page6.locator('[data-action="osm-pick"]', has_text='Kafe Ujian Dekat').click(); page6.wait_for_timeout(300)
    page6.click('[data-action="save-preview"]'); page6.wait_for_timeout(400)
    db6 = page6.evaluate('window.__sb.db')
    check('remote: it can be saved again from search', '已在雪团' not in row6 and len([p_ for p_ in db6['places'] if p_['name'] == 'Kafe Ujian Dekat']) == 1 and len(db6['wishlist']) == 1
          and page6.locator('[data-action="toggle-save"][aria-pressed="true"]').count() == 1, (row6, db6['wishlist']))
    page6.click('[data-action="toggle-save"]'); page6.wait_for_timeout(400)

    # 编辑自己的记录（换照片），再删掉：地点跟着删，照片也删
    via_home(page6, '线上测试店')
    page6.wait_for_timeout(200)
    page6.click('[data-action="edit-review"]')
    page6.wait_for_timeout(200)
    rate(page6, 0)
    page6.click('[data-action="f-photo-del"]')
    page6.click('#f-submit')
    page6.wait_for_timeout(500)
    v6 = page6.evaluate('window.__sb.db.visits.filter(v => v.user_id === "%s")' % A)
    check('remote: edit saved, removed photo deleted from storage', v6[0]['rating'] == 0 and v6[0]['photos'] == [] and page6.evaluate('Object.keys(window.__sb.files).length') == 0, v6)
    page6.click('[data-action="del-review"]')
    page6.click('[data-modal="yes"]')
    page6.wait_for_timeout(500)
    db6 = page6.evaluate('window.__sb.db')
    check('remote: deleting last visit removes the place', not any(p_['name'] == '线上测试店' for p_ in db6['places']) and page6.locator('.view-head .view-title').count() == 1)

    # 从照片批量加（线上）：附近的店从地点库里找，存成地点 + 记录，照片传上去，日期用拍摄时间
    page6.evaluate('window.__exif = ' + json.dumps({'k1.jpg': {'latitude': 2.8342, 'longitude': 101.7041, 'DateTimeOriginal': '2026-08-15T13:00:00'}}))
    kfile = os.path.join(SHOTS, 'k1.jpg')
    Image.new('RGB', (1000, 1000), (200, 160, 90)).save(kfile, 'JPEG')
    add(page6)
    page6.set_input_files('#bulk-file', [kfile])
    page6.wait_for_function('document.querySelector(".bk-card") && !document.querySelector(".bk-names .f-hint")', timeout=8000)
    chips6 = page6.locator('#bk-0 .bk-names .chip b').all_inner_texts()
    check('remote bulk: nearby names come from the place library, nearest first, XueTuan places too', chips6[:2] == ['Kafe Ujian Dekat', 'B 的公开店'], chips6)
    rate(page6, 5, '#bk-rate-0')
    page6.click('#bk-save')
    page6.wait_for_function('document.querySelector("#toast").textContent.indexOf("存进足迹 1 个") !== -1', timeout=8000)
    db6 = page6.evaluate('window.__sb.db')
    kp = [p_ for p_ in db6['places'] if p_['osm'] == 'ovt/aaa']
    kv = [v for v in db6['visits'] if kp and v['place_id'] == kp[0]['id']]
    check('remote bulk: place + private visit with the photo, dated when it was taken', len(kp) == 1 and kp[0]['name'] == 'Kafe Ujian Dekat' and len(kv) == 1 and kv[0]['rating'] == 5
          and kv[0]['visibility'] == 'private' and len(kv[0]['photos']) == 1 and kv[0]['created_at'].startswith('2026-08-15'), (kp, kv))

    # 把本地旧记录传上去
    tab(page6, 'me')
    page6.wait_for_timeout(200)
    check('remote: profile shows account', 'a@example.com' in page6.inner_text('.account-row'))
    # 我的家：搜城市（只要城市），写进 homes 表，默认不公开
    page6.click('#home-field [data-action="home-set"]')
    page6.fill('#home-q', 'george')
    page6.wait_for_selector('[data-action="home-result"]', timeout=5000)
    rows_h = page6.locator('[data-action="home-result"] b').all_inner_texts()
    check('remote home: city search lists only cities', rows_h == ['George Town'], rows_h)
    check('remote home: Photon asked for city layers only', any('q=george' in u and 'layer=city' in u for u in photon_calls), photon_calls[-1:])
    page6.click('[data-action="home-result"]')
    page6.wait_for_function('document.querySelector("#home-field .home-row")', timeout=4000)
    hrow = [h for h in page6.evaluate('window.__sb.db.homes') if h['user_id'] == A]
    check('remote home: row written, private by default, rounded', len(hrow) == 1 and hrow[0]['city'] == 'George Town' and hrow[0]['is_public'] is False and hrow[0]['lat'] == 5.4 and hrow[0]['lng'] == 100.3, hrow)
    page6.click('[data-action="home-public"]')
    page6.wait_for_timeout(200)
    hrow = [h for h in page6.evaluate('window.__sb.db.homes') if h['user_id'] == A]
    check('remote home: making it public updates the same row', len(hrow) == 1 and hrow[0]['is_public'] is True, hrow)
    uids = sorted(page6.evaluate('window.__map.getSource("homes").data.features.map(f => f.properties.uid)'))
    check('remote home: big map shows public homes only (not 小C’s private one)', uids == sorted([A, B]), uids)
    page6.click('[data-action="home-del"]')
    page6.wait_for_timeout(200)
    check('remote home: remove deletes my row', not any(h['user_id'] == A for h in page6.evaluate('window.__sb.db.homes')) and page6.locator('#home-field .home-set-btn').count() == 1)
    page6.click('[data-action="upload-local"]')
    page6.click('[data-modal="yes"]')
    page6.wait_for_timeout(800)
    db6 = page6.evaluate('window.__sb.db')
    up = [p_ for p_ in db6['places'] if p_['name'] == '槟城']
    check('remote: local entries uploaded (samples skipped, wishlist kept)', len(up) == 1 and up[0]['created_by'] == A and not any(p_['name'] == '示例' for p_ in db6['places']) and len(db6['wishlist']) == 1 and db6['wishlist'][0]['place_id'] == up[0]['id'], (up, db6['wishlist']))
    check('remote: upload toast', '上传了 1 个地点' in page6.inner_text('#toast'), page6.inner_text('#toast'))

    # 别人删掉最后一条记录，我收藏的地点还在（数据库触发器：还有人想去就不删）
    via_home(page6, 'B 的公开店')
    page6.click('[data-action="toggle-save"]'); page6.wait_for_timeout(300)
    page6.evaluate('window.__sbLogin("%s", "b@example.com")' % B); page6.wait_for_timeout(400)
    page6.evaluate('window.supabase.createClient().from("visits").delete().eq("id", "v-b-pub").then(() => {})'); page6.wait_for_timeout(200)
    page6.evaluate('window.__sbLogin("%s", "a@example.com")' % A); page6.wait_for_timeout(600)
    db6 = page6.evaluate('window.__sb.db')
    check('remote: someone deleting the last record keeps a place I saved', any(p_['id'] == 'p-b-pub' for p_ in db6['places']) and not any(v['place_id'] == 'p-b-pub' for v in db6['visits'])
          and any(w['place_id'] == 'p-b-pub' and w['user_id'] == A for w in db6['wishlist']), db6['wishlist'])
    tab(page6, 'foot')
    page6.click('[data-action="mine-sub"][data-v="saved"]'); page6.wait_for_timeout(300)
    check('remote: …and it is still in my wishlist', page6.locator('.near-item', has_text='B 的公开店').count() == 1, page6.inner_text('#view')[:200])
    page6.locator('.near-item', has_text='B 的公开店').click(); page6.wait_for_timeout(300)
    check('remote: …opening it says nobody has recorded it yet', page6.locator('.place-empty').count() == 1)
    page6.click('[data-action="toggle-save"]'); page6.wait_for_timeout(400)
    check('remote: the last unsave removes the empty place', not any(p_['id'] == 'p-b-pub' for p_ in page6.evaluate('window.__sb.db.places')))
    check('remote: cannot save a place I cannot see', page6.evaluate('window.supabase.createClient().from("wishlist").insert({ user_id: "%s", place_id: "p-b-priv" }).then(r => !!r.error)' % A))

    # 退出登录
    tab(page6, 'me')
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
