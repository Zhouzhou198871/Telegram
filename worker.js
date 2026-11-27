import { storefrontIconUrl } from "./product-icons.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = new Set([
    env.FRONTEND_ORIGIN || "https://shop.lynli.me",
    "https://shop.lynli.me",
    "https://admin.lynli.me",
    "https://admin-xiaochu.vercel.app",
    "https://zhouzhou198871.github.io"
  ]);
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key,X-Admin-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  else if (!origin) headers["Access-Control-Allow-Origin"] = env.FRONTEND_ORIGIN || "https://shop.lynli.me";
  return headers;
}

function reply(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
  });
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function unb64url(s) {
  const base = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base + "=".repeat((4 - base.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}


async function hashPassword(password) {
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
 const bits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:210000},key,256));
 return "pbkdf2-sha256$210000$"+b64url(salt)+"$"+b64url(bits);
}
async function verifyPassword(password,stored) {
 if(typeof stored!=="string")return false;
 // Qingtian legacy account format: SHA256("lynli$" + password). This is
 // accepted only as a migration bridge; successful login upgrades it to PBKDF2.
 if(/^[a-f0-9]{64}$/i.test(stored)){
  try{
   const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode("lynli$"+password)));
   const actual=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
   let diff=0;for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^stored.toLowerCase().charCodeAt(i);
   return diff===0;
  }catch{return false}
 }
 const p=stored.split("$");
 try {
  let salt,expected,iterations;
  if(p.length===4&&p[0]==="pbkdf2"&&p[1]==="100000"&&/^[a-f0-9]{32}$/i.test(p[2])&&/^[a-f0-9]{64}$/i.test(p[3])){
   // Legacy Cloudflare AUTH_DB format: the 32-character hex salt was used as UTF-8 bytes.
   salt=new TextEncoder().encode(p[2]);
   expected=Uint8Array.from(p[3].match(/.{2}/g),x=>parseInt(x,16));
   iterations=100000;
  } else if(p.length===4&&p[0]==="pbkdf2-sha256"&&p[1]==="210000"){
   salt=unb64url(p[2]);expected=unb64url(p[3]);iterations=210000;
  } else return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const actual=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations},key,256));
  if(actual.length!==expected.length)return false;
  let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];
  return diff===0;
 }catch{return false}
}
function validPassword(password){return typeof password==="string"&&password.length>=8&&password.length<=20&&/[A-Za-z]/.test(password)&&/\d/.test(password)}


async function signToken(payload, secret) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const input = header + "." + body;
  return input + "." + b64url(await hmac(secret, input));
}

async function verifyToken(request, env) {
 const h=request.headers.get("Authorization")||"";if(!h.startsWith("Bearer "))throw new Error("auth_required");
 const t=h.slice(7).trim(),p=t.split(".");if(p.length!==3)throw new Error("invalid_token");
 const input=p[0]+"."+p[1],sig=b64url(await hmac(env.JWT_SECRET||"",input));if(!env.JWT_SECRET||sig!==p[2])throw new Error("invalid_token");
 let payload;try{payload=JSON.parse(new TextDecoder().decode(unb64url(p[1])))}catch{throw new Error("invalid_token")}
 if(!payload.sub||!Number.isInteger(payload.exp)||payload.exp<=Math.floor(Date.now()/1000))throw new Error("token_expired");
 const session=await env.DB.prepare("SELECT token_version FROM users WHERE id=?").bind(payload.sub).first();
 if(!session||Number(payload.ver||0)!==Number(session.token_version||0))throw new Error("token_revoked");return payload;
}
function amountUnits(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{1,10}(\.\d{1,4})?$/.test(s)) return null;
  const parts = s.split(".");
  const units = Number(parts[0]) * 10000 + Number(((parts[1] || "") + "0000").slice(0, 4));
  return Number.isSafeInteger(units) && units > 0 ? units : null;
}

function money(units) {
  return Math.floor(units / 10000) + "." + String(units % 10000).padStart(4, "0");
}

function validEmail(email) {
  return typeof email === "string" && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function originRequest(env, method, path, payload) {
  if (typeof env.INTERNAL_HANDLER === "function") {
    return await env.INTERNAL_HANDLER(method, path, payload);
  }
  const signingSecret = env.INTERNAL_API_SECRET;
  if (!env.SERVER_ORIGIN || !signingSecret) throw new Error("origin_not_configured");
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signed = ts + "\n" + nonce + "\n" + method.toUpperCase() + "\n" + path + "\n" + body;
  const signature = Array.from(await hmac(signingSecret, signed))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const url = new URL(path, env.SERVER_ORIGIN);
  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(payload && payload.order_id ? { "Idempotency-Key": String(payload.order_id) } : {}),
      "X-Worker-Timestamp": ts,
      "X-Worker-Nonce": nonce,
      "X-Worker-Signature": signature
    },
    body: method === "GET" ? undefined : body
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error("origin_http_" + response.status);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

const INTERNAL_CNY_PER_USDT = 4;
const API_MIN_BALANCE_CNY = 500;
const API_MIN_BALANCE_UNITS = 1250000; // ¥500 at ¥4/USDT and 10,000 internal units/USDT.
let apiLedgerSchemaReady = false;

function makeReferralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function ensureReferralCode(env, user) {
  if (user.referral_code) return user.referral_code;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = makeReferralCode();
    await env.DB.prepare("UPDATE users SET referral_code=? WHERE id=? AND referral_code IS NULL").bind(code, user.id).run();
    const row = await env.DB.prepare("SELECT referral_code FROM users WHERE id=?").bind(user.id).first();
    if (row?.referral_code) return row.referral_code;
  }
  throw new Error("referral_code_unavailable");
}

async function findUserById(env, id) {
  return await env.DB.prepare(
    "SELECT id,email,tg_user_id,balance,balance_units,verify_code,code_expires,code_sent_at,code_attempts,nickname,avatar_data_url,referrer_user_id,referral_code FROM users WHERE id=?"
  ).bind(id).first();
}

async function sendCode(request, env) {
  if (!env.CODE_PEPPER) return reply(request, env, { ok: false, error: "auth_not_configured" }, 503);
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!validEmail(email)) return reply(request, env, { ok: false, error: "invalid_email" }, 400);
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare("SELECT id,code_sent_at FROM users WHERE email=?").bind(email).first();
  const referralCode = String(body.referral_code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const referrer = !existing && referralCode
    ? await env.DB.prepare("SELECT id FROM users WHERE referral_code=?").bind(referralCode).first()
    : null;
  if (existing && existing.code_sent_at && now - Number(existing.code_sent_at) < 60) {
    return reply(request, env, { ok: false, error: "too_many_requests", retry_after: 60 - (now - Number(existing.code_sent_at)) }, 429);
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const digest = b64url(await sha256(env.CODE_PEPPER + "|" + email + "|" + code));
  const userId = existing?.id || crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id,email,balance,balance_units,verify_code,code_expires,code_sent_at,code_attempts,created_at,updated_at,referrer_user_id) VALUES (?,?, '0.0000',0,?,?,?,0,?,?,?) ON CONFLICT(email) DO UPDATE SET verify_code=excluded.verify_code,code_expires=excluded.code_expires,code_sent_at=excluded.code_sent_at,code_attempts=0,updated_at=excluded.updated_at"
  ).bind(userId, email, digest, now + 300, now, now, now, referrer?.id || null).run();
  const registerIp = String(request.headers.get("CF-Connecting-IP") || String(request.headers.get("X-Forwarded-For") || "").split(",")[0] || "").trim().slice(0,80);
  if(registerIp) await env.DB.prepare("UPDATE users SET registered_ip=COALESCE(registered_ip,?) WHERE email=?").bind(registerIp,email).run().catch(()=>null);
  try {
    await originRequest(env, "POST", "/api/internal/send_email", { email, code });
  } catch {
    await env.DB.prepare("UPDATE users SET verify_code=NULL,code_expires=NULL WHERE email=?").bind(email).run();
    return reply(request, env, { ok: false, error: "email_delivery_failed" }, 502);
  }
  return reply(request, env, { ok: true, message: "验证码已发送，请检查邮箱。" });
}

async function recordUserLogin(env,userId,request,now){
  try{
    const forwarded=String(request.headers.get("X-Forwarded-For")||"").split(",")[0].trim();
    const ip=String(request.headers.get("CF-Connecting-IP")||forwarded||"").trim().slice(0,80);
    const ua=String(request.headers.get("User-Agent")||"").slice(0,512);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO user_login_events(event_id,user_id,ip,user_agent,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),userId,ip||null,ua,now),
      env.DB.prepare("UPDATE users SET last_login_ip=?,last_login_at=?,login_count=COALESCE(login_count,0)+1 WHERE id=?").bind(ip||null,now,userId)
    ]);
  }catch{}
}
async function login(request, env) {
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const email=String(body.email||"").trim().toLowerCase(),code=String(body.code||"").trim(),password=typeof body.password==="string"?body.password:"";
 if(!validEmail(email))return reply(request,env,{ok:false,error:"invalid_credentials"},400);
 const user=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
 if(code){
  if(!/^\d{6}$/.test(code)||!user||!user.verify_code||Number(user.code_expires||0)<Math.floor(Date.now()/1000))return reply(request,env,{ok:false,error:"code_expired"},401);
  if(Number(user.code_attempts||0)>=5)return reply(request,env,{ok:false,error:"too_many_attempts"},429);
  const digest=b64url(await sha256((env.CODE_PEPPER||"")+"|"+email+"|"+code));
  if(digest!==user.verify_code){await env.DB.prepare("UPDATE users SET code_attempts=code_attempts+1 WHERE id=?").bind(user.id).run();return reply(request,env,{ok:false,error:"invalid_code"},401)}
  const now=Math.floor(Date.now()/1000);let ph=user.password_hash||null;
  if(!ph&&password){if(!validPassword(password))return reply(request,env,{ok:false,error:"weak_password"},400);ph=await hashPassword(password)}
  await env.DB.prepare("UPDATE users SET verify_code=NULL,code_expires=NULL,code_attempts=0,password_hash=COALESCE(password_hash,?),updated_at=? WHERE id=?").bind(ph,now,user.id).run();
  await recordUserLogin(env,user.id,request,now);
  const token=await signToken({sub:user.id,email,iat:now,exp:now+2592000,ver:Number(user.token_version||0)},env.JWT_SECRET||"");
  return reply(request,env,{ok:true,token,user:{id:user.id,email,balance:user.balance||"0.0000",balance_units:user.balance_units||0}});
 }
 if(!password||!user)return reply(request,env,{ok:false,error:"invalid_credentials"},401);
 const currentOk=!!user.password_hash&&await verifyPassword(password,user.password_hash);
 const legacyOk=!currentOk&&!!user.password_hash_legacy&&await verifyPassword(password,user.password_hash_legacy);
 if(!currentOk&&!legacyOk)return reply(request,env,{ok:false,error:"invalid_credentials"},401);
 const now=Math.floor(Date.now()/1000);
 if(legacyOk||(user.password_hash||"").startsWith("pbkdf2$")){
  const upgraded=await hashPassword(password);
  await env.DB.prepare("UPDATE users SET password_hash=?,password_hash_legacy=NULL,updated_at=? WHERE id=?").bind(upgraded,now,user.id).run();
 }
 await recordUserLogin(env,user.id,request,now);
  const token=await signToken({sub:user.id,email,iat:now,exp:now+2592000,ver:Number(user.token_version||0)},env.JWT_SECRET||"");
 return reply(request,env,{ok:true,token,user:{id:user.id,email,balance:user.balance||"0.0000",balance_units:user.balance_units||0}});
}
async function forgotPassword(request,env){
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const email=String(body.email||"").trim().toLowerCase();if(!validEmail(email))return reply(request,env,{ok:false,error:"invalid_email"},400);
 const now=Math.floor(Date.now()/1000),generic={ok:true,message:"如果该邮箱已注册，验证码将发送至邮箱，请注意查收。"};
 const ip=request.headers.get("CF-Connecting-IP")||"unknown",ipHash=b64url(await sha256((env.CODE_PEPPER||"")+"|reset-ip|"+ip));
 await env.DB.prepare("INSERT INTO password_reset_limits(ip_hash,window_started_at,sent_count,last_sent_at) VALUES(?,?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET window_started_at=CASE WHEN ?-window_started_at>=600 THEN ? ELSE window_started_at END,sent_count=CASE WHEN ?-window_started_at>=600 THEN 1 ELSE sent_count+1 END,last_sent_at=excluded.last_sent_at").bind(ipHash,now,now,now,now,now).run();
 const limit=await env.DB.prepare("SELECT sent_count FROM password_reset_limits WHERE ip_hash=?").bind(ipHash).first();if(Number(limit?.sent_count||0)>5)return reply(request,env,generic);
 const user=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();if(!user)return reply(request,env,generic);
 const prev=await env.DB.prepare("SELECT sent_at FROM password_resets WHERE email=?").bind(email).first();if(prev&&now-Number(prev.sent_at||0)<60)return reply(request,env,generic);
 const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0"),digest=b64url(await sha256(env.CODE_PEPPER+"|password-reset|"+email+"|"+code));
 await env.DB.prepare("INSERT INTO password_resets(email,code_hash,expires_at,sent_at,attempts,created_at) VALUES(?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,created_at=excluded.created_at").bind(email,digest,now+300,now,now).run();
 try{await originRequest(env,"POST","/api/send_email",{email,code})}catch{await env.DB.prepare("DELETE FROM password_resets WHERE email=?").bind(email).run()}
 return reply(request,env,generic);
}
async function resetPassword(request,env){
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const email=String(body.email||"").trim().toLowerCase(),code=String(body.code||"").trim(),password=typeof body.password==="string"?body.password:"";
 if(!validEmail(email)||!/^\d{6}$/.test(code))return reply(request,env,{ok:false,error:"invalid_reset_request"},400);
 if(!validPassword(password))return reply(request,env,{ok:false,error:"weak_password"},400);
 const reset=await env.DB.prepare("SELECT * FROM password_resets WHERE email=?").bind(email).first(),now=Math.floor(Date.now()/1000);
 if(!reset||Number(reset.expires_at)<now){await env.DB.prepare("DELETE FROM password_resets WHERE email=?").bind(email).run();return reply(request,env,{ok:false,error:"reset_code_expired"},401)}
 if(Number(reset.attempts||0)>=5)return reply(request,env,{ok:false,error:"too_many_attempts"},429);
 const digest=b64url(await sha256((env.CODE_PEPPER||"")+"|password-reset|"+email+"|"+code));
 if(digest!==reset.code_hash){await env.DB.prepare("UPDATE password_resets SET attempts=attempts+1 WHERE email=?").bind(email).run();return reply(request,env,{ok:false,error:"invalid_reset_code"},401)}
 const ph=await hashPassword(password),changed=await env.DB.prepare("UPDATE users SET password_hash=?,token_version=COALESCE(token_version,0)+1,verify_code=NULL,code_expires=NULL,code_attempts=0,updated_at=? WHERE email=?").bind(ph,now,email).run();
 if(Number(changed.meta?.changes||0)!==1)return reply(request,env,{ok:false,error:"reset_unavailable"},404);
 await env.DB.prepare("DELETE FROM password_resets WHERE email=?").bind(email).run();return reply(request,env,{ok:true,message:"密码已重置，请使用新密码登录。"});
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const entry = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}
function clearGithubStateCookie() {
  return "github_oauth_state=; Path=/api/auth/github; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}
function githubStatus(request, env) {
  return reply(request, env, { ok: true, enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) });
}
async function githubStart(request, env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return reply(request, env, { ok: false, error: "github_oauth_not_configured" }, 503);
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const referralCode = String(new URL(request.url).searchParams.get("ref") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const callback = new URL("/api/auth/github/callback", request.url).toString();
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  target.searchParams.set("redirect_uri", callback);
  target.searchParams.set("scope", "read:user user:email");
  target.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { "Location": target.toString(), "Cache-Control": "no-store", "Set-Cookie": "github_oauth_state=" + encodeURIComponent(state + (referralCode ? "." + referralCode : "")) + "; Path=/api/auth/github; Max-Age=600; HttpOnly; Secure; SameSite=Lax" } });
}
async function githubCallback(request, env) {
  const url = new URL(request.url), state = url.searchParams.get("state") || "", savedState = cookieValue(request, "github_oauth_state"), cookie = clearGithubStateCookie();
  const savedParts = savedState.split(".");
  const savedNonce = savedParts[0] || "";
  const referralCode = (savedParts[1] || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  if (!state || !savedNonce || state !== savedNonce) return new Response("GitHub 登录状态校验失败，请返回登录页重试。", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  if (url.searchParams.get("error")) {
    const destination = new URL("/auth.html", env.FRONTEND_ORIGIN || "https://shop.lynli.me");
    destination.searchParams.set("github_error", "authorization_denied");
    return new Response(null, { status: 302, headers: { "Location": destination.toString(), "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  }
  const code = url.searchParams.get("code") || "";
  if (!code || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return new Response("GitHub OAuth 尚未配置完整。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": cookie } });
  try {
    const callback = new URL("/api/auth/github/callback", request.url).toString();
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "Qingtian-Shop" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback }) });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("github_token_exchange_failed");
    const ghHeaders = { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + tokenData.access_token, "User-Agent": "Qingtian-Shop", "X-GitHub-Api-Version": "2022-11-28" };
    const [profileResponse, emailsResponse] = await Promise.all([fetch("https://api.github.com/user", { headers: ghHeaders }), fetch("https://api.github.com/user/emails", { headers: ghHeaders })]);
    if (!profileResponse.ok || !emailsResponse.ok) throw new Error("github_profile_fetch_failed");
    const profile = await profileResponse.json(), emails = await emailsResponse.json();
    const primary = Array.isArray(emails) ? emails.find(x => x && x.verified && x.primary && validEmail(x.email)) : null;
    const verified = primary || (Array.isArray(emails) ? emails.find(x => x && x.verified && validEmail(x.email)) : null);
    if (!profile.id || !verified) throw new Error("github_verified_email_required");
    const githubId = String(profile.id), email = String(verified.email).trim().toLowerCase(), now = Math.floor(Date.now() / 1000);
    const identity = await env.DB.prepare("SELECT user_id FROM github_identities WHERE github_id=?").bind(githubId).first();
    let user = identity ? await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(identity.user_id).first() : null;
    if (!user) {
      user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
      if (!user) {
        const id = crypto.randomUUID();
        const referrer = referralCode ? await env.DB.prepare("SELECT id FROM users WHERE referral_code=? AND id<>?").bind(referralCode,id).first() : null;
        await env.DB.prepare("INSERT INTO users (id,email,balance,balance_units,created_at,updated_at,referrer_user_id) VALUES (?,?,'0.0000',0,?,?,?) ON CONFLICT(email) DO NOTHING").bind(id,email,now,now,referrer?.id || null).run();
        user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
      }
      if (!user) throw new Error("github_account_link_failed");
      await env.DB.prepare("INSERT INTO github_identities (github_id,user_id,email,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET user_id=excluded.user_id,email=excluded.email,updated_at=excluded.updated_at").bind(githubId,user.id,email,now,now).run();
    }
    const token = await signToken({ sub: user.id, email: user.email, iat: now, exp: now + 2592000, ver: Number(user.token_version || 0) }, env.JWT_SECRET || "");
    const destination = new URL("/shop.html", env.FRONTEND_ORIGIN || "https://shop.lynli.me"); destination.hash = "github_token=" + encodeURIComponent(token);
    return new Response(null, { status: 302, headers: { "Location": destination.toString(), "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (error) {
    const destination = new URL("/auth.html", env.FRONTEND_ORIGIN || "https://shop.lynli.me"); destination.searchParams.set("github_error", error.message === "github_verified_email_required" ? "verified_email_required" : "oauth_failed");
    return new Response(null, { status: 302, headers: { "Location": destination.toString(), "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  }
}



async function userInfo(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const user = await findUserById(env, claims.sub);
  if (!user) return reply(request, env, { ok: false, error: "user_not_found" }, 404);
  const referralCode = await ensureReferralCode(env, user);
  const bonus = await env.DB.prepare("SELECT COALESCE(SUM(amount_units),0) AS total FROM referral_rewards WHERE referrer_user_id=? AND credited_at IS NOT NULL").bind(user.id).first();
  const balanceUnits = Number(user.balance_units || 0);
  const bonusUnits = Number(bonus?.total || 0);
  return reply(request, env, {
    ok: true,
    user: {
      id: user.id, email: user.email, tg_user_id: user.tg_user_id,
      nickname: user.nickname || "", avatar_url: user.avatar_data_url || "",
      referral_code: referralCode,
      balance: user.balance, balance_units: balanceUnits,
      balance_cny: (balanceUnits / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
      invite_bonus_units: bonusUnits,
      invite_bonus_cny: (bonusUnits / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
      currency: "CNY", internal_cny_per_usdt: INTERNAL_CNY_PER_USDT
    }
  });
}

async function updateUserProfile(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const nickname = String(body.nickname || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 24);
  const avatar = body.avatar_data_url === undefined ? null : String(body.avatar_data_url || "");
  if (!nickname) return reply(request, env, { ok: false, error: "nickname_required" }, 400);
  if (avatar !== null && avatar && (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) || avatar.length > 420000)) {
    return reply(request, env, { ok: false, error: "invalid_avatar" }, 400);
  }
  if (avatar === null) {
    await env.DB.prepare("UPDATE users SET nickname=?,updated_at=? WHERE id=?").bind(nickname, Math.floor(Date.now()/1000), claims.sub).run();
  } else {
    await env.DB.prepare("UPDATE users SET nickname=?,avatar_data_url=?,updated_at=? WHERE id=?").bind(nickname, avatar || null, Math.floor(Date.now()/1000), claims.sub).run();
  }
  return reply(request, env, { ok: true, message: "profile_updated" });
}

async function userReferrals(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const user = await findUserById(env, claims.sub);
  if (!user) return reply(request, env, { ok: false, error: "user_not_found" }, 404);
  const referralCode = await ensureReferralCode(env, user);
  const [count, totals, rewards] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE referrer_user_id=? AND verify_code IS NULL").bind(user.id).first(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_units),0) AS total FROM referral_rewards WHERE referrer_user_id=? AND credited_at IS NOT NULL").bind(user.id).first(),
    env.DB.prepare("SELECT r.amount_units,r.created_at,u.email FROM referral_rewards r JOIN users u ON u.id=r.referred_user_id WHERE r.referrer_user_id=? AND r.credited_at IS NOT NULL ORDER BY r.created_at DESC LIMIT 50").bind(user.id).all()
  ]);
  const totalUnits = Number(totals?.total || 0);
  return reply(request, env, {
    ok: true, referral_code: referralCode,
    referral_url: "https://shop.lynli.me/auth.html?ref=" + encodeURIComponent(referralCode),
    invited_count: Number(count?.total || 0),
    reward_cny: (totalUnits / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
    rewards: (rewards.results || []).map(row => ({
      email: String(row.email || "").replace(/^(.{2}).+(@.*)$/, "$1***$2"),
      amount_cny: (Number(row.amount_units || 0) / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
      created_at: Number(row.created_at || 0)
    }))
  });
}

async function products(request, env) {
  try {
    // The dedicated read-only catalog sync service publishes a validated full
    // snapshot every minute. Use that snapshot's timestamp as the freshness
    // source; do not make every signed-in visitor trigger a second upstream sync.
    // Purchases still recheck the exact live supplier SKU, stock and CNY price
    // in the internal buy handler before any upstream purchase is submitted.
    const state = await env.DB.prepare(
      "SELECT COALESCE(MAX(updated_at),0) AS catalog_updated_at FROM shop_catalog WHERE is_local_inventory=FALSE"
    ).first();
    const catalogUpdatedAt = Number(state?.catalog_updated_at || 0);
    const catalogStale = !catalogUpdatedAt || Math.floor(Date.now()/1000) - catalogUpdatedAt > 180;
    const result = await env.DB.prepare(
      "SELECT product_id,supplier_product_id,name,category_name,source->>'Icon' AS icon,source->>'IsHot' AS is_hot,source->>'IsRecommend' AS is_recommend,price_usdt,price_cny,stock,is_local_inventory,purchasable FROM shop_catalog WHERE is_on_sale=TRUE AND stock>0 ORDER BY category_id,name"
    ).all();
    const items = (result.results || []).map(row => ({
      product_id: row.product_id,
      supplier_product_id: row.supplier_product_id,
      name: row.name,
      category: row.category_name || "数字商品",
      icon: String(row.icon || ""),
      icon_url: storefrontIconUrl(row.icon,row.name),
      is_hot: String(row.is_hot || "").toLowerCase() === "true",
      is_recommend: String(row.is_recommend || "").toLowerCase() === "true",
      price_usdt: String(row.price_usdt),
      stock: Number(row.stock || 0),
      quantity: Number(row.stock || 0),
      price_cny: String(row.price_cny),
      currency: "CNY",
      is_local_inventory: Boolean(row.is_local_inventory),
      price_verified: Boolean(row.is_local_inventory) || !catalogStale,
      purchasable: Boolean(row.purchasable) && (Boolean(row.is_local_inventory) || !catalogStale)
    }));
    return reply(request, env, {
      ok: true, count: items.length, items,
      updated_at: catalogUpdatedAt, catalog_stale: catalogStale
    });
  } catch {
    return reply(request, env, { ok: false, error: "catalog_unavailable" }, 503);
  }
}

async function refund(env, order) {
  const now = Math.floor(Date.now() / 1000);
  // A refund is allowed only for a confirmed failed purchase. If the supplier
  // has accepted an order, returned an order ID, or delivered a card, the
  // transaction is never refunded automatically; ambiguous cases stay pending.
  const supplier = await env.DB.prepare(
    "SELECT status,supplier_order_id,delivery_ciphertext FROM shop_supplier_orders WHERE order_id=?"
  ).bind(order.order_id).first();
  if (supplier && (supplier.status !== "failed" || supplier.supplier_order_id || supplier.delivery_ciphertext)) {
    return false;
  }
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET balance_units=balance_units+?,balance=ROUND((balance_units+?)/10000.0,4),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM web_purchases WHERE order_id=? AND status IN ('reserved','pending')) AND NOT EXISTS(SELECT 1 FROM shop_supplier_orders WHERE order_id=? AND (status<>'failed' OR supplier_order_id IS NOT NULL OR delivery_ciphertext IS NOT NULL))"
    ).bind(order.amount_units, order.amount_units, now, order.user_id, order.order_id, order.order_id),
    env.DB.prepare(
      "UPDATE web_purchases SET status='refunded',updated_at=?,error_code='purchase_failed' WHERE order_id=? AND status IN ('reserved','pending') AND NOT EXISTS(SELECT 1 FROM shop_supplier_orders WHERE order_id=? AND (status<>'failed' OR supplier_order_id IS NOT NULL OR delivery_ciphertext IS NOT NULL))"
    ).bind(now, order.order_id, order.order_id)
  ]);
  return Number(results[1]?.meta?.changes || 0) === 1;
}

async function creditReferralReward(env, purchase) {
  const rewardUnits = Math.floor(Number(purchase.amount_units || 0) * 5 / 100);
  if (rewardUnits < 1) return;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO referral_rewards (order_id,referrer_user_id,referred_user_id,amount_units,created_at) SELECT ?,referrer_user_id,id,?,? FROM users WHERE id=? AND referrer_user_id IS NOT NULL ON CONFLICT(order_id) DO NOTHING")
      .bind(purchase.order_id, rewardUnits, now, purchase.user_id),
    env.DB.prepare("WITH claimed AS (UPDATE referral_rewards SET credited_at=? WHERE order_id=? AND credited_at IS NULL RETURNING referrer_user_id,amount_units) UPDATE users SET balance_units=users.balance_units+claimed.amount_units,balance=ROUND((users.balance_units+claimed.amount_units)/10000.0,4),updated_at=? FROM claimed WHERE users.id=claimed.referrer_user_id")
      .bind(now, purchase.order_id, now)
  ]);
}

async function syncServerStatus(env, purchase, user) {
  const path = "/api/internal/buy/" + encodeURIComponent(purchase.order_id) + "?user_id=" + encodeURIComponent(user.id);
  const data = await originRequest(env, "GET", path);
  if (data.status === "delivered" && data.content) {
    await env.DB.prepare("UPDATE web_purchases SET status='delivered',server_order_id=?,updated_at=? WHERE order_id=? AND status IN ('reserved','pending')")
      .bind(purchase.order_id, Math.floor(Date.now() / 1000), purchase.order_id).run();
    await creditReferralReward(env, purchase);
    return { ...data, status: "delivered" };
  }
  if (data.status === "failed") {
    const refunded = await refund(env, purchase);
    if (refunded) return { ...data, status: "refunded" };
    return { ...data, status: "pending", error_code: "refund_blocked_after_supplier_acceptance" };
  }
  return data;
}

async function buy(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const user = await findUserById(env, claims.sub);
  if (!user) return reply(request, env, { ok: false, error: "user_not_found" }, 404);
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const productId = String(body.product_id || "").trim();
  const idem = request.headers.get("Idempotency-Key") || "";
  if (!productId || productId.length > 100 || idem.length < 12 || idem.length > 128) {
    return reply(request, env, { ok: false, error: "invalid_order_request" }, 400);
  }

  const product = await env.DB.prepare(
    "SELECT product_id,supplier_product_id,price_usdt,price_cny,stock,is_on_sale,purchasable,is_local_inventory,updated_at FROM shop_catalog WHERE product_id=?"
  ).bind(productId).first();
  if (!product || !product.is_on_sale || Number(product.stock || 0) < 1) {
    return reply(request, env, { ok: false, error: "product_unavailable" }, 409);
  }
  if (!product.is_local_inventory && Math.floor(Date.now()/1000) - Number(product.updated_at || 0) > 180) {
    return reply(request, env, { ok: false, error: "catalog_stale", message: "商品价格和库存正在同步，请稍后重试。" }, 409);
  }
  if (!product.purchasable) return reply(request, env, { ok: false, error: "product_not_enabled_for_purchase" }, 409);
  const amount = amountUnits(product.price_usdt);
  if (!amount) return reply(request, env, { ok: false, error: "invalid_product_price" }, 503);

  let purchase = await env.DB.prepare(
    "SELECT * FROM web_purchases WHERE user_id=? AND idempotency_key=?"
  ).bind(user.id, idem).first();

  if (!purchase) {
    const orderId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET balance_units=balance_units-?,balance=printf('%.4f',(balance_units-?)/10000.0),updated_at=? WHERE id=? AND balance_units>=? AND NOT EXISTS(SELECT 1 FROM web_purchases WHERE user_id=? AND idempotency_key=?)"
      ).bind(amount, amount, now, user.id, amount, user.id, idem),
      env.DB.prepare(
        "INSERT INTO web_purchases (order_id,user_id,product_id,amount,amount_units,status,idempotency_key,created_at,updated_at) SELECT ?,?,?,?,?, 'reserved',?,?,? WHERE changes()=1"
      ).bind(orderId, user.id, productId, money(amount), amount, idem, now, now)
    ]);
    if (Number(results[1]?.meta?.changes || 0) !== 1) {
      purchase = await env.DB.prepare(
        "SELECT * FROM web_purchases WHERE user_id=? AND idempotency_key=?"
      ).bind(user.id, idem).first();
      if (!purchase) return reply(request, env, { ok: false, error: "insufficient_balance" }, 402);
    } else {
      purchase = await env.DB.prepare("SELECT * FROM web_purchases WHERE order_id=?").bind(orderId).first();
    }
  }

  if (String(purchase.product_id || "") !== productId) {
    return reply(request, env, { ok: false, error: "idempotency_key_reused_for_different_product" }, 409);
  }

  if (purchase.status === "delivered") {
    const status = await syncServerStatus(env, purchase, user).catch(() => ({ status: "pending" }));
    return reply(request, env, { ok: true, order_id: purchase.order_id, status: status.status, content: status.content || null });
  }
  if (purchase.status === "refunded") {
    return reply(request, env, { ok: false, order_id: purchase.order_id, status: "refunded", error: "purchase_failed" }, 409);
  }
  if (purchase.status === "pending") {
    const status = await syncServerStatus(env, purchase, user).catch(() => ({ status: "pending" }));
    return reply(request, env, { ok: true, order_id: purchase.order_id, status: status.status, content: status.content || null }, 202);
  }

  let result;
  try {
    result = await originRequest(env, "POST", "/api/internal/buy", {
      order_id: purchase.order_id,
      user_id: user.id,
      product_id: productId,
      supplier_product_id: product.supplier_product_id,
      email: user.email,
      tg_user_id: user.tg_user_id || null,
      expected_price_usdt: product.price_usdt,
      expected_price_cny: product.price_cny
    });
  } catch {
    await env.DB.prepare("UPDATE web_purchases SET status='pending',updated_at=?,error_code='origin_unreachable' WHERE order_id=?")
      .bind(Math.floor(Date.now() / 1000), purchase.order_id).run();
    return reply(request, env, { ok: true, order_id: purchase.order_id, status: "pending", message: "订单处理中，请稍后查询。" }, 202);
  }

  if (result.status === "delivered" && result.content) {
    await env.DB.prepare("UPDATE web_purchases SET status='delivered',server_order_id=?,updated_at=? WHERE order_id=?")
      .bind(purchase.order_id, Math.floor(Date.now() / 1000), purchase.order_id).run();
    await creditReferralReward(env, purchase);
    return reply(request, env, { ok: true, order_id: purchase.order_id, status: "delivered", content: result.content });
  }
  if (result.status === "failed") {
    const refunded = await refund(env, purchase);
    if (!refunded) {
      await env.DB.prepare("UPDATE web_purchases SET status='pending',updated_at=?,error_code='refund_blocked_after_supplier_acceptance' WHERE order_id=? AND status IN ('reserved','pending')")
        .bind(Math.floor(Date.now()/1000), purchase.order_id).run();
      return reply(request, env, { ok: true, order_id: purchase.order_id, status: "pending", error: "purchase_outcome_requires_reconciliation" }, 202);
    }
    return reply(request, env, { ok: false, order_id: purchase.order_id, status: "refunded", error: result.error_code || "purchase_failed" }, 409);
  }
  await env.DB.prepare("UPDATE web_purchases SET status='pending',updated_at=?,error_code=? WHERE order_id=?")
    .bind(Math.floor(Date.now() / 1000), result.error_code || "delivery_pending", purchase.order_id).run();
  return reply(request, env, { ok: true, order_id: purchase.order_id, status: "pending", message: "订单已受理，卡密准备中。" }, 202);
}

async function userOrders(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const url = new URL(request.url);
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const limit = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20));
  const [count, result] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM web_purchases WHERE user_id=?").bind(claims.sub).first(),
    env.DB.prepare(
      "SELECT p.order_id,p.product_id,p.amount_units,p.status,p.error_code,p.created_at,p.updated_at,c.name AS product_name FROM web_purchases p LEFT JOIN shop_catalog c ON c.product_id=p.product_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT ? OFFSET ?"
    ).bind(claims.sub, limit, (page - 1) * limit).all()
  ]);
  const orders = (result.results || []).map(row => ({
    order_id: String(row.order_id),
    product_id: String(row.product_id || ""),
    product_name: String(row.product_name || row.product_id || "数字商品"),
    amount_cny: (Number(row.amount_units || 0) / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
    currency: "CNY",
    status: String(row.status || "pending"),
    error_code: row.error_code || null,
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0)
  }));
  return reply(request, env, { ok: true, count: Number(count?.total || 0), total: Number(count?.total || 0), page, limit, orders });
}

async function buyStatus(request, env, orderId) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const user = await findUserById(env, claims.sub);
  const purchase = await env.DB.prepare(
    "SELECT p.*,c.name AS product_name FROM web_purchases p LEFT JOIN shop_catalog c ON c.product_id=p.product_id WHERE p.order_id=? AND p.user_id=?"
  ).bind(orderId, claims.sub).first();
  if (!purchase || !user) return reply(request, env, { ok: false, error: "order_not_found" }, 404);
  const order = {
    order_id: orderId,
    product_id: String(purchase.product_id || ""),
    product_name: String(purchase.product_name || purchase.product_id || "数字商品"),
    amount_cny: (Number(purchase.amount_units || 0) / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
    created_at: Number(purchase.created_at || 0),
    updated_at: Number(purchase.updated_at || 0)
  };
  if (purchase.status === "refunded") return reply(request, env, { ok: true, ...order, status: "refunded" });
  if (purchase.status === "delivered" || purchase.status === "pending" || purchase.status === "reserved") {
    try {
      const data = await syncServerStatus(env, purchase, user);
      return reply(request, env, { ok: true, ...order, status: data.status, content: data.content || null });
    } catch {
      return reply(request, env, { ok: true, ...order, status: "pending", message: "订单仍在核验，请稍后查询。" }, 202);
    }
  }
  return reply(request, env, { ok: true, ...order, status: purchase.status });
}



function hexBytes(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }

async function changeUserPassword(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const current = typeof body.current_password === "string" ? body.current_password : "";
  const next = typeof body.new_password === "string" ? body.new_password : "";
  if (!validPassword(next)) return reply(request, env, { ok: false, error: "weak_password" }, 400);
  if (current === next) return reply(request, env, { ok: false, error: "password_unchanged" }, 400);
  const user = await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(claims.sub).first();
  if (!user || !user.password_hash || !await verifyPassword(current, user.password_hash)) {
    return reply(request, env, { ok: false, error: "invalid_current_password" }, 401);
  }
  const hash = await hashPassword(next), now = Math.floor(Date.now()/1000);
  await env.DB.prepare("UPDATE users SET password_hash=?,token_version=COALESCE(token_version,0)+1,updated_at=? WHERE id=?")
    .bind(hash, now, claims.sub).run();
  return reply(request, env, { ok: true, message: "password_changed", relogin_required: true });
}

async function ensureQingtianPayRechargeSchema(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS qingtianpay_recharge_links (order_id TEXT PRIMARY KEY, qingtianpay_order_no TEXT NOT NULL UNIQUE, checkout_url TEXT NOT NULL, qr_image_url TEXT, created_at BIGINT NOT NULL)").run();
}
async function qingtianPayApi(env, path, options = {}) {
  const apiKey = String(env.QINGTIANPAY_API_KEY || "").trim();
  if (!apiKey) throw new Error("qingtianpay_not_configured");
  const response = await fetch("https://pay-api.lynli.me" + path, {
    ...options,
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("qingtianpay_request_failed");
    error.status = response.status;
    const upstreamCode = data && (data.error || data.code || data.detail);
    error.upstreamCode = typeof upstreamCode === "string" ? upstreamCode.slice(0, 80) : "";
    throw error;
  }
  return data;
}
async function reconcileAlipayRecharge(env, row) {
  const link = await env.DB.prepare("SELECT qingtianpay_order_no FROM qingtianpay_recharge_links WHERE order_id=?").bind(row.order_id).first();
  if (!link?.qingtianpay_order_no) return;
  try {
    const remote = await qingtianPayApi(env, "/api/v1/orders/" + encodeURIComponent(String(link.qingtianpay_order_no)));
    const order = remote.order || remote.data?.order || remote.data || remote;
    if (String(order.status || "").toLowerCase() !== "paid") return;
    const now = Math.floor(Date.now()/1000);
    await env.DB.prepare("WITH paid AS (UPDATE recharge_orders SET status='paid',paid_at=?,updated_at=? WHERE order_id=? AND status='pending' RETURNING user_id,credit_units) UPDATE users SET balance_units=users.balance_units+paid.credit_units,balance=ROUND((users.balance_units+paid.credit_units)/10000.0,4),updated_at=? FROM paid WHERE users.id=paid.user_id RETURNING users.id")
      .bind(now, now, row.order_id, now).first();
  } catch (error) {
    // Temporary payment-center failures leave the recharge pending for the next poll.
  }
}
async function userRechargeOrders(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  await ensureQingtianPayRechargeSchema(env);
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
    const amount = String(body.amount_cny ?? "").trim();
    const paymentMethod = String(body.payment_method || "USDT_TRC20").toUpperCase();
    if (!["ALIPAY","USDT_TRC20"].includes(paymentMethod)) return reply(request, env, { ok: false, error: "invalid_payment_method" }, 400);
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return reply(request, env, { ok: false, error: "invalid_amount" }, 400);
    const cents = Math.round(Number(amount) * 100);
    const bonusCents = Math.floor(cents / 1000) * 50;
    const creditedCents = cents + bonusCents;
    const creditUnits = creditedCents * 25;
    if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isSafeInteger(creditUnits) || creditUnits <= 0) {
      return reply(request, env, { ok: false, error: "invalid_amount" }, 400);
    }
    const orderId = crypto.randomUUID(), now = Math.floor(Date.now()/1000);
    let checkout = null;
    if (paymentMethod === "ALIPAY") {
      if (!String(env.QINGTIANPAY_API_KEY || "").trim()) return reply(request, env, { ok:false, error:"alipay_not_configured" }, 503);
      try {
        const created = await qingtianPayApi(env, "/api/v1/payments", {
          method: "POST",
          body: JSON.stringify({
            external_order_no: orderId,
            amount: (cents/100).toFixed(2),
            subject: "晴天号铺账户充值",
            payment_method: "alipay_wap",
            buyer_ref: String(claims.sub),
            metadata: { source: "shop.lynli.me", recharge_order_id: orderId }
          })
        });
        const payment = created.order || created.data?.order || created.data || created;
        const orderNo = String(payment.order_no || "").trim();
        const checkoutUrl = String(payment.checkout_url || "").trim();
        if (!orderNo || !/^https:\/\//i.test(checkoutUrl)) {
          return reply(request, env, {ok:false,error:"alipay_order_response_invalid"},502);
        }
        checkout = { order_no: orderNo, checkout_url: checkoutUrl, qr_image_url: payment.qr_image_url ? String(payment.qr_image_url) : null };
      } catch (error) {
        const upstreamStatus = Number(error?.status) || 0;
        const errorCode = upstreamStatus === 401 || upstreamStatus === 403
          ? "qingtianpay_api_key_rejected"
          : upstreamStatus === 400 || upstreamStatus === 422
            ? "qingtianpay_request_invalid"
            : upstreamStatus
              ? "qingtianpay_unavailable"
              : (String(error?.name || "").toLowerCase().includes("timeout") ? "qingtianpay_timeout" : "qingtianpay_network_error");
        console.error("[alipay_recharge_create_failed]", JSON.stringify({
          status: upstreamStatus,
          code: errorCode,
          upstream_code: String(error?.upstreamCode || "").slice(0, 80)
        }));
        return reply(request, env, {
          ok:false,
          error:errorCode,
          upstream_status:upstreamStatus || null,
          upstream_code:String(error?.upstreamCode || "").slice(0, 80) || null
        }, upstreamStatus === 401 || upstreamStatus === 403 ? 502 : 503);
      }
    }
    await env.DB.prepare("INSERT INTO recharge_orders(order_id,user_id,amount_cny,credit_units,payment_method,status,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?)")
      .bind(orderId, claims.sub, (cents/100).toFixed(2), creditUnits, paymentMethod, now, now).run();
    if (checkout) {
      await env.DB.prepare("INSERT INTO qingtianpay_recharge_links(order_id,qingtianpay_order_no,checkout_url,qr_image_url,created_at) VALUES(?,?,?,?,?)")
        .bind(orderId, checkout.order_no, checkout.checkout_url, checkout.qr_image_url, now).run();
    }
    return reply(request, env, {
      ok: true,
      order: {
        order_id: orderId, amount_cny: (cents/100).toFixed(2), payment_method: paymentMethod,
        status: "pending", created_at: now,
        ...(checkout ? { qingtianpay_order_no: checkout.order_no, checkout_url: checkout.checkout_url, qr_image_url: checkout.qr_image_url } : {})
      },
      ...(paymentMethod === "ALIPAY" ? { payment_provider: "qingtianpay" } : { payment_instructions: "请联系官方客服获取 USDT（TRC20）收款信息；付款后提交订单号与凭证，由客服核验入账。" })
    }, 201);
  }
  const pending = await env.DB.prepare("SELECT r.order_id,r.amount_cny,r.payment_method,r.status,r.created_at,r.updated_at,r.paid_at FROM recharge_orders r WHERE r.user_id=? AND r.status='pending' AND r.payment_method='ALIPAY' ORDER BY r.created_at DESC LIMIT 20")
    .bind(claims.sub).all();
  for (const row of pending.results || []) await reconcileAlipayRecharge(env, row);
  const result = await env.DB.prepare("SELECT r.order_id,r.amount_cny,r.payment_method,r.status,r.created_at,r.updated_at,r.paid_at,p.checkout_url FROM recharge_orders r LEFT JOIN qingtianpay_recharge_links p ON p.order_id=r.order_id WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 100")
    .bind(claims.sub).all();
  return reply(request, env, { ok: true, orders: (result.results || []).map(row => ({
    order_id: String(row.order_id), amount_cny: Number(row.amount_cny).toFixed(2),
    payment_method: String(row.payment_method), status: String(row.status),
    created_at: Number(row.created_at), updated_at: Number(row.updated_at), paid_at: row.paid_at ? Number(row.paid_at) : null,
    checkout_url: row.checkout_url ? String(row.checkout_url) : null
  })) });
}


let userWithdrawalsSchemaReady = false;
async function ensureUserWithdrawalsSchema(env) {
  if (userWithdrawalsSchemaReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_withdrawals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount_units INTEGER NOT NULL, payment_method TEXT NOT NULL, account_value TEXT NOT NULL, holder_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, resolved_at INTEGER)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_user_withdrawals_user_created ON user_withdrawals(user_id,created_at DESC)").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_withdrawals_one_pending ON user_withdrawals(user_id) WHERE status='pending'").run();
  userWithdrawalsSchemaReady = true;
}
async function userWithdrawals(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok:false, error:e.message }, 401); }
  await ensureUserWithdrawalsSchema(env);
  if (request.method === "GET") {
    const user = await findUserById(env, claims.sub);
    if (!user) return reply(request, env, {ok:false,error:"user_not_found"},404);
    const rows = await env.DB.prepare("SELECT id,amount_units,payment_method,status,created_at,updated_at FROM user_withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 50").bind(claims.sub).all();
    return reply(request, env, {ok:true,balance_cny:(Number(user.balance_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),withdrawals:(rows.results||[]).map(x=>({id:x.id,amount_cny:(Number(x.amount_units)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),payment_method:x.payment_method,status:x.status,created_at:Number(x.created_at),updated_at:Number(x.updated_at)}))});
  }
  let body;
  try { body=await request.json(); } catch { return reply(request,env,{ok:false,error:"invalid_json"},400); }
  const method=String(body.payment_method||"").toUpperCase(), account=String(body.account||"").trim(), holder=String(body.holder_name||"").trim();
  if (!["ALIPAY","USDT_TRC20"].includes(method) || !account || account.length>120 || holder.length>80 || (method==="ALIPAY"&&!holder) || (method==="USDT_TRC20"&&!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(account))) return reply(request,env,{ok:false,error:"invalid_withdrawal_details"},400);
  const id=crypto.randomUUID(), now=Math.floor(Date.now()/1000);
  try {
    await env.DB.prepare("INSERT INTO user_withdrawals(id,user_id,amount_units,payment_method,account_value,holder_name,status,created_at,updated_at) SELECT ?,id,balance_units,?,?,?,'pending',?,? FROM users WHERE id=? AND balance_units>=250000 AND NOT EXISTS (SELECT 1 FROM user_withdrawals WHERE user_id=? AND status='pending')")
      .bind(id,method,account,holder,now,now,claims.sub,claims.sub).run();
  } catch {
    const pending=await env.DB.prepare("SELECT id FROM user_withdrawals WHERE user_id=? AND status='pending' LIMIT 1").bind(claims.sub).first();
    return reply(request,env,{ok:false,error:pending?"withdrawal_pending":"withdrawal_create_failed"},409);
  }
  const created=await env.DB.prepare("SELECT amount_units FROM user_withdrawals WHERE id=? AND user_id=? AND status='pending'").bind(id,claims.sub).first();
  if (!created) { const current=await findUserById(env,claims.sub); const currentCny=Number(current?.balance_units||0)/10000*INTERNAL_CNY_PER_USDT; return reply(request,env,{ok:false,error:currentCny<100?"withdrawal_minimum_not_met":"insufficient_balance",minimum_withdrawal_cny:"100.00"},409); }
  const units=Number(created.amount_units||0);
  const changed=await env.DB.prepare("UPDATE users SET balance_units=balance_units-?,balance=ROUND((balance_units-?)/10000.0,4),updated_at=? WHERE id=? AND balance_units>=? RETURNING id").bind(units,units,now,claims.sub,units).first();
  if (!changed) {
    await env.DB.prepare("DELETE FROM user_withdrawals WHERE id=? AND status='pending'").bind(id).run();
    return reply(request,env,{ok:false,error:"insufficient_balance"},409);
  }
  return reply(request,env,{ok:true,withdrawal:{id,amount_cny:(units/10000*INTERNAL_CNY_PER_USDT).toFixed(2),payment_method:method,status:"pending",created_at:now}},201);
}

async function resolveUserWithdrawal(request, env) {
  if (!env.ADMIN_API_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_API_KEY) return reply(request,env,{ok:false,error:"unauthorized"},401);
  let body; try { body=await request.json(); } catch { return reply(request,env,{ok:false,error:"invalid_json"},400); }
  const id=String(body.id||"").trim(), decision=String(body.decision||"").toLowerCase();
  if (!id || !["approve","reject"].includes(decision)) return reply(request,env,{ok:false,error:"invalid_request"},400);
  await ensureUserWithdrawalsSchema(env);
  const now=Math.floor(Date.now()/1000);
  if (decision==="approve") {
    const row=await env.DB.prepare("UPDATE user_withdrawals SET status='approved',updated_at=?,resolved_at=? WHERE id=? AND status='pending' RETURNING id").bind(now,now,id).first();
    return row?reply(request,env,{ok:true,id,status:"approved",note:"请完成线下转账"}):reply(request,env,{ok:false,error:"withdrawal_not_pending"},409);
  }
  const changed=await env.DB.prepare("UPDATE user_withdrawals SET status='rejected',updated_at=?,resolved_at=? WHERE id=? AND status='pending' RETURNING user_id").bind(now,now,id).first();
  if (!changed) return reply(request,env,{ok:false,error:"withdrawal_not_pending"},409);
  const refund=await env.DB.prepare("UPDATE users SET balance_units=balance_units+(SELECT amount_units FROM user_withdrawals WHERE id=?),balance=ROUND((balance_units+(SELECT amount_units FROM user_withdrawals WHERE id=?))/10000.0,4),updated_at=? WHERE id=? RETURNING id").bind(id,id,now,changed.user_id).first();
  return reply(request,env,{ok:true,id,status:"rejected",refunded:Boolean(refund)});
}

async function userApiKeys(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT id,key_prefix,label,created_at,last_used_at,revoked_at FROM user_api_keys WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(claims.sub).all();
    return reply(request, env, { ok: true, eligible: (await env.DB.prepare("SELECT balance_units FROM users WHERE id=?").bind(claims.sub).first()).balance_units >= API_MIN_BALANCE_UNITS,
      required_cny: API_MIN_BALANCE_CNY,
      keys: (result.results || []).map(row => ({ id: row.id, key_prefix: row.key_prefix, label: row.label, created_at: Number(row.created_at), last_used_at: row.last_used_at ? Number(row.last_used_at) : null, revoked: Boolean(row.revoked_at) })) });
  }
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const user = await env.DB.prepare("SELECT balance_units FROM users WHERE id=?").bind(claims.sub).first();
  if (!user || Number(user.balance_units || 0) < API_MIN_BALANCE_UNITS) return reply(request, env, { ok: false, error: "api_balance_requirement", required_cny: API_MIN_BALANCE_CNY }, 403);
  const active = await env.DB.prepare("SELECT COUNT(*) AS total FROM user_api_keys WHERE user_id=? AND revoked_at IS NULL").bind(claims.sub).first();
  if (Number(active?.total || 0) >= 5) return reply(request, env, { ok: false, error: "api_key_limit" }, 409);
  const label = String(body.label || "默认 API 密钥").trim().slice(0, 40) || "默认 API 密钥";
  const key = "qt_live_" + hexBytes(crypto.getRandomValues(new Uint8Array(32)));
  const hash = hexBytes(await sha256(key)), id = crypto.randomUUID(), now = Math.floor(Date.now()/1000);
  await env.DB.prepare("INSERT INTO user_api_keys(id,user_id,key_prefix,key_hash,label,created_at) VALUES(?,?,?,?,?,?)")
    .bind(id, claims.sub, key.slice(0, 16), hash, label, now).run();
  return reply(request, env, { ok: true, key: { id, key, key_prefix: key.slice(0,16), label, created_at: now }, warning: "完整密钥仅显示这一次，请立即复制保存。" }, 201);
}

async function revokeUserApiKey(request, env, keyId) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const now = Math.floor(Date.now()/1000);
  const result = await env.DB.prepare("UPDATE user_api_keys SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL")
    .bind(now, keyId, claims.sub).run();
  if (Number(result.meta?.changes || 0) !== 1) return reply(request, env, { ok: false, error: "api_key_not_found" }, 404);
  return reply(request, env, { ok: true });
}

async function userApiUsage(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const result = await env.DB.prepare("SELECT id,endpoint,method,status_code,created_at FROM user_api_usage WHERE user_id=? ORDER BY created_at DESC LIMIT 100")
    .bind(claims.sub).all();
  return reply(request, env, { ok: true, logs: (result.results || []).map(row => ({ id: row.id, endpoint: row.endpoint, method: row.method, status_code: Number(row.status_code), created_at: Number(row.created_at) })) });
}

async function ensureApiLedger(env) {
  if (apiLedgerSchemaReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS api_billing_ledger (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, user_id TEXT NOT NULL, key_id TEXT NOT NULL, product_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('debit','refund')), amount_units INTEGER NOT NULL CHECK(amount_units>0), balance_after_units INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(order_id,action))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_api_billing_user_created ON api_billing_ledger(user_id,created_at DESC)").run();
  apiLedgerSchemaReady = true;
}
async function apiKeyContext(request, env, endpoint) {
  const header=request.headers.get("Authorization")||"";
  const key=header.startsWith("Bearer ")?header.slice(7).trim():"";
  if(!/^qt_live_[a-f0-9]{64}$/.test(key)) return {error:reply(request,env,{ok:false,error:"api_key_required"},401)};
  const hash=hexBytes(await sha256(key));
  const row=await env.DB.prepare("SELECT k.id AS key_id,k.user_id,u.email,u.balance_units,u.nickname,u.token_version,u.tg_user_id FROM user_api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked_at IS NULL").bind(hash).first();
  if(!row) return {error:reply(request,env,{ok:false,error:"invalid_api_key"},401)};
  const balance=Number(row.balance_units||0),now=Math.floor(Date.now()/1000);
  await env.DB.prepare("UPDATE user_api_keys SET last_used_at=? WHERE id=?").bind(now,row.key_id).run();
  if(balance<API_MIN_BALANCE_UNITS){
    await env.DB.prepare("INSERT INTO user_api_usage(id,key_id,user_id,endpoint,method,status_code,created_at) VALUES(?,?,?,?,?,403,?)").bind(crypto.randomUUID(),row.key_id,row.user_id,endpoint,request.method,now).run();
    return {error:reply(request,env,{ok:false,error:"api_balance_requirement",required_cny:API_MIN_BALANCE_CNY,balance_cny:(balance/10000*INTERNAL_CNY_PER_USDT).toFixed(2),message:"API 调用账户余额必须保持不低于 ¥500。"},403)};
  }
  return {row};
}
async function recordApiUsage(env,row,endpoint,method,status) {
  await env.DB.prepare("INSERT INTO user_api_usage(id,key_id,user_id,endpoint,method,status_code,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),row.key_id,row.user_id,endpoint,method,status,Math.floor(Date.now()/1000)).run();
}
async function publicApiAccount(request, env) {
  const auth=await apiKeyContext(request,env,"/api/v1/account"); if(auth.error)return auth.error;
  const row=auth.row, balance=Number(row.balance_units||0);
  await recordApiUsage(env,row,"/api/v1/account","GET",200);
  return reply(request,env,{ok:true,data:{email:row.email,nickname:row.nickname||"",balance_cny:(balance/10000*INTERNAL_CNY_PER_USDT).toFixed(2),api_minimum_balance_cny:API_MIN_BALANCE_CNY,currency:"CNY"}});
}
async function publicApiProducts(request,env,productId=null) {
  const endpoint=productId?"/api/v1/products/"+productId:"/api/v1/products";
  const auth=await apiKeyContext(request,env,endpoint);if(auth.error)return auth.error;
  const response=await products(request,env),payload=await response.json();
  if(!payload.ok){await recordApiUsage(env,auth.row,endpoint,"GET",response.status);return reply(request,env,payload,response.status);}
  let items=payload.items||[];
  if(productId) items=items.filter(x=>String(x.product_id)===productId);
  if(productId&&!items.length){await recordApiUsage(env,auth.row,endpoint,"GET",404);return reply(request,env,{ok:false,error:"product_not_found"},404);}
  const publicItems=items.map(x=>({product_id:x.product_id,name:x.name,category:x.category,icon:x.icon,icon_url:x.icon_url,is_hot:x.is_hot,is_recommend:x.is_recommend,price_usdt:x.price_usdt,price_cny:x.price_cny,stock:x.stock,quantity:x.quantity,available_quantity:x.stock,currency:x.currency,price_verified:x.price_verified,purchasable:x.purchasable}));
  await recordApiUsage(env,auth.row,endpoint,"GET",200);
  return reply(request,env,{ok:true,count:publicItems.length,updated_at:payload.updated_at,catalog_stale:payload.catalog_stale,items:publicItems});
}
async function publicApiOrders(request,env) {
  const endpoint="/api/v1/orders",auth=await apiKeyContext(request,env,endpoint);if(auth.error)return auth.error;
  if(request.method==="GET"){
    const rows=await env.DB.prepare("SELECT p.order_id,p.product_id,p.amount_units,p.status,p.error_code,p.created_at,p.updated_at,c.name AS product_name FROM web_purchases p LEFT JOIN shop_catalog c ON c.product_id=p.product_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 100").bind(auth.row.user_id).all();
    await recordApiUsage(env,auth.row,endpoint,"GET",200);
    return reply(request,env,{ok:true,count:(rows.results||[]).length,orders:(rows.results||[]).map(x=>({order_id:x.order_id,product_id:x.product_id,product_name:x.product_name||x.product_id,amount_cny:(Number(x.amount_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),currency:"CNY",status:x.status,error_code:x.error_code||null,created_at:Number(x.created_at),updated_at:Number(x.updated_at)}))});
  }
  let body;try{body=await request.json();}catch{return reply(request,env,{ok:false,error:"invalid_json"},400);}
  const productId=String(body.product_id||"").trim(),idem=request.headers.get("Idempotency-Key")||"";
  if(!productId||productId.length>100||idem.length<12||idem.length>128){await recordApiUsage(env,auth.row,endpoint,"POST",400);return reply(request,env,{ok:false,error:"invalid_order_request",message:"product_id 必填，并提供至少 12 位 Idempotency-Key。"},400);}
  const token=await signToken({sub:auth.row.user_id,email:auth.row.email,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,ver:Number(auth.row.token_version||0)},env.JWT_SECRET||"");
  const headers=new Headers(request.headers);headers.set("Authorization","Bearer "+token);headers.set("Idempotency-Key",idem);
  const internalRequest=new Request(request.url,{method:"POST",headers,body:JSON.stringify({product_id:productId})});
  const result=await buy(internalRequest,env);
  const status=result.status,payload=await result.clone().json().catch(()=>({ok:false,error:"invalid_buy_response"}));
  await recordApiUsage(env,auth.row,endpoint,"POST",status);
  if(payload.order_id){
    await ensureApiLedger(env);
    const purchase=await env.DB.prepare("SELECT order_id,product_id,amount_units,status FROM web_purchases WHERE order_id=? AND user_id=?").bind(payload.order_id,auth.row.user_id).first();
    if(purchase){
      const balanceRow=await env.DB.prepare("SELECT balance_units FROM users WHERE id=?").bind(auth.row.user_id).first();
      const balanceAfter=Number(balanceRow?.balance_units||0),amount=Number(purchase.amount_units||0),now=Math.floor(Date.now()/1000);
      if(purchase.status==="refunded"){
        await env.DB.batch([
          env.DB.prepare("INSERT INTO api_billing_ledger(id,order_id,user_id,key_id,product_id,action,amount_units,balance_after_units,created_at) VALUES(?,?,?,?,?,'debit',?,?,?) ON CONFLICT(order_id,action) DO NOTHING").bind(crypto.randomUUID(),purchase.order_id,auth.row.user_id,auth.row.key_id,purchase.product_id,amount,balanceAfter,now),
          env.DB.prepare("INSERT INTO api_billing_ledger(id,order_id,user_id,key_id,product_id,action,amount_units,balance_after_units,created_at) VALUES(?,?,?,?,?,'refund',?,?,?) ON CONFLICT(order_id,action) DO NOTHING").bind(crypto.randomUUID(),purchase.order_id,auth.row.user_id,auth.row.key_id,purchase.product_id,amount,balanceAfter,now)
        ]);
      } else {
        await env.DB.prepare("INSERT INTO api_billing_ledger(id,order_id,user_id,key_id,product_id,action,amount_units,balance_after_units,created_at) VALUES(?,?,?,?,?,'debit',?,?,?) ON CONFLICT(order_id,action) DO NOTHING").bind(crypto.randomUUID(),purchase.order_id,auth.row.user_id,auth.row.key_id,purchase.product_id,amount,balanceAfter,now).run();
      }
    }
  }
  return reply(request,env,payload,status);
}
async function userApiBilling(request,env) {
  let claims;try{claims=await verifyToken(request,env);}catch(e){return reply(request,env,{ok:false,error:e.message},401);}
  await ensureApiLedger(env);
  const rows=await env.DB.prepare("SELECT id,order_id,product_id,key_id,action,amount_units,balance_after_units,created_at FROM api_billing_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(claims.sub).all();
  return reply(request,env,{ok:true,entries:(rows.results||[]).map(x=>({id:x.id,order_id:x.order_id,product_id:x.product_id,key_id:x.key_id,action:x.action,amount_cny:(Number(x.amount_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),balance_after_cny:(Number(x.balance_after_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),created_at:Number(x.created_at)}))});
}

async function confirmRecharge(request, env) {
  if (!env.ADMIN_API_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_API_KEY) return reply(request, env, { ok: false, error: "unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const orderId = String(body.order_id || "").trim();
  if (!orderId) return reply(request, env, { ok: false, error: "invalid_order_id" }, 400);
  const now = Math.floor(Date.now()/1000);
  const paid = await env.DB.prepare("WITH paid AS (UPDATE recharge_orders SET status='paid',paid_at=?,updated_at=? WHERE order_id=? AND status='pending' RETURNING user_id,credit_units) UPDATE users SET balance_units=users.balance_units+paid.credit_units,balance=ROUND((users.balance_units+paid.credit_units)/10000.0,4),updated_at=? FROM paid WHERE users.id=paid.user_id RETURNING users.id")
    .bind(now, now, orderId, now).first();
  if (!paid) return reply(request, env, { ok: false, error: "recharge_order_not_pending" }, 409);
  return reply(request, env, { ok: true, order_id: orderId, credited: true });
}


const ADMIN_ROOT_EMAIL = "chulingli1988@outlook.com";
const ADMIN_ROLE_LABELS = { super_admin:"超级管理员", operations_admin:"运营管理员", support_admin:"客服管理员", viewer:"只读管理员" };
const ADMIN_ROLE_PERMISSIONS = {
 super_admin:["*"],
 operations_admin:["overview.read","orders.read","orders.manage","users.read","products.read","products.manage","inventory.read","inventory.manage","email.read","email.manage","notices.read","notices.manage","payments.read"],
 support_admin:["overview.read","users.read","support.read","support.manage"],
 viewer:["overview.read","orders.read","users.read","products.read","inventory.read","email.read","notices.read","payments.read","support.read"]
};
let adminAccountsSchemaReady=false;
async function ensureAdminAccounts(env){
 if(adminAccountsSchemaReady)return;
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS admin_accounts (user_id TEXT PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_by TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)").run();
 adminAccountsSchemaReady=true;
}
async function resolveAdmin(request,env){
 let claims;try{claims=await verifyToken(request,env)}catch(e){return {error:reply(request,env,{ok:false,error:e.message},401)}}
 const email=String(claims.email||"").trim().toLowerCase();
 const user=await env.DB.prepare("SELECT id,email,nickname,created_at,updated_at FROM users WHERE id=?").bind(claims.sub).first();
 if(!user||String(user.email||"").toLowerCase()!==email)return {error:reply(request,env,{ok:false,error:"admin_forbidden"},403)};
 if(email===ADMIN_ROOT_EMAIL)return {claims,user,admin:{id:user.id,email:user.email,nickname:user.nickname||"",role:"super_admin",role_label:"超级管理员",permissions:["*"],root:true,created_at:user.created_at,updated_at:user.updated_at}};
 await ensureAdminAccounts(env);
 const record=await env.DB.prepare("SELECT role,status,created_at,updated_at FROM admin_accounts WHERE user_id=?").bind(user.id).first();
 if(!record||record.status!=="active"||!ADMIN_ROLE_PERMISSIONS[record.role])return {error:reply(request,env,{ok:false,error:"admin_forbidden"},403)};
 return {claims,user,admin:{id:user.id,email:user.email,nickname:user.nickname||"",role:record.role,role_label:ADMIN_ROLE_LABELS[record.role],permissions:ADMIN_ROLE_PERMISSIONS[record.role],root:false,created_at:record.created_at,updated_at:record.updated_at}};
}
function hasAdminPermission(admin,permission){
 const p=admin?.permissions||[];
 return p.includes("*")||p.includes(permission)||(permission.endsWith(".read")&&p.includes("overview.read"))||p.includes(permission.replace(/\.read$/,".manage"));
}
async function adminAuthorize(request,env,permission="overview.read"){
 const auth=await resolveAdmin(request,env);if(auth.error)return auth;
 if(!hasAdminPermission(auth.admin,permission))return {error:reply(request,env,{ok:false,error:"admin_permission_denied",required:permission},403)};
 return auth;
}
function legacyAdminPermission(path,method){
 const suffix=method==="GET"?"read":"manage";
 if(path.includes("/stats/overview"))return "overview.read";
 if(path.includes("/stats/online"))return "users.read";
 if(path.includes("/upstream/overview"))return "products."+suffix;
 if(path.includes("/tickets")||path.includes("/ticket/")||path.includes("/chat/"))return "support."+suffix;
 if(path.includes("/users"))return "users."+suffix;
 if(path.includes("/orders")||path.includes("/shop/order/"))return "orders."+suffix;
 if(path.includes("/shop/products")||path.includes("/shop/product/")||path.endsWith("/products"))return "products."+suffix;
 if(path.includes("/account_pool"))return "inventory."+suffix;
 if(path.includes("/mail/")||path.includes("/config/mail"))return "email."+suffix;
 if(path.includes("/notices"))return "notices."+suffix;
 if(path.includes("/payment_configs"))return "payments."+suffix;
 if(path.includes("/config/ai"))return "support."+suffix;
 return "settings."+suffix;
}


async function adminOverview(request, env) {
  const auth = await adminAuthorize(request, env, "overview.read");
  if (auth.error) return auth.error;
  const [users, webOrders, catalog, activeCatalog, products] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM web_purchases").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM shop_catalog").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM shop_catalog WHERE is_on_sale=true AND purchasable=true").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM products WHERE active=1").first()
  ]);
  return reply(request, env, {
    ok: true,
    overview: {
      users: Number(users?.total || 0),
      orders: Number(webOrders?.total || 0),
      web_orders: Number(webOrders?.total || 0),
      catalog_products: Number(catalog?.total || 0),
      purchasable_products: Number(activeCatalog?.total || 0),
      synced_products: Number(products?.total || 0)
    }
  });
}

async function adminListUsers(request, env) {
  const auth = await adminAuthorize(request, env, "users.read");
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const limit = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "25", 10) || 25));
  const pattern = "%" + q + "%";
  const [count, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE (?='' OR email ILIKE ? OR COALESCE(nickname,'') ILIKE ?)").bind(q, pattern, pattern).first(),
    env.DB.prepare("SELECT id,email,nickname,tg_user_id,balance,created_at,updated_at FROM users WHERE (?='' OR email ILIKE ? OR COALESCE(nickname,'') ILIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(q, pattern, pattern, limit, (page - 1) * limit).all()
  ]);
  return reply(request, env, { ok: true, users: rows.results || [], total: Number(count?.total || 0), page, limit });
}


async function adminListOrders(request, env) {
  const auth = await adminAuthorize(request, env, "orders.read");
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const status = String(url.searchParams.get("status") || "").trim().slice(0, 40);
  const limit = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  const pattern = "%" + q + "%";
  const web = await env.DB.prepare("SELECT w.order_id,w.user_id,u.email,w.product_id,w.amount::text AS amount,w.status,w.created_at,w.updated_at,'商城订单' AS order_type FROM web_purchases w LEFT JOIN users u ON u.id=w.user_id WHERE (?='' OR w.status=?) AND (?='' OR w.order_id ILIKE ? OR COALESCE(u.email,'') ILIKE ? OR w.product_id ILIKE ?) ORDER BY w.created_at DESC LIMIT ?").bind(status,status,q,pattern,pattern,pattern,limit).all();
  const orders = web.results || [];
  return reply(request, env, { ok: true, orders, total_returned: orders.length, limit });
}

async function adminSupplierOrders(request, env, orderId = "") {
  const permission = request.method === "GET" ? "orders.read" : "orders.manage";
  const auth = await adminAuthorize(request, env, permission);
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const url = new URL(request.url);
    const status = String(url.searchParams.get("status") || "pending").trim().slice(0, 24);
    const limit = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
    const rows = await env.DB.prepare(
      "SELECT w.order_id,w.user_id,u.email,w.product_id,c.name AS product_name,COALESCE(s.status,'missing_supplier_record') AS supplier_status,s.supplier_order_id,COALESCE(s.error_code,w.error_code,'supplier_record_missing') AS error_code,w.created_at,COALESCE(s.updated_at,w.updated_at) AS updated_at,w.status AS payment_order_status,w.amount::text AS amount FROM web_purchases w LEFT JOIN shop_supplier_orders s ON s.order_id=w.order_id LEFT JOIN users u ON u.id=w.user_id LEFT JOIN shop_catalog c ON c.product_id=w.product_id WHERE ((?='all' AND (s.order_id IS NOT NULL OR w.status IN ('pending','reserved'))) OR (?='pending' AND (s.status='pending' OR (s.order_id IS NULL AND w.status IN ('pending','reserved')))) OR (?='processing' AND s.status='processing')) ORDER BY CASE WHEN s.status='pending' OR s.order_id IS NULL THEN 0 WHEN s.status='processing' THEN 1 ELSE 2 END,COALESCE(s.updated_at,w.updated_at) ASC LIMIT ?"
    ).bind(status,status,status,limit).all();
    return reply(request, env, { ok: true, orders: rows.results || [], total_returned: (rows.results || []).length, status });
  }
  if (request.method !== "POST" || !orderId) return reply(request, env, {ok:false,error:"method_not_allowed"},405);
  let body;
  try { body = await request.json(); } catch { return reply(request, env, {ok:false,error:"invalid_json"},400); }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const supplierOrderId = String(body.supplier_order_id || "").trim().slice(0,128);
  if (body.confirmed !== true || !content || content.length > 20000) {
    return reply(request, env, {ok:false,error:"explicit_supplier_confirmation_and_delivery_content_required"},400);
  }
  const purchase = await env.DB.prepare("SELECT order_id,user_id,amount_units,status FROM web_purchases WHERE order_id=?").bind(orderId).first();
  if (!purchase) return reply(request, env, {ok:false,error:"purchase_not_found"},404);
  if (!["pending","reserved","delivered"].includes(String(purchase.status))) {
    return reply(request, env, {ok:false,error:"purchase_not_reconcilable",status:purchase.status},409);
  }
  let result;
  try {
    result = await originRequest(env,"POST","/api/internal/supplier-deliver/"+encodeURIComponent(orderId),{
      confirmed:true,content,supplier_order_id:supplierOrderId
    });
  } catch (error) {
    return reply(request, env, {ok:false,error:error.data?.error || "supplier_delivery_save_failed"}, error.status || 502);
  }
  if (result.status !== "delivered") return reply(request,env,{ok:false,error:"supplier_delivery_not_confirmed"},409);
  const now = Math.floor(Date.now()/1000);
  await env.DB.prepare("UPDATE web_purchases SET status='delivered',server_order_id=?,error_code=NULL,updated_at=? WHERE order_id=? AND status IN ('pending','reserved','delivered')")
    .bind(orderId,now,orderId).run();
  await creditReferralReward(env,purchase);
  return reply(request,env,{ok:true,status:"delivered",order_id:orderId,already_delivered:!!result.already_delivered});
}

async function adminListProducts(request, env) {
  const auth = await adminAuthorize(request, env, "products.read");
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const limit = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "25", 10) || 25));
  const pattern = "%" + q + "%";
  const [count, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM shop_catalog WHERE (?='' OR name ILIKE ? OR product_id ILIKE ? OR COALESCE(category_name,'') ILIKE ?)").bind(q, pattern, pattern, pattern).first(),
    env.DB.prepare("SELECT product_id,supplier_product_id,name,category_name,price_cny::text AS price_cny,price_usdt::text AS price_usdt,stock,is_on_sale,is_local_inventory,purchasable,source->>'Icon' AS source_icon,updated_at FROM shop_catalog WHERE (?='' OR name ILIKE ? OR product_id ILIKE ? OR COALESCE(category_name,'') ILIKE ?) ORDER BY updated_at DESC LIMIT ? OFFSET ?").bind(q, pattern, pattern, pattern, limit, (page - 1) * limit).all()
  ]);
  return reply(request, env, { ok: true, products: (rows.results || []).map(row => ({ ...row, icon_url: storefrontIconUrl(row.source_icon, row.name), is_on_sale: !!row.is_on_sale, is_local_inventory: !!row.is_local_inventory, purchasable: !!row.purchasable })), total: Number(count?.total || 0), page, limit, read_only: true });
}

async function adminStaff(request,env){
 const auth=await adminAuthorize(request,env,"staff.manage");if(auth.error)return auth.error;
 await ensureAdminAccounts(env);
 if(request.method==="GET"){
  const rows=await env.DB.prepare("SELECT a.user_id,a.role,a.status,a.created_at,a.updated_at,u.email,u.nickname FROM admin_accounts a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC").all();
  return reply(request,env,{ok:true,admins:rows.results||[],roles:ADMIN_ROLE_LABELS,current_admin:auth.admin});
 }
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const now=Math.floor(Date.now()/1000),role=String(body.role||"").trim();
 if(!Object.prototype.hasOwnProperty.call(ADMIN_ROLE_PERMISSIONS,role))return reply(request,env,{ok:false,error:"invalid_admin_role"},400);
 if(body.email){
  const email=String(body.email).trim().toLowerCase();
  if(!validEmail(email)||email===ADMIN_ROOT_EMAIL)return reply(request,env,{ok:false,error:"invalid_admin_email"},400);
  const target=await env.DB.prepare("SELECT id,email FROM users WHERE lower(email)=?").bind(email).first();
  if(!target)return reply(request,env,{ok:false,error:"user_account_not_found_register_first"},404);
  await env.DB.prepare("INSERT INTO admin_accounts(user_id,role,status,created_by,created_at,updated_at) VALUES(?,?,'active',?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,status='active',updated_at=excluded.updated_at").bind(target.id,role,auth.user.id,now,now).run();
  return reply(request,env,{ok:true,admin:{user_id:target.id,email:target.email,role,role_label:ADMIN_ROLE_LABELS[role],status:"active"}},201);
 }
 const userId=String(body.user_id||"").trim();if(!userId)return reply(request,env,{ok:false,error:"missing_user_id"},400);
 const existing=await env.DB.prepare("SELECT user_id FROM admin_accounts WHERE user_id=?").bind(userId).first();
 if(!existing)return reply(request,env,{ok:false,error:"admin_not_found"},404);
 if(body.status!==undefined)await env.DB.prepare("UPDATE admin_accounts SET status=?,updated_at=? WHERE user_id=?").bind(body.status==="active"?"active":"disabled",now,userId).run();
 else await env.DB.prepare("UPDATE admin_accounts SET role=?,updated_at=? WHERE user_id=?").bind(role,now,userId).run();
 return reply(request,env,{ok:true,updated:true});
}
async function adminRemoveStaff(request,env,userId){
 const auth=await adminAuthorize(request,env,"staff.manage");if(auth.error)return auth.error;
 if(!userId||userId===auth.user.id)return reply(request,env,{ok:false,error:"invalid_admin_target"},400);
 const result=await env.DB.prepare("DELETE FROM admin_accounts WHERE user_id=?").bind(userId).run();
 if(!Number(result.meta?.changes||0))return reply(request,env,{ok:false,error:"admin_not_found"},404);
 return reply(request,env,{ok:true,removed:true});
}
async function adminSession(request, env) {
 const auth=await resolveAdmin(request,env);if(auth.error)return auth.error;
 return reply(request,env,{ok:true,admin:auth.admin});
}

async function adminApiKeys(request, env) {
 const auth=await adminAuthorize(request,env,"staff.manage");if(auth.error)return auth.error;
 if(request.method==="GET"){
  const rows=await env.DB.prepare("SELECT k.id,k.user_id,u.email,k.key_prefix,k.label,k.created_at,k.last_used_at,k.revoked_at,(SELECT COUNT(*) FROM user_api_usage x WHERE x.key_id=k.id) AS used FROM user_api_keys k LEFT JOIN users u ON u.id=k.user_id ORDER BY k.created_at DESC LIMIT 500").all();
  return reply(request,env,{ok:true,keys:(rows.results||[]).map(x=>({...x,created_at:Number(x.created_at||0),last_used_at:x.last_used_at?Number(x.last_used_at):null,revoked_at:x.revoked_at?Number(x.revoked_at):null,used:Number(x.used||0)}))});
 }
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const email=String(body.email||"").trim().toLowerCase(),label=String(body.label||"").trim().slice(0,40);
 if(!validEmail(email)||!label)return reply(request,env,{ok:false,error:"invalid_api_key_request"},400);
 const user=await env.DB.prepare("SELECT id,email,balance_units FROM users WHERE lower(email)=?").bind(email).first();
 if(!user)return reply(request,env,{ok:false,error:"user_not_found"},404);
 if(Number(user.balance_units||0)<API_MIN_BALANCE_UNITS)return reply(request,env,{ok:false,error:"api_balance_requirement",required_cny:API_MIN_BALANCE_CNY},403);
 const active=await env.DB.prepare("SELECT COUNT(*) AS total FROM user_api_keys WHERE user_id=? AND revoked_at IS NULL").bind(user.id).first();
 if(Number(active?.total||0)>=5)return reply(request,env,{ok:false,error:"api_key_limit"},409);
 const key="qt_live_"+hexBytes(crypto.getRandomValues(new Uint8Array(32)));
 const hash=hexBytes(await sha256(key)),id=crypto.randomUUID(),now=Math.floor(Date.now()/1000);
 await env.DB.prepare("INSERT INTO user_api_keys(id,user_id,key_prefix,key_hash,label,created_at) VALUES(?,?,?,?,?,?)").bind(id,user.id,key.slice(0,16),hash,label,now).run();
 return reply(request,env,{ok:true,key,id,email:user.email,label,key_prefix:key.slice(0,16),created_at:now,warning:"完整密钥仅显示这一次，请立即复制保存。"},201);
}
async function adminRevokeApiKey(request,env,keyId){
 const auth=await adminAuthorize(request,env,"staff.manage");if(auth.error)return auth.error;
 const existing=await env.DB.prepare("SELECT id,revoked_at FROM user_api_keys WHERE id=?").bind(keyId).first();
 if(!existing)return reply(request,env,{ok:false,error:"api_key_not_found"},404);
 if(existing.revoked_at)return reply(request,env,{ok:false,error:"api_key_already_revoked"},409);
 const now=Math.floor(Date.now()/1000);
 await env.DB.prepare("UPDATE user_api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now,keyId).run();
 return reply(request,env,{ok:true,revoked:true,id:keyId,revoked_at:now});
}
async function adminApiLogs(request,env){
 const auth=await adminAuthorize(request,env,"staff.manage");if(auth.error)return auth.error;
 const url=new URL(request.url),raw=Number(url.searchParams.get("limit")||100),limit=Math.min(200,Math.max(1,Number.isFinite(raw)?Math.trunc(raw):100));
 const rows=await env.DB.prepare("SELECT x.id,x.endpoint AS path,x.method,x.status_code,x.created_at,u.email,k.key_prefix FROM user_api_usage x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN user_api_keys k ON k.id=x.key_id ORDER BY x.created_at DESC LIMIT ?").bind(limit).all();
 return reply(request,env,{ok:true,logs:(rows.results||[]).map(x=>({...x,status_code:Number(x.status_code||0),created_at:Number(x.created_at||0)}))});
}

const LEGACY_ADMIN_EXACT = new Set([
  "/api/v1/admin/account_pool",
  "/api/v1/admin/account_pool/stats",
  "/api/v1/admin/logs",
  "/api/v1/admin/stats/online",
  "/api/v1/admin/upload",
  "/api/v1/admin/chat/users",
  "/api/v1/admin/config/ai",
  "/api/v1/admin/config/mail",
  "/api/v1/admin/mail/send",
  "/api/v1/admin/mail/templates",
  "/api/v1/admin/notices",
  "/api/v1/admin/orders",
  "/api/v1/admin/payment_configs",
  "/api/v1/admin/products",
  "/api/v1/admin/shop/orders",
  "/api/v1/admin/shop/overview",
  "/api/v1/admin/shop/products",
  "/api/v1/admin/stats/overview",
  "/api/v1/admin/tickets",
  "/api/v1/admin/upstream/overview",
  "/api/v1/admin/users"
]);
const LEGACY_ADMIN_PREFIXES = [
  "/api/v1/admin/account_pool/",
  "/api/v1/admin/chat/",
  "/api/v1/admin/mail/",
  "/api/v1/admin/notices/",
  "/api/v1/admin/shop/order/",
  "/api/v1/admin/shop/product/",
  "/api/v1/admin/ticket/",
  "/api/v1/admin/users/"
];
function legacyAdminPathAllowed(path) {
  return LEGACY_ADMIN_EXACT.has(path) || LEGACY_ADMIN_PREFIXES.some(prefix => path.startsWith(prefix));
}
async function adminLegacyProxy(request, env) {
  if (!["GET", "POST"].includes(request.method)) return reply(request, env, { ok: false, error: "method_not_allowed" }, 405);
  const url = new URL(request.url);
  const prefix = "/api/admin/legacy";
  if (!url.pathname.startsWith(prefix + "/")) return reply(request, env, { ok: false, error: "not_found" }, 404);
  const suffix = url.pathname.slice(prefix.length);
  if (!suffix.startsWith("/") || suffix.startsWith("//") || suffix.includes("..") || suffix.includes("\\") || /%2f|%5c/i.test(suffix)) {
    return reply(request, env, { ok: false, error: "invalid_legacy_path" }, 400);
  }
  const apiPath = "/api/v1/admin" + suffix;
  if (!legacyAdminPathAllowed(apiPath)) return reply(request, env, { ok: false, error: "legacy_route_not_allowed" }, 404);
  if (apiPath === "/api/v1/admin/payment_configs" && url.searchParams.get("view") !== "status") {
    return reply(request, env, { ok: false, error: "payment_status_view_required" }, 400);
  }
  const auth = await resolveAdmin(request, env);
  if (auth.error) return auth.error;
  const requiredPermission = legacyAdminPermission(apiPath, request.method);
  const permitted = apiPath === "/api/v1/admin/upload"
    ? hasAdminPermission(auth.admin, "support.manage")
    : hasAdminPermission(auth.admin, requiredPermission);
  if (!permitted) return reply(request, env, { ok: false, error: "admin_permission_denied", required: requiredPermission }, 403);
  if (!env.BOT_BRIDGE_SECRET) return reply(request, env, { ok: false, error: "admin_bridge_not_configured" }, 503);

  let body = "";
  if (request.method !== "GET") {
    body = await request.text();
    if (body.length > 2000000) return reply(request, env, { ok: false, error: "request_too_large" }, 413);
  }
  const targetPath = apiPath + url.search;
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const adminEmail=String(auth.user.email||"").trim().toLowerCase();
  const adminRole=String(auth.admin.role||"viewer").trim().toLowerCase();
  const adminUserId=String(auth.user.id||"").trim();
  const signed = ts + "\n" + nonce + "\n" + request.method.toUpperCase() + "\n" + targetPath + "\n" + body + "\n" + adminEmail + "\n" + adminRole + "\n" + adminUserId;
  const signature = Array.from(await hmac(env.BOT_BRIDGE_SECRET, signed))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  let response;
  try {
    response = await fetch(new URL(targetPath, "https://api.lynli.me"), {
      method: request.method,
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "application/json",
        "Accept": "application/json",
        "X-Admin-Email": adminEmail,
        "X-Admin-Role": adminRole,
        "X-Admin-User-Id": adminUserId,
        "X-Admin-Timestamp": ts,
        "X-Admin-Nonce": nonce,
        "X-Admin-Signature": signature
      },
      body: request.method === "GET" ? undefined : body
    });
  } catch {
    return reply(request, env, { ok: false, error: "legacy_api_unreachable" }, 502);
  }

  let data = {};
  try { data = await response.json(); } catch {}
  const ok = response.ok && (Number(data.code) === 1 || data.ok === true || data.status === "success");
  if (!ok) {
    const message = data.msg || data.message || data.error || "legacy_api_error";
    return reply(request, env, { ok: false, error: String(message), legacy_code: data.code ?? null }, response.status >= 400 ? response.status : 400);
  }
  return reply(request, env, { ok: true, data }, response.status);
}

async function adminCredit(request, env) {
  const auth=await adminAuthorize(request,env,"finance.manage");
  const keyAuthorized=!!env.ADMIN_API_KEY&&request.headers.get("X-Admin-Key")===env.ADMIN_API_KEY;
  if(auth.error&&!keyAuthorized)return auth.error;
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const units = amountUnits(body.amount_usdt);
  if (!validEmail(email) || !units) return reply(request, env, { ok: false, error: "invalid_credit" }, 400);
  const result = await env.DB.prepare(
    "UPDATE users SET balance_units=balance_units+?,balance=printf('%.4f',(balance_units+?)/10000.0),updated_at=? WHERE email=?"
  ).bind(units, units, Math.floor(Date.now() / 1000), email).run();
  if (Number(result.meta?.changes || 0) !== 1) return reply(request, env, { ok: false, error: "user_not_found" }, 404);
  return reply(request, env, { ok: true, email, credited: money(units) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return reply(request, env, { ok: true, service: "qingtian-shop-api" });
      }
      if (url.pathname === "/api/auth/github/status" && request.method === "GET") return githubStatus(request, env);
      if (url.pathname === "/api/auth/github/start" && request.method === "GET") return await githubStart(request, env);
      if (url.pathname === "/api/auth/github/callback" && request.method === "GET") return await githubCallback(request, env);
      if (url.pathname === "/api/auth/send_code" && request.method === "POST") return await sendCode(request, env);
      if (url.pathname === "/api/auth/forgot_password" && request.method === "POST") return await forgotPassword(request, env);
      if (url.pathname === "/api/auth/reset_password" && request.method === "POST") return await resetPassword(request, env);
      if (url.pathname === "/api/auth/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/api/user/info" && request.method === "GET") return await userInfo(request, env);
      if (url.pathname === "/api/user/profile" && request.method === "POST") return await updateUserProfile(request, env);
      if (url.pathname === "/api/user/change-password" && request.method === "POST") return await changeUserPassword(request, env);
      if (url.pathname === "/api/user/recharge-orders" && ["GET","POST"].includes(request.method)) return await userRechargeOrders(request, env);
      if (url.pathname === "/api/user/withdrawals" && ["GET","POST"].includes(request.method)) return await userWithdrawals(request, env);
      if (url.pathname === "/api/admin/withdrawals/resolve" && request.method === "POST") return await resolveUserWithdrawal(request, env);
      if (url.pathname === "/api/user/api-keys" && ["GET","POST"].includes(request.method)) return await userApiKeys(request, env);
      if (url.pathname === "/api/user/api-usage" && request.method === "GET") return await userApiUsage(request, env);
      const revokeKeyMatch = url.pathname.match(/^\/api\/user\/api-keys\/([a-f0-9-]{36})$/i);
      if (revokeKeyMatch && request.method === "DELETE") return await revokeUserApiKey(request, env, revokeKeyMatch[1]);
      if (url.pathname === "/api/v1/account" && request.method === "GET") return await publicApiAccount(request, env);
       if (url.pathname === "/api/v1/products" && request.method === "GET") return await publicApiProducts(request, env);
       const publicProductMatch=url.pathname.match(/^\/api\/v1\/products\/([^/]+)$/);
       if (publicProductMatch && request.method === "GET") return await publicApiProducts(request, env, decodeURIComponent(publicProductMatch[1]));
       if (url.pathname === "/api/v1/orders" && ["GET","POST"].includes(request.method)) return await publicApiOrders(request, env);
       if (url.pathname === "/api/user/api-billing" && request.method === "GET") return await userApiBilling(request, env);
      if (url.pathname === "/api/admin/recharge/confirm" && request.method === "POST") return await confirmRecharge(request, env);
      if (url.pathname === "/api/user/referrals" && request.method === "GET") return await userReferrals(request, env);
      if (url.pathname === "/api/user/orders" && request.method === "GET") return await userOrders(request, env);
      if (url.pathname === "/api/products" && request.method === "GET") {
        try { await verifyToken(request, env); } catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
        return await products(request, env);
      }
      if (url.pathname === "/api/buy" && request.method === "POST") return await buy(request, env);
      const match = url.pathname.match(/^\/api\/buy\/([a-f0-9-]{36})$/i);
      if (match && request.method === "GET") return await buyStatus(request, env, match[1]);
      if (url.pathname.startsWith("/api/admin/legacy/")) return await adminLegacyProxy(request, env);
      if (url.pathname === "/api/admin/session" && request.method === "GET") return await adminSession(request, env);
      if (url.pathname === "/api/admin/staff" && ["GET","POST"].includes(request.method)) return await adminStaff(request, env);
      const staffRemoveMatch=url.pathname.match(/^\/api\/admin\/staff\/([^/]+)$/);
      if (staffRemoveMatch && request.method === "DELETE") return await adminRemoveStaff(request, env, staffRemoveMatch[1]);
      if (url.pathname === "/api/admin/overview" && request.method === "GET") return await adminOverview(request, env);
      if (url.pathname === "/api/admin/users" && request.method === "GET") return await adminListUsers(request, env);
      if (url.pathname === "/api/admin/orders" && request.method === "GET") return await adminListOrders(request, env);
      if (url.pathname === "/api/admin/supplier-orders" && request.method === "GET") return await adminSupplierOrders(request, env);
      const supplierDeliveryMatch = url.pathname.match(/^\/api\/admin\/supplier-orders\/([a-f0-9-]{36})\/deliver$/i);
      if (supplierDeliveryMatch && request.method === "POST") return await adminSupplierOrders(request, env, supplierDeliveryMatch[1]);
      if (url.pathname === "/api/admin/products" && request.method === "GET") return await adminListProducts(request, env);
      if (url.pathname === "/api/admin/api-keys" && ["GET","POST"].includes(request.method)) return await adminApiKeys(request,env);
      const apiKeyRevokeMatch=url.pathname.match(/^\/api\/admin\/api-keys\/([a-f0-9-]{36})\/revoke$/i);
      if (apiKeyRevokeMatch && request.method === "POST") return await adminRevokeApiKey(request,env,apiKeyRevokeMatch[1]);
      if (url.pathname === "/api/admin/api-logs" && request.method === "GET") return await adminApiLogs(request,env);
      if (url.pathname === "/api/admin/credit" && request.method === "POST") return await adminCredit(request, env);
      return reply(request, env, { ok: false, error: "not_found" }, 404);
    } catch (error) {
      console.error("[worker_unhandled_error]", JSON.stringify({
        method: request.method,
        path: url.pathname,
        name: String(error?.name || "Error").slice(0, 80),
        code: String(error?.code || error?.cause?.code || "").slice(0, 80),
        message: String(error?.message || "unknown_error").slice(0, 240),
        stack: String(error?.stack || "").split("\n").slice(0, 6).join("\n").slice(0, 1200)
      }));
      return reply(request, env, { ok: false, error: "internal_error" }, 500);
    }
  }
};