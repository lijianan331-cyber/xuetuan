-- Apply only after the client supports signed media URLs. No records/files are deleted.
begin;

create schema if not exists xuetuan_guard;
revoke all on schema xuetuan_guard from public, anon, authenticated;
create table xuetuan_guard.admins (user_id uuid primary key references auth.users(id) on delete cascade);
create table xuetuan_guard.banned_users (user_id uuid primary key references auth.users(id) on delete cascade, banned_at timestamptz not null default now());
create table xuetuan_guard.user_devices (user_id uuid not null references auth.users(id) on delete cascade, device uuid not null, primary key(user_id,device));
create table xuetuan_guard.banned_devices (device uuid primary key, banned_at timestamptz not null default now());
create table xuetuan_guard.moderation_media (path text primary key);
create table xuetuan_guard.moderation_log (id bigint generated always as identity primary key, actor uuid not null, subject uuid not null, visit uuid not null, action text not null, created_at timestamptz not null default now());
alter table xuetuan_guard.admins enable row level security;
alter table xuetuan_guard.banned_users enable row level security;
alter table xuetuan_guard.user_devices enable row level security;
alter table xuetuan_guard.banned_devices enable row level security;
alter table xuetuan_guard.moderation_media enable row level security;
alter table xuetuan_guard.moderation_log enable row level security;
revoke all on all tables in schema xuetuan_guard from public, anon, authenticated;

create function public.xuetuan_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from xuetuan_guard.admins a join auth.users u on u.id=a.user_id
    where a.user_id=auth.uid() and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false));
$$;
revoke all on function public.xuetuan_is_admin() from public;
grant execute on function public.xuetuan_is_admin() to anon,authenticated;

create function public.xuetuan_moderatable_media(object_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.xuetuan_is_admin() and exists(select 1 from xuetuan_guard.moderation_media where path=object_path);
$$;
revoke all on function public.xuetuan_moderatable_media(text) from public;
grant execute on function public.xuetuan_moderatable_media(text) to anon,authenticated;

create function public.xuetuan_moderate_visit(visit_id uuid, decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.visits; files text[];
begin
  if not public.xuetuan_is_admin() then raise exception using errcode='42501',message='Admin required'; end if;
  if decision not in ('delete','delete_and_ban') or decision is null then raise exception 'Invalid moderation action'; end if;
  select * into r from public.visits where id=visit_id and visibility='public' for update;
  if not found then raise exception 'Public post not found'; end if;
  if exists(select 1 from xuetuan_guard.admins where user_id=r.user_id) and decision='delete_and_ban' then raise exception 'Cannot ban an administrator'; end if;
  if decision='delete_and_ban' then
    insert into xuetuan_guard.banned_users(user_id) values(r.user_id) on conflict do nothing;
    insert into xuetuan_guard.banned_devices(device) select device from xuetuan_guard.user_devices where user_id=r.user_id on conflict do nothing;
  end if;
  files := r.photos || array(select regexp_replace(p,'\.(jpg|gif|mp4|mov|webm)$','_t.jpg','i') from unnest(r.photos) p);
  insert into xuetuan_guard.moderation_media(path) select distinct unnest(files) on conflict do nothing;
  insert into xuetuan_guard.moderation_log(actor,subject,visit,action) values(auth.uid(),r.user_id,r.id,decision);
  delete from public.visits where id=r.id;
  return jsonb_build_object('files',files,'banned',decision='delete_and_ban');
end $$;
revoke all on function public.xuetuan_moderate_visit(uuid,text) from public;
grant execute on function public.xuetuan_moderate_visit(uuid,text) to authenticated;

create function public.xuetuan_moderation_pending() returns setof text
language plpgsql security definer set search_path='' as $$
begin
  if not public.xuetuan_is_admin() then raise exception using errcode='42501',message='Admin required'; end if;
  return query select m.path from xuetuan_guard.moderation_media m join storage.objects o on o.name=m.path and o.bucket_id='photos' limit 100;
end $$;
revoke all on function public.xuetuan_moderation_pending() from public;
grant execute on function public.xuetuan_moderation_pending() to authenticated;
create table xuetuan_guard.write_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (user_id, kind, window_start)
);
alter table xuetuan_guard.write_windows enable row level security;
revoke all on xuetuan_guard.write_windows from public, anon, authenticated;
create index write_windows_cleanup on xuetuan_guard.write_windows(window_start);

-- Trigger-only privileged code: no client-supplied user ID, no public RPC grant.
create function xuetuan_guard.check_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  write_kind text := tg_table_schema || '.' || tg_table_name || '.' || tg_op;
  minute_limit integer := 120;
  day_limit integer := 1000;
  win timestamptz;
  cap integer;
  accepted integer;
  path text;
  device_text text;
  device_id uuid;
begin
  if actor is null then return new; end if; -- admin maintenance; RLS still denies unauthenticated writes
  if exists(select 1 from xuetuan_guard.banned_users where user_id=actor) then
    raise exception using errcode='42501',message='XUETUAN_ACCOUNT_BLOCKED';
  end if;
  device_text := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb ->> 'x-xuetuan-device';
  if device_text is null or device_text !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
    raise exception using errcode='42501',message='XUETUAN_RELOAD_REQUIRED';
  end if;
  device_id := device_text::uuid;
  if exists(select 1 from xuetuan_guard.banned_devices where device=device_id) and not public.xuetuan_is_admin() then
    raise exception using errcode='42501',message='XUETUAN_DEVICE_BLOCKED';
  end if;
  insert into xuetuan_guard.user_devices values(actor,device_id) on conflict do nothing;
  if tg_table_schema = 'public' and tg_table_name = 'visits' then
    foreach path in array new.photos loop
      if path is null or path not like actor::text || '/%'
         or path !~ '^[a-f0-9-]+/[A-Za-z0-9_-]+\.(jpg|gif|mp4|mov|webm)$' then
        raise exception using errcode='42501', message='XUETUAN_PHOTO_OWNER';
      end if;
    end loop;
    if tg_op = 'INSERT' then minute_limit := 60; day_limit := 300;
    else minute_limit := 240; day_limit := 2000; end if;
  elsif tg_table_schema = 'storage' then
    if new.bucket_id <> 'photos' then return new; end if;
    minute_limit := 180; day_limit := 1200;
  elsif tg_table_name = 'places' then
    minute_limit := 60; day_limit := 300;
  elsif tg_table_name = 'homes' then
    minute_limit := 30; day_limit := 100;
  end if;
  for win, cap in select date_trunc('minute',now()), minute_limit
                  union all select date_trunc('day',now()), day_limit loop
    -- A suffix keeps midnight's minute bucket separate from the day bucket.
    accepted := null;
    insert into xuetuan_guard.write_windows(user_id,kind,window_start,hits)
    values(actor,write_kind || ':' || cap::text,win,1)
    on conflict(user_id,kind,window_start) do update
      set hits = xuetuan_guard.write_windows.hits + 1
      where xuetuan_guard.write_windows.hits < cap
    returning hits into accepted;
    if accepted is null then
      raise exception using errcode='P0001', message='XUETUAN_RATE_LIMIT';
    end if;
  end loop;
  delete from xuetuan_guard.write_windows where window_start < date_trunc('day',now()) - interval '2 days';
  return new;
end $$;
revoke all on function xuetuan_guard.check_write() from public, anon, authenticated;

create trigger visits_guard before insert or update on public.visits
  for each row execute function xuetuan_guard.check_write();
create trigger places_guard before insert or update on public.places
  for each row execute function xuetuan_guard.check_write();
create trigger wishlist_guard before insert on public.wishlist
  for each row execute function xuetuan_guard.check_write();
create trigger homes_guard before insert or update on public.homes
  for each row execute function xuetuan_guard.check_write();
create trigger profiles_guard before update on public.profiles
  for each row execute function xuetuan_guard.check_write();
create trigger photos_guard before insert on storage.objects
  for each row execute function xuetuan_guard.check_write();

-- SELECT inherits visits RLS: own uploads or media referenced by a visible visit.
create index if not exists visits_photos_gin on public.visits using gin(photos);
create policy "photos: read visible or own" on storage.objects for select to anon, authenticated
using (bucket_id = 'photos' and (
  (storage.foldername(name))[1] = (select auth.uid())::text
  or public.xuetuan_moderatable_media(name)
  or exists (
    select 1 from public.visits v where
      v.photos @> array[storage.objects.name]
      or exists(select 1 from unnest(v.photos) p
        where regexp_replace(p, '\.(jpg|gif|mp4|mov|webm)$', '_t.jpg', 'i') = storage.objects.name)
  )
));
create policy "photos: moderator deletes approved media" on storage.objects for delete to authenticated
using (bucket_id='photos' and public.xuetuan_moderatable_media(name));
update storage.buckets set public=false where id='photos';

-- Ownership columns cannot be reassigned even by an owner editing their row.
revoke update on public.visits, public.places from authenticated;
grant update (rating,price,text,title,photos,visibility) on public.visits to authenticated;
grant update (cat,precision,lat,lng,name,alt_name,link,osm) on public.places to authenticated;
commit;
