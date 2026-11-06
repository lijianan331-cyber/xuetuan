begin;

-- Moderator actions need a signed-in administrator. Keep read helpers used by RLS.
revoke execute on function public.xuetuan_moderate_visit(uuid,text) from public, anon;
revoke execute on function public.xuetuan_moderation_pending() from public, anon;

create index if not exists client_errors_actor_recent
  on public.client_errors (user_id, created_at desc);

create or replace function public.client_errors_cap() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind not in ('js','promise','save','delete-account') then return null; end if;
  if new.message is null or new.message not in ('UNKNOWN','XUETUAN_SAVE_TIMEOUT',
    'XUETUAN_WRITE_LOST','XUETUAN_DELETE_PENDING','XUETUAN_DELETE_UNAVAILABLE') then
    new.message := 'UNKNOWN';
  end if;
  if new.ua is null or new.ua not in ('MicroMessenger','Edg','Firefox','Chrome','Safari','Other') then
    new.ua := 'Other';
  end if;
  if new.app is null or new.app not in ('production','preview') then new.app := 'legacy'; end if;
  if new.page is null or new.page !~ '^[a-z-]{0,30}/[a-z-]{0,30}$' then new.page := 'unknown'; end if;

  -- This lock also bounds concurrent requests, including the shared anonymous budget.
  perform pg_advisory_xact_lock(hashtextextended('xuetuan:client-error:' || coalesce(new.user_id::text,'anon'),0));
  if (select count(*) from public.client_errors
      where user_id is not distinct from new.user_id and created_at > now() - interval '1 hour')
      >= (case when new.user_id is null then 300 else 30 end) then
    return null;
  end if;
  delete from public.client_errors where created_at < now() - interval '60 days';
  return new;
end $$;
revoke all on function public.client_errors_cap() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
