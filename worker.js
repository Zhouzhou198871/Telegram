const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.FRONTEND_ORIGIN || "https://zhouzhou198871.github.io";
  return {
    "Access-Control-Allow-Origin": origin === allowed ? origin : allowed,
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

async function signToken(payload, secret) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const input = header + "." + body;
  return input + "." + b64url(await hmac(secret, input));
}

async function verifyToken(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("auth_required");
  const token = header.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid_token");
  const input = parts[0] + "." + parts[1];
  const expected = b64url(await hmac(env.JWT_SECRET || "", input));
  if (!env.JWT_SECRET || expected !== parts[2]) throw new Error("invalid_token");
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64url(parts[1]))); }
  catch { throw new Error("invalid_token"); }
  if (!payload.sub || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("token_expired");
  }
  return payload;
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

async function findUserById(env, id) {
  return await env.DB.prepare(
    "SELECT id,email,tg_user_id,balance,balance_units,verify_code,code_expires,code_sent_at,code_attempts FROM users WHERE id=?"
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
  if (existing && existing.code_sent_at && now - Number(existing.code_sent_at) < 60) {
    return reply(request, env, { ok: false, error: "too_many_requests", retry_after: 60 - (now - Number(existing.code_sent_at)) }, 429);
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const digest = b64url(await sha256(env.CODE_PEPPER + "|" + email + "|" + code));
  const userId = existing?.id || crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id,email,balance,balance_units,verify_code,code_expires,code_sent_at,code_attempts,created_at,updated_at) VALUES (?,?, '0.0000',0,?,?,?,0,?,?) ON CONFLICT(email) DO UPDATE SET verify_code=excluded.verify_code,code_expires=excluded.code_expires,code_sent_at=excluded.code_sent_at,code_attempts=0,updated_at=excluded.updated_at"
  ).bind(userId, email, digest, now + 300, now, now, now).run();
  try {
    await originRequest(env, "POST", "/api/send_email", { email, code });
  } catch {
    await env.DB.prepare("UPDATE users SET verify_code=NULL,code_expires=NULL WHERE email=?").bind(email).run();
    return reply(request, env, { ok: false, error: "email_delivery_failed" }, 502);
  }
  return reply(request, env, { ok: true, message: "验证码已发送，请检查邮箱。" });
}

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch { return reply(request, env, { ok: false, error: "invalid_json" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) {
    return reply(request, env, { ok: false, error: "invalid_credentials" }, 400);
  }
  const user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  const now = Math.floor(Date.now() / 1000);
  if (!user || !user.verify_code || Number(user.code_expires || 0) < now) {
    return reply(request, env, { ok: false, error: "code_expired" }, 401);
  }
  if (Number(user.code_attempts || 0) >= 5) {
    return reply(request, env, { ok: false, error: "too_many_attempts" }, 429);
  }
  const digest = b64url(await sha256((env.CODE_PEPPER || "") + "|" + email + "|" + code));
  if (digest !== user.verify_code) {
    await env.DB.prepare("UPDATE users SET code_attempts=code_attempts+1 WHERE id=?").bind(user.id).run();
    return reply(request, env, { ok: false, error: "invalid_code" }, 401);
  }
  await env.DB.prepare(
    "UPDATE users SET verify_code=NULL,code_expires=NULL,code_attempts=0,updated_at=? WHERE id=?"
  ).bind(now, user.id).run();
  const token = await signToken({
    sub: user.id, email, iat: now, exp: now + 7 * 24 * 60 * 60
  }, env.JWT_SECRET || "");
  return reply(request, env, {
    ok: true, token,
    user: { id: user.id, email, balance: user.balance || "0.0000", balance_units: user.balance_units || 0 }
  });
}

async function userInfo(request, env) {
  let claims;
  try { claims = await verifyToken(request, env); }
  catch (e) { return reply(request, env, { ok: false, error: e.message }, 401); }
  const user = await findUserById(env, claims.sub);
  if (!user) return reply(request, env, { ok: false, error: "user_not_found" }, 404);
  return reply(request, env, {
    ok: true,
    user: {
      id: user.id, email: user.email, tg_user_id: user.tg_user_id,
      balance: user.balance, balance_units: user.balance_units
    }
  });
}

async function products(request, env) {
  try {
    const data = await originRequest(env, "GET", "/api/products");
    return reply(request, env, data);
  } catch {
    return reply(request, env, { ok: false, error: "catalog_unavailable" }, 503);
  }
}

async function refund(env, order) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET balance_units=balance_units+?,balance=printf('%.4f',(balance_units+?)/10000.0),updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM web_purchases WHERE order_id=? AND status='reserved')"
    ).bind(order.amount_units, order.amount_units, now, order.user_id, order.order_id),
    env.DB.prepare(
      "UPDATE web_purchases SET status='refunded',updated_at=?,error_code='purchase_failed' WHERE order_id=? AND status='reserved'"
    ).bind(now, order.order_id)
  ]);
}

async function syncServerStatus(env, purchase, user) {
  const path = "/api/buy/" + encodeURIComponent(purchase.order_id) + "?user_id=" + encodeURIComponent(user.id);
  const data = await originRequest(env, "GET", path);
  if (data.status === "delivered" && data.content) {
    await env.DB.prepare("UPDATE web_purchases SET status='delivered',server_order_id=?,updated_at=? WHERE order_id=? AND status IN ('reserved','pending')")
      .bind(purchase.order_id, Math.floor(Date.now() / 1000), purchase.order_id).run();
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

  const catalog = await originRequest(env, "GET", "/api/products").catch(() => null);
  const product = catalog?.items?.find(x => x.product_id === productId);
  if (!product) return reply(request, env, { ok: false, error: "product_unavailable" }, 409);
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
    result = await originRequest(env, "POST", "/api/buy", {
      order_id: purchase.order_id,
      user_id: user.id,
      product_id: productId,
      email: user.email,
      tg_user_id: user.tg_user_id || null,
      expected_price_usdt: product.price_usdt
    });
  } catch {
    await env.DB.prepare("UPDATE web_purchases SET status='pending',updated_at=?,error_code='origin_unreachable' WHERE order_id=?")
      .bind(Math.floor(Date.now() / 1000), purchase.order_id).run();
    return reply(request, env, { ok: true, order_id: purchase.order_id, status: "pending", message: "订单处理中，请稍后查询。" }, 202);
  }

  if (result.status === "delivered" && result.content) {
    await env.DB.prepare("UPDATE web_purchases SET status='delivered',server_order_id=?,updated_at=? WHERE order_id=?")
      .bind(purchase.order_id, Math.floor(Date.now() / 1000), purchase.order_id).run();
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
      if (url.pathname === "/api/auth/send_code" && request.method === "POST") return await sendCode(request, env);
      if (url.pathname === "/api/auth/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/api/user/info" && request.method === "GET") return await userInfo(request, env);
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
