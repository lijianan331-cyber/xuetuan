-- 2026-11-06（用户：“你认为要做的那些可以做”）。由用户在 SQL Editor 一次运行；可重复运行。
-- 1) 清真标记那一列（原 20261103020000_visit_halal.sql，之前一直没跑）
-- 2) 错误上报：网页出错时记一条（只记错误类型、页面、浏览器型号），用户只能写不能读
-- 3) 自助删除账号：删掉本人账号和它的全部数据

-- 1) 清真
alter table public.visits add column if not exists halal text
  check (halal is null or halal in ('halal','porkfree','nonhalal'));
grant update (halal) on public.visits to authenticated;

-- 2) 错误上报
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  kind text not null check (char_length(kind) between 1 and 40),
  message text check (char_length(message) <= 300),
  page text check (char_length(page) <= 80),
  ua text check (char_length(ua) <= 200),
  app text check (char_length(app) <= 40)
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant insert (kind, message, page, ua, app) on public.client_errors to anon, authenticated;
drop policy if exists "client_errors: write only" on public.client_errors;
create policy "client_errors: write only" on public.client_errors for insert to anon, authenticated
  with check (user_id is not distinct from auth.uid());
create index if not exists client_errors_recent on public.client_errors (created_at desc);

-- 一个号每小时最多记 30 条，没登录的所有人合计每小时 300 条；超了就悄悄丢掉，不报错
create or replace function public.client_errors_cap() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if (select count(*) from public.client_errors
      where user_id is not distinct from new.user_id and created_at > now() - interval '1 hour')
     >= (case when new.user_id is null then 300 else 30 end) then
    return null;
  end if;
  delete from public.client_errors where created_at < now() - interval '60 days';
  return new;
end $$;
revoke all on function public.client_errors_cap() from public, anon, authenticated;
drop trigger if exists client_errors_cap on public.client_errors;
create trigger client_errors_cap before insert on public.client_errors
  for each row execute function public.client_errors_cap();

-- 3) 自助删除账号（照片文件由网页先用存储接口删掉本人文件夹）
-- 删 auth.users 会顺着外键删掉 profiles，再删掉本人的记录、收藏、家、点赞、留言、私信、提醒、雪拼数据。
-- 先显式删记录，让“没人用的地点”触发器顺手清掉本人建的空地点；别人记录过的地点保留（created_by 变空）。
create or replace function public.xuetuan_delete_my_account() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare me_id uuid := auth.uid(); n int;
begin
  if me_id is null then raise exception using errcode='42501', message='Sign in first'; end if;
  if exists(select 1 from xuetuan_guard.admins where user_id = me_id) then
    raise exception using errcode='42501', message='XUETUAN_ADMIN_SELF_DELETE';
  end if;
  delete from public.visits where user_id = me_id;
  get diagnostics n = row_count;
  delete from public.wishlist where user_id = me_id;
  delete from public.client_errors where user_id = me_id;
  delete from auth.users where id = me_id;
  return jsonb_build_object('visits', n);
end $$;
revoke all on function public.xuetuan_delete_my_account() from public, anon;
grant execute on function public.xuetuan_delete_my_account() to authenticated;

notify pgrst, 'reload schema';
