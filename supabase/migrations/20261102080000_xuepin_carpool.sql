-- 雪拼（拼车）：和雪团共用账号和数据库，表名都用 xp_ 开头，不碰雪团原来的表。
-- 规则：
--   * 谁都能看拼车单和“几个人申请/上车”（不含联系方式）。
--   * 发单、申请、聊天、记行程都要登录，并且是绑定了谷歌的账号（游客号只能看，防刷）。
--   * 聊天只有发起人和申请过这一单的人能看。
--   * WhatsApp/微信只给同一单里已经拼上的人看（发起人 <-> 已同意的同学）。
--   * 同意/拒绝走 xp_decide()，在数据库里锁住这一单再算剩几个位置，不会超员。
begin;

create or replace function public.xp_full_account() returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
$$;
revoke all on function public.xp_full_account() from public;
grant execute on function public.xp_full_account() to anon, authenticated;

create table public.xp_rides (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  dir text not null check (dir in ('out', 'back')),
  place text not null check (place ~ '^[a-z0-9]{1,12}$'),
  alts text[] not null default '{}' check (cardinality(alts) <= 6),
  place_name text not null default '' check (char_length(place_name) <= 30),
  kind text not null check (kind in ('asap', 'at', 'before', 'range', 'loose')),
  time timestamptz not null,
  time_end timestamptz,
  period text not null default '' check (char_length(period) <= 4),
  have smallint not null check (have between 1 and 5),
  need smallint not null check (need between 1 and 5),
  fare numeric(7, 2) check (fare > 0 and fare <= 2000),
  note text not null default '' check (char_length(note) <= 60),
  raw text not null default '' check (char_length(raw) <= 80),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  check (have + need <= 6),
  check (time_end is null or time_end >= time)
);
create index xp_rides_time_idx on public.xp_rides (time desc);
create index xp_rides_owner_idx on public.xp_rides (owner);

create table public.xp_joins (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.xp_rides (id) on delete cascade,
  uid uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  count smallint not null default 1 check (count between 1 and 5),
  msg text not null default '' check (char_length(msg) <= 60),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (ride_id, uid)
);
create index xp_joins_uid_idx on public.xp_joins (uid);

create table public.xp_msgs (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.xp_rides (id) on delete cascade,
  uid uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  created_at timestamptz not null default now()
);
create index xp_msgs_ride_idx on public.xp_msgs (ride_id, created_at);

create table public.xp_contacts (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  wa text not null default '' check (char_length(wa) <= 20),
  wx text not null default '' check (char_length(wx) <= 30),
  updated_at timestamptz not null default now()
);

create table public.xp_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  dir text not null check (dir in ('out', 'back')),
  place text not null check (place ~ '^[a-z0-9]{1,12}$'),
  place_name text not null default '' check (char_length(place_name) <= 30),
  time timestamptz not null,
  created_at timestamptz not null default now()
);
create index xp_trips_user_idx on public.xp_trips (user_id);

alter table public.xp_rides enable row level security;
alter table public.xp_joins enable row level security;
alter table public.xp_msgs enable row level security;
alter table public.xp_contacts enable row level security;
alter table public.xp_trips enable row level security;

-- 默认权限收紧，只开需要的
revoke all on public.xp_rides, public.xp_joins, public.xp_msgs, public.xp_contacts, public.xp_trips from anon, authenticated;
grant select on public.xp_rides, public.xp_joins to anon, authenticated;
grant insert (dir, place, alts, place_name, kind, time, time_end, period, have, need, fare, note, raw) on public.xp_rides to authenticated;
grant update (status) on public.xp_rides to authenticated;
grant delete on public.xp_rides to authenticated;
grant insert (ride_id, count, msg) on public.xp_joins to authenticated;
grant delete on public.xp_joins to authenticated;
grant select, delete on public.xp_msgs to authenticated;
grant insert (ride_id, text) on public.xp_msgs to authenticated;
grant select, delete on public.xp_contacts to authenticated;
grant insert (wa, wx), update (wa, wx, updated_at) on public.xp_contacts to authenticated;
grant select, delete on public.xp_trips to authenticated;
grant insert (dir, place, place_name, time) on public.xp_trips to authenticated;

-- 拼车单
create policy "xp_rides: read all" on public.xp_rides for select to anon, authenticated using (true);
create policy "xp_rides: insert own" on public.xp_rides for insert to authenticated
  with check (owner = (select auth.uid()) and (select public.xp_full_account()));
create policy "xp_rides: update own" on public.xp_rides for update to authenticated
  using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy "xp_rides: delete own" on public.xp_rides for delete to authenticated
  using (owner = (select auth.uid()));

-- 申请
create policy "xp_joins: read all" on public.xp_joins for select to anon, authenticated using (true);
create policy "xp_joins: apply" on public.xp_joins for insert to authenticated
  with check (
    uid = (select auth.uid()) and status = 'pending' and decided_at is null
    and (select public.xp_full_account())
    and exists (select 1 from public.xp_rides r where r.id = ride_id and r.status = 'open' and r.owner <> (select auth.uid()))
  );
create policy "xp_joins: leave or remove" on public.xp_joins for delete to authenticated
  using (uid = (select auth.uid()) or exists (select 1 from public.xp_rides r where r.id = ride_id and r.owner = (select auth.uid())));

-- 聊天
create or replace function public.xp_in_ride(rid uuid, talking boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.xp_rides r where r.id = rid and r.owner = auth.uid())
      or exists (select 1 from public.xp_joins j where j.ride_id = rid and j.uid = auth.uid()
                 and (not talking or j.status in ('pending', 'accepted')))
$$;
revoke all on function public.xp_in_ride(uuid, boolean) from public, anon;
grant execute on function public.xp_in_ride(uuid, boolean) to authenticated;

create policy "xp_msgs: members read" on public.xp_msgs for select to authenticated
  using ((select public.xp_in_ride(ride_id, false)));
create policy "xp_msgs: members write" on public.xp_msgs for insert to authenticated
  with check (uid = (select auth.uid()) and (select public.xp_full_account()) and (select public.xp_in_ride(ride_id, true)));
create policy "xp_msgs: delete own" on public.xp_msgs for delete to authenticated
  using (uid = (select auth.uid()));

-- 联系方式：自己，或同一单里拼上了的人（发起人 <-> 已同意的同学）
create policy "xp_contacts: own or ride mates" on public.xp_contacts for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.xp_joins j join public.xp_rides r on r.id = j.ride_id
      where j.status = 'accepted' and (
        (r.owner = (select auth.uid()) and j.uid = xp_contacts.user_id)
        or (r.owner = xp_contacts.user_id and j.uid = (select auth.uid()))
      )
    )
  );
create policy "xp_contacts: insert own" on public.xp_contacts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.xp_full_account()));
create policy "xp_contacts: update own" on public.xp_contacts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "xp_contacts: delete own" on public.xp_contacts for delete to authenticated
  using (user_id = (select auth.uid()));

-- 我的行程：只有自己
create policy "xp_trips: own" on public.xp_trips for select to authenticated using (user_id = (select auth.uid()));
create policy "xp_trips: insert own" on public.xp_trips for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.xp_full_account()));
create policy "xp_trips: delete own" on public.xp_trips for delete to authenticated using (user_id = (select auth.uid()));

-- 同意 / 拒绝：只有发起人；锁住这一单再算位置
create or replace function public.xp_decide(join_id uuid, yes boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  j public.xp_joins;
  r public.xp_rides;
  taken int;
begin
  select * into j from public.xp_joins where id = join_id;
  if not found then raise exception using errcode = 'P0002', message = 'join not found'; end if;
  select * into r from public.xp_rides where id = j.ride_id for update;
  if r.owner is distinct from auth.uid() then raise exception using errcode = '42501', message = 'only the ride owner can decide'; end if;
  if j.status <> 'pending' then return j.status; end if;
  if yes then
    if r.status <> 'open' then raise exception using errcode = 'P0001', message = 'ride closed'; end if;
    select coalesce(sum(count), 0) into taken from public.xp_joins where ride_id = r.id and status = 'accepted';
    if taken + j.count > r.need then raise exception using errcode = 'P0001', message = 'not enough seats'; end if;
  end if;
  update public.xp_joins set status = case when yes then 'accepted' else 'declined' end, decided_at = now() where id = join_id;
  return case when yes then 'accepted' else 'declined' end;
end $$;
revoke all on function public.xp_decide(uuid, boolean) from public, anon;
grant execute on function public.xp_decide(uuid, boolean) to authenticated;

-- 防刷：一个人 24 小时最多发 10 单
create or replace function public.xp_rides_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.xp_rides where owner = new.owner and created_at > now() - interval '24 hours') >= 10 then
    raise exception using errcode = 'P0001', message = 'too many rides today';
  end if;
  return new;
end $$;
revoke all on function public.xp_rides_rate_limit() from public, anon, authenticated;
create trigger xp_rides_rate_limit before insert on public.xp_rides
  for each row execute function public.xp_rides_rate_limit();

-- 实时更新（页面开着时能马上看到申请和聊天；RLS 照样生效）
alter publication supabase_realtime add table public.xp_rides, public.xp_joins, public.xp_msgs;

commit;
