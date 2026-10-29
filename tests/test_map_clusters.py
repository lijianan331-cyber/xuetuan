"""Run after test_app.py: check cluster expressions with real MapLibre 5.24.0.

Only synthetic fixtures are used. The CDN library is cached in the temp folder.
"""
import json
import os
from pathlib import Path
import urllib.request
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
    browser.close()
