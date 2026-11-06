import assert from 'node:assert/strict';
import {makeAltHandler} from '../supabase/functions/xuetuan-managed-alt/handler.mjs';
const MAIN='aaaaaaaa-0000-4000-8000-000000000001',ALT='bbbbbbbb-0000-4000-8000-000000000002';
let main,alt,created,linked,sent,profile,tokenUser;
function reset(){main={id:MAIN,email:'lijianan331@gmail.com',email_confirmed_at:'2026-11-02',is_anonymous:false,app_metadata:{existing_setting:'keep'}};alt=null;created=0;linked=0;sent=0;profile='';tokenUser=main;}
function createClient(url,key){
 if(key==='public')return {auth:{getUser:async()=>({data:{user:tokenUser},error:null}),verifyOtp:async()=>({data:{user:alt,session:{access_token:'alt-access',refresh_token:'alt-refresh'}},error:null})}};
 return {auth:{admin:{
  getUserById:async id=>({data:{user:id===MAIN?main:alt},error:null}),
  createUser:async body=>{created++;alt={id:ALT,email:body.email,email_confirmed_at:'2026-11-03',is_anonymous:false,app_metadata:body.app_metadata};return {data:{user:alt},error:null};},
  updateUserById:async(id,body)=>{linked++;assert.equal(id,MAIN);main.app_metadata=body.app_metadata;return {data:{user:main},error:null};},
  listUsers:async()=>({data:{users:alt?[alt]:[]},error:null}),
  generateLink:async body=>{assert.equal(body.email,alt.email);assert.equal(body.type,'magiclink');return {data:{properties:{hashed_token:'one-use'}},error:null};},
  inviteUserByEmail:async()=>{sent++;throw Error('Must not send mail');}
 }},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{name:profile},error:null})})}),update:p=>({eq:async()=>{profile=p.name;return {error:null};}})})};
}
const handler=makeAltHandler({createClient,url:'https://synthetic.invalid',key:'public',serviceKey:'private'});
const req=(token='valid',body={},origin='https://xuetuan.vercel.app')=>new Request('https://synthetic.invalid/functions/v1/xuetuan-managed-alt',{method:'POST',headers:{Authorization:token?'Bearer '+token:'',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
let n=0;const check=(name,ok)=>{assert.ok(ok,name);n++;console.log('PASS '+name);};
reset();let r=await handler(req(''));check('missing token denied',r.status===401 && created===0);
tokenUser=null;r=await handler(req());check('invalid token denied',r.status===401 && created===0);
reset();tokenUser={...main,email:'other@example.com'};r=await handler(req('valid',{owner_id:MAIN}));check('client cannot select another owner',r.status===403 && created===0);
reset();main.is_anonymous=true;r=await handler(req());check('guest owner denied',r.status===403 && created===0);
reset();main.email_confirmed_at=null;r=await handler(req());check('unverified owner denied',r.status===403 && created===0);
reset();r=await handler(req('valid',{},'https://evil.invalid'));check('unapproved browser origin denied',r.status===403 && created===0);
reset();r=await handler(req());let data=await r.json();check('verified owner receives a distinct managed session',r.status===200 && data.owner_id===MAIN && data.user_id===ALT && data.session.refresh_token==='alt-refresh');
check('main settings preserved and one second identity linked',created===1 && linked===1 && main.app_metadata.existing_setting==='keep' && main.app_metadata.xuetuan_alt_id===ALT);
check('no email sent and second profile initialized',sent===0 && profile==='lijianan331的小号');
check('token response is private and does not expose service credentials',r.headers.get('Cache-Control')==='no-store' && !JSON.stringify(data).includes('private'));
r=await handler(req());check('repeated switch reuses the same identity',r.status===200 && created===1);
alt.app_metadata={xuetuan_managed_alt:true,xuetuan_owner:'someone-else'};r=await handler(req());check('wrong-owner managed identity cannot be adopted',r.status===403);
reset();main.app_metadata={xuetuan_alt_id:ALT};alt={id:ALT,email:'wrong@example.com',email_confirmed_at:'today',app_metadata:{xuetuan_managed_alt:true,xuetuan_owner:MAIN}};r=await handler(req());check('arbitrary account links are rejected',r.status===403);
console.log(`${n}/${n} managed identity backend checks passed`);
