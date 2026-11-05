-- A feedback-only guest channel into the verified owner's existing private inbox.
begin;
create function xuetuan_guard.feedback_owner() returns uuid language sql stable security definer set search_path='' as $$
 select u.id from auth.users u join xuetuan_guard.admins a on a.user_id=u.id
 where lower(u.email)='lijianan331@gmail.com' and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,true)
$$;
revoke all on function xuetuan_guard.feedback_owner() from public,anon,authenticated;
create function xuetuan_guard.feedback_read(kind text,t_id uuid,before_seq bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=xuetuan_guard.activity_user();owner_id uuid:=xuetuan_guard.feedback_owner();t xuetuan_guard.dm_threads;items jsonb;n integer;unread boolean;
begin
 if owner_id is null or actor=owner_id then raise exception 'XUETUAN_FEEDBACK_UNAVAILABLE';end if;
 if kind is null or kind not in('inbox','feedback','thread') then raise exception 'Invalid feedback view';end if;
 select * into t from xuetuan_guard.dm_threads where lo=least(actor,owner_id) and hi=greatest(actor,owner_id);
 unread:=exists(select 1 from xuetuan_guard.dm_messages m where m.thread_id=t.id and m.sender<>actor and m.seq>case when t.lo=actor then t.read_lo else t.read_hi end);
 if kind='inbox' then
  return jsonb_build_object('threads',case when t.id is null or (before_seq is not null and t.last_seq>=before_seq) then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id',t.id,'peer',owner_id,'name','意见反馈 · 雪团','status',t.status,'incoming',false,'last_seq',t.last_seq,'unread',unread,'preview',(select case when removed then '' else body end from xuetuan_guard.dm_messages where thread_id=t.id order by seq desc limit 1))) end,'unread',case when unread then 1 else 0 end,'has_more',false);
 end if;
 if kind='thread' and (t.id is null or t_id is distinct from t.id) then raise exception 'XUETUAN_DM_UNAVAILABLE';end if;
 with page as(select * from xuetuan_guard.dm_messages where thread_id=t.id and (before_seq is null or seq<before_seq) order by seq desc limit 31),numbered as(select *,row_number() over(order by seq desc) rn from page)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sender',sender,'body',case when removed then '' else body end,'seq',seq,'created_at',created_at,'removed',removed) order by seq) filter(where rn<=30),'[]'::jsonb),count(*) into items,n from numbered;
 return jsonb_build_object('messages',items,'has_more',n>30,'thread_id',t.id,'peer',owner_id,'name','意见反馈 · 雪团','status',coalesce(t.status,'accepted'),'incoming',false,'read_seq',case when t.lo=actor then t.read_lo else t.read_hi end,'blocked',exists(select 1 from xuetuan_guard.dm_blocks where user_id=actor and blocked_id=owner_id),'can_send',coalesce(t.status<>'declined',true) and not exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=owner_id) or (user_id=owner_id and blocked_id=actor)));
end $$;
create function xuetuan_guard.feedback_write(op text,content text,req_id uuid,seen_seq bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=xuetuan_guard.activity_user();owner_id uuid:=xuetuan_guard.feedback_owner();t xuetuan_guard.dm_threads;m xuetuan_guard.dm_messages;win timestamptz;cap integer;hits integer;
begin
 if owner_id is null or actor=owner_id then raise exception 'XUETUAN_FEEDBACK_UNAVAILABLE';end if;
 if op is null or op not in('send','read') then raise exception 'Invalid feedback action';end if;
 if op='send' then
  content:=btrim(coalesce(content,''));if char_length(content) not between 1 and 980 or req_id is null then raise exception 'Invalid feedback';end if;
  content:='[意见反馈] '||content;
  -- Ban/device validation always runs, including retries.
  perform xuetuan_guard.social_actor('comment');
  select * into m from xuetuan_guard.dm_messages where id=req_id;
  if found then
   if m.sender<>actor or m.body<>content or not exists(select 1 from xuetuan_guard.dm_threads x where x.id=m.thread_id and x.lo=least(actor,owner_id) and x.hi=greatest(actor,owner_id)) then raise exception 'Request id already used';end if;
   return jsonb_build_object('thread_id',m.thread_id,'message_id',m.id);
  end if;
  if exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=owner_id) or (user_id=owner_id and blocked_id=actor)) then raise exception 'XUETUAN_DM_CLOSED';end if;
  for win,cap in select date_trunc('minute',now()),3 union all select date_trunc('day',now()),20 loop
   hits:=null;insert into xuetuan_guard.write_windows(user_id,kind,window_start,hits) values(actor,'feedback:'||cap,win,1)
   on conflict(user_id,kind,window_start) do update set hits=xuetuan_guard.write_windows.hits+1 where xuetuan_guard.write_windows.hits<cap returning xuetuan_guard.write_windows.hits into hits;
   if hits is null then raise exception 'XUETUAN_RATE_LIMIT';end if;
  end loop;
  insert into xuetuan_guard.dm_threads(lo,hi,initiator,status) values(least(actor,owner_id),greatest(actor,owner_id),actor,'accepted') on conflict(lo,hi) do nothing;
 end if;
 select * into t from xuetuan_guard.dm_threads where lo=least(actor,owner_id) and hi=greatest(actor,owner_id) for update;
 if t.id is null then raise exception 'XUETUAN_DM_UNAVAILABLE';end if;
 if op='read' then
  if seen_seq is null or seen_seq<0 then raise exception 'Invalid read position';end if;
  update xuetuan_guard.dm_threads set read_lo=case when lo=actor then greatest(read_lo,least(seen_seq,last_seq)) else read_lo end,read_hi=case when hi=actor then greatest(read_hi,least(seen_seq,last_seq)) else read_hi end where id=t.id;
 else
  select * into m from xuetuan_guard.dm_messages where id=req_id;
  if found then
   if m.sender<>actor or m.body<>content or m.thread_id<>t.id then raise exception 'Request id already used';end if;
   return jsonb_build_object('thread_id',t.id,'message_id',m.id);
  end if;
  if t.status='declined' then raise exception 'XUETUAN_DM_CLOSED';end if;
  insert into xuetuan_guard.dm_messages(id,thread_id,sender,body) values(req_id,t.id,actor,content) returning * into m;
  update xuetuan_guard.dm_threads set status='accepted',last_seq=m.seq,read_lo=case when lo=actor then m.seq else read_lo end,read_hi=case when hi=actor then m.seq else read_hi end where id=t.id;
  return jsonb_build_object('thread_id',t.id,'message_id',m.id);
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function xuetuan_guard.feedback_read(text,uuid,bigint),xuetuan_guard.feedback_write(text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function xuetuan_guard.feedback_read(text,uuid,bigint),xuetuan_guard.feedback_write(text,text,uuid,bigint) to authenticated;
create function public.xuetuan_feedback_read(kind text default 'feedback',thread_id uuid default null,before_seq bigint default null) returns jsonb language sql security invoker set search_path='' as $$select xuetuan_guard.feedback_read(kind,thread_id,before_seq)$$;
create function public.xuetuan_feedback_write(action text,body text default '',request_id uuid default null,seen_seq bigint default null) returns jsonb language sql security invoker set search_path='' as $$select xuetuan_guard.feedback_write(action,body,request_id,seen_seq)$$;
revoke all on function public.xuetuan_feedback_read(text,uuid,bigint),public.xuetuan_feedback_write(text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.xuetuan_feedback_read(text,uuid,bigint),public.xuetuan_feedback_write(text,text,uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
