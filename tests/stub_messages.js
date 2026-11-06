/* Synthetic DM fixture for browser interaction checks. SQL authorization is tested separately in PGlite. */
(function(){
 const db=window.__dm={threads:[],messages:[],prefs:{},blocks:[],reports:[],calls:[],seq:0};
 const name=id=>(window.__sb.db.profiles.find(p=>p.id===id)||{}).name||'合成用户';
 const peer=(t,u)=>t.lo===u?t.hi:t.lo;
 const blocked=(u,v)=>db.blocks.some(b=>(b[0]===u&&b[1]===v)||(b[0]===v&&b[1]===u));
 function gate(op,fn){
  const user=me().id;db.calls.push({op,user});
  if(db.fail===op)return Promise.reject(Error('network offline'));
  if(db.hold===op)return new Promise((resolve,reject)=>{db.release=()=>{try{resolve(fn(user));}catch(e){reject(e);}};});
  return Promise.resolve().then(()=>fn(user));
 }
 store.dmRead=(kind,id,before)=>gate(kind,u=>{
  if(!u)throw Error('XUETUAN_BIND_REQUIRED');
  const own=db.threads.filter(t=>[t.lo,t.hi].includes(u));
  if(kind==='peer'){const t=own.find(t=>peer(t,u)===id);return {thread_id:t&&t.id,name:name(id),can_request:db.prefs[id]!==false&&!blocked(u,id)};}
  if(kind==='settings')return {allow_requests:db.prefs[u]!==false,blocks:db.blocks.filter(b=>b[0]===u).map(b=>({id:b[1],name:name(b[1])}))};
  if(kind==='inbox'){
   const unread=t=>db.messages.some(m=>m.thread===t.id&&m.sender!==u&&m.seq>(t.read[u]||0));
   const rows=own.filter(t=>!before||t.last_seq<before).sort((a,b)=>b.last_seq-a.last_seq);
   return {unread:own.filter(unread).length,has_more:rows.length>50,threads:rows.slice(0,50).map(t=>({id:t.id,peer:peer(t,u),name:name(peer(t,u)),incoming:t.initiator!==u,status:t.status,last_seq:t.last_seq,unread:unread(t),preview:db.messages.filter(m=>m.thread===t.id).at(-1).body}))};
  }
  const t=own.find(t=>t.id===id);if(!t)throw Error('XUETUAN_DM_UNAVAILABLE');
  const rows=db.messages.filter(m=>m.thread===id&&(!before||m.seq<before)).sort((a,b)=>a.seq-b.seq);
  return {peer:peer(t,u),name:name(peer(t,u)),incoming:t.initiator!==u,status:t.status,read_seq:t.read[u]||0,blocked:db.blocks.some(b=>b[0]===u&&b[1]===peer(t,u)),can_send:t.status==='accepted'&&!blocked(u,peer(t,u)),messages:rows.slice(-30).map(m=>Object.assign({},m,{body:m.removed?'':m.body})),has_more:rows.length>30};
 });
 store.dmWrite=(op,a={})=>gate(op,u=>{
  if(op==='prefs'){db.prefs[u]=a.allow_requests;return {ok:true};}
  if(op==='block'){db.blocks.push([u,a.peer_id]);return {ok:true};}
  if(op==='unblock'){db.blocks=db.blocks.filter(b=>b[0]!==u||b[1]!==a.peer_id);return {ok:true};}
  let t=db.threads.find(t=>t.id===a.thread_id&&[t.lo,t.hi].includes(u));
  if(op==='send'){
   const existing=db.messages.find(m=>m.id===a.request_id);if(existing)return {thread_id:existing.thread,message_id:existing.id};
   if(!t)t=db.threads.find(t=>[t.lo,t.hi].includes(u)&&peer(t,u)===a.peer_id);
   if(!t){if(db.prefs[a.peer_id]===false||blocked(u,a.peer_id))throw Error('XUETUAN_DM_CLOSED');t={id:crypto.randomUUID(),lo:u,hi:a.peer_id,initiator:u,status:'pending',read:{},last_seq:0};db.threads.push(t);}
   if(blocked(u,peer(t,u)))throw Error('XUETUAN_DM_CLOSED');
   if(t.status!=='accepted'&&(t.initiator!==u||t.last_seq))throw Error('XUETUAN_DM_WAIT');
   const m={id:a.request_id,thread:t.id,sender:u,body:a.body,seq:++db.seq,created_at:new Date().toISOString()};db.messages.push(m);t.last_seq=m.seq;t.read[u]=m.seq;return {thread_id:t.id,message_id:m.id};
  }
  if(!t)throw Error('XUETUAN_DM_UNAVAILABLE');
  if(op==='read')t.read[u]=Math.max(t.read[u]||0,Math.min(a.seen_seq,t.last_seq));
  if(op==='accept'||op==='decline')t.status=op==='accept'?'accepted':'declined';
  if(op==='report'){const m=db.messages.find(m=>m.id===a.message_id&&m.thread===t.id);db.reports.push({id:crypto.randomUUID(),message:m.id,body:m.body,name:name(m.sender),reason:a.body});}
  return {ok:true};
 });
 store.dmModeration=(id,decision)=>gate('moderation',u=>{
  if(u!==window.__sbAdmin)throw Error('Admin required');
  if(!id)return db.reports.map(r=>({id:r.id,body:r.body,name:r.name,reason:r.reason}));
  const r=db.reports.find(r=>r.id===id);if(decision!=='dismiss')db.messages.find(m=>m.id===r.message).removed=true;db.reports=db.reports.filter(x=>x.id!==id);return {ok:true};
 });
})();
