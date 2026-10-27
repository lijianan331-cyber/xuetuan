-- 店名搜索用的地点库：马来西亚的 Overture 开放地点数据（只读）。
-- 数据来自 poi-data 分支的 data/*.tsv，导入方法见 docs/DEPLOY.md。
create extension if not exists pg_trgm with schema extensions;

create table public.poi (
  id text primary key,                 -- Overture 的地点 id
  name text not null,
  alt_name text not null default '',
  mode text not null check (mode in ('food', 'travel')),
  cat text not null,
  lat double precision not null,
  lng double precision not null,
  locality text not null default '',
  confidence real not null default 0,
  search text generated always as (lower(name || ' ' || alt_name)) stored
);
create index poi_search_trgm on public.poi using gin (search extensions.gin_trgm_ops);

alter table public.poi enable row level security;
create policy "poi is readable by everyone" on public.poi for select using (true);
-- 没有写入的 policy：只能用管理员身份导入

-- 搜索：名字越像、离 near 越近排得越前。near 为空就只看名字。
create function public.search_poi(
  q text,
  near_lat double precision default null,
  near_lng double precision default null,
  want_mode text default null,
  lim integer default 20
)
returns table (id text, name text, alt_name text, mode text, cat text, lat double precision, lng double precision, locality text, dist_m double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with qq as (
    select lower(trim(q)) as q,
           replace(replace(replace(lower(trim(q)), '\', '\\'), '%', '\%'), '_', '\_') as esc
  ),
  hits as (
    select p.*,
      case when near_lat is null or near_lng is null then null
           else 111320 * sqrt(power(p.lat - near_lat, 2) + power((p.lng - near_lng) * cos(radians(near_lat)), 2)) end as d
    from public.poi p, qq
    where length(qq.q) >= 2
      and (p.search like '%' || qq.esc || '%' or qq.q <% p.search)
      and (want_mode is null or p.mode = want_mode)
  )
  select h.id, h.name, h.alt_name, h.mode, h.cat, h.lat, h.lng, h.locality, h.d
  from hits h, qq
  order by
    (case when h.search like qq.esc || '%' then 0.6 when h.search like '%' || qq.esc || '%' then 0.4 else 0 end)
    + word_similarity(qq.q, h.search)
    + 0.15 * h.confidence
    - coalesce(least(1.0, ln(1 + h.d / 1000) / 6), 0) desc
  limit least(greatest(lim, 1), 50)
$$;

grant execute on function public.search_poi(text, double precision, double precision, text, integer) to anon, authenticated;
