-- 头像照片（用户 2026-11-02 选“换成照片”）：profiles.avatar 存照片桶里的路径，只能是自己文件夹下的 avatar-*.jpg。
-- 别人能看到：照片读取规则里加一条“被某个 profile 当头像用的照片（和它的小图）”。
alter table public.profiles add column if not exists avatar text
  check (avatar is null or (char_length(avatar) <= 120 and avatar ~ ('^' || id::text || '/avatar-[A-Za-z0-9_-]+\.jpg$')));
grant update (avatar) on public.profiles to authenticated;

drop policy if exists "photos: read visible or own" on storage.objects;
create policy "photos: read visible or own" on storage.objects for select to anon, authenticated
using (bucket_id = 'photos' and (
  (storage.foldername(name))[1] = (select auth.uid())::text
  or public.xuetuan_moderatable_media(name)
  or exists (select 1 from public.profiles pf where pf.avatar is not null and (pf.avatar = storage.objects.name or regexp_replace(pf.avatar, '\.jpg$', '_t.jpg') = storage.objects.name))
  or exists (
    select 1 from public.visits v where
      v.photos @> array[storage.objects.name]
      or exists(select 1 from unnest(v.photos) p
        where regexp_replace(p, '\.(jpg|gif|mp4|mov|webm)$', '_t.jpg', 'i') = storage.objects.name)
  )
));
