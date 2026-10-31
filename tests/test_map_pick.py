"""Map point/business selection must preserve media and composer drafts."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');scope={'__file__':str(f.resolve())}
exec(f.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],scope)
def shop(pg,name='测试点心店'):
    pg.evaluate('''n=>{window.__qrf=[{layer:{id:'poi_r1'},properties:{name:n,class:'restaurant',subclass:'restaurant'},geometry:{type:'Point',coordinates:[101.8,2.9]}}];window.__map.fire('click',{point:{x:120,y:240},lngLat:{lng:101.8,lat:2.9}});}''',name)
with sync_playwright() as p:
    b=p.chromium.launch(channel=os.environ.get('XUETUAN_TEST_BROWSER_CHANNEL','msedge'),headless=True)
    ctx=b.new_context(viewport={'width':390,'height':740},has_touch=True);scope['route_all'](ctx)
    pg=ctx.new_page();pg.goto(scope['APP']+'?local');pg.wait_for_function('window.__map && window.__map.getSource("places")')
    pg.click('[data-action="new-post"]');pg.set_input_files('#f-file',scope['photo']);pg.wait_for_function('document.querySelectorAll("#f-photos .ph-edit").length===1 && !document.querySelector("#f-submit").disabled')
    pg.fill('#f-title','图片不能丢');pg.fill('#f-text','点评也要保留');scope['rate'](pg,4)
    pg.click('[data-action="post-map"]');shop(pg)
    assert pg.is_visible('#pick') and '测试点心店' in pg.inner_text('#pick-hint')
    pg.click('[data-action="pick-confirm"]')
    assert pg.input_value('#f-name')=='测试点心店' and pg.input_value('#f-title')=='图片不能丢' and pg.input_value('#f-text')=='点评也要保留' and scope['stars_val'](pg)=='4' and pg.locator('#f-photos .ph-edit').count()==1
    print('PASS post map business selection preserves photos, title, rating and review')
    pg.click('[data-action="post-map"]')
    chosen=pg.evaluate('''()=>{const f=window.__map.getSource('places').data.features.find(f=>f.properties.id);window.__qrf=[{...f,layer:{id:'pt-label'}}];window.__map.fire('click',{point:{x:140,y:250}});return f.properties.name;}''')
    assert chosen in pg.inner_text('#pick-hint');pg.click('[data-action="pick-confirm"]')
    assert chosen in pg.inner_text('#place-form') and pg.input_value('#f-title')=='图片不能丢' and pg.locator('#f-photos .ph-edit').count()==1
    print('PASS tapping an existing place label reuses that place and preserves the post')
    pg.click('[data-action="post-map"]');shop(pg);pg.evaluate('window.__map.fire("dragstart",{})')
    assert '已选：' not in pg.inner_text('#pick-hint')
    pg.evaluate('window.__qrf=[];window.__map.center={lng:101.91,lat:3.21};window.__map.fire("click",{point:{x:100,y:200},lngLat:{lng:101.91,lat:3.21}})')
    pg.click('[data-action="pick-confirm"]')
    assert pg.input_value('#f-name')=='' and pg.input_value('#f-title')=='图片不能丢' and pg.locator('#f-photos .ph-edit').count()==1
    print('PASS dragging/empty map clears business selection while keeping the post draft')
    pg.click('[data-action="form-cancel"]');scope['add'](pg);pg.click('[data-action="bulk-start"]');pg.set_input_files('#bulk-file',scope['photo']);pg.wait_for_selector('.bk-card')
    scope['rate'](pg,4,'#bk-rate-0');pg.fill('[data-bk-comment="0"]','批量点评')
    pg.click('[data-action="bulk-map"]');shop(pg,'批量选择餐厅');pg.click('[data-action="pick-confirm"]')
    assert '批量选择餐厅' in pg.inner_text('#bk-0') and pg.locator('.bk-ph').count()==1 and pg.input_value('[data-bk-comment="0"]')=='批量点评' and scope['stars_val'](pg,'#bk-rate-0')=='4'
    pg.screenshot(path=str(Path(scope['SHOTS'])/'31-bulk-map-business.png'))
    print('PASS batch map business selection preserves media and reviews and uses the selected place')
    b.close()
