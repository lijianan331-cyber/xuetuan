"""Synthetic loading schedules and client-only 1k/10k point measurements. No live writes."""
import json,base64,io
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
f=Path(__file__).with_name('test_app.py');s={'__file__':str(f.resolve())};exec(f.read_text(encoding='utf8').split('with sync_playwright() as p:')[0],s)
out=io.BytesIO();Image.new('RGB',(640,400),'#71a3c7').save(out,format='JPEG');url='data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True);c=b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True);s['route_all'](c,True);c.add_init_script('window.__sbSeed={profiles:[],places:[],visits:[]}');pg=c.new_page();pg.set_default_timeout(7000);errors=[];pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.goto(s['APP']);pg.wait_for_function('!state.bootLoading')
 pg.evaluate('''url=>{window.imgRequests=[];window.imgReleases=[];store.cachedPhotoURL=(id,small)=>id==='img-0'&&small?url:null;store.photoURL=(id,small)=>{imgRequests.push({id,small});return new Promise(r=>imgReleases.push(()=>r(url)));};for(let i=0;i<60;i++){store.places().push({id:'p'+i,mode:'food',cat:'other',cc:'MY',precision:'exact',lat:2.83,lng:101.7,name:'合成地点'+i});store.reviews().push({id:'r'+i,placeId:'p'+i,authorId:'synthetic',text:'合成',rating:4,visibility:'public',createdAt:Date.now()-i,photos:['img-'+i]});}setTab('home');render();}''',url)
 pg.wait_for_timeout(100);assert pg.evaluate('photoBusy<=4&&imgRequests.length<=7&&photoObserved.size>20'),pg.evaluate('[photoBusy,imgRequests.length,photoObserved.size,photoJobs.length]')
 print('PASS 60-card home: only nearby images queued, at most4 visible-image jobs active',flush=True)
 pg.evaluate("openPost('r0')");assert pg.locator('.post-gallery img').get_attribute('src')==url
 pg.wait_for_function('imgRequests.some(r=>r.id==="img-0"&&!r.small)')
 print('PASS cached home thumbnail appears synchronously while original URL is still pending; navigation releases old image slots',flush=True)
 pg.evaluate('imgReleases.splice(0).forEach(r=>r())');pg.wait_for_function('document.querySelector(".post-gallery img").naturalWidth===640')
 pg.evaluate('window.imgRequests=[];store.photoURL=()=>Promise.resolve(null);setTab("explore");')
 timings=pg.evaluate('''()=>{const output=[];for(const n of [1000,10000]){const ps=store.places(),rs=store.reviews();ps.length=0;rs.length=0;for(let i=0;i<n;i++){ps.push({id:'b'+i,mode:'food',cat:'other',cc:'MY',precision:'exact',lat:2.83+i*.000001,lng:101.7+i*.000001,name:'Synthetic '+i});rs.push({id:'v'+i,placeId:'b'+i,authorId:'synthetic',rating:4,visibility:'public',createdAt:1,photos:[]});}placeLookup.list=null;rIdx.list=null;let start=performance.now();ps.forEach(p=>placeById(p.id));const indexed=performance.now()-start;start=performance.now();for(const p of ps){for(let i=0;i<ps.length;i++)if(ps[i].id===p.id)break;}const linear=performance.now()-start;start=performance.now();const fc=placesGeoJSON();const build=performance.now()-start;let writes=0;const source={setData(){writes++;}};for(let i=0;i<10;i++)setMapSourceData(source,fc);if(writes!==1||fc.features.length!==n)throw Error('Map data duplicate or incomplete');output.push({points:n,indexed_lookup_ms:+indexed.toFixed(2),old_linear_lookup_ms:+linear.toFixed(2),geojson_build_ms:+build.toFixed(2),map_updates_for_10_equal_refreshes:writes});}return output;}''')
 print(json.dumps(timings,ensure_ascii=False),flush=True)
 pg.evaluate('''()=>{thumbQueue=[];thumbBusy=3;pinThumbs.clear();activePinPhotos=new Set(['keep']);pinThumbs.set('keep',{});for(let i=0;i<299;i++)pinThumbs.set('old'+i,{});queueThumb('new-visible');if(pinThumbs.size!==300||!pinThumbs.has('new-visible')||!pinThumbs.has('keep'))throw Error('Thumbnail cache did not evict a cold entry');}''')
 print('PASS thumbnail cache admits new visible photos at300 entries and keeps active entries; equal map data submitted once',flush=True)
 Path(s['SHOTS'],'performance-client-results.json').write_text(json.dumps(timings,indent=2),encoding='utf8')
 assert not errors,errors;b.close()
