-- Guests may interact; publishing and private messages retain their separate verification gates.
begin;
create or replace function xuetuan_guard.social_actor(action_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); device_text text; device_id uuid; cap integer; win timestamptz; hit integer;
begin
  if actor is null or not exists(select 1 from auth.users u where u.id=actor
      and ((coalesce(u.is_anonymous,false) and action_kind in ('like','comment','delete','report')) or (not coalesce(u.is_anonymous,true) and u.email_confirmed_at is not null))) then
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

notify pgrst,'reload schema';
commit;
