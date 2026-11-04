import http from 'node:http';
import {createFixture,A,B,C,P} from './fixtures/bounded_database.mjs';
const db=await createFixture(process.argv[2]);
await db.exec(`reset role;alter table public.visits disable trigger user;alter table public.places disable trigger user;
delete from public.visits;delete from public.places;
insert into public.places(id,mode,cat,lat,lng,name,cc,created_by) select ('50000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case when i%2=0 then 'food' else 'travel' end,'other',case when i<5 then 2.83+i*.001 else (i*17%160)-80+.01 end,case when i<5 then 101.7+i*.001 else (i*37%360)-180+.01 end,'Synthetic place '||i,'MY','${C}' from generate_series(1,10000) i;
insert into public.visits(id,place_id,user_id,rating,visibility,text,photos,created_at,activity_at) select ('60000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('50000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${C}',4,'public','Synthetic post '||i,array['${C}/fixture.jpg'],'2026-11-01','2026-11-01' from generate_series(1,10000) i;
insert into public.visits(id,place_id,user_id,rating,visibility,text,photos,created_at,activity_at) select ('70000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'50000000-0000-4000-8000-000000000002','${C}',case when i%5=0 then 0 else 4 end,'public','Extra review '||i,array['${C}/fixture-'||i||'.jpg'],'2026-10-20','2026-10-20' from generate_series(1,45) i;
insert into public.visits(id,place_id,user_id,rating,visibility,text,photos,created_at,activity_at) select ('80000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('50000000-0000-4000-8000-'||lpad((i*500)::text,12,'0'))::uuid,'${B}',3,case when i<6 then 'private' else 'public' end,'My synthetic visit '||i,array['${B}/fixture.jpg'],'2026-10-15','2026-10-15' from generate_series(1,10) i;
alter table public.visits enable trigger user;alter table public.places enable trigger user;analyze public.visits;analyze public.places;`);
const counts={calls:0,byKind:{},bytes:0};
const server=http.createServer(async(req,res)=>{
res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','content-type');res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');res.setHeader('Access-Control-Allow-Private-Network','true');
if(req.method==='OPTIONS'){res.end();return;}
if(req.url==='/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(counts));return;}
try{let text='';for await(const chunk of req)text+=chunk;
const input=JSON.parse(text);let data;
await db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[input.actor||'']);await tx.exec(input.actor?'set local role authenticated':'set local role anon');data=(await tx.query('select public.xuetuan_read_page($1,$2::jsonb) d',[input.kind,JSON.stringify(input.args||{})])).rows[0].d;});
counts.calls++;counts.byKind[input.kind]=(counts.byKind[input.kind]||0)+1;const body=JSON.stringify({data,error:null});counts.bytes+=body.length;
if(input.delay)await new Promise(r=>setTimeout(r,Math.min(1000,input.delay)));
res.setHeader('Content-Type','application/json');res.end(body);
}catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e.message,code:e.code}}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,owner:B,peer:C})));
process.on('SIGTERM',()=>server.close(async()=>{await db.close();process.exit(0);}));
