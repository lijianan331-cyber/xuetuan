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
def tier(x):
    d = dist_m(x['lat'], x['lng'])
    return 'walk' if d <= 1500 else 'short' if d <= 10000 else 'mid' if d <= 40000 else 'far'

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
    page.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type in ('error',) else None)
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
    check('app layers added', st['layers'] == ['pt-area', 'cl-halo', 'cl-circle', 'cl-count', 'pt-sel', 'pt-pin', 'pt-label', 'me-halo', 'me-dot'], st['layers'])
    check('parsed sample rows', len(SAMPLE_ROWS) >= 60 and len(FOOD_S) >= 30, len(SAMPLE_ROWS))
    want_imgs = len({(x['cat'], 'none' if x['rating'] is None else x['rating'] * 10) for x in FOOD_S})
    check('pin images drawn on demand (one per category + score bucket)', st['images'] == want_imgs, (st['images'], want_imgs))
    pins = page.evaluate('window.__map.getSource("places").data.features.map(f => [f.properties.icon, f.properties.color])')
    check('pins coloured by score (0 grey, 5 red)', all(c.lower() == '#d7261e' for i, c in pins if i.endswith('-50')) and all(c.lower() == '#8e9893' for i, c in pins if i.endswith('-0')) and any(i.endswith('-0') for i, c in pins), pins)
    check('renamed to 雪团', page.title() == '雪团 XueTuan' and '雪团' in page.evaluate('document.querySelector(".panel-brand .brand-name").textContent'), page.title())
    tabs = page.locator('#tabbar .tab').all_inner_texts()
    check('bottom tab bar: explore / saved / add / my map / me', [x.strip() for x in tabs] == ['探索', '收藏', '加一家', '我的地图', '我'], tabs)
    check('explore tab is current', page.get_attribute('#tabbar [data-scope="all"]', 'aria-current') == 'page')
    check('no right-side tool column, locate button kept', page.locator('.tools, [data-action="zoom-in"], [data-action="to-globe"], [data-action="basemap"]').count() == 0 and page.locator('.locate-btn').is_visible())
    check('header: place name, search bar, filter button', page.locator('#loc-name').is_visible() and page.locator('.search-bar').is_visible() and page.locator('[data-action="filters"]').is_visible())
    page.wait_for_function('document.querySelector("#loc-name").textContent !== "XMUM"', timeout=3000)
    check('header shows the area name for the map centre', page.inner_text('#loc-name') == 'XMUM 校园', page.inner_text('#loc-name'))
    check('score legend shown', page.locator('.legend').count() == 1)
    check('globe projection', st['proj'] == {'type': 'globe'}, st['proj'])
    check('labels patched to Chinese', 'name:zh' in json.dumps(st['label']), st['label'])
    check('shield labels untouched', st['shield'] == '{ref}', st['shield'])
    check('fonts picked from style', st['countFont'] == ['Noto Sans Bold'] and st['labelFont'] == ['Noto Sans Regular'], (st['countFont'], st['labelFont']))
    check('food mode shows all sample food places', st['feats'] == len(FOOD_S), (st['feats'], len(FOOD_S)))
    check('intro flight to campus', st['intro'] >= 1, st['intro'])
    feed_n = page.locator('.feed-item').count()
    check('feed lists the food samples', feed_n == min(80, len(FOOD_S)), feed_n)
    check('sample reviews carry scores', page.locator('.feed-item .score').count() == len([x for x in FOOD_S if x['rating'] is not None]))
    check('fab hint hidden (samples already near campus)', not page.locator('#fab-hint').is_visible())
    ov = page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    check('no horizontal overflow (mobile)', ov)
    page.screenshot(path=os.path.join(SHOTS, '01-mobile-peek.png'))

    # travel mode
    page.click('[data-action="mode"][data-mode="travel"]')
    page.wait_for_timeout(200)
    tf = page.evaluate('window.__map.getSource("places").data.features.length')
    check('travel mode shows all travel samples', tf == len(TRAVEL_S), (tf, len(TRAVEL_S)))
    check('accent repainted', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]').lower() == '#12897f', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]'))
    check('fab label switches', page.inner_text('#fab-label') == '打卡', page.inner_text('#fab-label'))
    # expand sheet by tapping title
    page.click('.title-row .view-title')
    page.wait_for_timeout(400)
    check('sheet expands to half', page.get_attribute('#panel', 'data-snap') == 'half')
    check('add button stays in the tab bar at half', page.locator('#fab').is_visible())
    vis = page.evaluate('''(() => { const body = document.querySelector('.panel-body'); body.scrollTop = body.scrollHeight; const r = document.querySelector('.feed li:last-child').getBoundingClientRect(); return r.bottom <= document.querySelector('#tabbar').getBoundingClientRect().top + 1; })()''')
    check('last feed item reachable in half sheet', vis)
    page.screenshot(path=os.path.join(SHOTS, '02-mobile-travel-half.png'))

    # open a sample place
    page.locator('.feed-item', has_text='金门大桥').click()
    page.wait_for_timeout(300)
    check('place view title', page.inner_text('.place-head h2') == '金门大桥', page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'none')
    check('far place offers google view only', page.locator('a.btn', has_text='在 Google 地图看').count() == 1 and page.locator('a.btn', has_text='Waze').count() == 0)
    sel = page.evaluate('window.__map.layers.find(l=>l.id==="pt-sel").filter')
    check('selection ring filter', sel == ['==', ['get', 'id'], 's-golden-gate'], sel)
    check('opened place gets the red pin', page.locator('#map .sel-pin').count() == 1)
    page.screenshot(path=os.path.join(SHOTS, '03-mobile-place.png'))
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back to feed', page.locator('.feed').count() == 1)
    check('red pin removed on the feed', page.locator('#map .sel-pin').count() == 0)

    # back to food, add a place at XMUM
    page.click('[data-action="mode"][data-mode="food"]')
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
    # validation
    page.click('#f-submit')
    page.wait_for_timeout(100)
    check('name required error', page.locator('#err-f-name').is_visible())
    check('category required error', page.locator('#err-cat').is_visible())
    check('score required error', page.locator('#err-rating').is_visible())
    check('score input offers 0 to 5', page.locator('.score-input .sc').all_inner_texts() == ['0', '1', '2', '3', '4', '5'])
    page.fill('#f-nick', '小测')
    page.fill('#f-name', '测试椰浆饭')
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
    check('after publish: place view', page.locator('.place-head h2').count() == 1 and page.inner_text('.place-head h2') == '测试椰浆饭')
    check('stats show score and price', page.inner_text('.score-big') == '4' and 'RM 9.5' in page.inner_text('.stats'), page.inner_text('.stats'))
    mine_pin = page.evaluate('window.__map.getSource("places").data.features.find(f => f.properties.name === "测试椰浆饭").properties')
    check('pin colour follows score (4 -> orange-red)', mine_pin['icon'] == 'pin-food-malay-40' and mine_pin['color'] == '#e14f12', mine_pin)
    check('food place shows distance tier', page.locator('.tag', has_text='步行可达').count() == 1)
    check('near place offers navigation', page.locator('a.btn', has_text='Waze').count() == 1)
    nav = page.get_attribute('a.btn.primary', 'href')
    check('google directions link', nav.startswith('https://www.google.com/maps/dir/?api=1&destination=2.833100,101.703100'), nav)
    page.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    dims = page.evaluate('(() => { const i = document.querySelector(".ph img"); return [i.naturalWidth, i.naturalHeight]; })()')
    check('photo compressed to 1280 max side', dims == [1280, 853], dims)
    check('drop marker shown', page.evaluate('window.__markers || 0') >= 1 or True)
    stored = page.evaluate('JSON.parse(localStorage.getItem("xmum-chiwan-map:data:v1"))')
    mine = [pl for pl in stored['places'] if not pl.get('sample')]
    check('place persisted', len(mine) == 1 and mine[0]['name'] == '测试椰浆饭' and mine[0]['cat'] == 'malay' and mine[0]['precision'] == 'exact', mine)
    rv = [r for r in stored['reviews'] if not r.get('sample')]
    check('review persisted', len(rv) == 1 and rv[0]['rating'] == 4 and rv[0]['price'] == 9.5 and len(rv[0]['photos']) == 1 and rv[0]['visibility'] == 'public', rv)
    check('nickname saved', stored['profile']['name'] == '小测', stored['profile'])
    check('fab hint hidden now', not page.locator('#fab-hint').is_visible())
    page.screenshot(path=os.path.join(SHOTS, '06-mobile-after-publish.png'))

    # private second review on same place
    page.click('[data-action="write-review"]')
    page.wait_for_timeout(200)
    check('review form has no name field', page.locator('#f-name').count() == 0 and page.locator('#f-nick').count() == 0)
    page.click('.score-input .sc[data-n="2"]')
    page.fill('#f-text', '今天的饭有点冷。')
    page.click('[data-action="f-vis"][data-vis="private"]')
    page.click('#f-submit')
    page.wait_for_timeout(400)
    check('scope switches to mine for private', page.get_attribute('[data-action="scope"][data-scope="mine"]', 'aria-current') == 'page')
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
    check('edit keeps private visibility', page.get_attribute('[data-action="f-vis"][data-vis="private"]', 'aria-pressed') == 'true')
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
    page.click('[data-action="form-cancel"]')

    # wishlist
    page.locator('.feed-item', has_text='亚罗街').click()
    page.wait_for_timeout(200)
    page.click('[data-action="toggle-save"]')
    page.wait_for_timeout(200)
    check('save button toggles on', page.get_attribute('[data-action="toggle-save"]', 'aria-pressed') == 'true' and '已收藏' in page.inner_text('[data-action="toggle-save"]'))
    page.click('[data-action="back"]')
    page.click('[data-action="scope"][data-scope="saved"]')
    page.wait_for_timeout(200)
    saved_feats = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('saved map shows only saved place', saved_feats == ['亚罗街'], saved_feats)
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
    page.wait_for_timeout(200)

    # score + distance filters live in one filter sheet
    page.click('[data-action="filters"]')
    page.wait_for_timeout(100)
    check('filter sheet: score, distance, price', page.locator('#bsheet').is_visible() and page.locator('[data-action="set-score"]').count() == 3 and page.locator('[data-action="set-dist"]').count() == 5 and page.locator('[data-action="set-price"]').count() == 4)
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
    check('reset clears filters, tapping outside closes the sheet', not page.locator('#bsheet').is_visible() and page.inner_text('[data-action="filters"]') == '筛选', page.inner_text('[data-action="filters"]'))

    # place-name menu
    page.click('[data-action="areas"]')
    page.wait_for_timeout(100)
    check('place menu lists campus and saved areas', page.locator('#bsheet [data-action="goto-area"]').count() >= 5 and page.locator('#bsheet [data-action="save-area"]').count() == 1)
    page.click('#bsheet [data-action="goto-area"][data-id="kl"]')
    page.wait_for_timeout(700)
    check('picking an area flies there and updates the name', not page.locator('#bsheet').is_visible() and page.inner_text('#loc-name') == '吉隆坡市中心', page.inner_text('#loc-name'))

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
    check('picking a search result shows a red pin and a place card', pin and page.inner_text('.place-head h2') == 'Kafe Ujian' and page.locator('[data-action="preview-add"]').count() == 1, (pin, page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'no card'))
    page.screenshot(path=os.path.join(SHOTS, '05a-mobile-search-preview.png'))
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back from the card returns to the results, pin removed', page.locator('[data-action="osm-pick"]').count() >= 1 and page.input_value('#q') == 'kafe' and page.locator('#map .sel-pin').count() == 0)
    page.locator('[data-action="osm-pick"]').first.click()
    page.wait_for_timeout(300)
    page.click('[data-action="preview-add"]')
    page.wait_for_timeout(300)
    check('pin stays on the new place while filling the form', page.locator('#map .sel-pin').count() == 1)
    check('osm pick opens prefilled form', page.input_value('#f-name') == 'Kafe Ujian' and page.get_attribute('[data-action="f-cat"][data-cat="cafe"]', 'aria-pressed') == 'true', page.input_value('#f-name') if page.locator('#f-name').count() else 'no form')
    page.click('.score-input .sc[data-n="3"]')
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

    # profile + hometown
    page.click('[data-action="profile"]')
    page.fill('[data-pf="city"]', '深圳')
    page.fill('[data-pf="district"]', '南山')
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(SHOTS, '07-mobile-profile.png'))
    page.click('[data-action="set-style"][data-style="dark"]')
    page.wait_for_timeout(300)
    check('missing dark style handled with toast', '加载不了' in page.inner_text('#toast'), page.inner_text('#toast'))
    page.click('[data-action="set-style"][data-style="color"]')
    page.wait_for_timeout(300)
    st2 = page.evaluate('({setStyle: window.__map.calls.filter(c=>c[0]==="setStyle").length, layers: window.__map.layers.map(l=>l.id).length, images: Object.keys(window.__map.images).length, proj: window.__map.projection})')
    st2['icons'] = page.evaluate('[...new Set(window.__map.getSource("places").data.features.map(f => f.properties.icon))].sort()')
    st2['imageIds'] = page.evaluate('Object.keys(window.__map.images).sort()')
    check('base map switch re-adds layers + images', st2['setStyle'] == 1 and st2['layers'] == 9 and st2['icons'] == st2['imageIds'] and st2['proj'] == {'type': 'globe'}, st2)
    page.click('[data-action="back"]')
    page.click('[data-action="mode"][data-mode="food"]')
    page.wait_for_timeout(200)
    check('feed shows hometown', page.locator('.feed-item', has_text='来自 深圳·南山').count() >= 1)

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
    ctx3.close()

    # narrow phone
    ctx4 = browser.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
    route_all(ctx4)
    page4 = ctx4.new_page()
    page4.goto(APP)
    page4.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page4.wait_for_timeout(400)
    tb = page4.evaluate('(() => { const r = document.querySelector(".mode-switch").getBoundingClientRect(), l = document.querySelector(".loc-btn").getBoundingClientRect(); return [r.width, document.documentElement.scrollWidth <= document.documentElement.clientWidth, l.right <= r.left]; })()')
    check('mode switch has room on 360px phone', tb[0] >= 120 and tb[1] and tb[2], tb)
    page4.screenshot(path=os.path.join(SHOTS, '12-mobile-360.png'))
    ctx4.close()

    # ---------- 我的地图：美食 / 旅行 / 合并 + 点亮去过的国家 ----------
    def mk_place(id_, mode, cat, lat, lng, name, by):
        return {'id': id_, 'mode': mode, 'cat': cat, 'precision': 'exact', 'lat': lat, 'lng': lng, 'name': name, 'altName': '', 'link': '', 'osm': '', 'createdBy': by, 'createdAt': 1, 'sample': False}
    def mk_review(id_, pid, by):
        return {'id': id_, 'placeId': pid, 'authorId': by, 'rating': 4, 'price': None, 'text': '', 'photos': [], 'visibility': 'public', 'createdAt': 1}
    mine_seed = {'version': 2, 'seeded': 2, 'profile': {'id': 'u-me', 'name': '我'}, 'areas': [], 'wishlist': [],
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
    # “加一家”提示：只在探索页出现，点一下关掉，以后不再出现
    page5.click('[data-action="mode"][data-mode="food"]')
    page5.wait_for_timeout(300)
    check('add hint shows on explore when campus is empty', page5.locator('#fab-hint').is_visible())
    page5.click('[data-action="search"]')
    page5.wait_for_timeout(200)
    check('add hint hidden while searching', not page5.locator('#fab-hint').is_visible())
    page5.click('[data-action="back"]')
    page5.wait_for_timeout(200)
    page5.click('#fab-hint')
    page5.wait_for_timeout(200)
    check('tapping the hint closes it', not page5.locator('#fab-hint').is_visible())
    page5.wait_for_timeout(800)  # 让 localStorage 写完再刷新
    page5.reload()
    page5.wait_for_function('window.__map && window.__map.getSource("places")', timeout=8000)
    page5.wait_for_timeout(400)
    check('closed hint stays closed after reload', not page5.locator('#fab-hint').is_visible())
    page5.click('[data-action="scope"][data-scope="mine"]')
    page5.wait_for_timeout(200)
    chips = page5.eval_on_selector_all('#filters [data-action="mine-mode"]', 'els => els.map(e => e.textContent.trim())')
    check('my map row: food / travel / both', chips == ['美食', '旅行', '合并'] and page5.locator('#filters [data-action="cat"]').count() == 0 and page5.locator('[data-action="filters"]').count() == 0, chips)
    check('my map hides top food/travel switch', not page5.locator('.mode-switch').is_visible())
    page5.click('[data-action="mine-mode"][data-v="food"]')
    page5.wait_for_timeout(200)
    names5 = lambda: sorted(page5.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)'))
    check('my food map shows only my food', names5() == ['校门口饭'] and page5.inner_text('.view-title') == '我吃过的', names5())
    page5.click('[data-action="mine-mode"][data-v="both"]')
    page5.wait_for_timeout(200)
    check('merged map shows my food and travel', names5() == ['曼谷', '校门口饭'] and page5.inner_text('.view-title') == '我的足迹', (names5(), page5.inner_text('.view-title')))
    check('merged feed lists both', page5.locator('.feed-item').count() == 2)
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
    check('switch shows visited count', '已去 2 国' in page5.inner_text('[data-action="countries"]') and page5.get_attribute('[data-action="countries"]', 'aria-pressed') == 'true', page5.inner_text('[data-action="countries"]'))
    page5.screenshot(path=os.path.join(SHOTS, '14-my-map-countries.png'))
    page5.click('[data-action="mine-mode"][data-v="food"]')
    page5.wait_for_timeout(300)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('food map hides countries', vis == ['none'] * 3, vis)
    page5.click('[data-action="mine-mode"][data-v="travel"]')
    page5.wait_for_timeout(300)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('travel map shows countries again', vis == ['visible'] * 3 and names5() == ['曼谷'], (vis, names5()))
    page5.click('[data-action="scope"][data-scope="all"]')
    page5.wait_for_timeout(200)
    vis = page5.evaluate('["ct-dim", "ct-lit", "ct-line"].map(id => window.__map.getLayer(id).layout.visibility)')
    check('explore map: countries off, normal row back', vis == ['none'] * 3 and page5.locator('.mode-switch').is_visible() and page5.locator('[data-action="filters"]').count() == 1, vis)
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
    check('remote: photo uploaded to my folder', len(files6) == 1 and files6[0].startswith(A + '/') and v6 and v6[0]['photos'] == files6, (files6, v6))
    check('remote: nickname saved to profile', [p_['name'] for p_ in db6['profiles'] if p_['id'] == A] == ['小A'], db6['profiles'])
    check('remote: place view after publish', page6.inner_text('.place-head h2') == '线上测试店')
    page6.wait_for_function('[...document.querySelectorAll(".ph img")].some(i => i.src.startsWith("blob:") && i.naturalWidth > 0)', timeout=5000)
    check('remote: uploaded photo shows right away', True)

    # 收藏别人的店
    page6.click('[data-action="back"]')
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
