import worker from "../worker.js";
import postgres from "postgres";
import nodemailer from "nodemailer";
import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";

export const config = { api: { bodyParser: false } };
let sqlClient;

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error("database_not_configured");
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10
    });
  }
  return sqlClient;
}

function normalizeSql(source, previousChanges = 0) {
  let sql = String(source)
    .replace(/balance\s*=\s*printf\('%\.4f',\s*\((balance_units\s*[+-]\s*\?)\s*\/\s*10000\.0\)\)/gi,
      "balance=ROUND(($1)/10000.0,4)")
    .replace(/\bchanges\s*\(\s*\)/gi, String(Number(previousChanges) || 0));
  let index = 0;
  return sql.replace(/\?/g, () => "$" + (++index));
}

class NeonStatement {
  constructor(db, source) { this.db = db; this.source = source; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    const rows = await this.db.execute(this.source, this.params);
    return rows[0] || null;
  }
  async all() {
    const rows = await this.db.execute(this.source, this.params);
    return { success: true, results: rows };
  }
  async run() {
    const result = await this.db.executeWithMeta(this.source, this.params);
    return { success: true, meta: { changes: result.changes }, results: result.rows };
  }
}

class NeonD1Compat {
  constructor(client) { this.client = client; }
  prepare(source) { return new NeonStatement(this, source); }
  async execute(source, params = [], tx = this.client, previousChanges = 0) {
    const statement = normalizeSql(source, previousChanges);
    const rows = await tx.unsafe(statement, params);
    return Array.from(rows);
  }
  async executeWithMeta(source, params = [], tx = this.client, previousChanges = 0) {
    let statement = normalizeSql(source, previousChanges);
    const command = statement.trim().match(/^([a-z]+)/i)?.[1]?.toUpperCase();
    const isMutation = ["INSERT", "UPDATE", "DELETE"].includes(command);
    if (isMutation && !/\bRETURNING\b/i.test(statement)) {
      statement += " RETURNING 1 AS __d1_changed";
    }
    const result = await tx.unsafe(statement, params);
    const rows = Array.from(result);
    return { rows, changes: isMutation ? rows.length : 0 };
  }
  async batch(statements) {
    return this.client.begin(async tx => {
      const output = [];
      let previousChanges = 0;
      for (const statement of statements) {
        const result = await this.executeWithMeta(statement.source, statement.params, tx, previousChanges);
        previousChanges = result.changes;
        output.push({ success: true, results: result.rows, meta: { changes: result.changes } });
      }
      return output;
    });
  }
}


function jsonResponse(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function encryptDelivery(value) {
  const key = Buffer.from(process.env.DELIVERY_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32) throw new Error("delivery_encryption_not_configured");
  const iv = Buffer.from(cryptoRandom(12));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
function cryptoRandom(size) {
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}
function decryptDelivery(value) {
  const key = Buffer.from(process.env.DELIVERY_ENCRYPTION_KEY || "", "hex");
  const packed = Buffer.from(String(value || ""), "base64");
  if (key.length !== 32 || packed.length < 29) throw new Error("delivery_ciphertext_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0,12));
  decipher.setAuthTag(packed.subarray(12,28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

async function verifyInternal(method, url, headers, rawBody, db) {
  const secret = process.env.INTERNAL_API_SECRET || "";
  const ts = headers.get("X-Worker-Timestamp") || "";
  const nonce = headers.get("X-Worker-Nonce") || "";
  const signature = headers.get("X-Worker-Signature") || "";
  if (!secret || !/^\d+$/.test(ts) || !/^[a-f0-9-]{24,64}$/.test(nonce) ||
      Math.abs(Math.floor(Date.now()/1000) - Number(ts)) > 60) return false;
  const path = url.pathname + (url.search ? url.search : "");
  const message = ts + "\n" + nonce + "\n" + method.toUpperCase() + "\n" + path + "\n" + rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(message).digest();
  let supplied;
  try { supplied = Buffer.from(signature, "hex"); } catch { return false; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  const now = Math.floor(Date.now()/1000);
  await db.unsafe("DELETE FROM api_nonces WHERE expires_at < $1", [now]);
  const inserted = await db.unsafe("INSERT INTO api_nonces(nonce,expires_at) VALUES($1,$2) ON CONFLICT(nonce) DO NOTHING RETURNING nonce", [nonce, Number(ts)+120]);
  return inserted.length === 1;
}

async function handleInternal(method, url, headers, rawBody, db) {
  const path = url.pathname;
  const buyStatusMatch = path.match(/^\/api\/internal\/buy\/([a-f0-9-]{36})$/i);
  if (path !== "/api/internal/send_email" && path !== "/api/internal/buy" && !buyStatusMatch) return null;
  const authorized = await verifyInternal(method, url, headers, rawBody, db).catch(() => false);
  if (!authorized) return { status: 401, body: { ok:false, error:"unauthorized" } };

  if (path === "/api/internal/send_email" && method === "POST") {
    let data = {};
    try { data = JSON.parse(rawBody.toString("utf8") || "{}"); } catch { return {status:400,body:{ok:false,error:"invalid_json"}}; }
    const email = String(data.email || "").trim();
    const code = String(data.code || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^\d{6}$/.test(code)) return {status:400,body:{ok:false,error:"invalid_email_or_code"}};
    const port = Number(process.env.SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 15000
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "晴天商城登录验证码",
      text: "您的晴天商城验证码是：" + code + "\n\n验证码 5 分钟内有效，请勿向任何人透露。"
    });
    return {status:200,body:{ok:true}};
  }

  if (path === "/api/internal/buy" && method === "POST") {
    let data = {};
    try { data = JSON.parse(rawBody.toString("utf8") || "{}"); } catch { return {status:400,body:{ok:false,status:"failed",error_code:"invalid_json"}}; }
    const orderId = String(data.order_id || "");
    const userId = String(data.user_id || "");
    const productId = String(data.supplier_product_id || data.product_id || "");
    if (!/^[a-f0-9-]{36}$/i.test(orderId) || !userId || !productId) return {status:400,body:{ok:true,status:"failed",error_code:"invalid_order"}};
    const prior = await db.unsafe("SELECT * FROM shop_supplier_orders WHERE order_id=$1", [orderId]);
    if (prior.length) {
      const row = prior[0];
      return {status:200,body:{ok:true,status:row.status,order_id:orderId,content:row.delivery_ciphertext ? decryptDelivery(row.delivery_ciphertext) : null,error_code:row.error_code,supplier_order_id:row.supplier_order_id}};
    }
    const productRows = await db.unsafe("SELECT * FROM products WHERE supplier_product_id=$1", [productId]);
    const product = productRows[0];
    if (!product || Number(product.active) !== 1 || product.stock_status !== "in_stock") {
      return {status:200,body:{ok:true,status:"failed",error_code:"product_not_enabled_for_purchase"}};
    }
    if (Math.round(Number(product.sell_price_usdt)*10000) !== Math.round(Number(data.expected_price_usdt)*10000)) {
      return {status:200,body:{ok:true,status:"failed",error_code:"price_changed"}};
    }
    const now = Math.floor(Date.now()/1000);
    await db.unsafe("INSERT INTO shop_supplier_orders(order_id,user_id,status,created_at,updated_at) VALUES($1,$2,'processing',$3,$3)",[orderId,userId,now]);
    const apiKey = process.env.SHOP_BUY_API_KEY || "";
    if (!apiKey) {
      await db.unsafe("UPDATE shop_supplier_orders SET status='failed',error_code='supplier_not_configured',updated_at=$2 WHERE order_id=$1",[orderId,now]);
      return {status:200,body:{ok:true,status:"failed",error_code:"supplier_not_configured"}};
    }
    try {
      const liveResponse = await fetch("http://167.253.96.220:8001/api/products?categoryId=0", {headers:{"x-api-key":apiKey},signal:AbortSignal.timeout(15000)});
      if (!liveResponse.ok) throw new Error("supplier_catalog_http_" + liveResponse.status);
      const liveData = await liveResponse.json();
      const liveRows = Array.isArray(liveData) ? liveData : (liveData.Data || liveData.data || []);
      const live = liveRows.find(row => String(row.ID || row.LinkId || "") === productId);
      if (!live || live.IsOnSale !== true || Number(live.InStock || 0) < 1) {
        await db.unsafe("UPDATE shop_supplier_orders SET status='failed',error_code='supplier_product_unavailable',updated_at=$2 WHERE order_id=$1",[orderId,Math.floor(Date.now()/1000)]);
        return {status:200,body:{ok:true,status:"failed",error_code:"supplier_product_unavailable"}};
      }
      const livePrice = Number(live.Price);
      const cachedPrice = Number(product.price_cny);
      if (!Number.isFinite(livePrice) || Math.round(livePrice*100) !== Math.round(cachedPrice*100)) {
        await db.unsafe("UPDATE shop_supplier_orders SET status='failed',error_code='supplier_price_changed',updated_at=$2 WHERE order_id=$1",[orderId,Math.floor(Date.now()/1000)]);
        return {status:200,body:{ok:true,status:"failed",error_code:"supplier_price_changed"}};
      }
      const purchaseResponse = await fetch("http://167.253.96.220:8001/api/buy", {
        method:"POST", headers:{"x-api-key":apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({product_id:productId,qty:1}), signal:AbortSignal.timeout(25000)
      });
      const purchaseData = await purchaseResponse.json().catch(()=>({}));
      if (!purchaseResponse.ok || purchaseData.success !== true) {
        await db.unsafe("UPDATE shop_supplier_orders SET status='failed',error_code=$2,updated_at=$3 WHERE order_id=$1",[orderId,String(purchaseData.msg||"supplier_purchase_failed").slice(0,120),Math.floor(Date.now()/1000)]);
        return {status:200,body:{ok:true,status:"failed",error_code:"supplier_purchase_failed"}};
      }
      const supplierOrderId = String(purchaseData.order_id || "");
      const content = String(purchaseData.card || "");
      if (!supplierOrderId || !content) {
        await db.unsafe("UPDATE shop_supplier_orders SET status='pending',error_code='supplier_delivery_pending',supplier_order_id=$2,updated_at=$3 WHERE order_id=$1",[orderId,supplierOrderId,Math.floor(Date.now()/1000)]);
        return {status:200,body:{ok:true,status:"pending",error_code:"supplier_delivery_pending"}};
      }
      const ciphertext = encryptDelivery(content);
      await db.unsafe("UPDATE shop_supplier_orders SET status='delivered',supplier_order_id=$2,delivery_ciphertext=$3,updated_at=$4 WHERE order_id=$1",[orderId,supplierOrderId,ciphertext,Math.floor(Date.now()/1000)]);
      return {status:200,body:{ok:true,status:"delivered",order_id:orderId,content}};
    } catch (error) {
      await db.unsafe("UPDATE shop_supplier_orders SET status='pending',error_code='supplier_result_uncertain',updated_at=$2 WHERE order_id=$1",[orderId,Math.floor(Date.now()/1000)]);
      return {status:200,body:{ok:true,status:"pending",error_code:"supplier_result_uncertain"}};
    }
  }

  if (buyStatusMatch && method === "GET") {
    const orderId = buyStatusMatch[1], userId = String(url.searchParams.get("user_id") || "");
    const rows = await db.unsafe("SELECT * FROM shop_supplier_orders WHERE order_id=$1 AND user_id=$2",[orderId,userId]);
    if (!rows.length) return {status:200,body:{ok:true,status:"pending"}};
    const row=rows[0];
    return {status:200,body:{ok:true,status:row.status,order_id:orderId,content:row.delivery_ciphertext ? decryptDelivery(row.delivery_ciphertext) : null,error_code:row.error_code,supplier_order_id:row.supplier_order_id}};
  }
  return {status:405,body:{ok:false,error:"method_not_allowed"}};
}

function makeHeaders(source) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, String(value));
  }
  return headers;
}

export default async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    const headers = makeHeaders(req.headers);
    const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost";
    const proto = headers.get("x-forwarded-proto") || "https";
    const url = new URL(req.url || "/", proto + "://" + host);
    const routePath = url.searchParams.get("path") || "";
    if (routePath) url.pathname = "/api/" + routePath.split("/").map(decodeURIComponent).join("/");
    if (url.pathname === "/api/health") url.pathname = "/health";
    url.searchParams.delete("path");
    const chunks = [];
    if (!["GET", "HEAD"].includes(method)) {
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = chunks.length ? Buffer.concat(chunks) : undefined;
    const env = { ...process.env, DB: new NeonD1Compat(getSql()) };
    const internal = await handleInternal(method, url, headers, rawBody || Buffer.alloc(0), getSql());
    if (internal) return jsonResponse(res, internal.status, internal.body);
    const request = new Request(url, {
      method,
      headers,
      ...(rawBody ? { body: rawBody, duplex: "half" } : {})
    });
    const response = await worker.fetch(request, env);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
    });
    if (typeof response.headers.getSetCookie === "function") {
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
    } else {
      const cookie = response.headers.get("set-cookie");
      if (cookie) res.setHeader("Set-Cookie", cookie);
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
  }
}
