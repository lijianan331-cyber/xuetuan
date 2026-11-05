/* Feedback fixture shares the synthetic DM inbox; never routes to real accounts. */
(function(){
 const owner='aaaaaaaa-0000-4000-8000-000000000001',db=window.__dm,f=window.__feedback={};
 function gate(op,fn){const user=me().id;if(f.fail===op)return Promise.reject(Error('offline'));if(f.hold===op)return new Promise(resolve=>{f.release=()=>resolve(fn(user));});return Promise.resolve().then(()=>fn(user));}
 const thread=u=>db.threads.find(t=>[t.lo,t.hi].includes(u)&&[t.lo,t.hi].includes(owner));
 store.feedbackRead=(kind,id,before)=>gate('read',u=>{
  const t=thread(u),rows=t?db.messages.filter(m=>m.thread===t.id&&(!before||m.seq<before)):[];
  if(kind==='thread'&&(!t||id!==t.id))throw Error('XUETUAN_DM_UNAVAILABLE');
  const unread=!!t&&db.messages.some(m=>m.thread===t.id&&m.sender!==u&&m.seq>(t.read[u]||0));
  if(kind==='inbox')return {threads:t?[{id:t.id,peer:owner,name:'意见反馈 · 雪团',status:t.status,last_seq:t.last_seq,incoming:false,unread,preview:rows.at(-1).body}]:[],unread:unread?1:0,has_more:false};
  return {messages:rows.slice(-30),has_more:rows.length>30,thread_id:t&&t.id,peer:owner,name:'意见反馈 · 雪团',status:'accepted',can_send:true,read_seq:t&&t.read[u]||0};
 });
 store.feedbackWrite=(op,a)=>gate(op,u=>{
  let t=thread(u);
  if(op==='read'){if(t)t.read[u]=Math.max(t.read[u]||0,Math.min(a.seen_seq,t.last_seq));return {ok:true};}
  const old=db.messages.find(m=>m.id===a.request_id);if(old)return {thread_id:old.thread,message_id:old.id};
  if(!t){t={id:crypto.randomUUID(),lo:u,hi:owner,initiator:u,status:'accepted',last_seq:0,read:{}};db.threads.push(t);}
  const m={id:a.request_id,thread:t.id,sender:u,body:'[意见反馈] '+a.body,seq:++db.seq,created_at:new Date().toISOString()};db.messages.push(m);t.last_seq=m.seq;t.read[u]=m.seq;
  return {thread_id:t.id,message_id:m.id};
 });
})();
