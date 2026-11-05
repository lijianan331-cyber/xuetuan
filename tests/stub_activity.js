/* Synthetic notification fixture; row security and triggers tested by PostgreSQL separately. */
(function(){
 const db=window.__activity={rows:[],calls:[]};
 function visible(user){return db.rows.filter(r=>r.recipient===user&&!r.hidden);}
 function gate(op,fn){const user=me().id;db.calls.push({op,user});if(db.fail===op)return Promise.reject(Error('offline'));if(db.hold===op)return new Promise(resolve=>{db.release=()=>resolve(fn(user));});return Promise.resolve().then(()=>fn(user));}
 store.activityRead=(kind,before)=>gate(kind,user=>{
  const all=visible(user),likes=all.filter(r=>r.event_type==='like'&&!r.is_read).length,comments=all.filter(r=>r.event_type!=='like'&&!r.is_read).length;
  const rows=all.filter(r=>(kind==='likes'?r.event_type==='like':r.event_type!=='like')&&(!before||r.seq<before)).sort((a,b)=>b.seq-a.seq);
  return {likes,comments,watermark:Math.max(0,...all.map(r=>r.seq)),rows:rows.slice(0,30).map(r=>({...r})),has_more:rows.length>30};
 });
 store.activitySeen=(kind,seq,id)=>gate('seen',user=>{
  const rows=visible(user);rows.forEach(r=>{if(r.seq<=seq&&(kind==='likes'?r.event_type==='like':r.event_type!=='like')&&(!id||(r.visit_id===id&&(kind==='likes'||r.seq===seq))))r.is_read=true;});
  return {ok:true,available:!id||rows.some(r=>r.seq===seq&&r.visit_id===id)};
 });
})();
