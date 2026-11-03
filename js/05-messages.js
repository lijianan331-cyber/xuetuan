/* Private text conversations. All authorization and stranger/block rules are rechecked by the server. */
'use strict';
var dmPanel=null,dmDrafts=new Map(),dmWrites=new Set(),dmUnread=0,dmLastBadge=0,dmBadgeBusy=false,dmIdentityEpoch=0,dmSDKUser;
var activityUnread={likes:0,comments:0},dmBadgeAgain=false;
store.activityRead=function(kind,cursor){return socialRPC('xuetuan_activity_inbox',{kind:kind,before_seq:cursor==null?null:cursor});};
store.activitySeen=function(kind,seq,id){return socialRPC('xuetuan_activity_seen',{kind:kind,through_seq:seq,visit_id:id||null});};
function activityKind(p){return p&&(p.kind==='likes'||p.kind==='comments');}
function activityReady(){return store.mode==='remote'&&store.signedIn()&&(dmSDKUser===undefined||dmSDKUser===me().id);}
function activityCounts(d){activityUnread={likes:Number(d.likes)||0,comments:Number(d.comments)||0};dmPaintBadge();}
function messageTotal(){return dmUnread+activityUnread.likes+activityUnread.comments;}
function messageTabs(p){return '<nav class="message-tabs" aria-label="'+esc(dmText('消息分类','Message categories'))+'">'+[['likes',dmText('点赞','Likes'),activityUnread.likes],['comments',dmText('评论','Comments'),activityUnread.comments],['inbox',dmText('私信','Chats'),dmUnread]].map(function(x){return '<button type="button" data-action="dm-tab" data-kind="'+x[0]+'" aria-pressed="'+(p.kind===x[0])+'">'+esc(x[1])+(x[2]?'<span class="message-count">'+esc(x[2]>99?'99+':String(x[2]))+'</span>':'')+'</button>';}).join('')+'</nav>';}
function activityHTML(p){
 var h='<div class="activity-tools"><button type="button" class="link-btn" data-action="dm-refresh"'+(p.loading?' disabled':'')+'>'+esc(dmText('刷新','Refresh'))+'</button><button type="button" class="link-btn" data-action="dm-activity-clear"'+(!p.data||p.loading||p.marking?' disabled':'')+'>'+esc(dmText('全部已读','Mark all read'))+'</button></div><ul class="dm-conversations activity-list">';
 h+=p.rows.map(function(r){var like=r.event_type==='like',label=like?dmText('这条分享收到 '+r.total+' 个赞','Your share received '+r.total+' likes'):(r.name||t('anon'))+dmText(r.event_type==='reply'?'回复了你':'评论了你的分享',r.event_type==='reply'?' replied to you':' commented on your share');return '<li><button type="button" class="dm-conversation" data-action="dm-activity-open" data-seq="'+esc(r.seq)+'" data-visit="'+esc(r.visit_id)+'"><span class="activity-symbol" aria-hidden="true">'+(like?socialHeart:dmIcon)+'</span><span><b>'+esc(label)+'</b>'+(!like?'<small class="activity-body">'+esc(r.body)+'</small>':'')+'<small>'+esc(r.title||dmText('分享','Share'))+'</small><time>'+esc(r.created_at?dmTime(r.created_at):dmText('以前收到的赞','Earlier likes'))+'</time></span>'+(!r.is_read?'<i class="dm-unread" aria-label="'+esc(dmText('未读','Unread'))+'"></i>':'')+'</button></li>';}).join('')+'</ul>';
 if(p.data&&!p.rows.length)h+='<p class="f-hint">'+esc(dmText(p.kind==='likes'?'还没有点赞提醒。':'还没有评论或回复提醒。',p.kind==='likes'?'No likes yet.':'No comments or replies yet.'))+'</p>';
 if(p.more)h+='<button type="button" class="btn small" data-action="dm-more"'+(p.loading?' disabled':'')+'>'+esc(dmText('更多提醒','More notifications'))+'</button>';
 return h;
}
function activityMark(all,row){
 var p=dmPanel;if(!p||!activityKind(p)||!dmCurrent(p)||!p.data||p.marking||p.loading)return;
 var seq=all?p.data.watermark:row.seq;p.marking=true;p.error='';dmPaint();
 return store.activitySeen(p.kind,seq,all?null:row.visit_id).then(function(result){
  if(!dmCurrent(p))return;
  p.rows.forEach(function(r){if(r.seq<=seq&&(all||(r.visit_id===row.visit_id&&(p.kind==='likes'||r.seq===seq))))r.is_read=true;});
  dmRefreshBadge(true);
  if(!all){
   if(!result.available){toast(dmText('这条分享已不可用，请刷新列表。','This share is unavailable. Refresh the list.'));return;}
   return (!store.review(row.visit_id)&&store.refresh?store.refresh(function(){return dmCurrent(p);}):Promise.resolve()).then(function(){if(!dmCurrent(p))return;if(store.review(row.visit_id))openPost(row.visit_id);else toast(dmText('这条分享已不可用，请刷新列表。','This share is unavailable. Refresh the list.'));});
  }
 }).catch(function(e){if(dmCurrent(p))p.error=dmError(e);}).then(function(){p.marking=false;dmPaint();});
}
var dmIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-6 3V6a2 2 0 0 1 1-2Z"/><path d="M8 9h8M8 13h5"/></svg>';
function dmText(zh,en){return state.lang==='en'?en:zh;}
store.dmRead=function(kind,id,cursor){return socialRPC('xuetuan_dm_read',{kind:kind,thread_id:id||null,before_seq:cursor==null?null:cursor});};
store.dmWrite=function(action,args){return socialRPC('xuetuan_dm_write',Object.assign({action:action},args||{}));};
store.dmModeration=function(id,decision){return socialRPC('xuetuan_dm_moderation',{report_id:id||null,decision:decision||null});};
store.feedbackRead=function(kind,id,cursor){return socialRPC('xuetuan_feedback_read',{kind:kind,thread_id:id||null,before_seq:cursor==null?null:cursor});};
store.feedbackWrite=function(action,args){args=args||{};return socialRPC('xuetuan_feedback_write',{action:action,body:args.body||'',request_id:args.request_id||null,seen_seq:args.seen_seq==null?null:args.seen_seq});};
function openFeedback(){if(!requireLogin(openFeedback))return;if(isModerator()){openMessages();return;}dmNavigate('feedback',{feedback:true,name:dmText('意见反馈','Feedback')});}
function dmBound(){return store.mode==='remote' && store.signedIn() && !isGuest() && (dmSDKUser===undefined||dmSDKUser===me().id);}
function dmAuth(){
 if(dmBound())return true;
 openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(dmText('登录后使用私信','Sign in for messages'))+'</h3><p class="f-hint">'+esc(dmText('私信需要登录或绑定谷歌。个人记录和收藏仍可匿名保存。','Sign in or link Google to use private messages.'))+'</p><div class="btn-row"><button type="button" class="btn primary" data-action="'+(isGuest()?'link-google':'login-google')+'">'+esc(dmText(isGuest()?'绑定谷歌':'谷歌登录',isGuest()?'Link Google':'Sign in with Google'))+'</button><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div></div>');return false;
}
function dmError(e){
 var s=String(e&&e.message||e||'');
 if(/XUETUAN_DM_CLOSED/.test(s))return dmText('暂时不能向对方发送私信。','You cannot message this person right now.');
 if(/XUETUAN_DM_WAIT/.test(s))return dmText('先等对方接受私信申请，再继续聊天。','Wait for this request to be accepted.');
 if(/XUETUAN_DM_UNAVAILABLE/.test(s))return dmText('会话不存在或无权查看。','Conversation unavailable.');
 if(/XUETUAN_BIND_REQUIRED/.test(s))return dmText('请先登录或绑定谷歌。','Sign in or link Google first.');
 if(/PGRST202|schema cache|no such function/.test(s))return dmText('私信功能尚未启用，请稍后重试。','Messages are not enabled yet.');
 if(/XUETUAN_/.test(s))return securitySaveError(e);
 return dmText('暂时未能完成，请重试；未发送文字仍保留。','Could not finish. Retry; unsent text is kept.');
}
function dmBadgeHTML(){var n=messageTotal();return '<span class="dm-badge" data-dm-badge'+(n?'':' hidden')+'>'+esc(n>99?'99+':String(n))+'</span>';}
function dmPaintBadge(){var n=messageTotal();document.querySelectorAll('[data-dm-badge]').forEach(function(el){el.hidden=!n;el.textContent=n>99?'99+':String(n);});}
function dmCurrent(p){return dmPanel===p && p.owner===me().id && p.epoch===dmIdentityEpoch && state.view==='messages';}
function dmOrigin(){return dmPanel&&state.view==='messages'?dmPanel.origin:{view:state.view,tab:state.tab};}
function dmNavigate(kind,opts){
 var origin=dmOrigin();dmPanel=Object.assign({kind:kind,owner:me().id,epoch:dmIdentityEpoch,origin:origin,rows:[],data:null,loading:false,error:'',more:false},opts||{});
 if(kind==='inbox'&&!dmBound())dmPanel.feedback=true;
 state.view='messages';render();setSnap('page');dmLoad(false);
}
function openMessages(peer,name){if(peer){if(!dmAuth()||peer===me().id)return;}else if(!requireLogin(function(){openMessages();}))return;dmNavigate(peer?'compose':dmBound()?'inbox':'comments',{peer:peer||null,name:name||''});dmRefreshBadge(true);}
function dmBack(){
 if(!dmPanel){goFeed();return;}
 if(dmPanel.kind!=='inbox'&&!activityKind(dmPanel)){dmNavigate('inbox');return;}
 var origin=dmPanel.origin;dmPanel=null;
 if(origin&&origin.view==='person'&&state.person){state.view='person';render();setSnap('half');return;}
 state.tab=origin&&origin.tab||'me';state.scope=scopeOfTab(state.tab);goFeed();
}
function dmDraftKey(p){return p.owner+':'+(p.feedback?'feedback':p.thread||'peer:'+p.peer);}
function dmDraft(p){var k=dmDraftKey(p),d=dmDrafts.get(k);if(!d){d={text:''};dmDrafts.set(k,d);}return d;}
function dmBusy(p){return dmWrites.has(p.owner);}
function dmTime(ts){var d=new Date(ts);return isNaN(+d)?'':d.toLocaleString(state.lang==='en'?'en-GB':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function dmMessageHTML(m,p){
 var own=m.sender===p.owner;
 return '<li class="dm-message'+(own?' mine':'')+'"><div class="dm-bubble"><p>'+esc(m.removed?dmText('这条消息已被管理员移除','This message was removed by a moderator.'):m.body)+'</p><div class="dm-message-meta"><time>'+esc(dmTime(m.created_at))+'</time>'+(!own&&!m.removed&&!p.feedback?'<button type="button" class="dm-report" data-action="dm-report" data-id="'+esc(m.id)+'" aria-label="'+esc(dmText('举报这条消息','Report this message'))+'">⋯</button>':'')+'</div></div></li>';
}
function renderMessages(){
 var p=dmPanel;if(!p||!(activityKind(p)||p.feedback?activityReady():dmBound())||p.owner!==me().id){view.innerHTML='<p class="f-hint">'+esc(dmText('请先登录后查看消息。','Sign in to view messages.'))+'</p>';return;}
 var old=$('#dm-timeline'),oldTop=old?old.scrollTop:0,oldHeight=old?old.scrollHeight:0,atEnd=!old||old.scrollHeight-old.scrollTop-old.clientHeight<70;
 var active=document.activeElement,focus=active&&active.id==='dm-body',start=focus?active.selectionStart:0,end=focus?active.selectionEnd:0;
 var data=p.data||{},busy=dmBusy(p),h='<div class="dm-screen"><div class="view-top dm-top"><button type="button" class="icon-btn flat" data-action="back" aria-label="'+esc(t('back'))+'">'+ICON.back+'</button><h2 class="view-title">'+esc(p.kind==='feedback'?dmText('意见反馈','Feedback'):p.kind==='thread'||p.kind==='compose'?p.name||dmText('私信','Messages'):p.kind==='settings'?dmText('私信设置','Message settings'):p.kind==='reports'?dmText('私信举报','Message reports'):dmText('消息','Messages'))+'</h2>'+
  (p.kind==='inbox'&&dmBound()?'<button type="button" class="btn small ghost" data-action="dm-settings">'+esc(dmText('设置','Settings'))+'</button>':p.kind==='thread'&&!p.feedback?'<button type="button" class="btn small ghost" data-action="dm-block-dialog">'+esc(data.blocked?dmText('解除拉黑','Unblock'):dmText('拉黑','Block'))+'</button>':'')+'</div>';
 if(p.kind==='inbox'||activityKind(p))h+=messageTabs(p);
 if(p.error)h+='<p class="dm-status" role="status">'+esc(p.error)+' <button type="button" class="link-btn" data-action="dm-refresh">'+esc(dmText('重试','Retry'))+'</button></p>';
 if(p.loading&&!p.data)h+='<p class="f-hint" role="status">'+esc(dmText('正在加载…','Loading…'))+'</p>';
 if(activityKind(p))h+=activityHTML(p);
 else if(p.kind==='inbox'){
  h+='<p class="f-hint">'+esc(p.feedback?dmText('游客可在这里查看意见反馈与回复。与同学私信需登录。','Guests can read feedback replies here. Sign in to message classmates.'):dmText('陌生人先发一条申请，接受后才能继续聊。','A new person may send one request. Accept it to continue.'))+'</p>'+(p.feedback?'<button type="button" class="btn small" data-action="dm-feedback">'+esc(dmText('写反馈','Send feedback'))+'</button>':'')+'<button type="button" class="link-btn dm-refresh" data-action="dm-refresh"'+(p.loading?' disabled':'')+'>'+esc(dmText('刷新','Refresh'))+'</button><ul class="dm-conversations">'+p.rows.map(function(c){return '<li><button type="button" class="dm-conversation" data-action="dm-thread" data-id="'+esc(c.id)+'" data-peer="'+esc(c.peer)+'" data-name="'+esc(c.name||t('anon'))+'">'+avatarHTML(c.name||'?',c.peer)+'<span><b>'+esc(c.name||t('anon'))+'</b><small>'+esc(c.status==='pending'?(c.incoming?dmText('私信申请 · ','Request · '):dmText('等待接受 · ','Awaiting acceptance · ')):c.status==='declined'?dmText('申请已拒绝 · ','Declined · '):'')+esc(c.preview||dmText('消息已移除','Message removed'))+'</small></span>'+(c.unread?'<i class="dm-unread" aria-label="'+esc(dmText('未读','Unread'))+'"></i>':'')+'</button></li>';}).join('')+'</ul>';
  if(p.data&&!p.rows.length)h+='<p class="f-hint">'+esc(p.feedback?dmText('还没有反馈会话。点“写反馈”提交建议，回复会留在这里。','No feedback yet. Send feedback; replies will appear here.'):dmText('还没有私信。可以从同学的公开主页发起申请。','No messages yet. Start from a classmate’s public profile.'))+'</p>';
  if(p.more)h+='<button type="button" class="btn small" data-action="dm-more"'+(p.loading?' disabled':'')+'>'+esc(dmText('更多会话','More conversations'))+'</button>';
 }else if(p.kind==='settings'){
  if(p.data)h+='<button type="button" class="switch-row" role="switch" data-action="dm-preference" aria-checked="'+!data.allow_requests+'"'+(busy?' disabled':'')+'><span class="sw-text"><b>'+esc(dmText('拒绝陌生人私信','Refuse new message requests'))+'</b><small>'+esc(dmText('开启后不接收新申请，已接受的会话仍可继续。','When enabled, only already accepted conversations may continue.'))+'</small></span><span class="switch" aria-hidden="true"></span></button><h3 class="sec-title">'+esc(dmText('已拉黑','Blocked people'))+'</h3><ul class="dm-conversations">'+(data.blocks||[]).map(function(b){return '<li class="dm-block-row"><b>'+esc(b.name||t('anon'))+'</b><button type="button" class="btn small" data-action="dm-unblock" data-peer="'+esc(b.id)+'"'+(busy?' disabled':'')+'>'+esc(dmText('解除拉黑','Unblock'))+'</button></li>';}).join('')+'</ul>'+(!(data.blocks||[]).length?'<p class="f-hint">'+esc(dmText('没有拉黑的用户。','No blocked people.'))+'</p>':'');
 }else if(p.kind==='reports'){
  h+='<p class="f-hint">'+esc(dmText('这里只展示用户主动举报的单条消息，不开放完整会话。','Only individually reported messages are shown, never the full private conversation.'))+'</p><ul class="dm-conversations">'+p.rows.map(function(r){return '<li class="dm-reported"><b>'+esc(r.name||t('anon'))+'</b><p>'+esc(r.body)+'</p><small>'+esc(dmReason(r.reason))+'</small><button type="button" class="btn small" data-action="dm-moderate-dialog" data-id="'+esc(r.id)+'">'+esc(dmText('处理','Review'))+'</button></li>';}).join('')+'</ul>'+(p.data&&!p.rows.length?'<p class="f-hint">'+esc(dmText('暂无待处理举报。','No reports to review.'))+'</p>':'');
 }else{
  if(p.kind==='feedback')h+='<p class="dm-notice">'+esc(dmText('建议或遇到的问题都可以写在这里，直接发给雪团主理人。回复会出现在“消息 → 私信”；游客请保留当前浏览器，绑定账号后可换设备查看。','Send suggestions or issues directly to XueTuan’s owner. Replies appear in Messages → Chats. Guests should keep this browser or link an account for other devices.'))+'</p>';
  if(p.kind==='compose'&&p.data)h+='<p class="dm-notice">'+esc(data.can_request?dmText('先发一条自我介绍。对方接受后，才能继续聊天。','Send one introduction first. Wait for acceptance before sending more.'):dmText('对方暂不接收新私信申请。','This person is not accepting new requests.'))+'</p>';
  else if(data.status==='pending')h+='<div class="dm-notice">'+esc(data.incoming?dmText('对方想和你聊天。接受后双方才能继续发消息。','This person wants to chat. Accept to continue.'):dmText('申请已发出，等待对方接受。','Request sent. Awaiting acceptance.'))+(data.incoming?'<div class="btn-row"><button type="button" class="btn primary small" data-action="dm-accept"'+(busy?' disabled':'')+'>'+esc(dmText('接受','Accept'))+'</button><button type="button" class="btn small" data-action="dm-decline"'+(busy?' disabled':'')+'>'+esc(dmText('拒绝','Decline'))+'</button></div>':'')+'</div>';
  else if(data.status==='declined')h+='<p class="dm-notice">'+esc(dmText('这条私信申请已拒绝，不能继续发送。','This request was declined.'))+'</p>';
  if(data.blocked)h+='<p class="dm-notice">'+esc(dmText('你已拉黑对方，双方不能继续发送消息。','You blocked this person. Neither side can send messages.'))+'</p>';
  h+='<div id="dm-timeline" class="dm-timeline">'+(p.more?'<button type="button" class="link-btn" data-action="dm-more"'+(p.loading?' disabled':'')+'>'+esc(dmText('更早的消息','Older messages'))+'</button>':'')+'<ul class="dm-messages">'+p.rows.map(function(m){return dmMessageHTML(m,p);}).join('')+'</ul></div>';
  var canSend=p.kind==='compose'?data.can_request:data.can_send;
  h+='<div class="dm-compose"><label class="social-input-label" for="dm-body">'+esc(dmText(p.feedback?'反馈内容':'私信内容',p.feedback?'Feedback':'Private message'))+'</label><textarea id="dm-body" class="input" rows="2" maxlength="'+(p.feedback?'980':'1000')+'" placeholder="'+esc(p.feedback?dmText('写下建议或问题…','Write a suggestion or issue…'):dmText('写私信…','Write a message…'))+'"'+(busy?' disabled':'')+'>'+esc(dmDraft(p).text)+'</textarea><button type="button" class="btn primary" data-action="dm-send"'+(!canSend||busy||!p.data?' disabled':'')+'>'+esc(busy?dmText('发送中…','Sending…'):dmText('发送','Send'))+'</button></div>';
 }
 view.innerHTML=h+'</div>';
 var timeline=$('#dm-timeline');if(timeline){if(p.prepend){timeline.scrollTop=oldTop+timeline.scrollHeight-oldHeight;p.prepend=false;}else timeline.scrollTop=atEnd?timeline.scrollHeight:oldTop;}
 if(focus&&!busy&&$('#dm-body')){$('#dm-body').focus({preventScroll:true});$('#dm-body').setSelectionRange(start,end);}
}
function dmPaint(){if(dmPanel&&dmCurrent(dmPanel))renderMessages();}
function dmLoad(more){
 var p=dmPanel;if(!p||!dmCurrent(p)||p.loading||p.marking||dmBusy(p))return Promise.resolve();
 p.loading=true;p.error='';dmPaint();var cursor=null;
 if(more&&p.rows.length)cursor=p.kind==='inbox'?p.rows[p.rows.length-1].last_seq:activityKind(p)?p.rows[p.rows.length-1].seq:p.rows[0].seq;
 var request=activityKind(p)?store.activityRead(p.kind,cursor):p.feedback?store.feedbackRead(p.kind,p.thread,cursor):p.kind==='reports'?store.dmModeration():store.dmRead(p.kind==='compose'?'peer':p.kind,p.kind==='compose'?p.peer:p.thread,cursor);
 return request.then(function(d){
  if(!dmCurrent(p))return;
  if(p.kind==='compose'&&d.thread_id){dmNavigate('thread',{thread:d.thread_id,peer:p.peer,name:d.name||p.name});return;}
  var previousMore=p.more;p.data=d;p.lastLoad=Date.now();p.more=!!d.has_more;
  if(activityKind(p)){
   var keys=new Set(more?p.rows.map(function(r){return p.kind==='likes'?r.visit_id:r.seq;}):[]);
   p.rows=(more?p.rows:[]).concat((d.rows||[]).filter(function(r){var k=p.kind==='likes'?r.visit_id:r.seq;if(keys.has(k))return false;keys.add(k);return true;}));activityCounts(d);
  }else if(p.kind==='thread'||p.kind==='feedback'){
   if(p.feedback&&d.thread_id)p.thread=d.thread_id;
   p.name=d.name||p.name;p.peer=d.peer;var seen=new Set(more?p.rows.map(function(m){return m.id;}):[]);
   var fresh=(d.messages||[]).filter(function(m){if(seen.has(m.id))return false;seen.add(m.id);return true;});
   var overlap=fresh.some(function(m){return p.rows.some(function(old){return old.id===m.id;});});
   var older=!more&&fresh.length&&overlap?p.rows.filter(function(m){return m.seq<fresh[0].seq;}):[];
   p.rows=more?fresh.concat(p.rows):older.concat(fresh);if(older.length)p.more=previousMore;p.prepend=!!more;
   if(!document.hidden){var last=p.rows.length?p.rows[p.rows.length-1].seq:0;if(last>(d.read_seq||0)){(p.feedback?store.feedbackWrite:store.dmWrite)('read',{thread_id:p.thread,seen_seq:last}).then(function(){if(dmCurrent(p))p.data.read_seq=last;dmRefreshBadge(true);},function(){});}}
  }else if(p.kind==='inbox'){
   var ids=new Set(more?p.rows.map(function(c){return c.id;}):[]);p.rows=(more?p.rows:[]).concat((d.threads||[]).filter(function(c){if(ids.has(c.id))return false;ids.add(c.id);return true;}));dmUnread=d.unread||0;dmPaintBadge();
  }else if(p.kind==='reports')p.rows=d||[];
 },function(e){if(dmCurrent(p))p.error=dmError(e);}).then(function(){p.loading=false;dmPaint();});
}
function dmRun(op,args,done){
 var p=dmPanel;if(!p||!dmCurrent(p)||dmBusy(p))return Promise.resolve(false);
 var owner=p.owner,epoch=p.epoch;dmWrites.add(owner);p.error='';dmPaint();
 return Promise.resolve().then(function(){return (p.feedback?store.feedbackWrite:store.dmWrite)(op,args);}).then(function(r){
  if(owner!==me().id||epoch!==dmIdentityEpoch)return false;
  if(done)done(r,p);return true;
 }).catch(function(e){if(dmCurrent(p)){p.error=dmError(e);toast(p.error);}return false;}).then(function(ok){if(epoch===dmIdentityEpoch)dmWrites.delete(owner);dmPaint();return ok;});
}
function dmSend(){
 var p=dmPanel;if(!p||!dmCurrent(p)||dmBusy(p)||!p.data)return;
 var d=dmDraft(p),body=d.text.trim();if(!body){$('#dm-body').focus();return;}
 if(body.length>1000)return;
 var signature=JSON.stringify([body,p.thread,p.peer]);if(d.signature!==signature){d.signature=signature;d.request=socialRequestId();}
 var key=dmDraftKey(p);
 dmRun('send',{thread_id:p.thread||null,peer_id:p.kind==='compose'?p.peer:null,body:body,request_id:d.request},function(r){
  if(dmDrafts.get(key)===d)dmDrafts.delete(key);
  if(dmCurrent(p)){
   if(p.kind==='compose'||p.kind==='feedback')dmNavigate('thread',{thread:r.thread_id,peer:p.peer,name:p.name,feedback:!!p.feedback});
   else p.lastLoad=0;
  }
 }).then(function(ok){if(ok){if(dmCurrent(p))dmLoad(false);else if(dmPanel&&dmCurrent(dmPanel))dmLoad(false);dmRefreshBadge(true);}});
}
function dmReason(v){return ({spam:dmText('广告刷屏','Spam'),abuse:dmText('辱骂或骚扰','Abuse'),privacy:dmText('泄露隐私','Privacy'),other:dmText('其他不当内容','Other')})[v]||v;}
function dmReportDialog(id){
 var p=dmPanel;if(!p||!dmCurrent(p))return;
 openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(dmText('举报这条私信','Report this message'))+'</h3><p class="f-hint">'+esc(dmText('只把选中的这条消息交给管理员，不提交完整会话。','Only this selected message is shared with moderators, not the whole conversation.'))+'</p><div class="social-report-reasons">'+['spam','abuse','privacy','other'].map(function(r){return '<button type="button" class="btn" data-action="dm-report-send" data-id="'+esc(id)+'" data-reason="'+r+'" data-thread="'+esc(p.thread)+'">'+esc(dmReason(r))+'</button>';}).join('')+'</div><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div>');
}
function dmBlockDialog(){
 var p=dmPanel;if(!p||!p.data||!dmCurrent(p))return;
 if(p.data.blocked){dmRun('unblock',{peer_id:p.peer}).then(function(ok){if(ok&&dmCurrent(p))dmLoad(false);});return;}
 openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(dmText('拉黑这位用户？','Block this person?'))+'</h3><p class="f-hint">'+esc(dmText('双方将无法继续发送私信，已有消息保留。你可以在私信设置中解除。','Neither side can send more messages. History stays; unblock in message settings.'))+'</p><div class="btn-row"><button type="button" class="btn danger" data-action="dm-block-confirm" data-peer="'+esc(p.peer)+'">'+esc(dmText('拉黑','Block'))+'</button><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div></div>');
}
function dmModerateDialog(id){
 if(!isModerator())return;
 openModal('<div class="modal-card" role="dialog" aria-modal="true"><h3>'+esc(dmText('处理私信举报','Review reported message'))+'</h3><div class="social-report-reasons">'+[['dismiss',dmText('忽略举报','Dismiss')],['remove',dmText('移除这条消息','Remove message')],['remove_and_ban',dmText('移除并封禁作者','Remove and ban sender')]].map(function(x){return '<button type="button" class="btn" data-action="dm-moderate" data-id="'+esc(id)+'" data-decision="'+x[0]+'">'+esc(x[1])+'</button>';}).join('')+'</div><button type="button" class="btn ghost" data-modal="no">'+esc(t('cancel'))+'</button></div>');
}
function handleDMAction(a,el){
 if(a.indexOf('dm-')!==0)return false;
 var d=el.dataset,p=dmPanel;
 if(a==='dm-open'){openMessages(d.peer,d.name);return true;}
 if(a==='dm-feedback'){openFeedback();return true;}
 if(a==='dm-reports'){if(isModerator())dmNavigate('reports');return true;}
 if(!p||!dmCurrent(p))return true;
 if(a==='dm-tab'){if(['likes','comments','inbox'].indexOf(d.kind)<0)return true;dmNavigate(d.kind);return true;}
 if(a==='dm-activity-clear'){activityMark(true);return true;}
 if(a==='dm-activity-open'){var row=p.rows.find(function(r){return String(r.seq)===d.seq&&r.visit_id===d.visit;});if(row)activityMark(false,row);return true;}
 if(a==='dm-settings'){if(dmAuth())dmNavigate('settings');return true;}
 if(a==='dm-thread'){dmNavigate('thread',{thread:d.id,peer:d.peer,name:d.name,feedback:!dmBound()});return true;}
 if(a==='dm-refresh'||a==='dm-more'){dmLoad(a==='dm-more');return true;}
 if(a==='dm-send'){dmSend();return true;}
 if(a==='dm-report'){dmReportDialog(d.id);return true;}
 if(a==='dm-block-dialog'){dmBlockDialog();return true;}
 if(a==='dm-moderate-dialog'){dmModerateDialog(d.id);return true;}
 if(dmBusy(p))return true;
 if(a==='dm-preference')dmRun('prefs',{allow_requests:!p.data.allow_requests}).then(function(ok){if(ok&&dmCurrent(p))dmLoad(false);});
 if(a==='dm-accept'||a==='dm-decline')dmRun(a==='dm-accept'?'accept':'decline',{thread_id:p.thread}).then(function(ok){if(ok&&dmCurrent(p))dmLoad(false);});
 if(a==='dm-unblock')dmRun('unblock',{peer_id:d.peer}).then(function(ok){if(ok&&dmCurrent(p))dmLoad(false);});
 var dialog=el.closest('.modal-card');
 function closeOwnDialog(){if(dmCurrent(p)&&dialog&&dialog.isConnected)closeModal();}
 if(a==='dm-block-confirm')dmRun('block',{peer_id:d.peer},closeOwnDialog).then(function(ok){if(ok&&dmCurrent(p))dmLoad(false);});
 if(a==='dm-report-send'&&d.thread===p.thread)dmRun('report',{thread_id:p.thread,message_id:d.id,body:d.reason},function(){closeOwnDialog();if(dmCurrent(p))toast(dmText('举报已提交','Report submitted'));});
 if(a==='dm-moderate'&&isModerator()){
  dmWrites.add(p.owner);document.querySelectorAll('#modal button').forEach(function(b){b.disabled=true;});
  store.dmModeration(d.id,d.decision).then(function(){if(dmCurrent(p)){closeOwnDialog();p.lastLoad=0;}},function(e){if(dmCurrent(p)){toast(dmError(e));if(dialog&&dialog.isConnected)dialog.querySelectorAll('button').forEach(function(b){b.disabled=false;});}}).then(function(){if(p.epoch===dmIdentityEpoch)dmWrites.delete(p.owner);if(dmCurrent(p))dmLoad(false);});
 }
 return true;
}
function dmRefreshBadge(force){
 if(dmBadgeBusy){if(force)dmBadgeAgain=true;return Promise.resolve();}
 if(!activityReady()||dmBadgeBusy||document.hidden||(!force&&Date.now()-dmLastBadge<60000))return Promise.resolve();
 var owner=me().id,epoch=dmIdentityEpoch;dmLastBadge=Date.now();dmBadgeBusy=true;
 return Promise.allSettled([store.activityRead('summary'),dmBound()?store.dmRead('inbox'):store.feedbackRead('inbox')]).then(function(results){if(me().id===owner&&epoch===dmIdentityEpoch){if(results[0].status==='fulfilled'&&results[0].value)activityCounts(results[0].value);if(results[1].status==='fulfilled'&&results[1].value)dmUnread=results[1].value.unread||0;dmPaintBadge();if(dmPanel&&dmCurrent(dmPanel))dmPaint();}}).then(function(){if(epoch===dmIdentityEpoch){dmBadgeBusy=false;if(dmBadgeAgain){dmBadgeAgain=false;return dmRefreshBadge(true);}}});
}
document.addEventListener('input',function(e){if(e.target.id==='dm-body'&&dmPanel&&dmCurrent(dmPanel))dmDraft(dmPanel).text=e.target.value;});
document.addEventListener('visibilitychange',function(){if(!document.hidden){if(dmPanel&&dmCurrent(dmPanel))dmLoad(false);dmRefreshBadge(true);}});
function dmForgetIdentity(){dmIdentityEpoch++;dmPanel=null;dmDrafts.clear();dmWrites.clear();dmUnread=0;activityUnread={likes:0,comments:0};dmLastBadge=0;dmBadgeBusy=false;dmBadgeAgain=false;dmPaintBadge();}
/* The store announces auth changes after profile loading. Hide private content immediately,
   even when that later load is slow or fails. Never call Supabase inside its auth callback. */
if(sbClient&&store.mode==='remote')sbClient.auth.onAuthStateChange(function(event,session){
 dmSDKUser=session&&session.user?session.user.id:null;
 if((dmPanel&&dmPanel.owner!==dmSDKUser)||(!dmPanel&&dmSDKUser!==me().id)){dmForgetIdentity();if(state.view==='messages')view.innerHTML='<p class="f-hint">'+esc(dmText('登录状态已变更，请重新打开消息。','Account changed. Reopen messages.'))+'</p>';}
});
store.onAuthChange(function(){dmForgetIdentity();if(state.view==='messages')goFeed();dmRefreshBadge(true);});
setInterval(function(){
 if(document.hidden||!activityReady())return;
 var p=dmPanel;if(p&&dmCurrent(p)&&Date.now()-(p.lastLoad||0)>(p.kind==='thread'?5000:15000))dmLoad(false);
 else dmRefreshBadge(false);
},5000);
