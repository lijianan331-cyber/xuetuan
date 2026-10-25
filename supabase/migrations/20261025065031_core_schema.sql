-- 雪团 第 2 步：用户、地点、足迹记录、收藏

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 20),
  country text not null default '' check (char_length(country) <= 30),
  region text not null default '' check (char_length(region) <= 30),
  city text not null default '' check (char_length(city) <= 30),
  district text not null default '' check (char_length(district) <= 30),
  created_at timestamptz not null default now()
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('food', 'travel')),
  cat text not null check (char_length(cat) between 1 and 20),
  precision text not null default 'exact' check (precision in ('exact', 'area', 'city')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  name text not null check (char_length(name) between 1 and 60),
  alt_name text not null default '' check (char_length(alt_name) <= 60),
  link text not null default '' check (char_length(link) <= 500),
  osm text not null default '' check (char_length(osm) <= 40),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index places_created_by_idx on public.places (created_by);
create index places_osm_idx on public.places (osm) where osm <> '';

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 0 and 5),
  price numeric(10, 2) check (price > 0),
  text text not null default '' check (char_length(text) <= 1000),
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index visits_place_id_idx on public.visits (place_id);
create index visits_user_id_idx on public.visits (user_id);

create table public.wishlist (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index wishlist_place_id_idx on public.wishlist (place_id);

-- 新用户注册时自动建 profile
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger places_touch before update on public.places for each row execute function public.touch_updated_at();
create trigger visits_touch before update on public.visits for each row execute function public.touch_updated_at();

-- 地点不让客户端直接删：最后一条记录删掉时由这里顺带删掉地点（看得见看不见的记录都算）
create function public.drop_empty_place() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.visits where place_id = old.place_id) then
    delete from public.places where id = old.place_id;
  end if;
  return null;
end $$;
create trigger visits_drop_empty_place after delete on public.visits
  for each row execute function public.drop_empty_place();

-- RLS
alter table public.profiles enable row level security;
alter table public.places enable row level security;
alter table public.visits enable row level security;
alter table public.wishlist enable row level security;

create policy "profiles: everyone can read" on public.profiles for select using (true);
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 记录：公开的谁都能看，私密的只有自己
create policy "visits: read public or own" on public.visits for select
  using (visibility = 'public' or user_id = (select auth.uid()));
create policy "visits: insert own" on public.visits for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "visits: update own" on public.visits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "visits: delete own" on public.visits for delete to authenticated
  using (user_id = (select auth.uid()));

-- 地点：自己建的，或者有一条“我看得见的”记录（子查询同样受 visits 的 RLS 限制）
-- 所以只有别人私密记录的地点不会出现在公共地图
create policy "places: read if any visible visit" on public.places for select
  using (
    created_by = (select auth.uid())
    or exists (select 1 from public.visits v where v.place_id = places.id)
  );
create policy "places: insert own" on public.places for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "places: update own" on public.places for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

create policy "wishlist: read own" on public.wishlist for select to authenticated using (user_id = (select auth.uid()));
create policy "wishlist: insert own" on public.wishlist for insert to authenticated with check (user_id = (select auth.uid()));
create policy "wishlist: delete own" on public.wishlist for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.profiles, public.places, public.visits to anon, authenticated;
grant select, insert, update, delete on public.places, public.visits, public.wishlist to authenticated;
grant update (name, country, region, city, district) on public.profiles to authenticated;

-- 照片：公开读；只能往自己 user id 开头的文件夹里传、删
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg']);
create policy "photos: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos: delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
