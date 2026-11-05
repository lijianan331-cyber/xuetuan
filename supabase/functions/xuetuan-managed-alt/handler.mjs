// A managed second identity for the verified owner only. No client-supplied owner/target IDs.
const OWNER_EMAIL='lijianan331@gmail.com';
const origins=new Set(['https://xuetuan.vercel.app','https://xuetuan-git-claude-project-thread-ze8a57-ganan1.vercel.app']);
export function makeAltHandler({createClient,url,key,serviceKey}) {
  return async function(req) {
    const origin=req.headers.get('origin')||'';
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-xuetuan-device','Access-Control-Allow-Methods':'POST, OPTIONS'};
    if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
    const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers});
    if(origin && !origins.has(origin))return reply(403,{error:'Origin not allowed'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply(405,{error:'POST required'});
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token || token.length>12000)return reply(401,{error:'Sign in required'});
    const publicClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    try {
      const {data,error}=await publicClient.auth.getUser(token);
      const owner=data?.user;
      if(error || !owner)return reply(401,{error:'Sign in required'});
      if(owner.is_anonymous || !owner.email_confirmed_at || String(owner.email).toLowerCase()!==OWNER_EMAIL)return reply(403,{error:'Owner account required'});
      const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      // Read server-controlled app_metadata afresh. user_metadata is never authorization input.
      const fresh=await admin.auth.admin.getUserById(owner.id);
      if(fresh.error || !fresh.data?.user)return reply(403,{error:'Owner unavailable'});
      const main=fresh.data.user,email='xuetuan-alt+'+owner.id+'@accounts.xuetuan.invalid';
      if(main.id!==owner.id || main.is_anonymous || !main.email_confirmed_at || String(main.email).toLowerCase()!==OWNER_EMAIL)return reply(403,{error:'Owner account required'});
      let alt=null;
      if(main.app_metadata?.xuetuan_alt_id){
        const found=await admin.auth.admin.getUserById(main.app_metadata.xuetuan_alt_id);
        if(found.error)return reply(409,{error:'Managed identity unavailable'});
        alt=found.data?.user;
      } else {
        const made=await admin.auth.admin.createUser({email,password:crypto.randomUUID()+crypto.randomUUID(),email_confirm:true,
          app_metadata:{xuetuan_managed_alt:true,xuetuan_owner:owner.id},user_metadata:{name:'lijianan331的小号'}});
        if(!made.error)alt=made.data?.user;
        else {
          // Recover an interrupted first setup; never adopt an unrelated account sharing an email.
          for(let page=1;page<=10 && !alt;page++){
            const users=await admin.auth.admin.listUsers({page,perPage:1000});
            if(users.error)break;
            alt=users.data.users.find(u=>u.email===email)||null;
            if(users.data.users.length<1000)break;
          }
        }
        if(!alt)return reply(409,{error:'Try setup again shortly'});
      }
      if(alt.email!==email || alt.id===owner.id || alt.app_metadata?.xuetuan_managed_alt!==true || alt.app_metadata?.xuetuan_owner!==owner.id || alt.is_anonymous || !alt.email_confirmed_at)return reply(403,{error:'Managed identity mismatch'});
      if(main.app_metadata?.xuetuan_alt_id!==alt.id){
        const linked=await admin.auth.admin.updateUserById(owner.id,{app_metadata:{...main.app_metadata,xuetuan_alt_id:alt.id}});
        if(linked.error)return reply(409,{error:'Could not link identity'});
      }
      const profile=await admin.from('profiles').select('name').eq('id',alt.id).single();
      if(!profile.error && !profile.data?.name){
        const named=await admin.from('profiles').update({name:'lijianan331的小号'}).eq('id',alt.id);
        if(named.error)return reply(503,{error:'Could not finish profile setup'});
      }
      // generateLink generates a one-use token; it does not send mail. Only a verified main session can reach here.
      const link=await admin.auth.admin.generateLink({type:'magiclink',email});
      if(link.error || !link.data?.properties?.hashed_token)return reply(503,{error:'Could not prepare identity session'});
      const signed=await publicClient.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
      const session=signed.data?.session;
      if(signed.error || !session || signed.data.user?.id!==alt.id)return reply(503,{error:'Could not start identity session'});
      return reply(200,{user_id:alt.id,owner_id:owner.id,session:{access_token:session.access_token,refresh_token:session.refresh_token}});
    }catch{return reply(503,{error:'Identity service unavailable'});}
  };
}
