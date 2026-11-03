/* Existing-account login and guest linking are different operations. Keep a local way back to the guest. */
'use strict';
var AUTH_GUEST_KEY='xuetuan:guest-return:v1',authReturningGuest=false,authSigninBusy=false,authSessionEpoch=0,authSDKIdentity;
function authText(zh,en){return state.lang==='en'?en:zh;}
function authWait(p){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error(authText('登录服务暂时没有响应，请重试','Sign-in service did not respond. Please retry.')));},20000);Promise.resolve(p).then(function(v){clearTimeout(timer);resolve(v);},function(e){clearTimeout(timer);reject(e);});});}
function authGuestBackup(){try{return JSON.parse(localStorage.getItem(AUTH_GUEST_KEY)||'null');}catch(e){return null;}}
function authCanReturnGuest(){var b=authGuestBackup();return store.mode==='remote'&&!isGuest()&&!!(b&&b.uid&&b.uid!==me().id&&b.access_token&&b.refresh_token);}
function authDiscardGuestBackup(){try{localStorage.removeItem(AUTH_GUEST_KEY);}catch(e){}}
function authReturnGuestHTML(){return authCanReturnGuest()?'<div class="me-account"><span>'+esc(authText('这台设备还保留着之前的游客记录','Previous guest records are kept on this device'))+'</span><button type="button" class="btn small ghost" data-action="auth-return-guest"'+(authReturningGuest?' disabled':'')+'>'+esc(authReturningGuest?authText('正在恢复…','Restoring…'):authText('返回游客记录','Return to guest'))+'</button></div>':'';}
function authWechatHintHTML(){return /MicroMessenger/i.test(navigator.userAgent)?'<p class="f-hint auth-browser-hint">'+esc(authText('微信内若无法谷歌登录，请点右上角“…” → 在浏览器打开，再使用同一链接登录。','If Google sign-in fails in WeChat, use its top-right menu to open this same link in your browser.'))+'</p>':'';}
function authGuestAccountHTML(){return '<div class="me-account auth-guest"><span>'+esc(authText('匿名账号 · 新账号可绑定谷歌，已有账号请直接登录','Guest account · link a new Google account or sign in to an existing one'))+'</span><div class="auth-choices"><button type="button" class="btn small primary" data-action="login-google">'+esc(authText('登录已有账号','Existing account'))+'</button><button type="button" class="btn small ghost" data-action="link-google">'+esc(authText('绑定谷歌','Link Google'))+'</button></div><small>'+esc(authText('登录旧账号不会合并游客记录，可在这台设备上返回。','Signing in does not merge guest records. You can return on this device.'))+'</small></div>'+authWechatHintHTML();}
function authPreserveGuest(){
 if(!isGuest())return Promise.resolve();
 var owner=me().id;
 return authWait(store.flushProfileChanges?store.flushProfileChanges():Promise.resolve()).then(function(){return authWait(sbClient.auth.getSession());}).then(function(r){
  var s=r.data&&r.data.session;
  if(r.error||!s||!s.user||s.user.id!==owner||!s.user.is_anonymous||!s.access_token||!s.refresh_token)throw new Error(authText('游客登录状态未就绪，请稍后重试','Guest session is not ready. Please retry.'));
  var value=JSON.stringify({uid:owner,access_token:s.access_token,refresh_token:s.refresh_token});
  try{localStorage.setItem(AUTH_GUEST_KEY,value);if(localStorage.getItem(AUTH_GUEST_KEY)!==value)throw Error();}
  catch(e){throw new Error(authText('浏览器未能保留游客登录，请先允许本站存储后重试','Allow storage for this site before signing in, so guest records remain accessible.'));}
 });
}
function authReturnGuest(){
 if(authReturningGuest||!authCanReturnGuest())return;
 var b=authGuestBackup(),owner=me().id,epoch=authSessionEpoch,stored=localStorage.getItem(AUTH_GUEST_KEY);authReturningGuest=true;render();
 var probe=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'xuetuan-guest-check'}});
 authWait(probe.auth.setSession({access_token:b.access_token,refresh_token:b.refresh_token})).then(function(r){
  if(r.error||!r.data||!r.data.session)throw Error('Guest expired');var s=r.data.session;
  return authWait(probe.auth.getUser()).then(function(u){if(u.error||!u.data||!u.data.user||u.data.user.id!==b.uid||!u.data.user.is_anonymous)throw Error('Invalid guest');return s;});
 }).then(function(s){
  if(me().id!==owner||authSessionEpoch!==epoch)throw Error('Account changed');
  return authWait(store.flushProfileChanges?store.flushProfileChanges():Promise.resolve()).then(function(){if(me().id!==owner||authSessionEpoch!==epoch)throw Error('Account changed');return authWait(sbClient.auth.setSession({access_token:s.access_token,refresh_token:s.refresh_token}));});
 }).then(function(r){if(r.error)throw r.error;if(localStorage.getItem(AUTH_GUEST_KEY)===stored)authDiscardGuestBackup();},function(){toast(authText('游客登录已过期或暂时无法恢复，当前账号仍保留。','Guest session expired or could not be restored. Your current account is kept.'));}).then(function(){authReturningGuest=false;if(state.view==='feed'&&state.tab==='me')render();});
}
function authFinishReturn(){
 var issue=authCallbackProblem;if(!issue)return;authCallbackProblem=null;
 var u=new URL(location.href),h=new URLSearchParams(u.hash.slice(1));
 ['error','error_code','error_description','code','access_token','refresh_token','provider_token','provider_refresh_token','expires_in','expires_at','token_type'].forEach(function(k){u.searchParams.delete(k);h.delete(k);});
 u.hash=h.toString();history.replaceState(history.state,'',u.pathname+u.search+u.hash);
 var collision=/identity_already_exists|identity_already_linked/.test(issue.code)||/identity is already linked to another user/i.test(issue.description);
 setTab('me');
 openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(collision?authText('这个 Google 已有雪团账号','This Google account already uses XueTuan'):authText('登录没有完成','Sign-in did not finish'))+'</h3><p class="f-hint">'+esc(collision?authText('请直接登录原来的账号。游客记录会保留在这台设备上，不会自动合并。','Sign in to the existing account. Guest records stay accessible on this device and are not merged.'):authText('刚才的登录被取消或暂时失败。当前记录仍保留，请重试。','Sign-in was cancelled or failed. Your current records are kept. Please retry.'))+'</p>'+authWechatHintHTML()+'<div class="btn-row"><button type="button" class="btn primary" data-action="login-google">'+esc(collision?authText('登录原账号','Sign in to existing account'):authText('重试谷歌登录','Retry Google'))+'</button><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div></div>');
}
if(store.mode==='remote'){
 var authOriginalGoogle=store.signInWithGoogle,authOriginalLink=store.linkGoogle,authOriginalSignOut=store.signOut;
 function authBeginGoogle(method){
  if(authSigninBusy)return Promise.resolve();authSigninBusy=true;var epoch=authSessionEpoch;
  return authPreserveGuest().then(function(){if(epoch!==authSessionEpoch)throw new Error(authText('登录状态已变化，请重试','Account changed. Please retry.'));return method.call(store);}).then(function(r){authSigninBusy=false;return r;},function(e){authSigninBusy=false;throw e;});
 }
 store.signInWithGoogle=function(){return authBeginGoogle(authOriginalGoogle);};
 store.linkGoogle=function(){return authBeginGoogle(authOriginalLink);};
 store.signOut=function(){return authOriginalSignOut.call(store).then(function(r){authDiscardGuestBackup();return r;});};
 sbClient.auth.onAuthStateChange(function(event,session){var key=session&&session.user?session.user.id+':'+!!session.user.is_anonymous:null;if(key!==authSDKIdentity){authSDKIdentity=key;authSessionEpoch++;}});
 store.onAuthChange(function(){var b=authGuestBackup();if(b&&b.uid===me().id&&!isGuest())authDiscardGuestBackup();});
}
