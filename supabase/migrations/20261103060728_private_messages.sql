-- Private text messages. Additive; apply only after owner consent.
begin;
create table xuetuan_guard.dm_preferences(user_id uuid primary key references public.profiles(id) on delete cascade,allow_requests boolean not null default true);
create table xuetuan_guard.dm_threads(
 id uuid primary key default gen_random_uuid(),lo uuid not null references public.profiles(id) on delete cascade,
 hi uuid not null references public.profiles(id) on delete cascade,initiator uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 last_seq bigint not null default 0,read_lo bigint not null default 0,read_hi bigint not null default 0,
 check(lo<hi),check(initiator in (lo,hi)),unique(lo,hi));
create index dm_threads_lo on xuetuan_guard.dm_threads(lo,last_seq desc);
create index dm_threads_hi on xuetuan_guard.dm_threads(hi,last_seq desc);
create index dm_threads_initiator on xuetuan_guard.dm_threads(initiator);
create table xuetuan_guard.dm_messages(
 id uuid primary key,thread_id uuid not null references xuetuan_guard.dm_threads(id) on delete cascade,
 sender uuid not null references public.profiles(id) on delete cascade,body text not null check(char_length(body) between 1 and 1000),
 seq bigint generated always as identity unique,created_at timestamptz not null default now(),removed boolean not null default false);
create index dm_messages_page on xuetuan_guard.dm_messages(thread_id,seq desc);
create index dm_messages_sender on xuetuan_guard.dm_messages(sender);
create table xuetuan_guard.dm_blocks(user_id uuid not null references public.profiles(id) on delete cascade,blocked_id uuid not null references public.profiles(id) on delete cascade,
 primary key(user_id,blocked_id),check(user_id<>blocked_id));
create index dm_blocks_target on xuetuan_guard.dm_blocks(blocked_id);
create table xuetuan_guard.dm_reports(
 id uuid primary key default gen_random_uuid(),message_id uuid not null references xuetuan_guard.dm_messages(id) on delete cascade,
 reporter uuid not null references public.profiles(id) on delete cascade,reason text not null check(reason in ('spam','abuse','privacy','other')),
 snapshot text not null,resolved boolean not null default false,created_at timestamptz not null default now(),unique(message_id,reporter));
create index dm_reports_pending on xuetuan_guard.dm_reports(created_at desc) where not resolved;
create index dm_reports_reporter on xuetuan_guard.dm_reports(reporter);
create table xuetuan_guard.dm_audit(id bigint generated always as identity primary key,actor uuid,report_id uuid,decision text,created_at timestamptz not null default now());
alter table xuetuan_guard.dm_preferences enable row level security;
alter table xuetuan_guard.dm_threads enable row level security;
alter table xuetuan_guard.dm_messages enable row level security;
alter table xuetuan_guard.dm_blocks enable row level security;
alter table xuetuan_guard.dm_reports enable row level security;
alter table xuetuan_guard.dm_audit enable row level security;
revoke all on xuetuan_guard.dm_preferences,xuetuan_guard.dm_threads,xuetuan_guard.dm_messages,xuetuan_guard.dm_blocks,xuetuan_guard.dm_reports,xuetuan_guard.dm_audit from public,anon,authenticated;

create function xuetuan_guard.dm_user() returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if actor is null or not exists(select 1 from auth.users where id=actor and not coalesce(is_anonymous,true) and email_confirmed_at is not null) then
  raise exception using errcode='42501',message='XUETUAN_BIND_REQUIRED';end if;
 return actor;
end $$;
revoke all on function xuetuan_guard.dm_user() from public,anon,authenticated;

create function xuetuan_guard.dm_read(kind text,t_id uuid,before_seq bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=xuetuan_guard.dm_user();t xuetuan_guard.dm_threads;result jsonb;n integer;peer uuid;
begin
 if kind='peer' then
  if t_id is null or t_id=actor then raise exception 'Invalid peer';end if;
  select * into t from xuetuan_guard.dm_threads where lo=least(actor,t_id) and hi=greatest(actor,t_id);
  return jsonb_build_object('thread_id',t.id,'name',(select name from public.profiles where id=t_id),
   'can_request',exists(select 1 from public.profiles where id=t_id and page_public)
    and coalesce((select allow_requests from xuetuan_guard.dm_preferences where user_id=t_id),true)
    and not exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=t_id) or(user_id=t_id and blocked_id=actor)));
 elsif kind='settings' then
  return jsonb_build_object('allow_requests',coalesce((select allow_requests from xuetuan_guard.dm_preferences where user_id=actor),true),
   'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name)) from xuetuan_guard.dm_blocks b join public.profiles p on p.id=b.blocked_id where b.user_id=actor),'[]'::jsonb));
 elsif kind='inbox' then
  with page as (select thr.*,p.name from xuetuan_guard.dm_threads thr join public.profiles p on p.id=case when thr.lo=actor then thr.hi else thr.lo end
   where actor in(thr.lo,thr.hi) and (before_seq is null or thr.last_seq<before_seq) order by thr.last_seq desc limit 51),
  numbered as(select *,row_number() over(order by last_seq desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'peer',case when lo=actor then hi else lo end,'name',name,'status',status,'incoming',initiator<>actor,
   'last_seq',last_seq,'unread',exists(select 1 from xuetuan_guard.dm_messages m where m.thread_id=numbered.id and m.sender<>actor and m.seq>case when lo=actor then read_lo else read_hi end),
   'preview',(select case when m.removed then '' else m.body end from xuetuan_guard.dm_messages m where m.thread_id=numbered.id order by m.seq desc limit 1)) order by last_seq desc) filter(where rn<=50),'[]'::jsonb),count(*) into result,n from numbered;
  return jsonb_build_object('threads',result,'has_more',n>50,'unread',(select count(*) from xuetuan_guard.dm_threads x where actor in(x.lo,x.hi) and exists(select 1 from xuetuan_guard.dm_messages m where m.thread_id=x.id and m.sender<>actor and m.seq>case when x.lo=actor then x.read_lo else x.read_hi end)));
 elsif kind='thread' then
  select * into t from xuetuan_guard.dm_threads where id=t_id and actor in(lo,hi);
  if not found then raise exception using errcode='42501',message='XUETUAN_DM_UNAVAILABLE';end if;
  peer:=case when t.lo=actor then t.hi else t.lo end;
  with page as(select * from xuetuan_guard.dm_messages where thread_id=t_id and (before_seq is null or seq<before_seq) order by seq desc limit 31),
  numbered as(select *,row_number() over(order by seq desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'sender',sender,'body',case when removed then '' else body end,'seq',seq,'created_at',created_at,'removed',removed) order by seq) filter(where rn<=30),'[]'::jsonb),count(*) into result,n from numbered;
  return jsonb_build_object('messages',result,'has_more',n>30,'peer',peer,'name',(select name from public.profiles where id=peer),'status',t.status,'incoming',t.initiator<>actor,
   'read_seq',case when t.lo=actor then t.read_lo else t.read_hi end,
   'blocked',exists(select 1 from xuetuan_guard.dm_blocks where user_id=actor and blocked_id=peer),
   'can_send',t.status='accepted' and not exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=peer) or(user_id=peer and blocked_id=actor)));
 else raise exception 'Invalid DM view';end if;
end $$;

create function xuetuan_guard.dm_write(op text,peer_id uuid,t_id uuid,content text,req_id uuid,msg_id uuid,seen_seq bigint,allow_new boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=xuetuan_guard.dm_user();t xuetuan_guard.dm_threads;m xuetuan_guard.dm_messages;peer uuid;win timestamptz;cap integer;hits integer;
begin
 if op is null or op not in('send','accept','decline','block','unblock','read','prefs','report') then raise exception 'Invalid DM action';end if;
 if op<>'read' then perform xuetuan_guard.social_actor(case when op='report' then 'report' else 'dm' end);end if;
 if op='prefs' then
  if allow_new is null then raise exception 'Missing preference';end if;
  insert into xuetuan_guard.dm_preferences values(actor,allow_new) on conflict(user_id) do update set allow_requests=excluded.allow_requests;
  return jsonb_build_object('ok',true);
 end if;
 if op in('block','unblock') then
  if peer_id is null or peer_id=actor or not exists(select 1 from public.profiles where id=peer_id) then raise exception 'Invalid peer';end if;
  if op='block' then insert into xuetuan_guard.dm_blocks values(actor,peer_id) on conflict do nothing;
  else delete from xuetuan_guard.dm_blocks where user_id=actor and blocked_id=peer_id;end if;
  return jsonb_build_object('ok',true);
 end if;
 if op='send' then
  content:=btrim(coalesce(content,''));if char_length(content) not between 1 and 1000 or req_id is null then raise exception 'Invalid message';end if;
  -- Exactly the same retry may succeed even if the peer changed privacy meanwhile; never insert it twice.
  select * into m from xuetuan_guard.dm_messages where id=req_id;
  if found then
   if m.sender<>actor or m.body<>content or (t_id is not null and m.thread_id<>t_id) or (peer_id is not null and not exists(select 1 from xuetuan_guard.dm_threads x where x.id=m.thread_id and peer_id in(x.lo,x.hi))) then raise exception 'Request id already used';end if;
   return jsonb_build_object('thread_id',m.thread_id,'message_id',m.id);
  end if;
  if t_id is null then
   if peer_id is null or peer_id=actor then raise exception 'Invalid peer';end if;
   select * into t from xuetuan_guard.dm_threads where lo=least(actor,peer_id) and hi=greatest(actor,peer_id) for update;
   if not found then
    -- Preference row is shared-locked against a simultaneous opt-out. Existing accepted threads are independent.
    insert into xuetuan_guard.dm_preferences(user_id) select id from public.profiles where id=peer_id on conflict do nothing;
    perform 1 from xuetuan_guard.dm_preferences where user_id=peer_id and allow_requests for share;
    if not found or not exists(select 1 from public.profiles where id=peer_id and page_public) then raise exception using errcode='42501',message='XUETUAN_DM_CLOSED';end if;
    if exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=peer_id) or(user_id=peer_id and blocked_id=actor)) then raise exception using errcode='42501',message='XUETUAN_DM_CLOSED';end if;
    for win,cap in select date_trunc('minute',now()),3 union all select date_trunc('day',now()),10 loop
     hits:=null;insert into xuetuan_guard.write_windows(user_id,kind,window_start,hits) values(actor,'dm-request:'||cap,win,1)
      on conflict(user_id,kind,window_start) do update set hits=xuetuan_guard.write_windows.hits+1 where xuetuan_guard.write_windows.hits<cap returning xuetuan_guard.write_windows.hits into hits;
     if hits is null then raise exception using errcode='P0001',message='XUETUAN_RATE_LIMIT';end if;
    end loop;
    insert into xuetuan_guard.dm_threads(lo,hi,initiator) values(least(actor,peer_id),greatest(actor,peer_id),actor) on conflict(lo,hi) do nothing;
    select * into t from xuetuan_guard.dm_threads where lo=least(actor,peer_id) and hi=greatest(actor,peer_id) for update;
   end if;
  else select * into t from xuetuan_guard.dm_threads where id=t_id and actor in(lo,hi) for update;end if;
 else select * into t from xuetuan_guard.dm_threads where id=t_id and actor in(lo,hi) for update;end if;
 if t.id is null then raise exception using errcode='42501',message='XUETUAN_DM_UNAVAILABLE';end if;
 peer:=case when actor=t.lo then t.hi else t.lo end;
 if op='read' then
  if seen_seq is null or seen_seq<0 then raise exception 'Invalid read position';end if;
  update xuetuan_guard.dm_threads set read_lo=case when lo=actor then greatest(read_lo,least(seen_seq,last_seq)) else read_lo end,
   read_hi=case when hi=actor then greatest(read_hi,least(seen_seq,last_seq)) else read_hi end where id=t.id;
 elsif op in('accept','decline') then
  if t.initiator=actor or t.status<>'pending' then raise exception 'Request cannot be changed';end if;
  if op='accept' and exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=peer) or(user_id=peer and blocked_id=actor)) then raise exception using errcode='42501',message='XUETUAN_DM_CLOSED';end if;
  update xuetuan_guard.dm_threads set status=case when op='accept' then 'accepted' else 'declined' end where id=t.id;
 elsif op='send' then
  if exists(select 1 from xuetuan_guard.dm_blocks where (user_id=actor and blocked_id=peer) or(user_id=peer and blocked_id=actor)) then raise exception using errcode='42501',message='XUETUAN_DM_CLOSED';end if;
  if t.status='declined' or (t.status='pending' and (t.initiator<>actor or t.last_seq>0)) then raise exception using errcode='42501',message='XUETUAN_DM_WAIT';end if;
  if t.status='pending' and not coalesce((select allow_requests from xuetuan_guard.dm_preferences where user_id=peer),true) then raise exception using errcode='42501',message='XUETUAN_DM_CLOSED';end if;
  insert into xuetuan_guard.dm_messages(id,thread_id,sender,body) values(req_id,t.id,actor,content) returning * into m;
  update xuetuan_guard.dm_threads set last_seq=m.seq,read_lo=case when lo=actor then m.seq else read_lo end,read_hi=case when hi=actor then m.seq else read_hi end where id=t.id;
  return jsonb_build_object('thread_id',t.id,'message_id',m.id);
 elsif op='report' then
  select * into m from xuetuan_guard.dm_messages where id=msg_id and thread_id=t.id and sender<>actor and not removed;
  if not found or content is null or content not in('spam','abuse','privacy','other') then raise exception 'Invalid report';end if;
  insert into xuetuan_guard.dm_reports(message_id,reporter,reason,snapshot) values(m.id,actor,content,m.body) on conflict(message_id,reporter) do nothing;
 end if;
 return jsonb_build_object('ok',true);
end $$;

create function xuetuan_guard.dm_moderation(r_id uuid,decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r xuetuan_guard.dm_reports;target uuid;
begin
 if not public.xuetuan_is_admin() then raise exception using errcode='42501',message='Admin required';end if;
 if r_id is null then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select rep.id,rep.snapshot as body,rep.reason,rep.created_at,p.name
   from xuetuan_guard.dm_reports rep join xuetuan_guard.dm_messages m on m.id=rep.message_id join public.profiles p on p.id=m.sender
   where not rep.resolved order by rep.created_at desc limit 50)x),'[]'::jsonb);
 end if;
 perform xuetuan_guard.social_actor('dm-moderate');
 if decision is null or decision not in('dismiss','remove','remove_and_ban') then raise exception 'Invalid decision';end if;
 select * into r from xuetuan_guard.dm_reports where id=r_id for update;
 if not found then raise exception 'Report unavailable';end if;
 select sender into target from xuetuan_guard.dm_messages where id=r.message_id;
 if decision='remove_and_ban' then
  if exists(select 1 from xuetuan_guard.admins where user_id=target) then raise exception 'Cannot ban administrator';end if;
  insert into xuetuan_guard.banned_users(user_id) values(target) on conflict do nothing;
  insert into xuetuan_guard.banned_devices(device) select device from xuetuan_guard.user_devices where user_id=target on conflict do nothing;
 end if;
 if decision<>'dismiss' then update xuetuan_guard.dm_messages set removed=true where id=r.message_id;end if;
 update xuetuan_guard.dm_reports set resolved=true where message_id=r.message_id;
 insert into xuetuan_guard.dm_audit(actor,report_id,decision) values(auth.uid(),r_id,decision);
 return jsonb_build_object('ok',true);
end $$;

revoke all on function xuetuan_guard.dm_read(text,uuid,bigint),xuetuan_guard.dm_write(text,uuid,uuid,text,uuid,uuid,bigint,boolean),xuetuan_guard.dm_moderation(uuid,text) from public,anon,authenticated;
grant execute on function xuetuan_guard.dm_read(text,uuid,bigint),xuetuan_guard.dm_write(text,uuid,uuid,text,uuid,uuid,bigint,boolean),xuetuan_guard.dm_moderation(uuid,text) to authenticated;
create function public.xuetuan_dm_read(kind text,thread_id uuid default null,before_seq bigint default null) returns jsonb language sql security invoker set search_path='' as $$select xuetuan_guard.dm_read(kind,thread_id,before_seq)$$;
create function public.xuetuan_dm_write(action text,peer_id uuid default null,thread_id uuid default null,body text default '',request_id uuid default null,message_id uuid default null,seen_seq bigint default null,allow_requests boolean default null) returns jsonb
 language sql security invoker set search_path='' as $$select xuetuan_guard.dm_write(action,peer_id,thread_id,body,request_id,message_id,seen_seq,allow_requests)$$;
create function public.xuetuan_dm_moderation(report_id uuid default null,decision text default null) returns jsonb language sql security invoker set search_path='' as $$select xuetuan_guard.dm_moderation(report_id,decision)$$;
revoke all on function public.xuetuan_dm_read(text,uuid,bigint),public.xuetuan_dm_write(text,uuid,uuid,text,uuid,uuid,bigint,boolean),public.xuetuan_dm_moderation(uuid,text) from public,anon,authenticated;
grant execute on function public.xuetuan_dm_read(text,uuid,bigint),public.xuetuan_dm_write(text,uuid,uuid,text,uuid,uuid,bigint,boolean),public.xuetuan_dm_moderation(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
