"""Real synthetic videos: 8s/26MB original imports, duration/size rejection, and batch parity."""
import os, shutil, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

f = Path(__file__).with_name('test_app.py')
scope = {'__file__': str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0], scope)

with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
    ffmpeg = shutil.which('ffmpeg')
    assert ffmpeg, 'ffmpeg is required to generate synthetic videos'
    short, long = Path(tmp, 'eight.mp4'), Path(tmp, 'eleven.mp4')
    for path, duration in [(short, 8), (long, 11)]:
        subprocess.run([ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=15',
                        '-t', str(duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(path)], check=True)
    large = Path(tmp, 'eight-26mb.mp4')
    large.write_bytes(short.read_bytes())
    with large.open('r+b') as out:
        out.truncate(26 * 1024 * 1024)
    b = p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL', 'msedge'), headless=True)
    c = b.new_context(viewport={'width':390,'height':780})
    scope['route_all'](c)
    pg = c.new_page()
    pg.goto(scope['APP'] + '?local')
    pg.wait_for_function('window.__map && window.__map.getSource("places")')
    pg.evaluate("window.__transcodes=0; const original=reencodeClip; reencodeClip=function(v){window.__transcodes++; return original(v);}; 0")
    pg.click('[data-action="new-post"]')
    pg.set_input_files('#f-file', str(large))
    pg.wait_for_function('state.form && !state.form.mediaBusy && state.form.photos.length===1', timeout=45000)
    assert pg.evaluate('state.form.photos[0].blob.size === 26*1024*1024 && window.__transcodes===0')
    print('PASS real 8s/26MB video imports into composer and retains the original 26MB file without transcoding')
    pg.set_input_files('#f-file', str(long))
    pg.wait_for_function('state.form && !state.form.mediaBusy')
    assert pg.evaluate('state.form.photos.length') == 1
    assert '10' in pg.inner_text('#toast')
    assert pg.evaluate('''async()=>{try {await prepareMedia(new File([new Uint8Array(31*1024*1024)], 'large.mp4', {type:'video/mp4'}));return false;}catch(e){return e.message==='clipBig';}}''')
    assert pg.evaluate('''async()=>{try {await prepareMedia(new File(['GIF89a',new Uint8Array(6*1024*1024)], 'big.gif', {type:'image/gif'}));return false;}catch(e){return e.message==='gifTooBig';}}''')
    print('PASS over-10s and over-30MB videos reject; GIF limit remains 5MB')
    pg.click('[data-action="form-cancel"]')
    pg.evaluate('clearFormDraft()')
    scope['add'](pg)
    pg.set_input_files('#bulk-file', str(large))
    pg.wait_for_selector('.bk-card', timeout=45000)
    assert pg.locator('.bk-ph').count() == 1
    assert pg.evaluate('state.bulk.rejected.length') == 0
    assert pg.evaluate('state.bulk.groups[0].photos[0].prepared.blob.size === 26*1024*1024 && window.__transcodes===0')
    print('PASS batch imports the same real 8s/26MB video')
    b.close()
