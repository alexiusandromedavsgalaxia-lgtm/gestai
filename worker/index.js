const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const cors = (request, env) => {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.APP_ORIGIN || "").split(",").map(x => x.trim());
  return { "access-control-allow-origin": allowed.includes(origin) ? origin : (allowed.includes("*") ? "*" : allowed[0] || "null"), "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization", "access-control-allow-credentials": "true", "vary": "Origin" };
};
const response = (data, status, request, env) => { const r=json(data,status); const h=new Headers(r.headers); for(const [k,v] of Object.entries(cors(request,env)))h.set(k,v); return new Response(r.body,{status:r.status,headers:h}); };
const id = () => crypto.randomUUID();
const enc = new TextEncoder();
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", salt, iterations:150000, hash:"SHA-256" }, key, 256);
  return salt instanceof Uint8Array && arguments.length > 1 ? b64(salt)+"."+b64(bits) : b64(salt)+"."+b64(bits);
}
async function verifyPassword(password, stored) {
  const [s, expected] = stored.split(".");
  const salt = Uint8Array.from(atob(s), c=>c.charCodeAt(0));
  const actual = await hashPassword(password, salt);
  return constantTime(actual.split(".")[1], expected);
}
function constantTime(a,b){if(!a||!b||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
async function tokenFor(user, env) {
  const token=id()+id().replaceAll("-","");
  const digest=await crypto.subtle.digest("SHA-256",enc.encode(token));
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now', ?))").bind(b64(digest),user.id,`+${Number(env.SESSION_TTL_SECONDS||2592000)} seconds`).run();
  return token;
}
async function auth(request, env) {
  const raw=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!raw)return null;
  const digest=await crypto.subtle.digest("SHA-256",enc.encode(raw));
  return env.DB.prepare("SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>datetime('now')").bind(b64(digest)).first();
}
async function requireUser(request,env){return auth(request,env);}
function room(env, conversationId){return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(conversationId));}
async function notify(env, conversationId, event){try{await room(env,conversationId).fetch("https://room/broadcast",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(event)});}catch{}}
async function allowedConversation(env,user,conversationId){
 return env.DB.prepare("SELECT c.* FROM conversations c LEFT JOIN identities i ON i.id=c.identity_id WHERE c.id=? AND (c.client_id=? OR c.operator_id=? OR i.owner_id=?)").bind(conversationId,user.id,user.id,user.id).first();
}
export default {
 async fetch(request,env){
  if(request.method==="OPTIONS")return new Response(null,{headers:cors(request,env)});
  const url=new URL(request.url), path=url.pathname;
  try{
   if(path==="/api/health")return response({ok:true,service:"GestAI API",time:new Date().toISOString()},200,request,env);
   if(path==="/api/auth/register"&&request.method==="POST"){
    const body=await request.json(),email=String(body.email||"").trim().toLowerCase(),name=String(body.name||"").trim(),password=String(body.password||"");
    if(!/^\S+@\S+\.\S+$/.test(email)||name.length<2||password.length<10)return response({error:"Introduce un email válido, un nombre y una contraseña de al menos 10 caracteres."},400,request,env);
    const user={id:id(),email,display_name:name,role:body.operator?"operator":"client"};
    try{await env.DB.prepare("INSERT INTO users(id,email,display_name,password_hash,role) VALUES(?,?,?,?,?)").bind(user.id,email,name,await hashPassword(password),user.role).run();}
    catch{return response({error:"Ese correo ya está registrado."},409,request,env);}
    const token=await tokenFor(user,env);return response({token,user},201,request,env);
   }
   if(path==="/api/auth/login"&&request.method==="POST"){
    const body=await request.json(),email=String(body.email||"").trim().toLowerCase(),user=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if(!user||!await verifyPassword(String(body.password||""),user.password_hash))return response({error:"Correo o contraseña incorrectos."},401,request,env);
    const token=await tokenFor(user,env);return response({token,user:{id:user.id,email:user.email,display_name:user.display_name,role:user.role}},200,request,env);
   }
   const liveMatch=path.match(/^\\/api\\/conversations\\/([\\w-]+)\\/live$/);
   if(liveMatch && request.headers.get("Upgrade")==="websocket"){
    const wsToken=url.searchParams.get("token")||"";
    const wsRequest=new Request(request,{headers:new Headers({"Authorization":"Bearer "+wsToken})});
    const wsUser=await requireUser(wsRequest,env);
    if(!wsUser)return new Response("Unauthorized",{status:401});
    const wsConversation=await allowedConversation(env,wsUser,liveMatch[1]);
    if(!wsConversation)return new Response("Not found",{status:404});
    return room(env,liveMatch[1]).fetch("https://room/connect",{headers:{"Upgrade":"websocket"}});
   }
   const user=await requireUser(request,env);
   if(!user)return response({error:"Inicia sesión para continuar."},401,request,env);
   if(path==="/api/me")return response({user},200,request,env);
   if(path==="/api/identities"&&request.method==="GET"){
    const rows=await env.DB.prepare("SELECT i.id,i.name,i.description,i.context_limit,i.is_public,u.display_name AS owner_name FROM identities i JOIN users u ON u.id=i.owner_id WHERE i.is_public=1 OR i.owner_id=? ORDER BY i.created_at DESC").bind(user.id).all();
    return response({identities:rows.results},200,request,env);
   }
   if(path==="/api/identities"&&request.method==="POST"){
    const b=await request.json(),name=String(b.name||"").trim();if(name.length<2)return response({error:"El nombre debe tener al menos 2 caracteres."},400,request,env);
    const context=Math.min(2000000,Math.max(100000,Number(b.context_limit)||100000)),identity={id:id(),name,description:String(b.description||"").slice(0,500),system_prompt:String(b.instructions||"").slice(0,10000),context_limit:context,is_public:b.is_public?1:0};
    await env.DB.prepare("INSERT INTO identities(id,owner_id,name,description,system_prompt,context_limit,is_public) VALUES(?,?,?,?,?,?,?)").bind(identity.id,user.id,identity.name,identity.description,identity.system_prompt,identity.context_limit,identity.is_public).run();
    return response({identity},201,request,env);
   }
   if(path==="/api/conversations"&&request.method==="GET"){
    const rows=await env.DB.prepare("SELECT c.id,c.status,c.updated_at,i.name AS identity_name,u.display_name AS operator_name,(SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message FROM conversations c JOIN identities i ON i.id=c.identity_id LEFT JOIN users u ON u.id=c.operator_id WHERE c.client_id=? OR c.operator_id=? OR i.owner_id=? ORDER BY c.updated_at DESC").bind(user.id,user.id,user.id).all();
    return response({conversations:rows.results},200,request,env);
   }
   if(path==="/api/conversations"&&request.method==="POST"){
    const b=await request.json(),identity=await env.DB.prepare("SELECT * FROM identities WHERE id=? AND (is_public=1 OR owner_id=?)").bind(b.identity_id,user.id).first();
    if(!identity)return response({error:"Identidad no disponible."},404,request,env);
    const conversation={id:id(),identity_id:identity.id,client_id:user.id,operator_id:identity.owner_id===user.id?null:identity.owner_id,status:"open"};
    await env.DB.prepare("INSERT INTO conversations(id,identity_id,client_id,operator_id,status) VALUES(?,?,?,?,?)").bind(conversation.id,conversation.identity_id,conversation.client_id,conversation.operator_id,conversation.status).run();
    return response({conversation},201,request,env);
   }
   const convMatch=path.match(/^\/api\/conversations\/([\w-]+)$/);
   if(convMatch&&request.method==="GET"){
    const c=await allowedConversation(env,user,convMatch[1]);if(!c)return response({error:"Conversación no encontrada."},404,request,env);
    const [identity,messages]=await Promise.all([env.DB.prepare("SELECT id,owner_id,name,description,context_limit FROM identities WHERE id=?").bind(c.identity_id).first(),env.DB.prepare("SELECT m.id,m.sender_id,m.body,m.attachment_json,m.created_at,u.display_name,u.role FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at ASC LIMIT 500").bind(c.id).all()]);
    return response({conversation:c,identity,messages:messages.results.map(m=>({...m,attachment:m.attachment_json?JSON.parse(m.attachment_json):null}))},200,request,env);
   }
   const msgMatch=path.match(/^\/api\/conversations\/([\w-]+)\/messages$/);
   if(msgMatch&&request.method==="POST"){
    const c=await allowedConversation(env,user,msgMatch[1]);if(!c)return response({error:"Conversación no encontrada."},404,request,env);
    const b=await request.json(),body=String(b.body||"").trim(),attachment=b.attachment||null;
    if(!body&&!attachment)return response({error:"El mensaje está vacío."},400,request,env);
    const message={id:id(),conversation_id:c.id,sender_id:user.id,body:body.slice(0,12000),attachment_json:attachment?JSON.stringify(attachment):null,created_at:new Date().toISOString()};
    await env.DB.prepare("INSERT INTO messages(id,conversation_id,sender_id,body,attachment_json) VALUES(?,?,?,?,?)").bind(message.id,c.id,user.id,message.body,message.attachment_json).run();
    await env.DB.prepare("UPDATE conversations SET updated_at=datetime('now') WHERE id=?").bind(c.id).run();
    const event={type:"message",message:{...message,attachment}};
    await notify(env,c.id,event);
    return response({message:event.message},201,request,env);
   }
   const presence=path.match(/^\/api\/conversations\/([\w-]+)\/presence$/);
   if(presence&&request.method==="PATCH"){
    const c=await allowedConversation(env,user,presence[1]);if(!c)return response({error:"Conversación no encontrada."},404,request,env);
    if(user.role!=="operator"&&user.id!==c.operator_id)return response({error:"Solo un operador puede cambiar su disponibilidad."},403,request,env);
    const b=await request.json(),status=b.status==="offline"?"waiting":"open";
    await env.DB.prepare("UPDATE conversations SET status=?,updated_at=datetime('now') WHERE id=?").bind(status,c.id).run();
    await notify(env,c.id,{type:"presence",status:b.status||"online"});
    return response({ok:true,status},200,request,env);
   }
   const handoff=path.match(/^\/api\/conversations\/([\w-]+)\/handoff$/);
   if(handoff&&request.method==="POST"){
    const c=await allowedConversation(env,user,handoff[1]);if(!c)return response({error:"Conversación no encontrada."},404,request,env);
    if(user.role!=="operator"&&user.id!==c.operator_id)return response({error:"Solo el operador actual puede iniciar el relevo."},403,request,env);
    const b=await request.json(),snapshot=await env.DB.prepare("SELECT u.display_name,m.body,m.created_at FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at DESC LIMIT 100").bind(c.id).all();
    const target=await env.DB.prepare("SELECT id FROM users WHERE role='operator' AND id<>? ORDER BY created_at LIMIT 1").bind(user.id).first();
    if(!target)return response({error:"No hay otro operador disponible. La conversación sigue asignada."},409,request,env);
    const h={id:id(),conversation_id:c.id,from_operator_id:user.id,to_operator_id:target.id,context_snapshot:JSON.stringify(snapshot.results.reverse()),expires_at:new Date(Date.now()+7*60*1000).toISOString()};
    await env.DB.prepare("INSERT INTO handoffs(id,conversation_id,from_operator_id,to_operator_id,context_snapshot,expires_at) VALUES(?,?,?,?,?,?)").bind(h.id,c.id,h.from_operator_id,h.to_operator_id,h.context_snapshot,h.expires_at).run();
    await env.DB.prepare("UPDATE conversations SET operator_id=?,status='handoff' WHERE id=?").bind(target.id,c.id).run();
    await notify(env,c.id,{type:"handoff",status:"transferred",operator_id:target.id});
    return response({handoff:{id:h.id,expires_at:h.expires_at,operator_id:target.id,context:snapshot.results.reverse()}},201,request,env);
   }
   if(path==="/api/uploads"&&request.method==="POST"){
    if(!env.FILES)return response({error:"El almacenamiento R2 no está configurado."},503,request,env);
    const form=await request.formData(),file=form.get("file"),conversationId=String(form.get("conversation_id")||"");
    if(!file||typeof file==="string"||!conversationId)return response({error:"Falta el archivo o la conversación."},400,request,env);
    const c=await allowedConversation(env,user,conversationId);if(!c)return response({error:"Conversación no encontrada."},404,request,env);
    const max=Number(env.MAX_UPLOAD_BYTES||26214400);if(file.size>max)return response({error:"El archivo supera el límite permitido."},413,request,env);
    const key=`${conversationId}/${id()}/${file.name.replace(/[^\p{L}\p{N}._-]/gu,"_").slice(0,100)}`;
    await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
    const meta={key,name:file.name,type:file.type,size:file.size};
    return response({attachment:meta},201,request,env);
   }
   const download=path.match(/^\/api\/files\/(.+)$/);
   if(download&&request.method==="GET"){
    if(!env.FILES)return response({error:"Almacenamiento no configurado."},503,request,env);
    const key=decodeURIComponent(download[1]),conversationId=key.split("/")[0],c=await allowedConversation(env,user,conversationId);
    if(!c)return response({error:"Archivo no disponible."},404,request,env);
    const object=await env.FILES.get(key);if(!object)return response({error:"Archivo no encontrado."},404,request,env);
    const headers=new Headers();object.writeHttpMetadata(headers);headers.set("cache-control","private, no-store");return new Response(object.body,{headers});
   }
   if(path==="/api/operator/inbox"&&request.method==="GET"){
    
    const rows=await env.DB.prepare("SELECT c.id,c.status,c.updated_at,i.name AS identity_name,u.display_name AS client_name,(SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message FROM conversations c JOIN identities i ON i.id=c.identity_id JOIN users u ON u.id=c.client_id WHERE (c.operator_id=? OR i.owner_id=?) AND c.status<>'closed' ORDER BY c.updated_at DESC").bind(user.id,user.id).all();
    return response({inbox:rows.results},200,request,env);
   }
   if(path.startsWith("/api/"))return response({error:"Ruta no encontrada."},404,request,env);
   return env.ASSETS?env.ASSETS.fetch(request):new Response("GestAI API is running");
  }catch(error){return response({error:"Error interno del servidor.",detail:env.ENVIRONMENT==="development"?String(error):undefined},500,request,env);}
 }
};

export class ChatRoom {
 constructor(state){this.state=state;this.sessions=new Set();}
 async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==="/broadcast"&&request.method==="POST"){
   const event=await request.json(),payload=JSON.stringify(event);
   for(const ws of this.sessions)try{ws.send(payload);}catch{this.sessions.delete(ws);}
   return new Response("ok");
  }
  if(url.pathname==="/connect"){
   const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();this.sessions.add(server);
   server.addEventListener("close",()=>this.sessions.delete(server));server.addEventListener("error",()=>this.sessions.delete(server));
   server.send(JSON.stringify({type:"connected"}));
   return new Response(null,{status:101,webSocket:client});
  }
  return new Response("Not found",{status:404});
 }
}