-- Additive only. Apply after owner approval. No existing visits/media/visibility rewritten.
begin;
create table xuetuan_guard.post_likes (
  visit_id uuid not null references public.visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (visit_id,user_id)
);
create table xuetuan_guard.post_comments (
  id uuid primary key,
  visit_id uuid not null references public.visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references xuetuan_guard.post_comments(id) on delete set null,
  body text not null check (char_length(body)<=500),
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index post_comments_page on xuetuan_guard.post_comments(visit_id,created_at desc,id desc);
create index post_comments_parent on xuetuan_guard.post_comments(parent_id);
create index post_comments_user on xuetuan_guard.post_comments(user_id);
create index post_likes_user on xuetuan_guard.post_likes(user_id);
create table xuetuan_guard.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references xuetuan_guard.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam','abuse','privacy','other')),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique(comment_id,user_id)
);
create index comment_reports_pending on xuetuan_guard.comment_reports(created_at desc) where not resolved;
create index comment_reports_user on xuetuan_guard.comment_reports(user_id);
alter table xuetuan_guard.post_likes enable row level security;
alter table xuetuan_guard.post_comments enable row level security;
alter table xuetuan_guard.comment_reports enable row level security;
revoke all on xuetuan_guard.post_likes,xuetuan_guard.post_comments,xuetuan_guard.comment_reports from public,anon,authenticated;

-- These private tables have no direct API grants or policies: access is only via checked functions.
-- Permission is determined from auth.users, never editable user_metadata or a client user id.
create function xuetuan_guard.social_actor(action_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); device_text text; device_id uuid; cap integer; win timestamptz; hit integer;
begin
  if actor is null or not exists(select 1 from auth.users u where u.id=actor
      and not coalesce(u.is_anonymous,true) and u.email_confirmed_at is not null) then
    raise exception using errcode='42501',message='XUETUAN_BIND_REQUIRED';
  end if;
  if exists(select 1 from xuetuan_guard.banned_users where user_id=actor) then
    raise exception using errcode='42501',message='XUETUAN_ACCOUNT_BLOCKED';
  end if;
  device_text:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-xuetuan-device';
  if device_text is null or device_text !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
    raise exception using errcode='42501',message='XUETUAN_RELOAD_REQUIRED';
  end if;
  device_id:=device_text::uuid;
  if exists(select 1 from xuetuan_guard.banned_devices where device=device_id) and not public.xuetuan_is_admin() then
    raise exception using errcode='42501',message='XUETUAN_DEVICE_BLOCKED';
  end if;
  insert into xuetuan_guard.user_devices values(actor,device_id) on conflict do nothing;
  for win,cap in select date_trunc('minute',now()),case action_kind when 'comment' then 6 when 'report' then 3 else 60 end
    union all select date_trunc('day',now()),case action_kind when 'comment' then 100 when 'report' then 20 else 500 end loop
    hit:=null;
    insert into xuetuan_guard.write_windows(user_id,kind,window_start,hits)
      values(actor,'social.'||action_kind||':'||cap,win,1)
      on conflict(user_id,kind,window_start) do update set hits=xuetuan_guard.write_windows.hits+1
      where xuetuan_guard.write_windows.hits<cap returning hits into hit;
    if hit is null then raise exception using errcode='P0001',message='XUETUAN_RATE_LIMIT'; end if;
  end loop;
  delete from xuetuan_guard.write_windows where window_start<date_trunc('day',now())-interval '2 days';
  return actor;
end $$;
revoke all on function xuetuan_guard.social_actor(text) from public,anon,authenticated;

create function xuetuan_guard.social_read(v_id uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid; comments jsonb; n integer;
begin
  select user_id into owner_id from public.visits where id=v_id and visibility='public';
  if not found then raise exception using errcode='42501',message='XUETUAN_POST_UNAVAILABLE'; end if;
  with page as (
    select c.*,p.name,p.page_public,parent.deleted as parent_deleted,pp.name as reply_name
    from xuetuan_guard.post_comments c join public.profiles p on p.id=c.user_id
    left join xuetuan_guard.post_comments parent on parent.id=c.parent_id
    left join public.profiles pp on pp.id=parent.user_id
    where c.visit_id=v_id and (cursor_at is null or (c.created_at,c.id)<(cursor_at,cursor_id))
    order by c.created_at desc,c.id desc limit 31
  ), numbered as (select *,row_number() over(order by created_at desc,id desc) as rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',case when deleted then null else user_id end,
    'name',case when deleted then '' else name end,'page_public',not deleted and page_public,
    'body',body,'deleted',deleted,'parent_id',parent_id,'reply_name',case when parent_deleted then '' else reply_name end,
    'created_at',created_at) order by created_at desc,id desc) filter(where rn<=30),'[]'::jsonb),count(*)
    into comments,n from numbered;
  return jsonb_build_object('comments',comments,'has_more',n>30,
    'liked',exists(select 1 from xuetuan_guard.post_likes where visit_id=v_id and user_id=auth.uid()),
    'like_count',case when owner_id=auth.uid() then (select count(*) from xuetuan_guard.post_likes where visit_id=v_id) else null end);
end $$;

create function xuetuan_guard.social_write(op text,v_id uuid,content text,t_id uuid,req_id uuid,is_liked boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; owner_id uuid; target xuetuan_guard.post_comments; old_row xuetuan_guard.post_comments;
begin
  if op is null or op not in ('like','comment','delete','report') then raise exception 'Invalid action'; end if;
  actor:=xuetuan_guard.social_actor(op);
  -- Lock visibility against simultaneous withdrawal/deletion. Each successful write rechecks public status.
  select user_id into owner_id from public.visits where id=v_id and visibility='public' for share;
  if not found then raise exception using errcode='42501',message='XUETUAN_POST_UNAVAILABLE'; end if;
  if op='like' then
    if is_liked is null then raise exception 'Missing like state'; end if;
    if is_liked then insert into xuetuan_guard.post_likes values(v_id,actor) on conflict do nothing;
    else delete from xuetuan_guard.post_likes where visit_id=v_id and user_id=actor; end if;
    return jsonb_build_object('liked',is_liked);
  end if;
  if op='comment' then
    content:=btrim(coalesce(content,''));
    if char_length(content) not between 1 and 500 or req_id is null then raise exception 'Invalid comment'; end if;
    if t_id is not null then
      select * into target from xuetuan_guard.post_comments where id=t_id and visit_id=v_id and not deleted for share;
      if not found or target.parent_id is not null then raise exception 'Reply target unavailable'; end if;
    end if;
    insert into xuetuan_guard.post_comments(id,visit_id,user_id,parent_id,body)
      values(req_id,v_id,actor,t_id,content) on conflict(id) do nothing;
    select * into old_row from xuetuan_guard.post_comments where id=req_id;
    if old_row.user_id<>actor or old_row.visit_id<>v_id or old_row.body<>content or old_row.parent_id is distinct from t_id or old_row.deleted then
      raise exception 'Request id already used';
    end if;
    return jsonb_build_object('comment_id',req_id);
  end if;
  select * into target from xuetuan_guard.post_comments where id=t_id and visit_id=v_id for update;
  if not found then raise exception 'Comment unavailable'; end if;
  if op='delete' then
    if actor<>target.user_id and actor<>owner_id and not public.xuetuan_is_admin() then raise exception using errcode='42501',message='Permission denied'; end if;
    update xuetuan_guard.post_comments set deleted=true,body='' where id=t_id;
    update xuetuan_guard.comment_reports set resolved=true where comment_id=t_id;
  else
    if target.deleted or content is null or content not in ('spam','abuse','privacy','other') then raise exception 'Invalid report'; end if;
    insert into xuetuan_guard.comment_reports(comment_id,user_id,reason) values(t_id,actor,content) on conflict(comment_id,user_id) do nothing;
  end if;
  return jsonb_build_object('ok',true);
end $$;

create function xuetuan_guard.social_reports() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.xuetuan_is_admin() then raise exception using errcode='42501',message='Admin required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    select c.id,c.visit_id,c.body,p.name,count(*) as reports,max(r.created_at) as reported_at,
      array_agg(distinct r.reason) as reasons
    from xuetuan_guard.comment_reports r join xuetuan_guard.post_comments c on c.id=r.comment_id
    join public.visits v on v.id=c.visit_id join public.profiles p on p.id=c.user_id
    where not r.resolved and not c.deleted and v.visibility='public'
    group by c.id,p.name order by max(r.created_at) desc,c.id limit 50
  ) r),'[]'::jsonb);
end $$;

create function xuetuan_guard.social_moderate(c_id uuid,decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target xuetuan_guard.post_comments;
begin
  if not public.xuetuan_is_admin() then raise exception using errcode='42501',message='Admin required'; end if;
  perform xuetuan_guard.social_actor('moderate');
  if decision is null or decision not in ('dismiss','delete','delete_and_ban') then raise exception 'Invalid decision'; end if;
  select c.* into target from xuetuan_guard.post_comments c join public.visits v on v.id=c.visit_id
    where c.id=c_id and v.visibility='public' for update of c;
  if not found then raise exception 'Public comment unavailable'; end if;
  if decision='delete_and_ban' then
    if exists(select 1 from xuetuan_guard.admins where user_id=target.user_id) then raise exception 'Cannot ban an administrator'; end if;
    insert into xuetuan_guard.banned_users(user_id) values(target.user_id) on conflict do nothing;
    insert into xuetuan_guard.banned_devices(device) select device from xuetuan_guard.user_devices where user_id=target.user_id on conflict do nothing;
  end if;
  if decision<>'dismiss' then update xuetuan_guard.post_comments set deleted=true,body='' where id=c_id; end if;
  update xuetuan_guard.comment_reports set resolved=true where comment_id=c_id;
  insert into xuetuan_guard.moderation_log(actor,subject,visit,action)
    values(auth.uid(),target.user_id,target.visit_id,'comment:'||c_id::text||':'||decision);
  return jsonb_build_object('ok',true);
end $$;

-- Public API wrappers are invokers. Only explicitly granted, fully checked private functions run privileged.
grant usage on schema xuetuan_guard to anon,authenticated;
revoke all on function xuetuan_guard.social_read(uuid,timestamptz,uuid),xuetuan_guard.social_write(text,uuid,text,uuid,uuid,boolean),
  xuetuan_guard.social_reports(),xuetuan_guard.social_moderate(uuid,text) from public,anon,authenticated;
grant execute on function xuetuan_guard.social_read(uuid,timestamptz,uuid) to anon,authenticated;
grant execute on function xuetuan_guard.social_write(text,uuid,text,uuid,uuid,boolean),xuetuan_guard.social_reports(),xuetuan_guard.social_moderate(uuid,text) to authenticated;
create function public.xuetuan_post_social(visit_id uuid,after_at timestamptz default null,after_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$select xuetuan_guard.social_read(visit_id,after_at,after_id)$$;
create function public.xuetuan_social_write(action text,visit_id uuid,body text default '',target_id uuid default null,request_id uuid default null,liked boolean default null) returns jsonb
language sql security invoker set search_path='' as $$select xuetuan_guard.social_write(action,visit_id,body,target_id,request_id,liked)$$;
create function public.xuetuan_comment_reports() returns jsonb
language sql security invoker set search_path='' as $$select xuetuan_guard.social_reports()$$;
create function public.xuetuan_moderate_comment(comment_id uuid,decision text) returns jsonb
language sql security invoker set search_path='' as $$select xuetuan_guard.social_moderate(comment_id,decision)$$;
revoke all on function public.xuetuan_post_social(uuid,timestamptz,uuid),public.xuetuan_social_write(text,uuid,text,uuid,uuid,boolean),
  public.xuetuan_comment_reports(),public.xuetuan_moderate_comment(uuid,text) from public,anon,authenticated;
grant execute on function public.xuetuan_post_social(uuid,timestamptz,uuid) to anon,authenticated;
grant execute on function public.xuetuan_social_write(text,uuid,text,uuid,uuid,boolean),public.xuetuan_comment_reports(),public.xuetuan_moderate_comment(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
