-- Bounded reads, preserving caller RLS. Additive only: existing content/privacy stay intact.
begin;
create function public.xuetuan_activity_time(at timestamptz, paths text[]) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare result timestamptz := at; path text; digits text; n bigint; i int; ceiling_ms numeric := extract(epoch from now())*1000+86400000;
begin
 foreach path in array coalesce(paths[1:6],'{}') loop
  digits := substring(path from '(?:^|/)ph-([0-9a-z]{8})');
  if digits is not null then
   n:=0; for i in 1..8 loop n:=n*36+strpos('0123456789abcdefghijklmnopqrstuvwxyz',substring(digits,i,1))-1; end loop;
   if n>1600000000000 and n<=ceiling_ms then result:=greatest(result,to_timestamp(n/1000.0)); end if;
  end if;
 end loop;
 return result;
end $$;
revoke all on function public.xuetuan_activity_time(timestamptz,text[]) from public;
grant execute on function public.xuetuan_activity_time(timestamptz,text[]) to anon,authenticated;

alter table public.visits add column activity_at timestamptz;
-- Backfill only the new column; preserve existing audit timestamps and guard state.
do $$ declare names text[]; states "char"[]; r record; i int; before_hash text; after_hash text; begin
 select md5(string_agg(md5((to_jsonb(v)-'activity_at')::text),'|' order by id)) into before_hash from public.visits v;
 for r in select tgname,tgenabled from pg_trigger where tgrelid='public.visits'::regclass and not tgisinternal and tgenabled<>'D' loop
  names:=array_append(names,r.tgname); states:=array_append(states,r.tgenabled);
  execute format('alter table public.visits disable trigger %I',r.tgname);
 end loop;
 update public.visits set activity_at=public.xuetuan_activity_time(created_at,photos);
 select md5(string_agg(md5((to_jsonb(v)-'activity_at')::text),'|' order by id)) into after_hash from public.visits v;
 if before_hash is distinct from after_hash then raise exception 'Backfill changed existing visit data'; end if;
 if names is not null then for i in 1..cardinality(names) loop
  execute format('alter table public.visits enable %s trigger %I',case states[i] when 'A' then 'always' when 'R' then 'replica' else '' end,names[i]);
 end loop; end if;
end $$;
alter table public.visits alter column activity_at set not null;
create function public.xuetuan_set_activity() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.activity_at:=public.xuetuan_activity_time(new.created_at,new.photos); return new; end $$;
revoke all on function public.xuetuan_set_activity() from public,anon,authenticated;
create trigger visits_activity before insert or update on public.visits for each row execute function public.xuetuan_set_activity();

create index visits_feed_activity_idx on public.visits(activity_at desc,id desc) where visibility='public' and cardinality(photos)>0;
create index visits_feed_rating_idx on public.visits((coalesce(rating,-1)) desc,activity_at desc,id desc) where visibility='public' and cardinality(photos)>0;
create index visits_place_activity_idx on public.visits(place_id,activity_at desc,id desc);
create index visits_owner_cursor_idx on public.visits(user_id,id);
create index places_viewport_idx on public.places(mode,lng,lat,id);

-- One place's exact summary is independent of which review page is loaded.
create function public.xuetuan_place_summary(pid uuid, scope text default 'all') returns jsonb
language sql stable security invoker set search_path='' as $$
 with visible as materialized (
  select v.id,v.rating,v.price,v.price_currency,v.photos,v.visibility,v.activity_at from public.visits v where v.place_id=pid
   and (v.visibility='public' or (scope='saved' and v.user_id=(select auth.uid())))
 ), scored as (
  select rating from visible where rating is not null and (scope<>'saved' or visibility='public')
 ), prices as (
  select coalesce(price_currency,'') currency,sum(price) total,count(*) n from visible where price>0 group by 1
 )
 select jsonb_build_object(
  'count',(select count(*) from visible),
  'own',(select count(*) from public.visits where place_id=pid and user_id=(select auth.uid())),
  'score',(select case when count(*) filter(where rating>0)>0 then round(avg(rating) filter(where rating>0),1) when count(*)>0 then 0 end from scored),
  'raters',(select case when count(*) filter(where rating>0)>0 then count(*) filter(where rating>0) else count(*) end from scored),
  'zeros',(select case when count(*) filter(where rating>0)>0 then count(*) filter(where rating=0) else 0 end from scored),
  'photoCount',(select count(distinct photo) from visible v cross join lateral unnest(v.photos) photo),
  'cover',(select photos[1] from visible where cardinality(photos)>0 order by activity_at desc,id desc limit 1),
  'prices',coalesce((select jsonb_agg(jsonb_build_object('currency',currency,'total',total,'count',n)) from prices),'[]'::jsonb)
 )
$$;
revoke all on function public.xuetuan_place_summary(uuid,text) from public;
grant execute on function public.xuetuan_place_summary(uuid,text) to anon,authenticated;

create function public.xuetuan_read_page(kind text, args jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid := auth.uid(); result jsonb; rows jsonb; lim int; pid uuid;
 after_id uuid; after_at timestamptz; after_rating numeric; ordering text; cursor_clause text;
 q_mode text; wanted_scope text; west float8; east float8; south float8; north float8; z int; cells float8; grid_area float8;
begin
 if kind='boot' then
  return jsonb_build_object('version',2,'actor',actor,
   'profile',(select to_jsonb(p) from public.profiles p where p.id=actor),
   'admin',public.xuetuan_is_admin(),
   'wishlist',coalesce((select jsonb_agg(to_jsonb(w)) from public.wishlist w where w.user_id=actor),'[]'::jsonb),
   'homes',coalesce((select jsonb_agg(to_jsonb(h)||jsonb_build_object('owner',jsonb_build_object('name',p.name))) from public.homes h join public.profiles p on p.id=h.user_id where h.user_id=actor),'[]'::jsonb),
   'homeCount',(select count(*) from public.homes where is_public));
 elsif kind='feed' then
  lim:=least(40,greatest(1,coalesce((args->>'limit')::int,20)));
  after_id:=(args->'cursor'->>'id')::uuid; after_at:=(args->'cursor'->>'at')::timestamptz; after_rating:=(args->'cursor'->>'rating')::numeric;
  if args->>'sort'='rating' then
   ordering:='coalesce(v.rating,-1) desc,v.activity_at desc,v.id desc';
   cursor_clause:='($4 is null or (coalesce(v.rating,-1),v.activity_at,v.id)<($6,$5,$4))';
  else ordering:='v.activity_at desc,v.id desc'; cursor_clause:='($4 is null or (v.activity_at,v.id)<($5,$4))'; end if;
  execute 'select coalesce(jsonb_agg(row),''[]''::jsonb) from (select to_jsonb(v)||jsonb_build_object(''author'',jsonb_build_object(''name'',a.name,''page_public'',a.page_public,''avatar'',a.avatar),''place'',to_jsonb(p)) row from public.visits v join public.places p on p.id=v.place_id join public.profiles a on a.id=v.user_id where v.visibility=''public'' and cardinality(v.photos)>0 and ($1=''all'' or p.mode=$1) and ($2=0 or v.activity_at>=now()-make_interval(days=>$2)) and ($3=0 or v.rating>=$3) and '||cursor_clause||' order by '||ordering||' limit $7) q'
   into rows using coalesce(args->>'mode','all'),least(36500,greatest(0,coalesce((args->>'days')::int,30))),greatest(0,coalesce((args->>'min')::numeric,0)),after_id,after_at,coalesce(after_rating,-1),lim+1;
  result:=jsonb_build_object('version',2,'actor',actor,'any',exists(select 1 from public.visits where visibility='public' and cardinality(photos)>0),'more',jsonb_array_length(rows)>lim,'rows',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality e(v,n) where n<=lim));
  return result;
 elsif kind='place' then
  pid:=(args->>'id')::uuid;after_id:=(args->>'after')::uuid;after_at:=(args->>'at')::timestamptz;
  select coalesce(jsonb_agg(row order by activity_at desc,id desc),'[]'::jsonb) into rows from (
   select v.id,v.activity_at,to_jsonb(v)||jsonb_build_object('author',jsonb_build_object('name',a.name,'page_public',a.page_public,'avatar',a.avatar),'place',to_jsonb(p)) row
   from public.visits v join public.places p on p.id=v.place_id join public.profiles a on a.id=v.user_id
   where v.place_id=pid and (after_id is null or (v.activity_at,v.id)<(after_at,after_id)) order by v.activity_at desc,v.id desc limit 21
  ) q;
  return jsonb_build_object('version',2,'actor',actor,'more',jsonb_array_length(rows)>20,
   'rows',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality e(v,n) where n<=20),
   'place',(select to_jsonb(p) from public.places p where p.id=pid),
   'summary',public.xuetuan_place_summary(pid,'all'),'savedSummary',public.xuetuan_place_summary(pid,'saved'));
 elsif kind in ('own','person','post') then
  lim:=case when kind in ('own','person') then 250 else 20 end;
  pid:=(args->>'id')::uuid; after_id:=(args->>'after')::uuid;
  if kind='own' and actor is null then return jsonb_build_object('version',2,'actor',actor,'more',false,'rows','[]'::jsonb); end if;
  select coalesce(jsonb_agg(row order by id),'[]'::jsonb) into rows from (
   select v.id,to_jsonb(v)||jsonb_build_object('author',jsonb_build_object('name',a.name,'page_public',a.page_public,'avatar',a.avatar),'place',to_jsonb(p)) row
   from public.visits v join public.places p on p.id=v.place_id join public.profiles a on a.id=v.user_id
   where ((kind='own' and v.user_id=actor) or (kind='person' and v.user_id=pid and v.visibility='public') or (kind='place' and v.place_id=pid) or (kind='post' and v.id=pid))
    and (after_id is null or v.id>after_id) order by v.id limit lim+1
  ) q;
  return jsonb_build_object('version',2,'actor',actor,'more',jsonb_array_length(rows)>lim,
   'rows',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality e(v,n) where n<=lim),
   'place',case when kind='place' then (select to_jsonb(p) from public.places p where p.id=pid) end,
   'summary',case when kind='place' then public.xuetuan_place_summary(pid,'all') end,
   'savedSummary',case when kind='place' then public.xuetuan_place_summary(pid,'saved') end);
 elsif kind='homes' then
  return jsonb_build_object('version',2,'actor',actor,'homes',coalesce((select jsonb_agg(to_jsonb(h)||jsonb_build_object('owner',jsonb_build_object('name',p.name))) from public.homes h join public.profiles p on p.id=h.user_id),'[]'::jsonb));
 elsif kind in ('map','search') then
  wanted_scope:=case when args->>'scope'='saved' then 'saved' else 'all' end;
  q_mode:=coalesce(args->>'mode','food');
  if q_mode not in ('food','travel') then raise exception 'Invalid mode'; end if;
  west:=greatest(-180,least(180,coalesce((args->>'west')::float8,-180)));
  east:=greatest(-180,least(180,coalesce((args->>'east')::float8,180)));
  south:=greatest(-90,least(90,coalesce((args->>'south')::float8,-90)));
  north:=greatest(-90,least(90,coalesce((args->>'north')::float8,90)));
  z:=greatest(0,least(22,coalesce((args->>'zoom')::int,15)));
  cells:=power(2,z+3); after_id:=(args->>'after')::uuid;
  grid_area:=greatest(.000001,(case when west<=east then east-west else 360-west+east end)/360)*greatest(.000001,abs(ln(tan(pi()/4+radians(greatest(-85,least(85,north)))/2))-ln(tan(pi()/4+radians(greatest(-85,least(85,south)))/2)))/(2*pi()));
  cells:=least(cells,sqrt(400/grid_area));
  if south>north then raise exception 'Invalid bounds'; end if;
  -- Low zoom returns spatial groups, rather than every individual place/review.
  if kind='map' and z<10 and wanted_scope='all' and not coalesce((args->>'filtered')::boolean,false) then
   with candidates as materialized (
    select p.*,floor((p.lng+180)/360*cells) gx,floor((1-ln(tan(pi()/4+radians(greatest(-85,least(85,p.lat)))/2))/pi())/2*cells) gy
    from public.places p where p.mode=q_mode and p.lat between south and north and (case when west<=east then p.lng between west and east else p.lng>=west or p.lng<=east end)
     and exists(select 1 from public.visits v where v.place_id=p.id and v.visibility='public')
   ), grouped as (
    select gx,gy,count(*) n,min(id::text)::uuid single_id,avg(lng) lng,avg(lat) lat,min(lng) w,min(lat) s,max(lng) e,max(lat) n_lat from candidates group by gx,gy
   )
   select coalesce(jsonb_agg(case when g.n=1 then jsonb_build_object('place',(select to_jsonb(p)-'gx'-'gy' from candidates p where p.id=g.single_id),'summary',public.xuetuan_place_summary(g.single_id,'all'))
    else jsonb_build_object('group',true,'count',g.n,'lng',g.lng,'lat',g.lat,'bounds',jsonb_build_array(g.w,g.s,g.e,g.n_lat),'zoom',z+2) end),'[]'::jsonb) into rows from grouped g;
   return jsonb_build_object('version',2,'actor',actor,'rows',rows,'more',false);
  end if;
  lim:=case when kind='search' then 25 else 250 end;
  select coalesce(jsonb_agg(jsonb_build_object('place',to_jsonb(p),'summary',public.xuetuan_place_summary(p.id,wanted_scope)) order by p.id),'[]'::jsonb) into rows
   from (select p.* from public.places p where
    (kind='search' or (p.mode=q_mode and (wanted_scope='saved' or (p.lat between south and north and (case when west<=east then p.lng between west and east else p.lng>=west or p.lng<=east end)))))
    and (wanted_scope<>'saved' or exists(select 1 from public.wishlist w where w.place_id=p.id and w.user_id=actor))
    and (kind<>'search' or (length(trim(coalesce(args->>'query','')))>=1 and (strpos(lower(p.name),lower(trim(args->>'query')))>0 or strpos(lower(p.alt_name),lower(trim(args->>'query')))>0)))
    and (after_id is null or p.id>after_id)
    and (wanted_scope='saved' or exists(select 1 from public.visits v where v.place_id=p.id and (v.visibility='public' or (kind='search' and v.user_id=actor))))
    order by p.id limit lim+1) p;
  return jsonb_build_object('version',2,'actor',actor,'more',jsonb_array_length(rows)>lim,'rows',(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality e(v,n) where n<=lim));
 end if;
 raise exception 'Invalid read kind';
end $$;
revoke all on function public.xuetuan_read_page(text,jsonb) from public;
grant execute on function public.xuetuan_read_page(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
