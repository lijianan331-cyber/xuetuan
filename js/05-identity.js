/* Owner-managed second identity. Uses separate verified Auth users, keeping existing RLS/records intact. */
'use strict';
var managedIdentity=null,identitySwitching=false,identitySeq=0;
var IDENTITY_MAIN_EMAIL='lijianan331@gmail.com',IDENTITY_PREFIX='xuetuan:managed-identity:v1:';
function identityText(zh,en){return state.lang==='en'?en:zh;}
function identityWait(request){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error('Identity request timed out'));},20000);Promise.resolve(request).then(function(v){clearTimeout(timer);resolve(v);},function(e){clearTimeout(timer);reject(e);});});}
function identityIsMain(u){return !!(u && !u.is_anonymous && u.email_confirmed_at && String(u.email||'').toLowerCase()===IDENTITY_MAIN_EMAIL);}
function identityIsAlt(u,owner){return !!(u && !u.is_anonymous && u.app_metadata && u.app_metadata.xuetuan_managed_alt===true && u.app_metadata.xuetuan_owner===owner);}
function identityTokens(kind,owner){try{return JSON.parse(localStorage.getItem(IDENTITY_PREFIX+owner+':'+kind)||'null');}catch(e){return null;}}
function identityKeep(kind,owner,s){
  var d={access_token:s.access_token,refresh_token:s.refresh_token,owner:owner,user:s.user.id};
  if(!d.access_token || !d.refresh_token)throw new Error('Invalid session');
  var key=IDENTITY_PREFIX+owner+':'+kind,value=JSON.stringify(d);
  localStorage.setItem(key,value);if(localStorage.getItem(key)!==value)throw new Error('Session storage unavailable');
}
function clearIdentityTokens(){
  try{Object.keys(localStorage).filter(function(k){return k.indexOf(IDENTITY_PREFIX)===0;}).forEach(function(k){localStorage.removeItem(k);});}catch(e){}
}
function identityProbe(){return window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'xuetuan-identity-probe'},global:{headers:{'x-xuetuan-device':browserDeviceId()}}});}
function identityValidate(tokens,owner,toMain){
  if(!tokens || tokens.owner!==owner || !tokens.access_token || !tokens.refresh_token)return Promise.reject(new Error('Main session expired'));
  var probe=identityProbe();
  return identityWait(probe.auth.setSession({access_token:tokens.access_token,refresh_token:tokens.refresh_token}).then(function(r){
    if(r.error || !r.data || !r.data.session)throw new Error('Main session expired');
    return probe.auth.getUser().then(function(v){
      var u=v.data&&v.data.user;if(v.error || !u || (toMain ? !identityIsMain(u)||u.id!==owner : !identityIsAlt(u,owner)))throw new Error('Identity mismatch');
      var s=r.data.session;s.user=u;return s;
    });
  }));
}
function refreshManagedIdentity(){
  if(store.mode!=='remote')return Promise.resolve();
  var seq=++identitySeq;
  return sbClient.auth.getSession().then(function(r){
    if(seq!==identitySeq)return;
    var u=r.data&&r.data.session&&r.data.session.user;
    managedIdentity=identityIsMain(u)?{alt:false,owner:u.id}:u&&u.app_metadata&&identityIsAlt(u,u.app_metadata.xuetuan_owner)?{alt:true,owner:u.app_metadata.xuetuan_owner}:null;
    if(!u)clearIdentityTokens();
    if(state.view==='feed' && state.tab==='me')render();
  },function(){});
}
function identityCardHTML(){
  if(!managedIdentity)return '';
  var alt=managedIdentity.alt;
  return '<div class="field identity-card"><b>'+esc(identityText('当前：'+(alt?'小号':'主号'),alt?'Using: second identity':'Using: main account'))+'</b><p class="f-hint">'+esc(identityText('两边昵称、足迹、收藏和互动独立。管理员权限只在主号。','Names, footprints, saves and interactions are separate. Admin tools stay on the main account.'))+'</p><div class="btn-row"><button type="button" class="btn small" data-action="identity-switch"'+(identitySwitching?' disabled':'')+'>'+esc(identitySwitching?identityText('正在切换…','Switching…'):identityText(alt?'切回主号':'切到小号',alt?'Switch to main':'Switch to second identity'))+'</button>'+(alt?'<button type="button" class="link-btn" data-action="login-google">'+esc(identityText('重新登录主号','Sign in to main again'))+'</button>':'')+'</div></div>';
}
function switchManagedIdentity(){
  if(identitySwitching || !managedIdentity || store.mode!=='remote')return;
  if((state.form&&state.form.saving)||(state.bulk&&state.bulk.saving)){toast(t('saveWorking'));return;}
  identitySwitching=true;var info=Object.assign({},managedIdentity),owner=info.owner,startUser=me().id;
  render();
  identityWait(store.flushProfileChanges?store.flushProfileChanges():Promise.resolve()).then(function(){return identityWait(sbClient.auth.getSession());}).then(function(r){
    var current=r.data&&r.data.session;if(r.error||!current)throw new Error('Main session expired');
    if((info.alt?!identityIsAlt(current.user,owner):!identityIsMain(current.user)) || current.user.id!==startUser)throw new Error('Identity mismatch');
    identityKeep(info.alt?'alt':'main',owner,current);
    if(info.alt)return identityValidate(identityTokens('main',owner),owner,true);
    var existing=identityTokens('alt',owner);
    var cached=existing?identityValidate(existing,owner,false):Promise.reject(new Error('No cached second identity'));
    return cached.catch(function(){
      return identityWait(sbClient.functions.invoke('xuetuan-managed-alt',{body:{}})).then(function(r){
        if(r.error || !r.data || !r.data.session || r.data.owner_id!==owner)throw new Error('Could not prepare second identity');
        return identityValidate(Object.assign({owner:owner},r.data.session),owner,false);
      });
    });
  }).then(function(next){
    if(me().id!==startUser)throw new Error('Identity changed');
    identityKeep(info.alt?'main':'alt',owner,next);
    // Before replacing the active SDK session, both identities must already be recoverable in this browser.
    return (store.flushProfileChanges?store.flushProfileChanges():Promise.resolve()).then(function(){return sbClient.auth.setSession({access_token:next.access_token,refresh_token:next.refresh_token});}).then(function(r){if(r.error)throw r.error;});
  }).then(function(){toast(identityText(info.alt?'已切回主号':'已切到小号',info.alt?'Switched to main':'Switched to second identity'));},function(e){
    toast(identityText(info.alt?'主号登录可能已过期，请点“重新登录主号”；当前小号仍保留。':'小号暂时没切过去，请重试；主号仍保留。',info.alt?'Main session may have expired. Sign in to main again.':'Could not switch. Your main account is kept.'));
  }).then(function(){identitySwitching=false;refreshManagedIdentity();});
}
function handleIdentityAction(a){if(a!=='identity-switch')return false;switchManagedIdentity();return true;}
if(store.mode==='remote'){
  store.onAuthChange(refreshManagedIdentity);refreshManagedIdentity();
  var originalIdentitySignOut=store.signOut;
  store.signOut=function(){
    var info=managedIdentity,other=info&&identityTokens(info.alt?'main':'alt',info.owner);
    clearIdentityTokens();
    var revoke=other?identityValidate(other,info.owner,!!info.alt).then(function(s){var p=identityProbe();return p.auth.setSession(s).then(function(r){if(!r.error)return p.auth.signOut({scope:'local'});});}).catch(function(){}):Promise.resolve();
    return revoke.then(function(){return originalIdentitySignOut.call(store);});
  };
}
