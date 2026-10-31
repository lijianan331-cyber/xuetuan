"""Run after test_app.py: check cluster expressions with real MapLibre 5.24.0.

Only synthetic fixtures are used. The CDN library is cached in the temp folder.
"""
import json
import os
from pathlib import Path
import urllib.request
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

tmp = Path(os.getenv('TEMP', '/tmp'))
fixture = json.loads((tmp / 'xuetuan-real-cluster-spec.json').read_text(encoding='utf-8'))
js = tmp / 'xuetuan-maplibre-5.24.0.js'
if not js.exists():
    js.write_bytes(urllib.request.urlopen('https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js', timeout=30).read())
source = fixture['source']
source['data'] = {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [101.7 + dx, 2.8]},
     'properties': {'id': str(i), 'photoRef': '["synthetic-cover",4,false]', 'photoCount': i + 1, 'locationCount': 1}}
    for i, dx in enumerate([0, 0.000001])
]}

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.getenv('XUETUAN_TEST_BROWSER_CHANNEL', 'msedge'), headless=True)
    page = browser.new_page(viewport={'width': 390, 'height': 700})
    page.set_content('<div id="map" style="width:390px;height:600px"></div>')
    page.add_script_tag(content=js.read_text(encoding='utf-8'))
    page.evaluate('''({source,layers}) => {
      window.mapErrors=[];
      window.realFixture=structuredClone(source.data);
      const m=window.realMap=new maplibregl.Map({container:'map',style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#edf3f7'}}]},center:[101.7,2.8],zoom:10,fadeDuration:0,attributionControl:false});
      m.on('error',e=>mapErrors.push(e.error.message));
      m.on('styleimagemissing',e=>{
        if(!e.id.startsWith('cg:'))return;
        const c=document.createElement('canvas');c.width=68;c.height=78;
        const g=c.getContext('2d');g.fillStyle='#82bddd';g.fillRect(0,0,68,68);
        m.addImage(e.id,g.getImageData(0,0,68,78));
      });
      m.on('load',()=>{m.addSource('places',source);layers.forEach(l=>m.addLayer(l));});
    }''', {'source': source, 'layers': fixture['layers']})
    page.wait_for_function('realMap.getSource("places") && realMap.isSourceLoaded("places")')
    page.wait_for_timeout(400)
    assert page.evaluate('realMap.queryRenderedFeatures({layers:["cl-circle"]}).some(f=>f.properties.point_count===2)')
    assert not page.evaluate('realMap.queryRenderedFeatures({layers:["cl-photo"]}).length')
    print('PASS real MapLibre: city zoom keeps the light-blue number cluster')
    page.evaluate('realMap.jumpTo({zoom:16})')
    page.wait_for_function('realMap.queryRenderedFeatures({layers:["cl-photo"]}).some(f=>f.properties.point_count===2 && f.properties.photoTotal===3 && f.properties.photoRef.includes("synthetic-cover"))')
    print('PASS real MapLibre: nearly coincident points show a street-level photo cover and total')
    page.evaluate('realMap.getSource("places").setData({...realFixture,features:realFixture.features.map(f=>({...f,geometry:{type:"Point",coordinates:[101.7,2.8]}}))})')
    page.wait_for_timeout(300)
    assert page.evaluate('realMap.queryRenderedFeatures({layers:["cl-photo"]}).some(f=>f.properties.point_count===2 && f.properties.photoTotal===3)')
    print('PASS real MapLibre: exactly coincident coordinates also render a photo cluster')
    page.evaluate('realMap.getSource("places").setClusterOptions({cluster:true,clusterMaxZoom:18,clusterRadius:80})')
    page.wait_for_timeout(300)
    assert page.evaluate('realMap.queryRenderedFeatures({layers:["cl-photo"]}).some(f=>f.properties.photoTotal===3)')
    page.evaluate('''realMap.getSource('places').setData({type:'FeatureCollection',features:[{...realFixture.features[0],properties:{...realFixture.features[0].properties,id:'one-position',memberIds:'["a","b"]',point_count:2,point_count_abbreviated:'2',photoCount:3,photoTotal:3,locationCount:2}}]})''')
    page.wait_for_function('realMap.queryRenderedFeatures({layers:["cl-photo"]}).some(f=>f.properties.memberIds && f.properties.point_count===2 && !f.properties.cluster)')
    print('PASS real MapLibre: pre-grouped identical positions keep their count and clickable members')
    assert not page.evaluate('mapErrors'), page.evaluate('mapErrors')
    print('PASS real MapLibre: cluster property reductions survive options updates with no style errors')
    page.screenshot(path=str(Path(__file__).parent / 'shots' / '20-real-map-cluster.png'))
    page.close()

    # Render production photo sprites, not rectangular placeholders. A real cluster
    # and a singleton share one mobile viewport; measure their actual colored border.
    html = (Path(__file__).parents[1] / 'index.html').read_text(encoding='utf-8')
    draw = html[html.index('  function drawPhotoPin('):html.index('  function loadImage(')]
    for dpr in [1, 2]:
        ctx = browser.new_context(viewport={'width':390,'height':700},device_scale_factor=dpr)
        pg = ctx.new_page()
        pg.set_content('<style>body{margin:0}#map{width:390px;height:600px}</style><div id="map"></div>')
        pg.add_script_tag(content=js.read_text(encoding='utf-8'))
        pg.add_script_tag(content='var DPR=devicePixelRatio,PIN_PHOTO=56;\n'+draw)
        pg.evaluate('''({source,layers})=>{
          window.errors=[];
          const thumb=document.createElement('canvas');thumb.width=thumb.height=80;
          const tg=thumb.getContext('2d');tg.fillStyle='#3f898d';tg.fillRect(0,0,80,80);
          tg.fillStyle='#abd7d4';tg.fillRect(0,42,80,38);
          const m=window.m=new maplibregl.Map({container:'map',style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#edf3f7'}}]},center:[101.7,2.8],zoom:11,fadeDuration:0,attributionControl:false,preserveDrawingBuffer:true});
          m.on('error',e=>errors.push(e.error.message));
          m.on('styleimagemissing',e=>{m.addImage(e.id,drawPhotoPin(thumb,'#e14f12',false,e.id.startsWith('cg:')?3:1),{pixelRatio:DPR});});
          window.positionAt=(z,grouped=false)=>{
            const dx=126*360/(512*2**z),props={photoRef:'["synthetic-cover",4,false]',photoCount:1,photoTotal:1,locationCount:1,photo:true,pic:'synthetic-single',id:'single'};
            const f=(lng,p)=>({type:'Feature',geometry:{type:'Point',coordinates:[lng,2.8]},properties:p});
            const a=grouped?[f(101.7-dx,{...props,id:'group',point_count:2,memberIds:'["a","b"]',photoCount:3,photoTotal:3,locationCount:2})]:[f(101.7-dx,{...props,id:'a'}),f(101.7-dx+1e-8,{...props,id:'b',photoCount:2})];
            m.jumpTo({zoom:z});m.getSource('places').setData({type:'FeatureCollection',features:[...a,f(101.7+dx,props)]});
          };
          m.on('load',()=>{m.addSource('places',{...source,data:{type:'FeatureCollection',features:[]}});layers.forEach(l=>m.addLayer(l));positionAt(11);});
        }''', {'source':source,'layers':fixture['layers']})
        pg.wait_for_function('m.getSource("places") && m.isSourceLoaded("places")')
        widths = []
        for zoom in [11.99,12,12.25,12.5,13,14,16,18,19,16,13,12,11.99]:
            pg.evaluate('z=>positionAt(z,z>18)',zoom)
            pg.wait_for_function('m.isSourceLoaded("places")')
            pg.wait_for_timeout(280)
            png = pg.screenshot()
            im = Image.open(BytesIO(png)).convert('RGB')
            halves = [[],[]]
            for yy in range(im.height):
                for xx in range(im.width):
                    r,g,b = im.getpixel((xx,yy))
                    if r>175 and 45<g<120 and b<55:
                        halves[int(xx>=im.width/2)].append(xx)
            if zoom<12:
                if halves[0] or halves[1]:
                    (tmp/'xue-real-size-fail.png').write_bytes(png)
                assert not halves[0] and not halves[1], (dpr,zoom,pg.evaluate('({zoom:m.getZoom(),layers:m.queryRenderedFeatures().map(f=>f.layer.id)})'),'photo appeared too early')
                continue
            assert all(halves), (dpr,zoom,'cluster or singleton missing')
            pair = [(max(xs)-min(xs)+1)/dpr for xs in halves]
            assert all(51<=width<=55 for width in pair) and abs(pair[0]-pair[1])<=1.5,(dpr,zoom,pair)
            widths.extend(pair)
            if dpr==2 and zoom in [12.25,14,19]:
                (Path(__file__).parent/'shots'/f'21-uniform-photo-z{zoom}.png').write_bytes(png)
        assert max(widths)-min(widths)<=2,(dpr,widths)
        assert not pg.evaluate('errors'),pg.evaluate('errors')
        print(f'PASS real MapLibre DPR {dpr}: singleton and cluster appear together at z12, remain 51–55 CSS px through continuous zoom and same-coordinate z19')
        ctx.close()
    browser.close()
