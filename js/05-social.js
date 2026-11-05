/* Lightweight public post discussion. Activity notifications and private chats live in 05-messages.js. */
'use strict';
var socialPanel = null, socialDrafts = new Map(), socialWrites = new Map(), socialEpoch = 0;
var socialHeart = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20.5 4.8a5.4 5.4 0 0 0-7.6 0l-.9.9-.9-.9a5.4 5.4 0 0 0-7.6 7.6L12 21l8.5-8.6a5.4 5.4 0 0 0 0-7.6Z"/></svg>';
function socialText(zh,en) { return state.lang === 'en' ? en : zh; }
function socialRequestId() {
  if(crypto.randomUUID)return crypto.randomUUID();
  var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  var h=Array.from(bytes).map(function(x){return x.toString(16).padStart(2,'0');}).join('');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
function socialRPC(name,args) {
  return new Promise(function(resolve,reject){
    var timer=setTimeout(function(){reject(new Error('Network timeout'));},20000);
    Promise.resolve().then(function(){return sbClient.rpc(name,args || {});}).then(function(r){
      clearTimeout(timer);if(r.error)reject(r.error);else resolve(r.data);
    },function(e){clearTimeout(timer);reject(e);});
  });
}
/* Keep all data access behind store. Local mode stores its synthetic/local discussion separately. */
store.socialRead = function (id,cursor) {
  if (store.mode === 'remote') return socialRPC('xuetuan_post_social',{visit_id:id,after_at:cursor ? cursor.created_at : null,after_id:cursor ? cursor.id : null});
  return localSocial('read',id,{cursor:cursor});
};
store.socialWrite = function (action,id,args) {
  if (store.mode === 'remote') return socialRPC('xuetuan_social_write',Object.assign({action:action,visit_id:id},args));
  return localSocial(action,id,args || {});
};
store.socialReports = function () { return socialRPC('xuetuan_comment_reports'); };
store.socialModerate = function (id,decision) { return socialRPC('xuetuan_moderate_comment',{comment_id:id,decision:decision}); };
function localSocial(action,id,args) {
  return Promise.resolve().then(function () {
    var r=store.review(id); if (!r || r.visibility!=='public') throw new Error('XUETUAN_POST_UNAVAILABLE');
    var raw=lsGet('xuetuan:local-social:v1'), db=raw ? JSON.parse(raw) : {comments:[],likes:[],reports:[]}, user=me().id;
    if (action==='read') {
      var rows=db.comments.filter(function(c){return c.visit_id===id;}).sort(function(a,b){return b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id);});
      if (args.cursor) rows=rows.filter(function(c){return c.created_at<args.cursor.created_at || (c.created_at===args.cursor.created_at && c.id<args.cursor.id);});
      return {comments:rows.slice(0,30),has_more:rows.length>30,liked:db.likes.some(function(x){return x.visit_id===id && x.user_id===user;}),like_count:isMine(r) ? db.likes.filter(function(x){return x.visit_id===id;}).length : null};
    }
    var c=db.comments.find(function(x){return x.id===args.target_id && x.visit_id===id;});
    if (action==='like') { db.likes=db.likes.filter(function(x){return x.visit_id!==id || x.user_id!==user;}); if(args.liked)db.likes.push({visit_id:id,user_id:user}); }
    if (action==='comment') {
      if (!args.body.trim() || args.body.length>500 || (args.target_id && (!c || c.deleted || c.parent_id))) throw new Error('Invalid comment');
      if (!db.comments.some(function(x){return x.id===args.request_id;})) db.comments.push({id:args.request_id,visit_id:id,user_id:user,name:me().name,body:args.body.trim(),parent_id:args.target_id||null,reply_name:c ? c.name : '',created_at:new Date().toISOString(),deleted:false});
    }
    if (action==='delete') { if(!c || (c.user_id!==user && !isMine(r)))throw new Error('Permission denied'); c.deleted=true;c.body='';c.name='';c.user_id=null; }
    if (action==='report') db.reports.push({comment_id:args.target_id,user_id:user,reason:args.body});
    localStorage.setItem('xuetuan:local-social:v1',JSON.stringify(db)); return {ok:true};
  });
}
function socialKey(id) { return socialEpoch + ':' + (me().id || '-') + ':' + id; }
function socialError(e,reading) {
  var s=String(e && e.message || e || '');
  if (/XUETUAN_POST_UNAVAILABLE/.test(s)) return socialText('帖子已撤回公开或被删除，无法继续互动。','This post is no longer public.');
  if (/XUETUAN_BIND_REQUIRED/.test(s)) return socialText('请先登录或绑定谷歌账号再互动。','Sign in or link Google to interact.');
  if (/PGRST202|schema cache|Could not find.*function|no such function/.test(s)) return socialText('互动功能尚未启用，请稍后重试。','Discussion is not available yet.');
  if (/XUETUAN_/.test(s)) return securitySaveError(e);
  if (reading) return socialText('评论暂时加载不了，请重试。','Comments could not load. Please retry.');
  return socialText('没有保存成功，请重试；评论仍保留。','Could not save. Retry; your text is kept.');
}
function socialAuth() {
  return store.mode !== 'remote' || store.signedIn() || requireLogin();
}
function currentSocial(p) { return socialPanel===p && socialKey(p.id)===p.key && state.view==='post' && state.postId===p.id && !!$('#post-social'); }
function mountPostSocial(id) {
  var key=socialKey(id);
  if (!socialPanel || socialPanel.key!==key) socialPanel={id:id,key:key,rows:[],data:null,loading:false,error:'',more:false,reply:null};
  paintPostSocial();
  if ((!socialPanel.data || Date.now()-(socialPanel.loadedAt||0)>30000) && !socialPanel.loading) loadPostSocial(false);
}
/* 一条评论：左边小头像，右边 名字 · 时间，正文，下面一行灰色小字操作（回复 / 删除 / 举报）。
   回复排在它回复的那条下面，往右缩进（用户 2026-11-03 嫌原来的样子怪） */
function socialCommentHTML(c,p,nested) {
  var post=store.review(p.id), own=c.user_id===me().id, mayDelete=own || isMine(post) || isModerator();
  var author=c.deleted ? socialText('已删除','Deleted') : c.name || t('anon');
  var person=!c.deleted && c.page_public ? ' data-action="person" data-uid="'+esc(c.user_id)+'"' : '';
  var authorHTML=person ? '<button type="button" class="social-author"'+person+'>'+esc(author)+'</button>' : '<b class="social-author">'+esc(author)+'</b>';
  return '<li class="social-comment'+(c.parent_id?' is-reply':'')+'" data-comment="'+esc(c.id)+'">'+(c.deleted ? '<span class="avatar social-avatar ghost" aria-hidden="true"></span>' : avatarHTML(author,c.user_id).replace('class="avatar','class="avatar social-avatar'))+
    '<div class="social-main"><div class="social-comment-head">'+authorHTML+
    (c.parent_id && !nested ? '<small class="social-reply-label">'+esc(socialText('回复 ','Reply to ')+(c.reply_name || socialText('已删除的评论','deleted comment')))+'</small>' : c.parent_id ? '<small class="social-reply-label sr-only">'+esc(socialText('回复 ','Reply to ')+(c.reply_name || socialText('已删除的评论','deleted comment')))+'</small>' : '')+'</div>'+
    '<p'+(c.deleted?' class="social-gone"':'')+'>'+esc(c.deleted ? socialText('这条评论已删除','This comment was deleted.') : c.body)+'</p>'+
    '<div class="social-comment-actions"><time>'+esc(timeAgo(Date.parse(c.created_at)))+'</time>'+(c.deleted ? '' : (!c.parent_id ? '<button type="button" class="link-btn" data-action="social-reply" data-id="'+esc(c.id)+'">'+esc(socialText('回复','Reply'))+'</button>' : '')+
      (mayDelete ? '<button type="button" class="link-btn" data-action="social-delete" data-id="'+esc(c.id)+'">'+esc(t('del'))+'</button>' : '')+
      (!own ? '<button type="button" class="link-btn" data-action="social-report" data-id="'+esc(c.id)+'">'+esc(socialText('举报','Report'))+'</button>' : '')+
      (isModerator() ? '<button type="button" class="link-btn" data-action="social-mod-open" data-id="'+esc(c.id)+'">'+esc(socialText('管理','Moderate'))+'</button>' : ''))+'</div></div></li>';
}
/* 顶层评论按服务器顺序（新的在上）；每条下面接它的回复（旧的在上）。父评论不在这一页的回复单独放，带「回复 X」 */
function socialThreadHTML(p) {
  var roots=[], kids={}, ids={};
  p.rows.forEach(function(c){ids[c.id]=1;});
  p.rows.forEach(function(c){ if(c.parent_id && ids[c.parent_id]) (kids[c.parent_id]=kids[c.parent_id]||[]).push(c); else roots.push(c); });
  return roots.map(function(c){
    return socialCommentHTML(c,p,false)+(kids[c.id]||[]).slice().sort(function(a,b){return a.created_at.localeCompare(b.created_at);}).map(function(k){return socialCommentHTML(k,p,true);}).join('');
  }).join('');
}
function paintPostSocial() {
  var p=socialPanel;if(!p || !currentSocial(p))return;
  var el=$('#post-social'), draft=socialDrafts.get(p.key)||{text:''}, busy=socialWrites.has(p.key), data=p.data;
  var active=document.activeElement,focusBody=active && active.id==='social-body',start=focusBody?active.selectionStart:0,end=focusBody?active.selectionEnd:0;
  var mayWrite=!!data && !p.loading, disabled=busy||!mayWrite?' disabled':'';
  /* 赞放在帖子正文下面那一排（#post-like-slot）；这里是评论区：标题、评论、最下面一条输入框 */
  var slot=$('#post-like-slot'), likeHTML='<button type="button" class="post-act social-like" data-action="social-like" aria-pressed="'+!!(data&&data.liked)+'"'+disabled+'>'+socialHeart+'<span>'+esc(data&&data.liked ? socialText('已赞','Liked') : socialText('赞','Like'))+'</span></button>'+
    (data&&data.like_count!=null ? '<small class="social-private-count" title="'+esc(socialText('只有你看得到','Only you can see this'))+'">'+esc(socialText(data.like_count+' 个赞 · 仅你可见',data.like_count+' likes · only you see this'))+'</small>' : '');
  if(slot)slot.innerHTML=likeHTML;
  var n=p.rows.filter(function(c){return !c.deleted;}).length, mine=me();
  el.innerHTML=(slot?'':'<div class="social-toolbar">'+likeHTML+'</div>')+
    '<div class="social-heading"><h2>'+esc(socialText('评论','Comments'))+(n?' <span>'+n+(p.more?'+':'')+'</span>':'')+'</h2><button type="button" class="icon-btn flat social-refresh" data-action="social-refresh" aria-label="'+esc(socialText('刷新评论','Refresh comments'))+'"'+(p.loading||busy?' disabled':'')+'><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/></svg></button></div>'+
    (p.error ? '<p class="social-status" role="status">'+esc(p.error)+' <button type="button" class="link-btn" data-action="social-refresh">'+esc(socialText('重试','Retry'))+'</button></p>' : '')+
    (p.loading && !p.rows.length ? '<p class="social-empty" role="status">'+esc(socialText('正在加载评论…','Loading comments…'))+'</p>' : '')+
    (!p.rows.length && data && !p.loading ? '<p class="social-empty">'+esc(socialText('还没有评论，来说第一句吧。','No comments yet. Say the first word.'))+'</p>' : '')+
    '<ul class="social-comments">'+socialThreadHTML(p)+'</ul>'+
    (p.more ? '<button type="button" class="link-btn social-more" data-action="social-more"'+(p.loading||busy?' disabled':'')+'>'+esc(socialText('查看更早的评论','Older comments'))+'</button>' : '')+
    '<div class="social-compose">'+(p.reply ? '<div class="social-replying"><span>'+esc(socialText('回复 ','Reply to ')+(p.reply.name||t('anon')))+'</span><button type="button" class="link-btn" data-action="social-cancel-reply">'+esc(t('cancel'))+'</button></div>' : '')+
    '<div class="social-input-row">'+avatarHTML(mine.name||t('you'),mine.id).replace('class="avatar','class="avatar social-avatar')+
    '<label class="social-input-label" for="social-body">'+esc(socialText('写评论','Write a comment'))+'</label><textarea class="social-input" id="social-body" rows="1" maxlength="500" placeholder="'+esc(p.reply ? socialText('写下你的回复…','Write a reply…') : socialText('说点什么… 评论所有人可见','Say something… comments are public'))+'"'+(busy?' disabled':'')+'>'+esc(draft.text)+'</textarea>'+
    '<button type="button" class="social-send" data-action="social-send"'+disabled+'>'+esc(busy ? socialText('发送中','Sending') : socialText('发送','Send'))+'</button></div></div>';
  if(focusBody && !busy){var body=$('#social-body');body.focus({preventScroll:true});body.setSelectionRange(start,end);}
}
function loadPostSocial(more) {
  var p=socialPanel;if(!p || p.loading || socialWrites.has(p.key))return Promise.resolve();
  p.loading=true;p.error='';paintPostSocial();
  var cursor=more && p.rows.length ? p.rows[p.rows.length-1] : null;
  return store.socialRead(p.id,cursor).then(function(data){
    if(!currentSocial(p))return;
    var ids=new Set(more?p.rows.map(function(c){return c.id;}):[]);
    p.rows=(more?p.rows:[]).concat((data.comments||[]).filter(function(c){if(ids.has(c.id))return false;ids.add(c.id);return true;}));
    p.data=data;p.more=!!data.has_more;p.loadedAt=Date.now();
  },function(e){if(currentSocial(p)){p.error=socialError(e,true);if(/XUETUAN_POST_UNAVAILABLE/.test(String(e&&e.message))){p.rows=[];p.data=null;p.more=false;}}}).then(function(){p.loading=false;paintPostSocial();});
}
function runSocialWrite(p,action,args,done) {
  if(socialWrites.has(p.key))return;
  var owner=me().id,epoch=socialEpoch;
  socialWrites.set(p.key,true);p.error='';paintPostSocial();
  return Promise.resolve().then(function(){return store.socialWrite(action,p.id,args);}).then(function(result){
    if(owner!==me().id || epoch!==socialEpoch)return;
    if(done)done(result);
  }).catch(function(e){if(currentSocial(p)){p.error=socialError(e);if(/XUETUAN_POST_UNAVAILABLE/.test(String(e&&e.message))){p.rows=[];p.data=null;p.more=false;}toast(p.error);}}).then(function(){socialWrites.delete(p.key);paintPostSocial();});
}
function sendSocialComment() {
  var p=socialPanel;if(!p || !currentSocial(p) || !p.data || !socialAuth() || socialWrites.has(p.key))return;
  var d=socialDrafts.get(p.key)||{text:''}, text=d.text.trim(), parent=p.reply&&p.reply.id||null;
  if(!text){$('#social-body').focus();return;}
  if(text.length>500)return;
  /* The same unchanged draft reuses its UUID after timeout/retry, preventing duplicate comments. */
  var signature=JSON.stringify([text,parent]);
  if(d.signature!==signature){d.signature=signature;d.request=socialRequestId();socialDrafts.set(p.key,d);}
  runSocialWrite(p,'comment',{body:text,target_id:parent,request_id:d.request},function(){
    socialDrafts.delete(p.key);p.reply=null;
    if(currentSocial(p)){p.error='';toast(socialText('评论已发送','Comment sent'));}
  }).then(function(){if(currentSocial(p) && !socialDrafts.has(p.key))loadPostSocial(false);});
}
function socialReportDialog(id) {
  if(!socialAuth())return;
  var p=socialPanel;if(!p || !currentSocial(p))return;
  openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(socialText('举报评论','Report comment'))+'</h3><p class="f-hint">'+esc(socialText('举报仅管理员可见，不会公开你的身份。','Only administrators can see your report. Your identity is not shown publicly.'))+'</p><div class="social-report-reasons">'+[['spam','广告刷屏','Spam'],['abuse','辱骂或骚扰','Abuse'],['privacy','泄露隐私','Privacy'],['other','其他不当内容','Other']].map(function(x){return '<button type="button" class="btn" data-action="social-report-send" data-id="'+esc(id)+'" data-post="'+esc(p.id)+'" data-reason="'+x[0]+'">'+esc(socialText(x[1],x[2]))+'</button>';}).join('')+'</div><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div>');
}
function socialDeleteDialog(id) {
  var p=socialPanel;if(!p || !currentSocial(p) || !socialAuth())return;
  openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(socialText('删除这条评论？','Delete this comment?'))+'</h3><p class="f-hint">'+esc(socialText('评论正文会删除，已有回复保留。','The text will be removed. Existing replies stay.'))+'</p><div class="btn-row"><button type="button" class="btn danger" data-action="social-delete-confirm" data-id="'+esc(id)+'" data-post="'+esc(p.id)+'">'+esc(t('del'))+'</button><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div></div>');
}
var socialReportsBusy=false;
function loadSocialReports() {
  if(!isModerator() || socialReportsBusy)return;
  var el=$('#social-reports');if(!el)return;
  var owner=me().id;socialReportsBusy=true;el.textContent=socialText('正在加载…','Loading…');
  store.socialReports().then(function(rows){
    if(!el.isConnected || owner!==me().id || !isModerator())return;
    el.innerHTML=rows.length ? '<ul class="social-comments">'+rows.map(function(c){return '<li class="social-comment"><b>'+esc(c.name||t('anon'))+'</b><p>'+esc(c.body)+'</p><small>'+esc(socialText('举报 '+c.reports+' 次','Reported '+c.reports+' times'))+' · '+esc((c.reasons||[]).map(function(x){return ({spam:'广告刷屏',abuse:'辱骂骚扰',privacy:'泄露隐私',other:'其他'})[x]||x;}).join('、'))+'</small><div class="social-comment-actions"><button type="button" class="link-btn" data-action="open-post" data-id="'+esc(c.visit_id)+'">'+esc(socialText('看帖子','Open post'))+'</button><button type="button" class="link-btn" data-action="social-mod-open" data-id="'+esc(c.id)+'">'+esc(socialText('处理','Review'))+'</button></div></li>';}).join('')+'</ul>' : '<p class="f-hint">'+esc(socialText('暂无待处理举报。','No reports to review.'))+'</p>';
  },function(e){if(el.isConnected)el.textContent=socialError(e);}).then(function(){socialReportsBusy=false;});
}
function socialModerationDialog(id) {
  if(!isModerator())return;
  openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(socialText('处理公开评论','Moderate public comment'))+'</h3><p class="f-hint">'+esc(socialText('封禁沿用账号及已记录浏览器限制。清除浏览器数据可能绕过浏览器限制。','Bans apply to the account and recorded browsers. Clearing browser data can bypass browser restrictions.'))+'</p><div class="social-report-reasons">'+[['dismiss','忽略举报','Dismiss report'],['delete','删除评论','Delete comment'],['delete_and_ban','删除并封禁作者','Delete and ban author']].map(function(x){return '<button type="button" class="btn" data-action="social-mod-confirm" data-id="'+esc(id)+'" data-decision="'+x[0]+'">'+esc(socialText(x[1],x[2]))+'</button>';}).join('')+'</div><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div>');
}
var socialModerating=false;
function handleSocialAction(action,el) {
  if(action.indexOf('social-')!==0)return false;
  var p=socialPanel,d=el.dataset;
  if(action==='social-open'){openPost(d.id);return true;}
  if(action==='social-reports'){loadSocialReports();return true;}
  if(action==='social-mod-open'){socialModerationDialog(d.id);return true;}
  if(action==='social-mod-confirm'){
    if(!isModerator() || socialModerating)return true;
    var owner=me().id;socialModerating=true;$$('#modal button').forEach(function(b){b.disabled=true;});
    store.socialModerate(d.id,d.decision).then(function(){if(owner!==me().id)return;closeModal();toast(socialText('已处理','Done'));loadSocialReports();if(p && currentSocial(p))loadPostSocial(false);},function(e){toast(socialError(e));$$('#modal button').forEach(function(b){b.disabled=false;});}).then(function(){socialModerating=false;});return true;
  }
  if(!p || !currentSocial(p))return true;
  /* 正文下面那排的「评论」：滚到输入框并点亮 */
  if(action==='social-focus'){var b=$('#social-body');if(b){b.scrollIntoView({block:'center',behavior:'smooth'});b.focus({preventScroll:true});}return true;}
  if(action==='social-refresh' || action==='social-more'){loadPostSocial(action==='social-more');return true;}
  if(store.mode==='remote'&&!store.signedIn()){
    var post=p.id,text=(socialDrafts.get(p.key)||{}).text||'';
    requireLogin(function(){var owner=me().id,until=Date.now()+10000;function retry(){
      if(me().id!==owner||state.view!=='post'||state.postId!==post)return;
      var current=socialPanel;if(!current)return;
      socialDrafts.set(current.key,{text:text});
      if(current.data&&!current.loading){paintPostSocial();handleSocialAction(action,el);return;}
      if(Date.now()<until)setTimeout(retry,80);
    }retry();});return true;
  }
  if(socialWrites.has(p.key))return true;
  if(action==='social-send'){sendSocialComment();return true;}
  if(action==='social-cancel-reply'){p.reply=null;paintPostSocial();return true;}
  if(action==='social-reply'){
    if(!socialAuth())return true;
    p.reply=p.rows.find(function(c){return c.id===d.id && !c.deleted && !c.parent_id;})||null;
    paintPostSocial();$('#social-body').focus();return true;
  }
  if(action==='social-report'){socialReportDialog(d.id);return true;}
  if(action==='social-delete'){socialDeleteDialog(d.id);return true;}
  if(!socialAuth())return true;
  if(action==='social-like' && p.data)runSocialWrite(p,'like',{liked:!p.data.liked},function(){
    if(!currentSocial(p))return;
    var add=p.data.liked?-1:1;p.data.liked=!p.data.liked;if(p.data.like_count!=null)p.data.like_count+=add;p.error='';
  });
  if((action==='social-report-send' || action==='social-delete-confirm') && d.post===p.id){
    var deleting=action==='social-delete-confirm',modalCard=$('#modal .modal-card');
    if(modalCard)modalCard.querySelectorAll('button').forEach(function(b){b.disabled=true;});
    runSocialWrite(p,deleting?'delete':'report',{target_id:d.id,body:deleting?'':d.reason},function(){
      if(!currentSocial(p))return;if(modalCard && modalCard.isConnected)closeModal();p.error='';
      if(deleting){var c=p.rows.find(function(x){return x.id===d.id;});if(c){c.deleted=true;c.body='';c.name='';c.user_id=null;}if(p.reply && p.reply.id===d.id)p.reply=null;}
      toast(socialText(deleting?'评论已删除':'举报已提交',deleting?'Comment deleted':'Report submitted'));
    }).then(function(){if(modalCard && modalCard.isConnected)modalCard.querySelectorAll('button').forEach(function(b){b.disabled=false;});});
  }
  return true;
}
document.addEventListener('input',function(e){if(e.target.id==='social-body'){e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';}if(e.target.id==='social-body' && socialPanel){var d=socialDrafts.get(socialPanel.key)||{};d.text=e.target.value;socialDrafts.set(socialPanel.key,d);}});
store.onAuthChange(function(){socialEpoch++;socialPanel=null;socialDrafts.clear();socialWrites.clear();});
