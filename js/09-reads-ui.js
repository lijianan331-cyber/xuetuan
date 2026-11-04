/* Keep existing local/legacy flows; activate lazy reads only after API version 2. */
'use strict';
(function () {
  var navEpoch = 0, uiBusy = new Map(), ownPaint = new Map(), ownFailed = new Set(), mapTimer, updateTimer, homeRequestKey = '';
  function reader() { return store.pagedReads && store.pagedReads() ? store.reader() : null; }
  function wait(key, task, done) {
    var actor = me().id, seq = ++navEpoch;key=String(actor)+':'+key;
    toast(state.lang === 'en' ? 'Loading…' : '加载中…');
    if (!uiBusy.has(key)) uiBusy.set(key, Promise.resolve().then(task).then(function (v) { uiBusy.delete(key); return v; }, function (e) { uiBusy.delete(key); throw e; }));
    uiBusy.get(key).then(function () { if (actor === me().id && seq === navEpoch) done(); }, function () { if (actor === me().id && seq === navEpoch) toast(t('loadFail')); });
  }
  var oldSetTab = setTab;
  setTab = function (tab) {
    var r = reader();
    if (r && (tab === 'foot' || tab === 'me') && !r.ownReady() && navigator.onLine !== false) { wait('own',r.ensureOwn,function(){oldSetTab(tab);}); return; }
    navEpoch++; oldSetTab(tab);
  };
  var oldFeed=renderFeed;
  renderFeed=function(){
    var r=reader(),id=me().id;
    if(r&&(state.tab==='foot'||state.tab==='me')&&!r.ownReady()&&navigator.onLine!==false){
      view.innerHTML='<div class="empty"><p>'+esc(ownFailed.has(id)?t('loadFail'):state.lang==='en'?'Loading your footprints…':'正在加载你的足迹…')+'</p>'+(ownFailed.has(id)?'<button class="btn ghost" type="button" data-action="read-own-retry">'+esc(state.lang==='en'?'Retry':'重试')+'</button>':'')+'</div>';
      if(!ownPaint.has(id)&&!ownFailed.has(id)){var pending=r.ensureOwn().then(function(){ownPaint.delete(id);if(id===me().id&&(state.tab==='foot'||state.tab==='me')){refreshMap();render();}},function(){ownPaint.delete(id);ownFailed.add(id);if(id===me().id&&(state.tab==='foot'||state.tab==='me'))render();});ownPaint.set(id,pending);}
      return;
    }
    oldFeed();
  };
  var oldFavorites = openFavorites;
  openFavorites = function () { var r=reader(); if(r&&!r.ownReady()&&navigator.onLine!==false){wait('own',r.ensureOwn,oldFavorites);return;} oldFavorites(); };
  var oldShare = openMyShare;
  openMyShare = function () { var r=reader(); if(r&&!r.ownReady()&&navigator.onLine!==false){wait('own',r.ensureOwn,oldShare);return;} oldShare(); };
  var oldPerson = openPerson;
  openPerson = function (id) { var r=reader();if(!r||navigator.onLine===false){oldPerson(id);return;}wait('person:'+id,function(){return r.ensurePerson(id);},function(){oldPerson(id);}); };
  var oldPlace = openPlace;
  openPlace = function (id, opts) {
    var r=reader();if(r&&!r.placeInfo(id)&&navigator.onLine!==false){wait('place:'+id,function(){return r.ensurePlace(id);},function(){openPlace(id,opts);});return;} var p=placeById(id),s=p&&p._overview&&p._overview.all;if(r&&s&&!s.count&&s.own&&!r.ownReady()&&navigator.onLine!==false){wait('own',r.ensureOwn,function(){oldPlace(id,opts);});return;}oldPlace(id,opts);
  };
  var oldPostPlace = openPostPlace;
  openPostPlace = function (id) {var r=reader();if(r&&!r.placeInfo(id)&&navigator.onLine!==false){wait('place:'+id,function(){return r.ensurePlace(id);},function(){oldPostPlace(id);});return;}oldPostPlace(id);};
  var oldPost = openPost;
  openPost = function (id) { var r=reader();if(r&&navigator.onLine!==false){wait('post:'+id,function(){return r.ensurePost(id);},function(){oldPost(id);});return;}oldPost(id); };
  var oldEligible=homeEligible,oldHomeReviews=homeReviews;
  homeEligible=function(){var r=reader();return r?r.feedItems().filter(function(v){return v.visibility==='public'&&v.photos.length&&placeById(v.placeId);}):oldEligible();};
  homeReviews=function(){if(!reader())return oldHomeReviews();var cutoff=state.homeDays?Date.now()-state.homeDays*86400000:0;return homeEligible().filter(function(r){return (state.homeMode==='all'||placeById(r.placeId).mode===state.homeMode)&&(!cutoff||homeTime(r)>=cutoff)&&(!state.homeMin||r.rating>=state.homeMin);}).sort(function(a,b){return (state.homeSort==='rating'?(b.rating==null?-1:b.rating)-(a.rating==null?-1:a.rating):0)||homeTime(b)-homeTime(a)||b.id.localeCompare(a.id);});};
  var oldHome=renderHome;
  renderHome=function(){
    oldHome();var r=reader();if(!r)return;
    var key=JSON.stringify({mode:state.homeMode,days:state.homeDays,min:state.homeMin,sort:state.homeSort,limit:20});
    if(r.feedInfo().key!==key&&homeRequestKey!==key){homeRequestKey=key;r.readFeed(false,homeVisible,true).then(function(){homeRequestKey='';if(homeVisible())render();},function(){homeRequestKey='';toast(t('loadFail'));});}
    if(!homeReviews().length&&r.feedInfo().any&&state.homeDays&&!view.querySelector('[data-action="home-all-time"]')){var empty=view.querySelector('.home-empty');if(empty){var message=empty.querySelector('p');if(message)message.textContent=state.lang==='en'?'No recent shares match. You can view older posts.':'近期没有符合条件的分享，可以查看更早的记录。';var older=document.createElement('button');older.type='button';older.className='link-btn';older.dataset.action='home-all-time';older.textContent=state.lang==='en'?'See older shares':'看更早的分享';empty.appendChild(older);}}
    if(r.feedInfo().more){var box=document.createElement('div');box.className='read-more';box.innerHTML='<button type="button" class="btn ghost" data-action="read-feed-more">'+esc(state.lang==='en'?'Load more':'加载更多')+'</button>';view.appendChild(box);}
  };
  var oldRenderPlace=renderPlace;
  renderPlace=function(){oldRenderPlace();var r=reader(),info=r&&r.placeInfo(state.placeId);if(info&&info.more){var box=document.createElement('div');box.className='read-more';box.innerHTML='<button type="button" class="btn ghost" data-action="read-place-more">'+esc(state.lang==='en'?'More reviews and photos':'更多点评和照片')+'</button>';view.appendChild(box);}};
  var oldPlaces=placesInView;
  placesInView=function(){var r=reader();if(!r||(state.scope!=='all'&&state.scope!=='saved'))return oldPlaces();if(hometownMode())return [];return r.mapPlaces().filter(function(p){return inScope(p)&&passesFilters(p);});};
  var oldGeoJSON=placesGeoJSON;
  placesGeoJSON=function(){var fc=oldGeoJSON(),rs=state.scope==='all'&&store.mapGroups?store.mapGroups():[];if(hometownMode()||filtersActive())return fc;rs.forEach(function(g){fc.features.push({type:'Feature',geometry:{type:'Point',coordinates:[g.lng,g.lat]},properties:{serverGroup:true,bounds:JSON.stringify(g.bounds),zoom:g.zoom,point_count:g.count,point_count_abbreviated:String(g.count),locationCount:g.count,photoCount:0,photoTotal:0,photoRef:'',photo:false}});});return fc;};
  var oldMap=refreshMap;
  refreshMap=function(){oldMap();clearTimeout(mapTimer);var r=reader();if(r)mapTimer=setTimeout(function(){r.readMap(false).catch(function(){});},250);};
  var oldCount=publicHomeCount;
  publicHomeCount=function(){var r=reader();return r&&r.homeCount()!=null?r.homeCount():oldCount();};
  var oldSearch=renderSearchResults,searchTimer;
  renderSearchResults=function(){oldSearch();clearTimeout(searchTimer);var r=reader(),q=state.query;if(r&&q&&q.trim())searchTimer=setTimeout(function(){r.search(q).catch(function(){});},250);};
  var oldClusterPhotos=openClusterPhotos;
  openClusterPhotos=function(){
    var r=reader(),ids=state.clusterPlaces||[];
    if(!r||navigator.onLine===false){oldClusterPhotos();return;}
    var missing=ids.filter(function(id){return !r.placeInfo(id);});
    if(!missing.length){oldClusterPhotos();return;}
    // A large cluster opens its place list; never fan out hundreds of detail calls.
    if(missing.length>12){toast(state.lang==='en'?'Choose a place to view all its photos':'请选择地点查看全部照片');return;}
    wait('cluster:'+ids.join(','),function(){var queue=missing.slice();function next(){var id=queue.shift();return id?r.ensurePlace(id).then(next):Promise.resolve();}return Promise.all([next(),next()]);},function(){if(state.view==='cluster')oldClusterPhotos();});
  };
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-action]'),r=reader();if(!el||!r)return;
    var a=el.dataset.action;
    if(a==='read-own-retry'){ownFailed.delete(me().id);render();return;}
    if(a==='read-own-more'){state.footLimit=(state.footLimit||80)+80;var scroll=view.scrollTop;render();view.scrollTop=scroll;return;}
    if(a==='read-feed-more'||a==='read-place-more'){
      if(el.disabled)return;el.disabled=true;var id=state.placeId;
      var task=a==='read-feed-more'?r.readFeed(true,homeVisible):r.ensurePlace(id,true);
      task.then(function(){if(a==='read-feed-more'?homeVisible():state.view==='place'&&state.placeId===id){var scroll=view.scrollTop;render();view.scrollTop=scroll;}},function(){toast(t('loadFail'));}).then(function(){el.disabled=false;});
    }else if(a==='homes-open'||a==='homes-toggle')r.ensureHomes().catch(function(){toast(t('loadFail'));});
  });
  window.addEventListener('xuetuan-read-update',function(e){var kind=e.detail;
    clearTimeout(updateTimer);updateTimer=setTimeout(function(){
      oldMap();
      if(state.view==='search'||state.view==='add')oldSearch();
      else if(kind!=='detail'&&kind!=='personal'&&!(kind==='map'&&state.tab==='home')&&['feed','place','person','cluster'].indexOf(state.view)!==-1&&!state.form){var top=view.scrollTop;render();view.scrollTop=top;}
    },60);
  });
  window.addEventListener('offline',function(){navEpoch++;});
  store.onAuthChange(function(){homeRequestKey='';});
  // A slow script download can finish after boot's RPCs. Paint the enhanced UI then too.
  if(reader()&&!state.bootLoading){refreshMap();if(['feed','place','person','cluster'].indexOf(state.view)!==-1&&!state.form)render();}
})();
