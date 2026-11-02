"""Launch film lifecycle and mobile frames, using isolated synthetic app data."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

f = Path(__file__).with_name('test_app.py')
scope = {'__file__': str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], scope)
APP = scope['APP']

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL', 'msedge'), headless=True)
    ctx = browser.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
    scope['route_all'](ctx, True)
    ctx.add_init_script('Object.defineProperty(navigator, "webdriver", { get: () => false })')
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(APP)
    pg.wait_for_selector('#launch-film.running')
    pg.wait_for_function('window.__map && document.querySelector("#view").childElementCount > 0')
    assert pg.locator('#app').evaluate('(el) => el.inert')
    assert pg.inner_text('#launch-title') == 'xmumer的图鉴'
    assert pg.locator('.launch-scene img').evaluate_all('(xs) => xs.every(x => x.naturalWidth === 1024)')
    assert pg.locator('#launch-snowfall').evaluate('(el) => el.width <= innerWidth * 1.5 + 1')
    pg.wait_for_timeout(450)
    pg.screenshot(path=str(Path(scope['SHOTS']) / '32-launch-approach.png'))
    pg.wait_for_timeout(1550)
    pg.screenshot(path=str(Path(scope['SHOTS']) / '33-launch-snowfall.png'))
    pg.wait_for_timeout(1100)
    pg.screenshot(path=str(Path(scope['SHOTS']) / '34-launch-settled.png'))
    pg.wait_for_selector('#launch-film', state='detached', timeout=3000)
    assert not pg.locator('#app').evaluate('(el) => el.inert')
    scope['tab'](pg, 'foot')
    assert not errors, errors
    print('PASS mobile film runs over parallel app boot, reveals snowy campus and releases usable app')

    pg.reload()
    pg.wait_for_function('window.__map')
    assert pg.locator('#launch-film').count() == 0
    assert pg.locator('[data-launch-src]').evaluate_all('(xs) => xs.every(x => !x.hasAttribute("src"))')
    print('PASS reload in the same tab does not replay or request scene assets')

    pg.goto(APP + '?intro=1')
    pg.wait_for_selector('#launch-film.running')
    pg.click('#launch-skip')
    pg.wait_for_selector('#launch-film', state='detached')
    assert not pg.locator('#app').evaluate('(el) => el.inert')
    scope['tab'](pg, 'me')
    print('PASS explicit preview can be skipped immediately and navigation works')

    pg.goto(APP + '?intro=1')
    pg.wait_for_selector('#launch-film.running')
    pg.keyboard.press('Tab')
    assert pg.locator('#launch-skip').evaluate('(el) => el === document.activeElement')
    pg.keyboard.press('Escape')
    pg.wait_for_selector('#launch-film', state='detached')
    assert not pg.locator('#app').evaluate('(el) => el.inert')
    print('PASS keyboard focus stays on skip; Escape closes without changing application route')
    ctx.close()

    reduced = browser.new_context(viewport={'width': 370, 'height': 740}, reduced_motion='reduce')
    scope['route_all'](reduced, True)
    rp = reduced.new_page(); rp.goto(APP + '?splash')
    rp.wait_for_selector('#launch-film.running')
    assert rp.locator('.launch-copy').evaluate('(el) => getComputedStyle(el).opacity') == '1'
    rp.wait_for_selector('#launch-film', state='detached', timeout=2200)
    assert not rp.locator('#app').evaluate('(el) => el.inert')
    print('PASS reduced motion shows a short static snowy campus without impact or snowfall')
    reduced.close()

    broken = browser.new_context(viewport={'width': 390, 'height': 780})
    scope['route_all'](broken, True)
    broken.route('**/assets/launch-*.webp', lambda route: route.abort())
    # Leave the external SDK request pending; the film must still release the app.
    pending = []
    broken.route('**/maplibre-gl.js', lambda route: pending.append(route))
    bp = broken.new_page(); bp.goto(APP + '?splash', wait_until='commit')
    bp.wait_for_selector('#launch-film', state='visible')
    bp.wait_for_selector('#launch-film', state='detached', timeout=6200)
    assert not bp.locator('#app').evaluate('(el) => el.inert')
    print('PASS failed scene images and stalled external SDK do not trap the launch screen')
    for route in pending:
        route.fulfill(status=200, body=scope['STUB'], headers={'Content-Type': 'application/javascript'})
    bp.wait_for_function('window.__map')
    broken.close()

    desktop = browser.new_context(viewport={'width': 1440, 'height': 900})
    scope['route_all'](desktop, True)
    dp = desktop.new_page(); dp.goto(APP + '?splash'); dp.wait_for_selector('#launch-film.running')
    dp.wait_for_timeout(3000)
    dp.screenshot(path=str(Path(scope['SHOTS']) / '35-launch-desktop.png'))
    assert dp.locator('.launch-copy').evaluate('(el) => el.getBoundingClientRect().width < innerWidth')
    dp.evaluate('document.dispatchEvent(new Event("visibilitychange"))')
    # An actual pagehide must dispose immediately (also covers browser back/forward caching).
    dp.evaluate('window.dispatchEvent(new Event("pagehide"))')
    assert dp.locator('#launch-film').count() == 0
    assert not dp.locator('#app').evaluate('(el) => el.inert')
    print('PASS desktop framing and pagehide cleanup release the canvas and app immediately')
    desktop.close()

    auth = browser.new_context()
    scope['route_all'](auth, True)
    ap = auth.new_page(); ap.goto(APP + '?code=synthetic-auth-callback')
    assert ap.locator('#launch-film').count() == 0
    print('PASS auth callback bypasses film')
    auth.close()
    assert not errors, errors
    browser.close()
