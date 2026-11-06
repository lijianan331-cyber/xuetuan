begin;

create table xuetuan_guard.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table xuetuan_guard.account_deletions enable row level security;
revoke all on xuetuan_guard.account_deletions from public, anon, authenticated;

-- The old browser-driven endpoint cannot safely coordinate Storage with Postgres.
revoke execute on function public.xuetuan_delete_my_account() from public, anon, authenticated;

-- Cached pages still run the old flow. Block their own-folder deletes until
-- they load the new client. This compatibility marker grants no ownership.
create policy "photos: require safe client for own file deletion"
  on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'photos' or split_part(name,'/',1) <> (select auth.uid())::text
    or position('xuetuan-delete-safe/1' in coalesce(
      (nullif(current_setting('request.headers',true),'')::jsonb)->>'x-client-info','')) > 0
  );

create function public.xuetuan_account_deletion_pending() returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
  -- Serialize file writes with the server's deletion step for this account.
  perform 1 from auth.users where id=actor for key share;
  if not found then return true; end if;
  return exists(select 1 from xuetuan_guard.account_deletions where user_id=actor);
end $$;
revoke all on function public.xuetuan_account_deletion_pending() from public, anon, authenticated;
grant execute on function public.xuetuan_account_deletion_pending() to authenticated;

create policy "photos: no new files during account deletion"
  on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'photos' or not (select public.xuetuan_account_deletion_pending()));
create policy "photos: no file changes during account deletion"
  on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'photos' or not (select public.xuetuan_account_deletion_pending()))
  with check (bucket_id <> 'photos' or not (select public.xuetuan_account_deletion_pending()));

-- Only the server can invoke this function. It derives actor from a verified session.
-- Storage API deletes files; SQL only enumerates or verifies their metadata.
create function public.xuetuan_account_delete_step(actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare objects jsonb;
begin
  if actor is null then raise exception using errcode='42501', message='Actor required'; end if;
  perform 1 from auth.users where id=actor for update;
  if not found then return jsonb_build_object('status','deleted'); end if;
  if exists(select 1 from xuetuan_guard.admins where user_id=actor) then
    return jsonb_build_object('status','forbidden');
  end if;

  insert into xuetuan_guard.account_deletions(user_id) values(actor) on conflict do nothing;

  select coalesce(jsonb_agg(name),'[]'::jsonb) into objects from (
    select name from storage.objects
    where bucket_id='photos' and split_part(name,'/',1)=actor::text
    order by name limit 100
  ) files;
  if jsonb_array_length(objects)>0 then
    return jsonb_build_object('status','pending','paths',objects);
  end if;

  delete from public.visits where user_id=actor;
  delete from public.wishlist where user_id=actor;
  delete from public.client_errors where user_id=actor;
  delete from auth.users where id=actor;
  return jsonb_build_object('status','deleted');
end $$;
revoke all on function public.xuetuan_account_delete_step(uuid) from public, anon, authenticated;
grant execute on function public.xuetuan_account_delete_step(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
