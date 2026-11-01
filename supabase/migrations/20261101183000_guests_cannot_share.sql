-- 2026-11-01 刷屏之后（30 个游客号各发 1 条公开帖）：游客（匿名登录）只能存私密记录，
-- 绑定谷歌后才能分享到大地图、公开家乡、打开个人主页。用 restrictive policy，原来的“只能动自己的”规则不变。
begin;
create policy "visits: guests keep private" on public.visits as restrictive for insert to authenticated
  with check (visibility <> 'public' or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy "visits: guests keep private (update)" on public.visits as restrictive for update to authenticated
  using (true)
  with check (visibility <> 'public' or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy "homes: guests keep private" on public.homes as restrictive for insert to authenticated
  with check (not is_public or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy "homes: guests keep private (update)" on public.homes as restrictive for update to authenticated
  using (true)
  with check (not is_public or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
-- 已有的游客公开记录（刷屏以外的）改回私密
update public.visits set visibility = 'private'
  where visibility = 'public' and user_id in (select id from auth.users where is_anonymous);
update public.homes set is_public = false
  where is_public and user_id in (select id from auth.users where is_anonymous);
commit;
