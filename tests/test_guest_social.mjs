// Actual PostgreSQL functions, grants and ownership checks. Synthetic accounts only; no cloud writes.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href), db=new PGlite();
const A='aaaaaaaa-0000-4000-8000-000000000001',B='bbbbbbbb-0000-4000-8000-000000000002',C='cccccccc-0000-4000-8000-000000000003',G='eeeeeeee-0000-4000-8000-000000000004',D='dddddddd-0000-4000-8000-000000000001';
const V='22222222-0000-4000-8000-000000000001',W='22222222-0000-4000-8000-000000000002',P='11111111-0000-4000-8000-000000000001';
const c1='33333333-0000-4000-8000-000000000001',c2='33333333-0000-4000-8000-000000000002',c3='33333333-0000-4000-8000-000000000003';
let passed=0;
const check=(name,ok)=>{if(!ok)throw Error(name);console.log('PASS '+name);passed++;};
async function deny(name,sql,pattern=/permission|XUETUAN|denied|Invalid|unavailable|already used|Admin|row-level security/i){try{await db.exec(sql);}catch(e){check(name,pattern.test(e.message));return;}throw Error('Allowed: '+name);}
async function actor(id,device=D){await db.exec(`reset role;set request.jwt.claim.sub='${id||''}';set request.headers='{"x-xuetuan-device":"${device}"}';set role ${id?'authenticated':'anon'}`);}
const read=async(id=V,at=null,cursor=null)=>(await db.query('select public.xuetuan_post_social($1,$2,$3) as d',[id,at,cursor])).rows[0].d;
const write=async(action,id=V,body='',target=null,request=null,liked=null)=>(await db.query('select public.xuetuan_social_write($1,$2,$3,$4,$5,$6) as d',[action,id,body,target,request,liked])).rows[0].d;
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

await db.exec(`create function auth.jwt() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('is_anonymous',is_anonymous) from auth.users where id=auth.uid()$$`);
await db.exec(fs.readFileSync('supabase/migrations/20261101183000_guests_cannot_share.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261103074112_guest_social_interactions.sql','utf8'));
await actor(null);await deny('no identity still cannot forge an interaction',`select public.xuetuan_social_write('like','${V}',liked=>true)`);
await actor(G);await write('like',V,'',null,null,true);check('guest can like',(await read()).liked);await write('like',V,'',null,null,false);check('guest can unlike',!(await read()).liked);
const cg=crypto.randomUUID();await write('comment',V,'Guest comment',null,cg);check('guest can comment',(await read()).comments.some(c=>c.id===cg));
await deny('guest cannot read private post discussion',`select public.xuetuan_post_social('${W}')`);
await deny('guest cannot publish publicly',`insert into public.visits(place_id,user_id,visibility) values('${P}','${G}','public')`);
await db.exec(`insert into public.visits(place_id,user_id,visibility) values('${P}','${G}','private')`);check('guest can keep a private record',true);
await deny('guest cannot use moderator helper',`select public.xuetuan_moderate_comment('${cg}','delete')`);
await actor(A);await db.query('select public.xuetuan_moderate_comment($1,$2)',[cg,'delete_and_ban']);check('administrator can remove and ban guest comments',(await read()).comments.find(c=>c.id===cg).deleted);
await actor(G);await deny('banned guest cannot interact again',`select public.xuetuan_social_write('like','${V}',liked=>true)`);
await db.exec(`reset role;delete from xuetuan_guard.banned_users;delete from xuetuan_guard.banned_devices;delete from xuetuan_guard.write_windows;`);await actor(G);
for(let i=0;i<6;i++)await write('comment',V,'Guest rate '+i,null,crypto.randomUUID());await deny('guest comment limits remain enforced',`select public.xuetuan_social_write('comment','${V}','too many',request_id=>gen_random_uuid())`);
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261103060728_private_messages.sql','utf8'));await actor(G);await deny('guest still cannot use private messages',"select public.xuetuan_dm_read('inbox')");
console.log(`${passed}/${passed} guest interaction checks passed`);await db.close();
