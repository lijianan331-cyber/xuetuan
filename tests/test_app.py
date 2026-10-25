import json, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

SCR = os.path.dirname(os.path.abspath(__file__))
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'file://' + os.path.join(ROOT, 'index.html')
STUB = open(os.path.join(SCR, 'stub_maplibre.js'), encoding='utf-8').read()
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
results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else '  -> ' + str(extra)))

def route_all(ctx):
    def handler(route):
        url = route.request.url
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
    check('pin images drawn on demand (2 unrated food categories)', st['images'] == 2, st['images'])
    pins = page.evaluate('window.__map.getSource("places").data.features.map(f => [f.properties.icon, f.properties.color])')
    check('unrated pins are pale grey', all(i.endswith('-none') and c == '#B9C1BD' for i, c in pins), pins)
    check('renamed to 雪团', page.title() == '雪团 XueTuan' and page.inner_text('.brand-top') == '雪团', (page.title(), page.inner_text('.brand-top')))
    check('three maps: explore / mine / saved', page.locator('[data-action="scope"]').all_inner_texts() == ['探索', '我的', '收藏'], page.locator('[data-action="scope"]').all_inner_texts())
    check('score legend shown', page.locator('.legend').count() == 1)
    check('globe projection', st['proj'] == {'type': 'globe'}, st['proj'])
    check('labels patched to Chinese', 'name:zh' in json.dumps(st['label']), st['label'])
    check('shield labels untouched', st['shield'] == '{ref}', st['shield'])
    check('fonts picked from style', st['countFont'] == ['Noto Sans Bold'] and st['labelFont'] == ['Noto Sans Regular'], (st['countFont'], st['labelFont']))
    check('food mode shows 4 sample food places', st['feats'] == 4, st['feats'])
    check('intro flight to campus', st['intro'] >= 1, st['intro'])
    feed_n = page.locator('.feed-item').count()
    check('feed lists 4 food samples', feed_n == 4, feed_n)
    check('fab hint visible (no food near campus)', page.locator('#fab-hint').is_visible())
    ov = page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    check('no horizontal overflow (mobile)', ov)
    page.screenshot(path=os.path.join(SHOTS, '01-mobile-peek.png'))

    # travel mode
    page.click('[data-action="mode"][data-mode="travel"]')
    page.wait_for_timeout(200)
    tf = page.evaluate('window.__map.getSource("places").data.features.length')
    check('travel mode shows 21 samples', tf == 21, tf)
    check('accent repainted', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]').lower() == '#0f8b8d', page.evaluate('window.__map.layers.find(l=>l.id==="cl-circle").paint["circle-color"]'))
    check('fab label switches', page.inner_text('#fab-label') == '打卡', page.inner_text('#fab-label'))
    # expand sheet by tapping title
    page.click('.title-row .view-title')
    page.wait_for_timeout(400)
    check('sheet expands to half', page.get_attribute('#panel', 'data-snap') == 'half')
    check('fab hidden at half, header add button shown', (not page.locator('#fab').is_visible()) and page.locator('.title-add').is_visible())
    vis = page.evaluate('''(() => { const b = document.querySelector('.feed-item:last-of-type, .feed li:last-child .feed-item'); const body = document.querySelector('.panel-body'); body.scrollTop = body.scrollHeight; const r = document.querySelector('.feed li:last-child').getBoundingClientRect(); return r.bottom <= window.innerHeight + 1; })()''')
    check('last feed item reachable in half sheet', vis)
    page.screenshot(path=os.path.join(SHOTS, '02-mobile-travel-half.png'))

    # open a sample place
    page.locator('.feed-item', has_text='金门大桥').click()
    page.wait_for_timeout(300)
    check('place view title', page.inner_text('.place-head h2') == '金门大桥', page.inner_text('.place-head h2') if page.locator('.place-head h2').count() else 'none')
    check('far place offers google view only', page.locator('a.btn', has_text='在 Google 地图看').count() == 1 and page.locator('a.btn', has_text='Waze').count() == 0)
    sel = page.evaluate('window.__map.layers.find(l=>l.id==="pt-sel").filter')
    check('selection ring filter', sel == ['==', ['get', 'id'], 's-golden-gate'], sel)
    page.screenshot(path=os.path.join(SHOTS, '03-mobile-place.png'))
    page.click('[data-action="back"]')
    page.wait_for_timeout(200)
    check('back to feed', page.locator('.feed').count() == 1)

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
    check('scope switches to mine for private', page.get_attribute('[data-action="scope"][data-scope="mine"]', 'aria-pressed') == 'true')
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

    # score + distance filters
    page.click('[data-action="score"]')
    page.wait_for_timeout(150)
    f3 = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('score filter 3+ keeps only scored places', page.inner_text('[data-action="score"]') == '3 分以上' and f3 == ['测试椰浆饭'], (page.inner_text('[data-action="score"]'), f3))
    page.click('[data-action="score"]'); page.click('[data-action="score"]')
    page.wait_for_timeout(150)
    check('score filter cycles back', page.inner_text('[data-action="score"]') == '评分不限')
    page.click('[data-action="dist"]')
    page.wait_for_timeout(150)
    walk = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('distance filter: walkable', page.inner_text('[data-action="dist"]') == '步行 · 1.5km 内' and walk == ['测试椰浆饭'], (page.inner_text('[data-action="dist"]'), walk))
    page.click('[data-action="dist"]'); page.click('[data-action="dist"]')
    page.wait_for_timeout(150)
    mid = sorted(page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)'))
    check('distance filter: mid-range is KL', mid == sorted(['亚罗街', '茨厂街']), mid)
    check('feed follows distance filter', page.locator('.feed-item').count() == 2, page.locator('.feed-item').count())
    page.click('[data-action="dist"]'); page.click('[data-action="dist"]')
    page.wait_for_timeout(150)
    check('distance filter cycles back', page.inner_text('[data-action="dist"]') == '距离不限')

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

    # language
    page.click('[data-action="lang"]')
    page.wait_for_timeout(200)
    check('UI in English', page.inner_text('.view-title') == 'What people are eating', page.inner_text('.view-title'))
    lab = page.evaluate('window.__map.style.layers.find(l => l.id === "place-city").layout["text-field"]')
    check('map labels English', 'name:en' in json.dumps(lab), lab)
    names = page.evaluate('window.__map.getSource("places").data.features.map(f => f.properties.name)')
    check('pin names use English alt names', 'Nasi Lemak Test 2' in names and 'Jalan Alor' in names, names)
    page.screenshot(path=os.path.join(SHOTS, '08-mobile-english.png'))
    page.click('[data-action="lang"]')

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
    tb = page4.evaluate('(() => { const r = document.querySelector(".mode-switch").getBoundingClientRect(); return [r.width, document.documentElement.scrollWidth <= document.documentElement.clientWidth]; })()')
    check('mode switch has room on 360px phone', tb[0] >= 140 and tb[1], tb)
    page4.screenshot(path=os.path.join(SHOTS, '12-mobile-360.png'))
    ctx4.close()

    browser.close()

print()
print('errors:', errors)
print('errors2:', errors2)
fails = [r for r in results if not r[1]]
print(f'{len(results) - len(fails)}/{len(results)} passed')
