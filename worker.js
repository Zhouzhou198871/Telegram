const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = new Set([env.FRONTEND_ORIGIN || "https://zhouzhou198871.github.io", "https://shop.lynli.me", "https://zhouzhou198871.github.io"]);
  const allowedOrigin = allowedOrigins.has(origin) ? origin : (env.FRONTEND_ORIGIN || "https://zhouzhou198871.github.io");
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key,X-Admin-Key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
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
 if(typeof stored!=="string")return false;const p=stored.split("$");
 if(p.length!==4||p[0]!=="pbkdf2-sha256"||p[1]!=="210000")return false;
 try{const salt=unb64url(p[2]),expected=unb64url(p[3]);const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);const actual=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:210000},key,256));if(actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];return diff===0}catch{return false}
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
  if (!env.SERVER_ORIGIN || !env.INTERNAL_API_SECRET) throw new Error("origin_not_configured");
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const signed = ts + "\n" + nonce + "\n" + method.toUpperCase() + "\n" + path + "\n" + body;
  const signature = Array.from(await hmac(env.INTERNAL_API_SECRET, signed))
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
  try {
    await originRequest(env, "POST", "/api/internal/send_email", { email, code });
  } catch {
    await env.DB.prepare("UPDATE users SET verify_code=NULL,code_expires=NULL WHERE email=?").bind(email).run();
    return reply(request, env, { ok: false, error: "email_delivery_failed" }, 502);
  }
  return reply(request, env, { ok: true, message: "验证码已发送，请检查邮箱。" });
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
  const token=await signToken({sub:user.id,email,iat:now,exp:now+2592000,ver:Number(user.token_version||0)},env.JWT_SECRET||"");
  return reply(request,env,{ok:true,token,user:{id:user.id,email,balance:user.balance||"0.0000",balance_units:user.balance_units||0}});
 }
 if(!password||!user||!user.password_hash||!await verifyPassword(password,user.password_hash))return reply(request,env,{ok:false,error:"invalid_credentials"},401);
 const now=Math.floor(Date.now()/1000),token=await signToken({sub:user.id,email,iat:now,exp:now+2592000,ver:Number(user.token_version||0)},env.JWT_SECRET||"");
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



async function telegramLoginTable(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS telegram_login_sessions (nonce TEXT PRIMARY KEY, status TEXT NOT NULL, telegram_id TEXT, token TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)").run();
}
async function telegramWebhookSecret(env) {
  return b64url(await sha256(env.TELEGRAM_BOT_TOKEN + "|qingtian-shop-telegram-webhook-v1"));
}
async function telegramApi(env, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const description = String(data.description || "telegram_api_error").replace(/[^a-zA-Z0-9 _.,:;()/-]/g, "").slice(0, 240);
    throw new Error("telegram_api_" + method + "_failed: " + description);
  }
  return data.result;
}
async function telegramLoginStart(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.JWT_SECRET) return reply(request, env, { ok: false, error: "telegram_login_not_configured" }, 503);
  await telegramLoginTable(env);
  const webhookSecret = await telegramWebhookSecret(env);
  try {
    await telegramApi(env, "setWebhook", {
      url: (env.PUBLIC_APP_URL || "https://shop.lynli.me") + "/api/auth/telegram/webhook/" + webhookSecret,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    });
  } catch (error) {
    return reply(request, env, { ok: false, error: "telegram_webhook_setup_failed", detail: String(error.message || "telegram_api_error") }, 502);
  }
  const now = Math.floor(Date.now() / 1000), nonce = b64url(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare("INSERT INTO telegram_login_sessions(nonce,status,expires_at,created_at) VALUES(?, 'pending', ?, ?)").bind(nonce, now + 300, now).run();
  return reply(request, env, { ok: true, nonce, login_url: "https://t.me/qingtian_tiezibot?start=web_" + nonce, expires_in: 300 });
}
async function telegramLoginPoll(request, env) {
  let body; try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const nonce = String(body.nonce || "");
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(nonce)) return reply(request, env, { ok: false, error: "invalid_login_session" }, 400);
  await telegramLoginTable(env);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT status,token,expires_at FROM telegram_login_sessions WHERE nonce=?").bind(nonce).first();
  if (!row || Number(row.expires_at) < now) {
    await env.DB.prepare("DELETE FROM telegram_login_sessions WHERE nonce=?").bind(nonce).run();
    return reply(request, env, { ok: false, error: "login_session_expired" }, 410);
  }
  if (row.status !== "confirmed" || !row.token) return reply(request, env, { ok: true, status: "pending" }, 202);
  const consumed = await env.DB.prepare("DELETE FROM telegram_login_sessions WHERE nonce=? AND status='confirmed' RETURNING token").bind(nonce).first();
  if (!consumed?.token) return reply(request, env, { ok: false, error: "login_session_consumed" }, 410);
  return reply(request, env, { ok: true, status: "confirmed", token: consumed.token });
}
async function createTelegramSessionToken(env, telegramId) {
  let user = await env.DB.prepare("SELECT * FROM users WHERE tg_user_id=?").bind(telegramId).first();
  if (!user) {
    const email = "telegram_" + telegramId + "@telegram-login.invalid", id = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO users (id,email,tg_user_id,balance,balance_units,created_at,updated_at) VALUES (?,?,?,'0.0000',0,?,?) ON CONFLICT(tg_user_id) DO NOTHING").bind(id, email, telegramId, now, now).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE tg_user_id=?").bind(telegramId).first();
  }
  if (!user) throw new Error("telegram_account_create_failed");
  const now = Math.floor(Date.now() / 1000);
  return await signToken({ sub: user.id, email: user.email, iat: now, exp: now + 2592000, ver: Number(user.token_version || 0) }, env.JWT_SECRET);
}
async function telegramLoginWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.JWT_SECRET) return new Response("not configured", { status: 503 });
  const secret = await telegramWebhookSecret(env);
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) return new Response("forbidden", { status: 403 });
  await telegramLoginTable(env);
  const update = await request.json().catch(() => ({}));
  const message = update.message;
  if (message?.chat?.type === "private" && message.from?.id && typeof message.text === "string") {
    const match = message.text.match(/^\/start\s+web_([A-Za-z0-9_-]{30,40})$/);
    if (match) {
      const nonce = match[1], now = Math.floor(Date.now() / 1000), telegramId = String(message.from.id);
      const session = await env.DB.prepare("SELECT status,expires_at FROM telegram_login_sessions WHERE nonce=?").bind(nonce).first();
      if (session && session.status === "pending" && Number(session.expires_at) >= now) {
        await env.DB.prepare("UPDATE telegram_login_sessions SET status='awaiting_confirmation',telegram_id=? WHERE nonce=? AND status='pending'").bind(telegramId, nonce).run();
        await telegramApi(env, "sendMessage", {
          chat_id: message.chat.id,
          text: "正在登录晴天号铺。请确认这是你本人发起的网页登录；如果不是，请忽略此消息。",
          reply_markup: { inline_keyboard: [[{ text: "确认登录晴天号铺", callback_data: "tglogin:" + nonce }]] }
        });
      } else {
        await telegramApi(env, "sendMessage", { chat_id: message.chat.id, text: "此登录链接已过期，请返回网站重新点击 Telegram 登录。" });
      }
    }
  }
  const callback = update.callback_query;
  if (callback?.data?.startsWith("tglogin:") && callback.from?.id) {
    const nonce = callback.data.slice(8), telegramId = String(callback.from.id), now = Math.floor(Date.now() / 1000);
    const session = await env.DB.prepare("SELECT status,telegram_id,expires_at FROM telegram_login_sessions WHERE nonce=?").bind(nonce).first();
    if (!session || session.status !== "awaiting_confirmation" || session.telegram_id !== telegramId || Number(session.expires_at) < now) {
      await telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "登录请求已过期或不属于你的账号。", show_alert: true });
    } else {
      const token = await createTelegramSessionToken(env, telegramId);
      const changed = await env.DB.prepare("UPDATE telegram_login_sessions SET status='confirmed',token=? WHERE nonce=? AND status='awaiting_confirmation' AND telegram_id=?").bind(token, nonce, telegramId).run();
      if (Number(changed.meta?.changes || 0) === 1) {
        await telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "登录确认成功。" });
        await telegramApi(env, "sendMessage", { chat_id: callback.message?.chat?.id || telegramId, text: "晴天号铺登录已确认。请返回浏览器，页面将自动完成登录。" });
      } else {
        await telegramApi(env, "answerCallbackQuery", { callback_query_id: callback.id, text: "登录请求已处理，请返回网站。", show_alert: true });
      }
    }
  }
  return new Response("ok", { status: 200 });
}

async function telegramLogin(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.JWT_SECRET) {
    return reply(request, env, { ok: false, error: "telegram_login_not_configured" }, 503);
  }
  let body;
  try { body = await request.json(); } catch {
    return reply(request, env, { ok: false, error: "invalid_json" }, 400);
  }
  const userData = body && body.user && typeof body.user === "object" ? body.user : body;
  if (!userData || typeof userData !== "object" || Array.isArray(userData)) {
    return reply(request, env, { ok: false, error: "invalid_telegram_payload" }, 400);
  }
  const hash = String(userData.hash || "").toLowerCase();
  const authDate = Number(userData.auth_date);
  const telegramId = String(userData.id || "");
  const now = Math.floor(Date.now() / 1000);
  if (!/^[a-f0-9]{64}$/.test(hash) || !/^\d{1,20}$/.test(telegramId) ||
      !Number.isSafeInteger(authDate) || authDate > now + 60 || now - authDate > 86400) {
    return reply(request, env, { ok: false, error: "invalid_or_expired_telegram_auth" }, 401);
  }
  const entries = Object.entries(userData).filter(([key, value]) =>
    key !== "hash" && value !== undefined && value !== null &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  );
  if (!entries.some(([key]) => key === "id") || !entries.some(([key]) => key === "auth_date")) {
    return reply(request, env, { ok: false, error: "invalid_telegram_payload" }, 400);
  }
  const dataCheckString = entries
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => key + "=" + String(value))
    .join("\n");
  const secretKey = await sha256(env.TELEGRAM_BOT_TOKEN);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC", cryptoKey, new TextEncoder().encode(dataCheckString)
  ));
  let expectedHash = "";
  for (const byte of signature) expectedHash += byte.toString(16).padStart(2, "0");
  let mismatch = expectedHash.length ^ hash.length;
  for (let i = 0; i < 64; i++) mismatch |= expectedHash.charCodeAt(i) ^ hash.charCodeAt(i);
  if (mismatch !== 0) {
    return reply(request, env, { ok: false, error: "telegram_signature_invalid" }, 401);
  }

  const nowTs = now;
  let user = await env.DB.prepare("SELECT * FROM users WHERE tg_user_id=?").bind(telegramId).first();
  if (!user) {
    // Telegram-only accounts receive a reserved, non-deliverable alias because users.email is NOT NULL.
    // This does not claim or link any existing email account.
    const email = "telegram_" + telegramId + "@telegram-login.invalid";
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id,email,tg_user_id,balance,balance_units,created_at,updated_at) VALUES (?,?,?,'0.0000',0,?,?) ON CONFLICT(tg_user_id) DO NOTHING"
    ).bind(id, email, telegramId, nowTs, nowTs).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE tg_user_id=?").bind(telegramId).first();
  }
  if (!user) return reply(request, env, { ok: false, error: "telegram_account_create_failed" }, 500);
  const token = await signToken({
    sub: user.id, email: user.email, iat: nowTs, exp: nowTs + 2592000,
    ver: Number(user.token_version || 0)
  }, env.JWT_SECRET);
  return reply(request, env, {
    ok: true, token,
    user: {
      id: user.id, email: user.email, tg_user_id: user.tg_user_id,
      balance: user.balance || "0.0000", balance_units: Number(user.balance_units || 0)
    }
  });
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
    await originRequest(env, "POST", "/api/internal/catalog_sync", {}).catch(() => null);
    const result = await env.DB.prepare(
      "SELECT product_id,supplier_product_id,name,category_name,price_usdt,price_cny,stock,is_local_inventory,purchasable FROM shop_catalog WHERE is_on_sale=TRUE AND stock>0 ORDER BY category_id,name"
    ).all();
    const items = (result.results || []).map(row => ({
      product_id: row.product_id,
      supplier_product_id: row.supplier_product_id,
      name: row.name,
      category: row.category_name || "数字商品",
      price_usdt: String(row.price_usdt),
      stock: Number(row.stock || 0),
      price_cny: String(row.price_cny),
      currency: "CNY",
      is_local_inventory: Boolean(row.is_local_inventory),
      purchasable: Boolean(row.purchasable)
    }));
    return reply(request, env, { ok: true, count: items.length, items, updated_at: Math.floor(Date.now()/1000) });
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
    "SELECT product_id,supplier_product_id,price_usdt,price_cny,stock,is_on_sale,purchasable FROM shop_catalog WHERE product_id=?"
  ).bind(productId).first();
  if (!product || !product.is_on_sale || Number(product.stock || 0) < 1) {
    return reply(request, env, { ok: false, error: "product_unavailable" }, 409);
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

async function adminCredit(request, env) {
  if (!env.ADMIN_API_KEY || request.headers.get("X-Admin-Key") !== env.ADMIN_API_KEY) {
    return reply(request, env, { ok: false, error: "unauthorized" }, 401);
  }
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
      if (url.pathname === "/api/auth/telegram/start" && request.method === "POST") return await telegramLoginStart(request, env);
      if (url.pathname === "/api/auth/telegram/poll" && request.method === "POST") return await telegramLoginPoll(request, env);
      if (url.pathname === "/api/auth/telegram/webhook/" + await telegramWebhookSecret(env) && request.method === "POST") return await telegramLoginWebhook(request, env);
      if (url.pathname === "/api/auth/telegram_login" && request.method === "POST") return await telegramLogin(request, env);
      if (url.pathname === "/api/user/info" && request.method === "GET") return await userInfo(request, env);
      if (url.pathname === "/api/user/profile" && request.method === "POST") return await updateUserProfile(request, env);
      if (url.pathname === "/api/user/referrals" && request.method === "GET") return await userReferrals(request, env);
      if (url.pathname === "/api/products" && request.method === "GET") {
        try { await verifyToken(request, env); } catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
        return await products(request, env);
      }
      if (url.pathname === "/api/buy" && request.method === "POST") return await buy(request, env);
      const match = url.pathname.match(/^\/api\/buy\/([a-f0-9-]{36})$/i);
      if (match && request.method === "GET") return await buyStatus(request, env, match[1]);
      if (url.pathname === "/api/admin/credit" && request.method === "POST") return await adminCredit(request, env);
      return reply(request, env, { ok: false, error: "not_found" }, 404);
    } catch {
      return reply(request, env, { ok: false, error: "internal_error" }, 500);
    }
  }
};