-- 我的家：旅行大地图上的小房子。每人一个，只存到城市一级（城市名 + 大概位置）。
-- 默认不公开；公开的大家都能看到，不公开的只有自己能看到。
create table public.homes (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  city text not null check (char_length(city) between 1 and 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);
create index homes_public_idx on public.homes (is_public) where is_public;

-- 位置在数据库里再取整到 0.1 度（约 10 公里），就算有人绕过界面也存不了精确地址
create function public.homes_round() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.lat = round(new.lat::numeric, 1)::double precision;
  new.lng = round(new.lng::numeric, 1)::double precision;
  new.updated_at = now();
  return new;
end $$;
create trigger homes_round before insert or update on public.homes
  for each row execute function public.homes_round();
revoke execute on function public.homes_round() from public, anon, authenticated;

alter table public.homes enable row level security;
create policy "homes: read public or own" on public.homes for select
  using (is_public or user_id = (select auth.uid()));
create policy "homes: insert own" on public.homes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "homes: update own" on public.homes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "homes: delete own" on public.homes for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.homes to anon, authenticated;
grant insert, update, delete on public.homes to authenticated;
