import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export const A='aaaaaaaa-0000-4000-8000-000000000001',B='bbbbbbbb-0000-4000-8000-000000000002',C='cccccccc-0000-4000-8000-000000000003',G='eeeeeeee-0000-4000-8000-000000000004';
export const P='11111111-0000-4000-8000-000000000001',V='22222222-0000-4000-8000-000000000001',W='22222222-0000-4000-8000-000000000002';
export async function createFixture(path){const {PGlite}=await import(pathToFileURL(path).href);const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to anon,authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant select on storage.objects to anon;grant select,insert,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
for(const f of ['20261025065031_core_schema.sql','20261025065744_visits_rating_nullable_for_imports.sql','20261025065824_revoke_trigger_functions_from_api.sql','20261026135702_homes.sql','20261027090709_visits_half_star_rating.sql','20261027120500_keep_saved_places.sql','20261028060000_photos_gif_video.sql','20261029093501_visit_post_title.sql','20261030064731_security_hardening.sql','20261101150000_profile_page_public.sql','20261102150713_post_interactions.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
await db.exec(`insert into auth.users(id,email_confirmed_at,is_anonymous) values('${A}',now(),false),('${B}',now(),false),('${C}',now(),false),('${G}',now(),true);
insert into xuetuan_guard.admins values('${A}');update public.profiles set name='Synthetic',page_public=true;
insert into public.places(id,mode,cat,lat,lng,name,created_by) values('${P}','food','other',2,101,'Synthetic','${B}');
insert into public.visits(id,place_id,user_id,visibility) values('${V}','${P}','${B}','public'),('${W}','${P}','${B}','private');`);

await db.exec(`reset role;grant select on public.wishlist to anon;alter table public.places add column cc text;alter table public.visits add column price_currency text;alter table public.profiles add column avatar text default '';`);
await db.exec(fs.readFileSync('supabase/migrations/20261102101500_wishlist_insert_fix.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261104072920_bounded_reads.sql','utf8'));
return db;}