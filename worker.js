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
  const signingSecret = path.startsWith("/api/internal/nodes/") ? env.NODE_STORE_SECRET : env.INTERNAL_API_SECRET;
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
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET balance_units=balance_units+?,balance=printf('%.4f',(balance_units+?)/10000.0),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM web_purchases WHERE order_id=? AND status IN ('reserved','pending'))"
    ).bind(order.amount_units, order.amount_units, now, order.user_id, order.order_id),
    env.DB.prepare(
      "UPDATE web_purchases SET status='refunded',updated_at=?,error_code='purchase_failed' WHERE order_id=? AND status IN ('reserved','pending')"
    ).bind(now, order.order_id)
  ]);
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
    await refund(env, purchase);
    return { ...data, status: "refunded" };
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
    await refund(env, purchase);
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
  const result = await env.DB.prepare(
    "SELECT p.order_id,p.product_id,p.amount_units,p.status,p.error_code,p.created_at,p.updated_at,c.name AS product_name FROM web_purchases p LEFT JOIN shop_catalog c ON c.product_id=p.product_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 100"
  ).bind(claims.sub).all();
  const orders = (result.results || []).map(row => ({
    order_id: String(row.order_id),
    product_id: String(row.product_id || ""),
    product_name: String(row.product_name || row.product_id || "数字商品"),
    amount_cny: (Number(row.amount_units || 0) / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2),
    currency: "CNY",
    status: String(row.status || "pending"),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0)
  }));
  return reply(request, env, { ok: true, count: orders.length, orders });
}

async function buyStatus(request, env, orderId) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const user = await findUserById(env, claims.sub);
  const purchase = await env.DB.prepare(
    "SELECT * FROM web_purchases WHERE order_id=? AND user_id=?"
  ).bind(orderId, claims.sub).first();
  if (!purchase || !user) return reply(request, env, { ok: false, error: "order_not_found" }, 404);
  if (purchase.status === "refunded") return reply(request, env, { ok: true, status: "refunded" });
  if (purchase.status === "delivered" || purchase.status === "pending" || purchase.status === "reserved") {
    try {
      const data = await syncServerStatus(env, purchase, user);
      if (data.status === "failed") await refund(env, purchase);
      return reply(request, env, { ok: true, order_id: orderId, status: data.status, content: data.content || null });
    } catch {
      return reply(request, env, { ok: true, order_id: orderId, status: "pending", message: "订单仍在核验，请稍后查询。" }, 202);
    }
  }
  return reply(request, env, { ok: true, status: purchase.status });
}



function nodeHexBytes(value) {
  const s=String(value||"").trim();
  if(!/^[a-f0-9]{64}$/i.test(s))throw new Error("delivery_encryption_not_configured");
  return Uint8Array.from(s.match(/.{2}/g),x=>parseInt(x,16));
}
function nodeB64(bytes) {
  let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);
}
async function encryptNodePayload(value,env) {
  const key=await crypto.subtle.importKey("raw",nodeHexBytes(env.DELIVERY_ENCRYPTION_KEY),{name:"AES-GCM"},false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value)));
  const packed=new Uint8Array(iv.length+encrypted.length);packed.set(iv);packed.set(encrypted,iv.length);
  return nodeB64(packed);
}
async function decryptNodePayload(value,env) {
  const raw=Uint8Array.from(atob(String(value||"")),c=>c.charCodeAt(0));
  if(raw.length<29)throw new Error("node_delivery_invalid");
  const key=await crypto.subtle.importKey("raw",nodeHexBytes(env.DELIVERY_ENCRYPTION_KEY),{name:"AES-GCM"},false,["decrypt"]);
  const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:raw.slice(0,12)},key,raw.slice(12));
  return JSON.parse(new TextDecoder().decode(clear));
}
function yamlScalar(value){return JSON.stringify(String(value));}
function nodeClashYaml(proxy){
  const keys=["name","type","server","port","uuid","alterId","cipher","network","tls","udp","flow","servername","client-fingerprint","username","password","obfs","obfs-password","sni","skip-cert-verify"];
  const lines=["mixed-port: 7890","allow-lan: false","mode: rule","log-level: info","proxies:"];
  lines.push("  - name: "+yamlScalar(proxy.name));
  for(const key of keys){if(proxy[key]===undefined||proxy[key]===null)continue;const val=proxy[key];lines.push("    "+key+": "+(typeof val==="boolean"||typeof val==="number"?String(val):yamlScalar(val)));}
  if(proxy["reality-opts"]){lines.push("    reality-opts:");for(const [k,v] of Object.entries(proxy["reality-opts"]))lines.push("      "+k+": "+yamlScalar(v));}
  if(proxy["ws-opts"]){lines.push("    ws-opts:");lines.push("      path: "+yamlScalar(proxy["ws-opts"].path||"/"));if(proxy["ws-opts"].headers){lines.push("      headers:");for(const [k,v] of Object.entries(proxy["ws-opts"].headers))lines.push("        "+k+": "+yamlScalar(v));}}
  lines.push("proxy-groups:","  - name: Proxy","    type: select","    proxies:","      - "+yamlScalar(proxy.name),"      - DIRECT","rules:","  - MATCH,Proxy","");
  return lines.join("\n");
}
async function nodeProducts(request,env){
  let claims;try{claims=await verifyToken(request,env)}catch(e){return reply(request,env,{ok:false,error:e.message},401)}
  const result=await env.DB.prepare("SELECT product_id,name,protocol,description,server_ref,server_present,provisioning_ready FROM node_products WHERE active=TRUE AND server_present=TRUE AND provisioning_ready=TRUE ORDER BY display_order").all();
  const products=[];
  for(const p of result.results||[]){
    const pkgs=await env.DB.prepare("SELECT package_id,name,price_cny,duration_days,traffic_limit_bytes,max_devices FROM node_packages WHERE product_id=? AND active=TRUE ORDER BY display_order").bind(p.product_id).all();
    products.push({...p,packages:(pkgs.results||[]).map(x=>({...x,price_cny:Number(x.price_cny),duration_days:Number(x.duration_days),traffic_limit_bytes:x.traffic_limit_bytes===null?null:Number(x.traffic_limit_bytes),max_devices:Number(x.max_devices||1)}))});
  }
  return reply(request,env,{ok:true,products});
}
async function refundNodeOrder(env,orderId,reason){
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare("WITH failed AS (UPDATE node_orders SET status='refunded',error_code=?,updated_at=? WHERE order_id=? AND status='provisioning' RETURNING user_id,amount_units) UPDATE users SET balance_units=users.balance_units+failed.amount_units,balance=ROUND((users.balance_units+failed.amount_units)/10000.0,4),updated_at=? FROM failed WHERE users.id=failed.user_id")
    .bind(String(reason||"node_provision_failed").slice(0,100),now,orderId,now).run();
}
async function userNodeOrders(request,env){
  let claims;try{claims=await verifyToken(request,env)}catch(e){return reply(request,env,{ok:false,error:e.message},401)}
  if(request.method==="GET"){
    const currentTime=Math.floor(Date.now()/1000);
    await env.DB.prepare("UPDATE node_accounts SET status='expired',updated_at=? WHERE user_id=? AND status='active' AND expires_at<=?").bind(currentTime,claims.sub,currentTime).run();
    const accountRows=await env.DB.prepare("SELECT account_id,order_id,product_id,protocol,server_ref,client_ref,expires_at,traffic_limit_bytes,traffic_used_bytes,status,created_at,updated_at FROM node_accounts WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(claims.sub).all();
    let accounts=(accountRows.results||[]).map(x=>({...x,expires_at:Number(x.expires_at||0),traffic_limit_bytes:Number(x.traffic_limit_bytes||0),traffic_used_bytes:Number(x.traffic_used_bytes||0)}));
    let trafficUsageAvailable=false;
    if(accounts.length){
      try{
        const usage=await originRequest(env,"POST","/api/internal/nodes/usage",{client_refs:accounts.map(x=>x.client_ref)});
        if(Array.isArray(usage.accounts)){
          trafficUsageAvailable=true;
          for(const item of usage.accounts){
            const used=Number(item.traffic_used_bytes||0),status=String(item.status||"active");
            await env.DB.prepare("UPDATE node_accounts SET traffic_used_bytes=?,status=?,updated_at=? WHERE client_ref=? AND user_id=?").bind(used,status,currentTime,item.client_ref,claims.sub).run();
            const local=accounts.find(x=>x.client_ref===item.client_ref);if(local){local.traffic_used_bytes=used;local.status=status;}
          }
        }
      }catch{}
    }
    const rows=await env.DB.prepare("SELECT o.order_id,o.product_id,o.package_id,o.amount_units,o.status,o.error_code,o.created_at,o.updated_at,o.delivery_ciphertext,p.name AS product_name,g.name AS package_name FROM node_orders o LEFT JOIN node_products p ON p.product_id=o.product_id LEFT JOIN node_packages g ON g.package_id=o.package_id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 100").bind(claims.sub).all();
    const orders=[];
    for(const r of rows.results||[]){
      let delivery=null;if(r.delivery_ciphertext&&r.status==="fulfilled"){try{delivery=await decryptNodePayload(r.delivery_ciphertext,env)}catch{}}
      orders.push({order_id:r.order_id,product_id:r.product_id,package_id:r.package_id,product_name:r.product_name||"节点服务",package_name:r.package_name||"",amount_cny:(Number(r.amount_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),status:r.status,error_code:r.error_code||null,created_at:Number(r.created_at),updated_at:Number(r.updated_at),delivery});
    }
    return reply(request,env,{ok:true,orders,accounts,traffic_usage_available:trafficUsageAvailable});
  }
  let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
  const packageId=String(body.package_id||"").trim();
  const idem=String(request.headers.get("Idempotency-Key")||body.idempotency_key||"").trim();
  if(!packageId||idem.length<8||idem.length>120)return reply(request,env,{ok:false,error:"invalid_node_order"},400);
  const existing=await env.DB.prepare("SELECT order_id,status,delivery_ciphertext,error_code FROM node_orders WHERE user_id=? AND idempotency_key=?").bind(claims.sub,idem).first();
  if(existing){
    let delivery=null;if(existing.delivery_ciphertext&&existing.status==="fulfilled"){try{delivery=await decryptNodePayload(existing.delivery_ciphertext,env)}catch{}}
    return reply(request,env,{ok:true,order_id:existing.order_id,status:existing.status,delivery,error_code:existing.error_code||null});
  }
  const pkg=await env.DB.prepare("SELECT g.package_id,g.product_id,g.name AS package_name,g.price_cny,g.duration_days,g.traffic_limit_bytes,g.max_devices,p.name AS product_name,p.protocol,p.server_ref,p.provisioning_ready,p.server_present,p.active AS product_active FROM node_packages g JOIN node_products p ON p.product_id=g.product_id WHERE g.package_id=? AND g.active=TRUE").bind(packageId).first();
  if(!pkg||!pkg.product_active||!pkg.provisioning_ready||!pkg.server_present)return reply(request,env,{ok:false,error:"node_package_unavailable"},404);
  const cents=Math.round(Number(pkg.price_cny)*100),units=cents*25;
  if(!Number.isSafeInteger(units)||units<1)return reply(request,env,{ok:false,error:"invalid_package_price"},409);
  const orderId=crypto.randomUUID(),now=Math.floor(Date.now()/1000);
  let inserted;
  try{
    inserted=await env.DB.prepare("WITH debit AS (UPDATE users SET balance_units=balance_units-?,balance=ROUND((balance_units-?)/10000.0,4),updated_at=? WHERE id=? AND balance_units>=? RETURNING id) INSERT INTO node_orders(order_id,user_id,product_id,package_id,amount_units,status,idempotency_key,created_at,updated_at,expires_at) SELECT ?,?,?,?,?,'provisioning',?,?,?,? FROM debit RETURNING order_id")
      .bind(units,units,now,claims.sub,units,orderId,claims.sub,pkg.product_id,pkg.package_id,units,idem,now,now,now+900).first();
  }catch(e){
    const dupe=await env.DB.prepare("SELECT order_id,status FROM node_orders WHERE user_id=? AND idempotency_key=?").bind(claims.sub,idem).first();
    if(dupe)return reply(request,env,{ok:true,order_id:dupe.order_id,status:dupe.status});
    throw e;
  }
  if(!inserted)return reply(request,env,{ok:false,error:"insufficient_balance",required_cny:(units/10000*INTERNAL_CNY_PER_USDT).toFixed(2)},402);
  let account;
  const serverRef=String(pkg.server_ref||"us").toLowerCase();
  try{
    const provisioned=await originRequest(env,"POST","/api/internal/nodes/provision",{order_id:orderId,client_ref:orderId,protocol:pkg.protocol,duration_days:Number(pkg.duration_days),server_ref:serverRef,traffic_limit_bytes:Number(pkg.traffic_limit_bytes||0)});
    account=provisioned.account;
    if(!account||!account.uri||!account.client_ref)throw new Error("node_delivery_missing");
    const delivery={protocol:pkg.protocol,uri:account.uri,http_uri:account.http_uri||null,clash_yaml:account.clash_proxy?nodeClashYaml(account.clash_proxy):null,expires_at:Number(account.expires_at),instructions:pkg.protocol==="mtproto"?"此链接仅用于 Telegram：在 Telegram 客户端打开即可添加代理。":"将 Clash YAML 保存为 .yaml 文件后导入 Mihomo / Clash Meta。"};
    const encrypted=await encryptNodePayload(JSON.stringify(delivery),env);
    await env.DB.batch([
      env.DB.prepare("UPDATE node_orders SET status='fulfilled',delivery_ciphertext=?,updated_at=?,expires_at=? WHERE order_id=? AND status='provisioning'").bind(encrypted,Math.floor(Date.now()/1000),Number(account.expires_at),orderId),
      env.DB.prepare("INSERT INTO node_accounts(account_id,user_id,product_id,order_id,protocol,server_ref,client_ref,expires_at,traffic_limit_bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)").bind(crypto.randomUUID(),claims.sub,pkg.product_id,orderId,pkg.protocol,serverRef,account.client_ref,Number(account.expires_at),pkg.traffic_limit_bytes,Math.floor(Date.now()/1000),Math.floor(Date.now()/1000))
    ]);
    return reply(request,env,{ok:true,order_id:orderId,status:"fulfilled",delivery},201);
  }catch(e){
    let cleanupConfirmed=false;
    try{
      const cleanup=await originRequest(env,"POST","/api/internal/nodes/revoke",{protocol:pkg.protocol,client_ref:account?.client_ref||orderId,server_ref:serverRef});
      cleanupConfirmed=cleanup?.ok===true;
    }catch{}
    if(cleanupConfirmed){
      await refundNodeOrder(env,orderId,String(e.message||"node_provision_failed"));
      return reply(request,env,{ok:false,order_id:orderId,status:"refunded",error:"node_provision_failed"},502);
    }
    await env.DB.prepare("UPDATE node_orders SET error_code='node_provision_result_uncertain',updated_at=? WHERE order_id=? AND status='provisioning'")
      .bind(Math.floor(Date.now()/1000),orderId).run();
    return reply(request,env,{ok:true,order_id:orderId,status:"provisioning",error_code:"node_provision_result_uncertain",message:"节点开通结果正在核对，请勿重复下单。"},202);
  }
}
async function nodeOrderStatus(request,env,orderId){
  let claims;try{claims=await verifyToken(request,env)}catch(e){return reply(request,env,{ok:false,error:e.message},401)}
  const row=await env.DB.prepare("SELECT o.order_id,o.status,o.amount_units,o.error_code,o.created_at,o.updated_at,o.delivery_ciphertext,p.name AS product_name,g.name AS package_name FROM node_orders o LEFT JOIN node_products p ON p.product_id=o.product_id LEFT JOIN node_packages g ON g.package_id=o.package_id WHERE o.order_id=? AND o.user_id=?").bind(orderId,claims.sub).first();
  if(!row)return reply(request,env,{ok:false,error:"order_not_found"},404);
  let delivery=null;if(row.delivery_ciphertext&&row.status==="fulfilled"){try{delivery=await decryptNodePayload(row.delivery_ciphertext,env)}catch{}}
  return reply(request,env,{ok:true,order_id:row.order_id,status:row.status,product_name:row.product_name,package_name:row.package_name,amount_cny:(Number(row.amount_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),error_code:row.error_code||null,created_at:Number(row.created_at),updated_at:Number(row.updated_at),delivery});
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

async function userRechargeOrders(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
    const amount = String(body.amount_cny ?? "").trim();
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(amount)) return reply(request, env, { ok: false, error: "invalid_amount" }, 400);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents) || cents < 8000 || cents > 5000000) {
      return reply(request, env, { ok: false, error: "amount_out_of_range" }, 400);
    }
    const orderId = crypto.randomUUID(), now = Math.floor(Date.now()/1000);
    const creditUnits = Math.round(cents * 25); // ¥4 = 1 USDT; balance is stored in 1/10000 USDT.
    await env.DB.prepare("INSERT INTO recharge_orders(order_id,user_id,amount_cny,credit_units,payment_method,status,created_at,updated_at) VALUES(?,?,?,?, 'USDT_TRC20','pending',?,?)")
      .bind(orderId, claims.sub, (cents/100).toFixed(2), creditUnits, now, now).run();
    return reply(request, env, { ok: true, order: { order_id: orderId, amount_cny: (cents/100).toFixed(2), payment_method: "USDT_TRC20", status: "pending", created_at: now }, payment_instructions: "请先联系官方客服获取实时收款地址；付款后提交订单号与凭证，由客服核验入账。" }, 201);
  }
  const result = await env.DB.prepare("SELECT order_id,amount_cny,payment_method,status,created_at,updated_at,paid_at FROM recharge_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100")
    .bind(claims.sub).all();
  return reply(request, env, { ok: true, orders: (result.results || []).map(row => ({
    order_id: String(row.order_id), amount_cny: Number(row.amount_cny).toFixed(2),
    payment_method: String(row.payment_method), status: String(row.status),
    created_at: Number(row.created_at), updated_at: Number(row.updated_at), paid_at: row.paid_at ? Number(row.paid_at) : null
  })) });
}

async function userApiKeys(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  if (request.method === "GET") {
    const result = await env.DB.prepare("SELECT id,key_prefix,label,created_at,last_used_at,revoked_at FROM user_api_keys WHERE user_id=? ORDER BY created_at DESC LIMIT 20").bind(claims.sub).all();
    return reply(request, env, { ok: true, eligible: (await env.DB.prepare("SELECT balance_units FROM users WHERE id=?").bind(claims.sub).first()).balance_units >= 500000,
      keys: (result.results || []).map(row => ({ id: row.id, key_prefix: row.key_prefix, label: row.label, created_at: Number(row.created_at), last_used_at: row.last_used_at ? Number(row.last_used_at) : null, revoked: Boolean(row.revoked_at) })) });
  }
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const user = await env.DB.prepare("SELECT balance_units FROM users WHERE id=?").bind(claims.sub).first();
  if (!user || Number(user.balance_units || 0) < 500000) return reply(request, env, { ok: false, error: "api_balance_requirement", required_cny: 200 }, 403);
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

async function publicApiAccount(request, env) {
  const header = request.headers.get("Authorization") || "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!/^qt_live_[a-f0-9]{64}$/.test(key)) return reply(request, env, { ok: false, error: "api_key_required" }, 401);
  const hash = hexBytes(await sha256(key));
  const row = await env.DB.prepare("SELECT k.id AS key_id,k.user_id,u.email,u.balance_units,u.nickname FROM user_api_keys k JOIN users u ON u.id=k.user_id WHERE k.key_hash=? AND k.revoked_at IS NULL")
    .bind(hash).first();
  if (!row) return reply(request, env, { ok: false, error: "invalid_api_key" }, 401);
  const now = Math.floor(Date.now()/1000), balanceUnits = Number(row.balance_units || 0);
  if (balanceUnits < 500000) return reply(request, env, { ok: false, error: "api_balance_requirement", required_cny: 200 }, 403);
  await env.DB.batch([
    env.DB.prepare("UPDATE user_api_keys SET last_used_at=? WHERE id=?").bind(now, row.key_id),
    env.DB.prepare("INSERT INTO user_api_usage(id,key_id,user_id,endpoint,method,status_code,created_at) VALUES(?,?,?,?,?,200,?)")
      .bind(crypto.randomUUID(), row.key_id, row.user_id, "/api/v1/account", "GET", now)
  ]);
  return reply(request, env, { ok: true, data: { email: row.email, nickname: row.nickname || "", balance_cny: (balanceUnits / 10000 * INTERNAL_CNY_PER_USDT).toFixed(2), currency: "CNY" } });
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
const ADMIN_ROLE_LABELS = { super_admin:"超级管理员", operations_admin:"运营管理员", support_admin:"客服管理员", node_admin:"节点管理员", viewer:"只读管理员" };
const ADMIN_ROLE_PERMISSIONS = {
 super_admin:["*"],
 operations_admin:["overview.read","orders.read","orders.manage","users.read","products.read","products.manage","inventory.read","inventory.manage","email.read","email.manage","notices.read","notices.manage","payments.read","bots.read"],
 support_admin:["overview.read","users.read","support.read","support.manage"],
 node_admin:["overview.read","users.read","nodes.read","nodes.manage","bots.read","bots.manage"],
 viewer:["overview.read","orders.read","users.read","products.read","inventory.read","email.read","notices.read","payments.read","nodes.read","support.read","bots.read"]
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
 if(path.includes("/nodes/export"))return "nodes.manage";
 const suffix=method==="GET"?"read":"manage";
 if(path.includes("/stats/overview"))return "overview.read";
 if(path.includes("/stats/online"))return "users.read";
 if(path.includes("/upstream/overview"))return "products."+suffix;
 if(path.includes("/config/dnshe"))return "nodes."+suffix;
 if(path.includes("/tickets")||path.includes("/ticket/")||path.includes("/chat/"))return "support."+suffix;
 if(path.includes("/bots/matrix/")||path.includes("/bots/credentials"))return "bots."+suffix;
 if(path.includes("/nodes")||path.includes("/servers")||path.includes("/plans"))return "nodes."+suffix;
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
  const [users, webOrders, nodeOrders, catalog, activeCatalog, products] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM web_purchases").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM node_orders").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM shop_catalog").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM shop_catalog WHERE is_on_sale=true AND purchasable=true").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM products WHERE active=1").first()
  ]);
  return reply(request, env, {
    ok: true,
    overview: {
      users: Number(users?.total || 0),
      orders: Number(webOrders?.total || 0) + Number(nodeOrders?.total || 0),
      web_orders: Number(webOrders?.total || 0),
      node_orders: Number(nodeOrders?.total || 0),
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
  const [web, nodes] = await Promise.all([
    env.DB.prepare("SELECT w.order_id,w.user_id,u.email,w.product_id,w.amount::text AS amount,w.status,w.created_at,w.updated_at,'商城订单' AS order_type FROM web_purchases w LEFT JOIN users u ON u.id=w.user_id WHERE (?='' OR w.status=?) AND (?='' OR w.order_id ILIKE ? OR COALESCE(u.email,'') ILIKE ? OR w.product_id ILIKE ?) ORDER BY w.created_at DESC LIMIT ?").bind(status,status,q,pattern,pattern,pattern,limit).all(),
    env.DB.prepare("SELECT n.order_id,n.user_id,u.email,n.product_id,(n.amount_units::numeric/10000)::text AS amount,n.status,n.created_at,n.updated_at,'节点订单' AS order_type FROM node_orders n LEFT JOIN users u ON u.id=n.user_id WHERE (?='' OR n.status=?) AND (?='' OR n.order_id ILIKE ? OR COALESCE(u.email,'') ILIKE ? OR n.product_id ILIKE ?) ORDER BY n.created_at DESC LIMIT ?").bind(status,status,q,pattern,pattern,pattern,limit).all()
  ]);
  const orders = [...(web.results || []), ...(nodes.results || [])]
    .sort((a,b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .slice(0, limit);
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

async function adminNodeAccounts(request,env){
 const auth=await adminAuthorize(request,env,request.method==="GET"?"nodes.read":"nodes.manage");if(auth.error)return auth.error;
 if(request.method==="GET"){
  const limit=Math.max(1,Math.min(500,Number(new URL(request.url).searchParams.get("limit")||200)));
  const rows=await env.DB.prepare("SELECT a.account_id,a.user_id,u.email,a.product_id,p.name AS product_name,a.order_id,a.protocol,a.server_ref,a.client_ref,a.expires_at,a.traffic_limit_bytes,a.traffic_used_bytes,a.status,a.created_at,a.updated_at FROM node_accounts a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN node_products p ON p.product_id=a.product_id ORDER BY a.created_at DESC LIMIT ?").bind(limit).all();
  const accounts=(rows.results||[]).map(x=>({...x,expires_at:Number(x.expires_at||0),traffic_limit_bytes:Number(x.traffic_limit_bytes||0),traffic_used_bytes:Number(x.traffic_used_bytes||0),created_at:Number(x.created_at||0),updated_at:Number(x.updated_at||0)}));
  let trafficUsageAvailable=false;
  if(accounts.length){
   try{
    const usage=await originRequest(env,"POST","/api/internal/nodes/usage",{client_refs:accounts.map(x=>x.client_ref)});
    if(Array.isArray(usage.accounts)){
     trafficUsageAvailable=true;
     for(const item of usage.accounts){
      const used=Number(item.traffic_used_bytes||0),status=String(item.status||"active"),expires=Number(item.expires_at||0),now=Math.floor(Date.now()/1000);
      await env.DB.prepare("UPDATE node_accounts SET traffic_used_bytes=?,status=?,expires_at=?,updated_at=? WHERE client_ref=?").bind(used,status,expires||now,item.updated_at?Number(item.updated_at):now,item.client_ref).run();
      const local=accounts.find(x=>x.client_ref===item.client_ref);if(local){local.traffic_used_bytes=used;local.status=status;if(expires)local.expires_at=expires;}
     }
    }
   }catch{}
  }
  return reply(request,env,{ok:true,accounts,traffic_usage_available:trafficUsageAvailable});
 }
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const id=String(body.account_id||"").trim(),action=String(body.action||"");
 if(!id||action!=="revoke")return reply(request,env,{ok:false,error:"invalid_node_account_action"},400);
 const account=await env.DB.prepare("SELECT client_ref,server_ref,status FROM node_accounts WHERE account_id=?").bind(id).first();
 if(!account)return reply(request,env,{ok:false,error:"node_account_not_found"},404);
 try{await originRequest(env,"POST","/api/internal/nodes/revoke",{client_ref:account.client_ref,server_ref:account.server_ref});}
 catch{return reply(request,env,{ok:false,error:"node_server_revoke_failed"},502)}
 await env.DB.prepare("UPDATE node_accounts SET status='revoked',updated_at=? WHERE account_id=?").bind(Math.floor(Date.now()/1000),id).run();
 return reply(request,env,{ok:true,account_id:id,status:"revoked"});
}
async function adminNodeOrders(request,env){
 const auth=await adminAuthorize(request,env,request.method==="GET"?"nodes.read":"nodes.manage");if(auth.error)return auth.error;
 if(request.method==="GET"){
  const limit=Math.max(1,Math.min(500,Number(new URL(request.url).searchParams.get("limit")||200)));
  const rows=await env.DB.prepare("SELECT o.order_id,o.user_id,u.email,o.product_id,p.name AS product_name,p.protocol,p.server_ref,o.package_id,g.name AS package_name,o.amount_units,o.status,o.error_code,o.created_at,o.updated_at FROM node_orders o LEFT JOIN users u ON u.id=o.user_id LEFT JOIN node_products p ON p.product_id=o.product_id LEFT JOIN node_packages g ON g.package_id=o.package_id ORDER BY o.created_at DESC LIMIT ?").bind(limit).all();
  return reply(request,env,{ok:true,orders:(rows.results||[]).map(x=>({...x,amount_cny:(Number(x.amount_units||0)/10000*INTERNAL_CNY_PER_USDT).toFixed(2),created_at:Number(x.created_at||0),updated_at:Number(x.updated_at||0)}))});
 }
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const orderId=String(body.order_id||"").trim();
 if(body.action!=="retry"||body.confirmed!==true||!orderId)return reply(request,env,{ok:false,error:"explicit_retry_confirmation_required"},400);
 const row=await env.DB.prepare("SELECT o.order_id,o.user_id,o.product_id,o.package_id,o.status,g.duration_days,g.traffic_limit_bytes,p.protocol,p.server_ref FROM node_orders o JOIN node_products p ON p.product_id=o.product_id JOIN node_packages g ON g.package_id=o.package_id WHERE o.order_id=?").bind(orderId).first();
 if(!row)return reply(request,env,{ok:false,error:"node_order_not_found"},404);
 if(row.status!=="provisioning")return reply(request,env,{ok:false,error:"node_order_not_pending",status:row.status},409);
 try{
  const serverRef=String(row.server_ref||"us").toLowerCase();
  const provisioned=await originRequest(env,"POST","/api/internal/nodes/provision",{order_id:orderId,client_ref:orderId,protocol:row.protocol,duration_days:Number(row.duration_days),server_ref:serverRef,traffic_limit_bytes:Number(row.traffic_limit_bytes||0)});
  const account=provisioned?.account;
  if(!provisioned?.ok||!account?.uri||!account?.client_ref)throw new Error("node_delivery_missing");
  const delivery={protocol:row.protocol,uri:account.uri,http_uri:account.http_uri||null,clash_yaml:account.clash_proxy?nodeClashYaml(account.clash_proxy):null,expires_at:Number(account.expires_at),instructions:row.protocol==="mtproto"?"此链接仅用于 Telegram：在 Telegram 客户端打开即可添加代理。":"将连接链接导入支持该协议的客户端。"};
  const encrypted=await encryptNodePayload(JSON.stringify(delivery),env),now=Math.floor(Date.now()/1000);
  const existing=await env.DB.prepare("SELECT account_id FROM node_accounts WHERE client_ref=?").bind(account.client_ref).first();
  const stmts=[env.DB.prepare("UPDATE node_orders SET status='fulfilled',delivery_ciphertext=?,error_code=NULL,updated_at=?,expires_at=? WHERE order_id=? AND status='provisioning'").bind(encrypted,now,Number(account.expires_at),orderId)];
  if(existing)stmts.push(env.DB.prepare("UPDATE node_accounts SET status='active',expires_at=?,traffic_limit_bytes=?,updated_at=? WHERE client_ref=?").bind(Number(account.expires_at),Number(row.traffic_limit_bytes||0),now,account.client_ref));
  else stmts.push(env.DB.prepare("INSERT INTO node_accounts(account_id,user_id,product_id,order_id,protocol,server_ref,client_ref,expires_at,traffic_limit_bytes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)").bind(crypto.randomUUID(),row.user_id,row.product_id,orderId,row.protocol,serverRef,account.client_ref,Number(account.expires_at),Number(row.traffic_limit_bytes||0),now,now));
  await env.DB.batch(stmts);
  return reply(request,env,{ok:true,order_id:orderId,status:"fulfilled",delivery});
 }catch(e){
  await env.DB.prepare("UPDATE node_orders SET error_code='node_provision_result_uncertain',updated_at=? WHERE order_id=? AND status='provisioning'").bind(Math.floor(Date.now()/1000),orderId).run();
  return reply(request,env,{ok:true,order_id:orderId,status:"provisioning",error_code:"node_provision_result_uncertain"},202);
 }
}
async function adminNodeCatalog(request,env){
 const auth=await adminAuthorize(request,env,"nodes.read");if(auth.error)return auth.error;
 const [products,packages]=await Promise.all([
  env.DB.prepare("SELECT product_id,name,protocol,description,server_ref,server_present,provisioning_ready,active,display_order,provisioning_mode FROM node_products ORDER BY display_order,product_id").all(),
  env.DB.prepare("SELECT package_id,product_id,name,price_cny,duration_days,traffic_limit_bytes,max_devices,active,display_order FROM node_packages ORDER BY product_id,display_order,package_id").all()
 ]);
 return reply(request,env,{ok:true,products:(products.results||[]).map(x=>({...x,server_present:!!x.server_present,provisioning_ready:!!x.provisioning_ready,active:!!x.active,display_order:Number(x.display_order||0)})),packages:(packages.results||[]).map(x=>({...x,price_cny:Number(x.price_cny),duration_days:Number(x.duration_days),traffic_limit_bytes:x.traffic_limit_bytes===null?null:Number(x.traffic_limit_bytes),max_devices:Number(x.max_devices||1),active:!!x.active,display_order:Number(x.display_order||0)}))});
}
async function adminNodeProductUpdate(request,env,productId){
 const auth=await adminAuthorize(request,env,"nodes.manage");if(auth.error)return auth.error;
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const product=await env.DB.prepare("SELECT product_id,server_ref,server_present,provisioning_ready FROM node_products WHERE product_id=?").bind(productId).first();
 if(!product)return reply(request,env,{ok:false,error:"node_product_not_found"},404);
 const active=body.active===true||body.active===1||body.active==="1";
 if(active&&(!product.server_present||!product.provisioning_ready))return reply(request,env,{ok:false,error:"node_product_not_ready",server_present:!!product.server_present,provisioning_ready:!!product.provisioning_ready},409);
 const serverRef=String(body.server_ref===undefined?product.server_ref:body.server_ref).toLowerCase();
 if(!["us","sg"].includes(serverRef))return reply(request,env,{ok:false,error:"invalid_server_ref"},400);
 await env.DB.prepare("UPDATE node_products SET active=?,server_ref=?,updated_at=? WHERE product_id=?").bind(active,serverRef,Math.floor(Date.now()/1000),productId).run();
 return reply(request,env,{ok:true,product_id:productId,active,server_ref:serverRef});
}
async function adminNodePackageSave(request,env,packageId=null){
 const auth=await adminAuthorize(request,env,"nodes.manage");if(auth.error)return auth.error;
 let body;try{body=await request.json()}catch{return reply(request,env,{ok:false,error:"invalid_json"},400)}
 const id=String(packageId||body.package_id||"").trim(),productId=String(body.product_id||"").trim(),name=String(body.name||"").trim().slice(0,80);
 const price=Number(body.price_cny),days=Number(body.duration_days),devices=Number(body.max_devices||1),sort=Math.trunc(Number(body.display_order||0));
 const traffic=body.traffic_limit_bytes===null||body.traffic_limit_bytes===""||body.traffic_limit_bytes===undefined?null:Number(body.traffic_limit_bytes);
 if(!/^[a-z0-9][a-z0-9-]{1,63}$/i.test(id)||!productId||!name||!Number.isFinite(price)||price<=0||price>100000||!Number.isInteger(days)||days<1||days>3650||!Number.isInteger(devices)||devices<1||devices>20||!Number.isInteger(sort)||!Number.isFinite(traffic===null?0:traffic)||(traffic!==null&&(!Number.isSafeInteger(traffic)||traffic<0)))return reply(request,env,{ok:false,error:"invalid_node_package"},400);
 const product=await env.DB.prepare("SELECT product_id,server_present,provisioning_ready FROM node_products WHERE product_id=?").bind(productId).first();
 if(!product)return reply(request,env,{ok:false,error:"node_product_not_found"},404);
 const active=body.active===true||body.active===1||body.active==="1";
 if(active&&(!product.server_present||!product.provisioning_ready))return reply(request,env,{ok:false,error:"node_product_not_ready",server_present:!!product.server_present,provisioning_ready:!!product.provisioning_ready},409);

 const existing=await env.DB.prepare("SELECT package_id,product_id FROM node_packages WHERE package_id=?").bind(id).first();
 if(packageId&&!existing)return reply(request,env,{ok:false,error:"node_package_not_found"},404);
 if(existing&&existing.product_id!==productId)return reply(request,env,{ok:false,error:"node_package_product_immutable"},409);
 const now=Math.floor(Date.now()/1000);
 if(existing){
  await env.DB.prepare("UPDATE node_packages SET name=?,price_cny=?,duration_days=?,traffic_limit_bytes=?,max_devices=?,active=?,display_order=?,updated_at=? WHERE package_id=?").bind(name,price,days,traffic,devices,active,sort,now,id).run();
 }else{
  await env.DB.prepare("INSERT INTO node_packages(package_id,product_id,name,price_cny,duration_days,traffic_limit_bytes,max_devices,active,display_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,productId,name,price,days,traffic,devices,active,sort,now,now).run();
 }
 return reply(request,env,{ok:true,package_id:id,product_id:productId,active});
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
 if(Number(user.balance_units||0)<500000)return reply(request,env,{ok:false,error:"api_balance_requirement",required_cny:200},403);
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

async function adminBotProxy(request, env, method, path, payload, permission="bots.read") {
  const auth=await adminAuthorize(request,env,permission);if(auth.error)return auth.error;
  if (!env.BOT_BRIDGE_SECRET) return reply(request, env, { ok: false, error: "bot_bridge_not_configured" }, 503);
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signed = ts + "\n" + nonce + "\n" + method.toUpperCase() + "\n" + path + "\n" + body;
  const signature = Array.from(await hmac(env.BOT_BRIDGE_SECRET, signed)).map(b => b.toString(16).padStart(2, "0")).join("");
  let response;
  try {
    response = await fetch(new URL(path, "https://api.lynli.me"), {
      method,
      headers: { "Content-Type": "application/json", "X-Worker-Timestamp": ts, "X-Worker-Nonce": nonce, "X-Worker-Signature": signature },
      body: method === "GET" ? undefined : body
    });
  } catch {
    return reply(request, env, { ok: false, error: "bot_bridge_unreachable" }, 502);
  }
  let data = {};
  try { data = await response.json(); } catch {}
  return reply(request, env, data, response.status);
}

async function adminBots(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/admin/bots") {
    return await adminBotProxy(request, env, "GET", "/_internal/bots/status", undefined, "bots.read");
  }
  if (request.method === "GET" && url.pathname === "/api/admin/bots/logs") {
    const bot = String(url.searchParams.get("bot") || "");
    if (!["tg", "mivra"].includes(bot)) return reply(request, env, { ok: false, error: "invalid_bot" }, 400);
    return await adminBotProxy(request, env, "GET", "/_internal/bots/logs?bot=" + encodeURIComponent(bot) + "&lines=100", undefined, "bots.read");
  }
  if (request.method === "POST" && url.pathname === "/api/admin/bots/action") {
    let body;
    try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
    if (!["tg", "mivra"].includes(body.bot) || !["start", "stop", "restart"].includes(body.action)) {
      return reply(request, env, { ok: false, error: "invalid_action" }, 400);
    }
    return await adminBotProxy(request, env, "POST", "/_internal/bots/action", { bot: body.bot, action: body.action }, "bots.manage");
  }
  return reply(request, env, { ok: false, error: "not_found" }, 404);
}

const LEGACY_ADMIN_EXACT = new Set([
  "/api/v1/admin/account_pool",
  "/api/v1/admin/account_pool/stats",
  "/api/v1/admin/bots/matrix/stats",
  "/api/v1/admin/bots/matrix/users",
  "/api/v1/admin/bots/credentials",
  "/api/v1/admin/config/dnshe",
  "/api/v1/admin/logs",
  "/api/v1/admin/stats/online",
  "/api/v1/admin/upload",
  "/api/v1/admin/chat/users",
  "/api/v1/admin/config/ai",
  "/api/v1/admin/config/mail",
  "/api/v1/admin/mail/send",
  "/api/v1/admin/mail/templates",
  "/api/v1/admin/nodes",
  "/api/v1/admin/notices",
  "/api/v1/admin/orders",
  "/api/v1/admin/payment_configs",
  "/api/v1/admin/plans",
  "/api/v1/admin/products",
  "/api/v1/admin/servers",
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
  "/api/v1/admin/bots/matrix/",
  "/api/v1/admin/bots/credentials/",
  "/api/v1/admin/config/dnshe/",
  "/api/v1/admin/chat/",
  "/api/v1/admin/mail/",
  "/api/v1/admin/nodes/",
  "/api/v1/admin/notices/",
  "/api/v1/admin/plans/",
  "/api/v1/admin/servers/",
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
    ? (hasAdminPermission(auth.admin, "support.manage") || hasAdminPermission(auth.admin, "bots.manage"))
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
      if (url.pathname === "/api/user/api-keys" && ["GET","POST"].includes(request.method)) return await userApiKeys(request, env);
      if (url.pathname === "/api/user/api-usage" && request.method === "GET") return await userApiUsage(request, env);
      const revokeKeyMatch = url.pathname.match(/^\/api\/user\/api-keys\/([a-f0-9-]{36})$/i);
      if (revokeKeyMatch && request.method === "DELETE") return await revokeUserApiKey(request, env, revokeKeyMatch[1]);
      if (url.pathname === "/api/v1/account" && request.method === "GET") return await publicApiAccount(request, env);
      if (url.pathname === "/api/admin/recharge/confirm" && request.method === "POST") return await confirmRecharge(request, env);
      if (url.pathname === "/api/user/referrals" && request.method === "GET") return await userReferrals(request, env);
      if (url.pathname === "/api/user/orders" && request.method === "GET") return await userOrders(request, env);
      if (url.pathname === "/api/node-products" && request.method === "GET") return await nodeProducts(request, env);
      if (url.pathname === "/api/user/node-orders" && ["GET","POST"].includes(request.method)) return await userNodeOrders(request, env);
      const nodeOrderMatch = url.pathname.match(/^\/api\/user\/node-orders\/([a-f0-9-]{36})$/i);
      if (nodeOrderMatch && request.method === "GET") return await nodeOrderStatus(request, env, nodeOrderMatch[1]);
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
      if (url.pathname === "/api/admin/node-orders" && ["GET","POST"].includes(request.method)) return await adminNodeOrders(request,env);
      if (url.pathname === "/api/admin/node-catalog" && request.method === "GET") return await adminNodeCatalog(request,env);
      if (url.pathname === "/api/admin/node-accounts" && ["GET","POST"].includes(request.method)) return await adminNodeAccounts(request,env);
      const nodeProductMatch=url.pathname.match(/^\/api\/admin\/node-products\/([a-z0-9][a-z0-9-]{1,63})$/i);
      if (nodeProductMatch && request.method === "POST") return await adminNodeProductUpdate(request,env,nodeProductMatch[1]);
      if (url.pathname === "/api/admin/node-packages" && request.method === "POST") return await adminNodePackageSave(request,env);
      const nodePackageMatch=url.pathname.match(/^\/api\/admin\/node-packages\/([a-z0-9][a-z0-9-]{1,63})$/i);
      if (nodePackageMatch && request.method === "POST") return await adminNodePackageSave(request,env,nodePackageMatch[1]);
      if (url.pathname === "/api/admin/api-keys" && ["GET","POST"].includes(request.method)) return await adminApiKeys(request,env);
      const apiKeyRevokeMatch=url.pathname.match(/^\/api\/admin\/api-keys\/([a-f0-9-]{36})\/revoke$/i);
      if (apiKeyRevokeMatch && request.method === "POST") return await adminRevokeApiKey(request,env,apiKeyRevokeMatch[1]);
      if (url.pathname === "/api/admin/api-logs" && request.method === "GET") return await adminApiLogs(request,env);
      if (url.pathname.startsWith("/api/admin/bots")) return await adminBots(request, env);
      if (url.pathname === "/api/admin/credit" && request.method === "POST") return await adminCredit(request, env);
      return reply(request, env, { ok: false, error: "not_found" }, 404);
    } catch {
      return reply(request, env, { ok: false, error: "internal_error" }, 500);
    }
  }
};