import worker from "../worker.js";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import nodemailer from "nodemailer";
import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";

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

async function verifyInternal(method, url, headers, rawBody, db, secretOverride) {
  const secret = secretOverride !== undefined ? String(secretOverride || "") : (process.env.INTERNAL_API_SECRET || "");
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
  const catalogSync = path === "/api/internal/catalog_sync" && method === "POST";
  const catalogSnapshotSync = path === "/api/internal/catalog_snapshot_sync" && method === "POST";
  const nodeProvision = path === "/api/internal/nodes/provision" && method === "POST";
  const nodeRevoke = path === "/api/internal/nodes/revoke" && method === "POST";
  if (path !== "/api/internal/send_email" && path !== "/api/internal/buy" && !buyStatusMatch && !catalogSync && !catalogSnapshotSync && !nodeProvision && !nodeRevoke) return null;
  const authorized = await verifyInternal(method, url, headers, rawBody, db, catalogSnapshotSync ? (process.env.CATALOG_SYNC_SECRET || "") : undefined).catch(() => false);
  if (!authorized) return { status: 401, body: { ok:false, error:"unauthorized" } };

  if (catalogSnapshotSync) {
    let data = {};
    try { data = JSON.parse(rawBody.toString("utf8") || "{}"); }
    catch { return {status:400,body:{ok:false,error:"invalid_json"}}; }
    const categoriesIn = Array.isArray(data.categories) ? data.categories : [];
    const productsIn = Array.isArray(data.products) ? data.products : [];
    const version = String(data.fetched_at || data.updated_at || new Date().toISOString());
    if (!/^\d{4}-\d{2}-\d{2}T/.test(version) || categoriesIn.length < 1 || categoriesIn.length > 200 || productsIn.length < 1000 || productsIn.length > 10000) {
      return {status:400,body:{ok:false,error:"catalog_payload_validation_failed"}};
    }
    const categories = categoriesIn.map(c => ({
      category_id:String(c.id || ""), name:String(c.name || "未命名分类"),
      alias:String(c.alias || ""), icon:String(c.icon || ""),
      product_count:Math.max(0,Math.trunc(Number(c.count || 0))),
      enabled:c.enabled === true ? 1 : 0, synced_at:version
    }));
    if (categories.some(c => !c.category_id || !Number.isFinite(c.product_count))) {
      return {status:400,body:{ok:false,error:"catalog_category_invalid"}};
    }
    const seen = new Set();
    const products = [];
    for (const p of productsIn) {
      const id = String(p.supplier_product_id || p.id || "").trim();
      const cost = Number(p.price_cny);
      const stock = Number(p.stock || 0);
      if (!id || seen.has(id) || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(stock) || stock < 0) {
        return {status:400,body:{ok:false,error:"catalog_product_invalid"}};
      }
      seen.add(id);
      const onSale = p.is_on_sale === true;
      const active = onSale && stock > 0 && cost > 0;
      const sell = Math.round((cost / 4) * 10000) / 10000;
      const status = !onSale ? "off_sale" : stock > 0 ? "in_stock" : "out_of_stock";
      const productUrl = "https://dahaoshang.com/#/product/" + encodeURIComponent(id);
      const variants = JSON.stringify(Array.isArray(p.variants) ? p.variants : []);
      const raw = JSON.stringify(p.raw || p);
      products.push({
        version, supplier_product_id:id, title:String(p.name || "未命名商品"),
        category_id:String(p.category_id || ""), category:String(p.category_name || "其他商品"),
        price_cny:cost, sell_price_usdt:sell, stock, is_on_sale:onSale, purchasable:active,
        description:p.description == null ? null : String(p.description),
        variants_json:variants, stock_status:status, product_url:productUrl,
        raw_json:raw, active:active ? 1 : 0, synced_at:version
      });
    }
    if (products.length !== productsIn.length) return {status:400,body:{ok:false,error:"catalog_product_count_mismatch"}};
    const activeCount = products.filter(p => p.active === 1).length;
    const syncEpoch = Math.floor(Date.parse(version) / 1000);
    if (!Number.isFinite(syncEpoch) || syncEpoch <= 0) return {status:400,body:{ok:false,error:"catalog_version_invalid"}};
    const shopCatalogItems = products.map(p => ({
      product_id:p.supplier_product_id, supplier_product_id:p.supplier_product_id,
      name:p.title, category_id:p.category_id, category_name:p.category,
      price_cny:p.price_cny, price_usdt:p.sell_price_usdt, stock:p.stock,
      is_on_sale:p.is_on_sale, is_local_inventory:false, purchasable:p.purchasable,
      source:JSON.parse(p.raw_json), updated_at:syncEpoch
    }));
    await db.begin(async tx => {
      for (let i=0;i<categories.length;i+=200) {
        const batch = categories.slice(i,i+200);
        const categoryJson = JSON.stringify(batch).replace(/'/g, "''");
        const versionSql = version.replace(/'/g, "''");
        const categorySql = "INSERT INTO supplier_categories(category_id,name,alias,icon,product_count,enabled,synced_at) SELECT x.category_id,x.name,x.alias,x.icon,x.product_count,x.enabled,x.synced_at FROM jsonb_to_recordset('" + categoryJson + "'::jsonb) AS x(category_id text,name text,alias text,icon text,product_count integer,enabled integer,synced_at text) ON CONFLICT(category_id) DO UPDATE SET name=EXCLUDED.name,alias=EXCLUDED.alias,icon=EXCLUDED.icon,product_count=EXCLUDED.product_count,enabled=EXCLUDED.enabled,synced_at=EXCLUDED.synced_at";
        await tx.unsafe(categorySql);
        const categorySnapshotSql = "INSERT INTO catalog_snapshot_categories(version,category_id,name,alias,icon,product_count,enabled) SELECT '" + versionSql + "',x.category_id,x.name,x.alias,x.icon,x.product_count,x.enabled FROM jsonb_to_recordset('" + categoryJson + "'::jsonb) AS x(category_id text,name text,alias text,icon text,product_count integer,enabled integer) ON CONFLICT(version,category_id) DO UPDATE SET name=EXCLUDED.name,alias=EXCLUDED.alias,icon=EXCLUDED.icon,product_count=EXCLUDED.product_count,enabled=EXCLUDED.enabled";
        await tx.unsafe(categorySnapshotSql);
      }
      for (let i=0;i<products.length;i+=250) {
        const batch = products.slice(i,i+250);
        const json = JSON.stringify(batch).replace(/'/g, "''");
        const productsSql = "INSERT INTO products(supplier_product_id,title,category,price_cny,sell_price_usdt,description,variants_json,stock_status,product_url,raw_json,active,synced_at) SELECT x.supplier_product_id,x.title,x.category,x.price_cny,x.sell_price_usdt,x.description,x.variants_json,x.stock_status,x.product_url,x.raw_json,x.active,x.synced_at FROM jsonb_to_recordset('" + json + "'::jsonb) AS x(supplier_product_id text,title text,category text,price_cny double precision,sell_price_usdt double precision,description text,variants_json text,stock_status text,product_url text,raw_json text,active integer,synced_at text) ON CONFLICT(supplier_product_id) DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,price_cny=EXCLUDED.price_cny,sell_price_usdt=EXCLUDED.sell_price_usdt,description=EXCLUDED.description,variants_json=EXCLUDED.variants_json,stock_status=EXCLUDED.stock_status,product_url=EXCLUDED.product_url,raw_json=EXCLUDED.raw_json,active=EXCLUDED.active,synced_at=EXCLUDED.synced_at";
        await tx.unsafe(productsSql);
        const snapshotSql = "INSERT INTO catalog_snapshot_products(version,supplier_product_id,title,category_id,category,price_cny,sell_price_usdt,description,variants_json,stock_status,product_url,raw_json,active) SELECT x.version,x.supplier_product_id,x.title,x.category_id,x.category,x.price_cny,x.sell_price_usdt,x.description,x.variants_json,x.stock_status,x.product_url,x.raw_json,x.active FROM jsonb_to_recordset('" + json + "'::jsonb) AS x(version text,supplier_product_id text,title text,category_id text,category text,price_cny double precision,sell_price_usdt double precision,description text,variants_json text,stock_status text,product_url text,raw_json text,active integer) ON CONFLICT(version,supplier_product_id) DO UPDATE SET title=EXCLUDED.title,category_id=EXCLUDED.category_id,category=EXCLUDED.category,price_cny=EXCLUDED.price_cny,sell_price_usdt=EXCLUDED.sell_price_usdt,description=EXCLUDED.description,variants_json=EXCLUDED.variants_json,stock_status=EXCLUDED.stock_status,product_url=EXCLUDED.product_url,raw_json=EXCLUDED.raw_json,active=EXCLUDED.active";
        await tx.unsafe(snapshotSql);
      }
      for (let i=0;i<shopCatalogItems.length;i+=250) {
        const batch = shopCatalogItems.slice(i,i+250);
        const shopJson = JSON.stringify(batch).replace(/'/g, "''");
        const shopSql = "INSERT INTO shop_catalog(product_id,supplier_product_id,name,category_id,category_name,price_cny,price_usdt,stock,is_on_sale,is_local_inventory,purchasable,source,updated_at) SELECT x.product_id,x.supplier_product_id,x.name,x.category_id,x.category_name,x.price_cny,x.price_usdt,x.stock,x.is_on_sale,x.is_local_inventory,x.purchasable,x.source,x.updated_at FROM jsonb_to_recordset('" + shopJson + "'::jsonb) AS x(product_id text,supplier_product_id text,name text,category_id text,category_name text,price_cny numeric,price_usdt numeric,stock integer,is_on_sale boolean,is_local_inventory boolean,purchasable boolean,source jsonb,updated_at bigint) ON CONFLICT(product_id) DO UPDATE SET supplier_product_id=EXCLUDED.supplier_product_id,name=EXCLUDED.name,category_id=EXCLUDED.category_id,category_name=EXCLUDED.category_name,price_cny=EXCLUDED.price_cny,price_usdt=EXCLUDED.price_usdt,stock=EXCLUDED.stock,is_on_sale=EXCLUDED.is_on_sale,is_local_inventory=false,purchasable=EXCLUDED.purchasable,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at WHERE shop_catalog.is_local_inventory=false";
        await tx.unsafe(shopSql);
      }
      await tx.unsafe("UPDATE shop_catalog SET stock=0,is_on_sale=false,purchasable=false,updated_at=$1 WHERE is_local_inventory=false AND updated_at < $1",[syncEpoch]);
      await tx.unsafe("INSERT INTO catalog_sync_state(id,synced_at,product_count,category_count) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET synced_at=EXCLUDED.synced_at,product_count=EXCLUDED.product_count,category_count=EXCLUDED.category_count",[version,products.length,categories.length]);
      await tx.unsafe("INSERT INTO catalog_sync_runs(attempted_at,status,product_count,category_count,active_count,error) VALUES($1,'success',$2,$3,$4,NULL)",[version,products.length,categories.length,activeCount]);
      await tx.unsafe("DELETE FROM catalog_snapshot_products WHERE version NOT IN (SELECT DISTINCT version FROM catalog_snapshot_products ORDER BY version DESC LIMIT 2)");
      await tx.unsafe("DELETE FROM catalog_snapshot_categories WHERE version NOT IN (SELECT DISTINCT version FROM catalog_snapshot_categories ORDER BY version DESC LIMIT 2)");
    });
    return {status:200,body:{ok:true,version,products:products.length,categories:categories.length,active_products:activeCount}};
  }

  if (nodeProvision || nodeRevoke) {
    const serverApiOrigin = String(process.env.NODE_SERVER_API_ORIGIN || "http://167.253.96.220:8001").trim();
    if (!serverApiOrigin || !process.env.INTERNAL_API_SECRET) return {status:503,body:{ok:false,error:"node_origin_not_configured"}};
    const originPath = nodeProvision ? "/api/nodes/provision" : "/api/nodes/revoke";
    const ts = String(Math.floor(Date.now()/1000));
    const nonce = Array.from(cryptoRandom(16),b=>b.toString(16).padStart(2,"0")).join("");
    const bodyText = rawBody.toString("utf8");
    const signed = ts + "\n" + nonce + "\nPOST\n" + originPath + "\n" + bodyText;
    const signature = createHmac("sha256",process.env.INTERNAL_API_SECRET).update(signed).digest("hex");
    try {
      const response = await fetch(new URL(originPath,serverApiOrigin), {
        method:"POST",
        headers:{"Content-Type":"application/json","X-Worker-Timestamp":ts,"X-Worker-Nonce":nonce,"X-Worker-Signature":signature},
        body:rawBody,
        signal:AbortSignal.timeout(65000)
      });
      const result = await response.json().catch(()=>({ok:false,error:"node_origin_invalid_response"}));
      if (!response.ok || !result.ok) return {status:response.status,body:result};
      if (nodeProvision) {
        const packed = Buffer.from(String(result.encrypted || ""), "base64");
        if (packed.length < 29) return {status:502,body:{ok:false,error:"node_delivery_envelope_invalid"}};
        const key = createHash("sha256").update(process.env.INTERNAL_API_SECRET + "|node-manager-response").digest();
        const decipher = createDecipheriv("aes-256-gcm",key,packed.subarray(0,12));
        decipher.setAuthTag(packed.subarray(packed.length-16));
        const clear = Buffer.concat([decipher.update(packed.subarray(12,packed.length-16)),decipher.final()]);
        return {status:200,body:{ok:true,account:JSON.parse(clear.toString("utf8"))}};
      }
      return {status:response.status,body:result};
    } catch {
      return {status:502,body:{ok:false,error:"node_origin_unavailable"}};
    }
  }

  if (catalogSync) {
    const state = await db.unsafe("SELECT COALESCE(MAX(updated_at),0) AS last FROM shop_catalog");
    const last = Number(state[0]?.last || 0), now = Math.floor(Date.now()/1000);
    const catalogKey = process.env.SHOP_BUY_API_KEY || "";
    if (!catalogKey) return {status:503,body:{ok:false,error:"supplier_not_configured"}};
    try {
      const headersUpstream = {"x-api-key":catalogKey};
      const [productResponse,categoryResponse] = await Promise.all([
        fetch("http://167.253.96.220:8001/api/products?categoryId=0",{headers:headersUpstream,signal:AbortSignal.timeout(18000)}),
        fetch("http://167.253.96.220:8001/api/categories",{headers:headersUpstream,signal:AbortSignal.timeout(12000)})
      ]);
      if (!productResponse.ok) throw new Error("supplier_catalog_http_" + productResponse.status);
      const productData = await productResponse.json();
      let rows = Array.isArray(productData) ? productData : (productData.Data || productData.data || []);
      if (!Array.isArray(rows) && rows && typeof rows === "object") rows = rows.Items || rows.items || [];
      if (!Array.isArray(rows) || !rows.length) throw new Error("supplier_catalog_empty");
      let categoryRows = [];
      if (categoryResponse.ok) {
        const categoryData = await categoryResponse.json();
        categoryRows = Array.isArray(categoryData) ? categoryData : (categoryData.Data || categoryData.data || []);
        if (!Array.isArray(categoryRows) && categoryRows && typeof categoryRows === "object") categoryRows = categoryRows.Items || categoryRows.items || [];
      }
      const categoryMap = new Map(categoryRows.filter(x=>x&&x.ID).map(x=>[String(x.ID),String(x.Name||x.Title||"其他商品")]));
      const items = rows.filter(x=>x&&String(x.ID||x.LinkId||"").trim()).map(x=>{
        const id=String(x.ID||x.LinkId).trim(),price=Number(x.Price||0),stock=Math.max(0,Number(x.InStock||0)),sale=x.IsOnSale===true;
        return {product_id:id,supplier_product_id:id,name:String(x.Name||"未命名商品"),category_id:String(x.CategoryId||""),category_name:categoryMap.get(String(x.CategoryId||""))||"其他商品",price_cny:Number.isFinite(price)?price:0,price_usdt:Math.round(price/4*10000)/10000,stock,is_on_sale:sale,is_local_inventory:false,purchasable:sale&&stock>0,source:x,updated_at:now};
      });
      for(let i=0;i<items.length;i+=500){
        const json=JSON.stringify(items.slice(i,i+500)).replace(/'/g,"''");
        await db.unsafe(`INSERT INTO shop_catalog(product_id,supplier_product_id,name,category_id,category_name,price_cny,price_usdt,stock,is_on_sale,is_local_inventory,purchasable,source,updated_at)
          SELECT x.product_id,x.supplier_product_id,x.name,x.category_id,x.category_name,x.price_cny,x.price_usdt,x.stock,x.is_on_sale,x.is_local_inventory,x.purchasable,x.source,x.updated_at
          FROM jsonb_to_recordset('${json}'::jsonb) AS x(product_id text,supplier_product_id text,name text,category_id text,category_name text,price_cny numeric,price_usdt numeric,stock integer,is_on_sale boolean,is_local_inventory boolean,purchasable boolean,source jsonb,updated_at bigint)
          ON CONFLICT(product_id) DO UPDATE SET supplier_product_id=EXCLUDED.supplier_product_id,name=EXCLUDED.name,category_id=EXCLUDED.category_id,category_name=EXCLUDED.category_name,price_cny=EXCLUDED.price_cny,price_usdt=EXCLUDED.price_usdt,stock=EXCLUDED.stock,is_on_sale=EXCLUDED.is_on_sale,is_local_inventory=EXCLUDED.is_local_inventory,purchasable=EXCLUDED.purchasable,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`);
      }
      await db.unsafe("UPDATE shop_catalog SET stock=0,is_on_sale=false,purchasable=false WHERE updated_at < $1",[now]);
      return {status:200,body:{ok:true,count:items.length,sellable:items.filter(x=>x.is_on_sale&&x.stock>0).length,updated_at:now}};
    } catch (error) {
      return {status:503,body:{ok:false,error:String(error.message||"catalog_sync_failed").slice(0,120)}};
    }
  }

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
    const productRows = await db.unsafe("SELECT * FROM shop_catalog WHERE product_id=$1", [String(data.product_id || productId)]);
    const product = productRows[0];
    if (!product || !product.is_on_sale || Number(product.stock || 0) < 1 || !product.purchasable) {
      return {status:200,body:{ok:true,status:"failed",error_code:"product_not_enabled_for_purchase"}};
    }
    if (Math.round(Number(product.price_usdt)*10000) !== Math.round(Number(data.expected_price_usdt)*10000)) {
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
      let liveRows = Array.isArray(liveData) ? liveData : (liveData.Data || liveData.data || []);
      if (!Array.isArray(liveRows) && liveRows && typeof liveRows === "object") {
        liveRows = liveRows.Items || liveRows.items || [];
      }
      if (!Array.isArray(liveRows)) liveRows = [];
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


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function storefrontTitle(value) {
  return String(value || "数字商品").replace(/^\s*\[货号[^\]]*\]\s*/i,"").replace(/^[^\p{L}\p{N}]+/u,"").split(/[|｜]/)[0].replace(/\s+/g," ").trim() || "数字商品";
}
function storefrontDescription(value) {
  const parts=String(value||"").split(/[|｜]/).map(x=>x.trim()).filter(Boolean);
  const detail=parts.length>1?parts.slice(1).filter(x=>!/^\[?货号/i.test(x)&&!/单次最多购买|最多购买\s*\d+/i.test(x)).join(" · "):"";
  return detail.length>76?detail.slice(0,73)+"…":detail;
}
function storefrontPopularityScore(name,icon) {
  const n=String(name||"").toLowerCase(), i=String(icon||"").toLowerCase();
  const rules=[
    [/chatgpt|openai|gpt[- ]?[45]/i,100],[/claude|anthropic/i,98],[/gemini|google ai/i,96],
    [/google|gmail|youtube|google voice/i,94],[/microsoft|office 365|office365|outlook|onedrive|teams/i,92],
    [/apple|icloud/i,90],[/discord/i,88],[/telegram/i,86],[/whatsapp/i,84],
    [/instagram/i,82],[/tiktok/i,80],[/facebook|meta/i,78],[/x\.com|twitter/i,76],
    [/snapchat/i,74],[/reddit/i,72],[/steam/i,70],[/spotify/i,68],[/netflix/i,66],
    [/amazon/i,64],[/linkedin/i,62],[/github/i,60],[/notion/i,58],[/canva/i,56],
    [/capcut/i,54],[/adobe|photoshop|premiere/i,52],[/zoom/i,50],[/yahoo/i,48],[/skype/i,46]
  ];
  const hit=rules.find(([pattern])=>pattern.test(n));
  if(hit)return hit[1];
  const ranks={"shop-google":94,"shop-google-voice-logo":94,"shop-microsoft":92,"shop-apple":90,"shop-discord":88,"shop-telegram":86,"shop-whatsapp":84,"shop-instagram":82,"shop-tiktok":80,"shop-facebook":78,"shop-twitter-circle-fill":76,"shop-steam":70,"shop-amazon-circle-fill":64,"shop-youtube":94,"shop-yahoo":48};
  return ranks[i]||0;
}
function storefrontIconUrl(icon,name) {
  const title=String(name||"").toLowerCase();
  const rules=[
    [/microsoft\s*teams|\bteams\b/i,"microsoftteams"],[/\bskype\b/i,"skype"],
    [/chatgpt|openai|gpt[- ]?[45]/i,"openai"],[/claude|anthropic/i,"claude"],[/gemini/i,"googlegemini"],
    [/google\s*voice/i,"googlevoice"],[/youtube/i,"youtube"],[/gmail|google|谷歌/i,"google"],
    [/outlook|hotmail/i,"outlook"],[/office\s*365|office365/i,"microsoftoffice"],
    [/onedrive|microsoft|windows|微软/i,"microsoft"],[/apple|icloud|苹果/i,"apple"],
    [/discord/i,"discord"],[/telegram|飞机号|电报|纸飞机/i,"telegram"],[/whatsapp/i,"whatsapp"],
    [/instagram/i,"instagram"],[/tiktok|TK账号|抖音/i,"tiktok"],[/facebook|meta|脸书/i,"facebook"],
    [/x\.com|twitter/i,"x"],[/snapchat/i,"snapchat"],[/reddit/i,"reddit"],[/steam/i,"steam"],
    [/spotify/i,"spotify"],[/netflix/i,"netflix"],[/amazon/i,"amazon"],[/linkedin/i,"linkedin"],
    [/github/i,"github"],[/notion/i,"notion"],[/canva/i,"canva"],[/capcut/i,"capcut"],
    [/adobe|photoshop|premiere/i,"adobe"],[/zoom/i,"zoom"],[/yahoo/i,"yahoo"],
    [/proton\s?mail|protonmail/i,"protonmail"],[/\baol\b|aol\.com/i,"aol"],
    [/\bgmx\b|gmx\.(us|com)/i,"gmx"],[/vfemail/i,"vfemail"],[/firstmail/i,"firstmail"],
    [/ixbrowser/i,"ixbrowser"]
  ];
  const slug=rules.find(([pattern])=>pattern.test(title))?.[1];
  return slug ? "https://cdn.simpleicons.org/"+slug : "";
}

async function renderStorefront(res) {
  const fileUrl = new URL("../shop.html", import.meta.url);
  let html = await readFile(fileUrl, "utf8");
  try {
    const db=getSql();
    const freshness=await db.unsafe("SELECT MAX(updated_at) AS latest FROM shop_catalog WHERE is_local_inventory=false");
    const latest=Number(freshness[0]?.latest||0);
    const fresh=latest>0 && Math.floor(Date.now()/1000)-latest<=180;
    const rows=await db.unsafe("SELECT product_id,name,category_name,price_cny,price_usdt,stock,is_on_sale,is_local_inventory,purchasable,source,updated_at FROM shop_catalog WHERE is_on_sale=true AND stock>0");
    rows.sort((a,b)=>storefrontPopularityScore(b.name,b.source?.Icon)-storefrontPopularityScore(a.name,a.source?.Icon) || Number(b.updated_at||0)-Number(a.updated_at||0) || String(a.name||"").localeCompare(String(b.name||"")));
    const products=rows.slice(0,48).map(row=>{
      const source=row.source&&typeof row.source==="object"?row.source:{};
      return {product_id:String(row.product_id),name:String(row.name||""),category:String(row.category_name||"其他商品"),
        price_cny:Number(row.price_cny),price_usdt:Number(row.price_usdt),price_verified:false,stock:Number(row.stock||0),
        purchasable:Boolean(row.purchasable)&&(Boolean(row.is_local_inventory)||fresh),icon:String(source.Icon||""),
        image_url:String(source.ImageUrl||source.ImageURL||source.Image||source.image_url||""),
        icon_url:storefrontIconUrl(source.Icon,row.name),
        description:String(source.Description||source.DescriptionZh||source.description||"")};
    });
    const cards=products.map(item=>{
      const title=storefrontTitle(item.name),desc=storefrontDescription(item.description||item.name);
      const image=/^https:\/\//i.test(item.image_url)
        ? '<img class="product-cover-image" alt="'+escapeHtml(title)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="'+escapeHtml(item.image_url)+'">'
        : '<div class="product-cover-art"><span class="product-cover-kicker">'+escapeHtml(item.category)+'</span><strong>'+escapeHtml(title)+'</strong><small>QINGTIAN · DIGITAL STORE</small></div>';
      const icon=item.icon_url?'<img class="product-icon-image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="'+escapeHtml(item.icon_url)+'">':'<span class="product-icon-fallback" aria-hidden="true">'+escapeHtml(title.slice(0,1)||"软")+'</span>';
      return '<article class="product-card shop-product-card"><div class="product-cover">'+image+'</div><div class="product-card-head"><div class="product-icon-wrap">'+icon+'</div><div class="product-title-wrap"><div class="product-category">'+escapeHtml(item.category)+'</div><h3 class="product-name">'+escapeHtml(title)+'</h3></div></div>'+(desc?'<p class="product-description">'+escapeHtml(desc)+'</p>':'')+'<div class="product-meta"><div class="product-price">'+"价格实时核验中"+'</div><div class="product-stock">库存 '+item.stock+'</div></div><div class="product-stock-track"><span style="width:'+Math.max(8,Math.min(100,item.stock*5))+'%"></span></div><button type="button" class="primary-button buy-button" disabled>核对价格中</button></article>';
    }).join("");
    const placeholder='<div class="product-grid" id="productGrid" aria-live="polite">\n        <div class="loading-card" data-i18n="loadingCatalog">正在连接商品目录…</div>\n      </div>';
    html=html.replace(placeholder,'<div class="product-grid" id="productGrid" aria-live="polite">'+(cards||'<div class="empty-card">暂无上架商品</div>')+'</div>');
    const payload=JSON.stringify(products).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026");
    html=html.replace('<script>window.__QINGTIAN_INITIAL_PRODUCTS__='+payload+';</script><script src="./script.js?v=popular-apps-live-price-20261125-v1" defer></script>',
      '<script>window.__QINGTIAN_INITIAL_PRODUCTS__='+payload+';</script><script src="./script.js?v=catalog-cache-copy-20261125-v4" defer></script>');
    res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","public, s-maxage=20, stale-while-revalidate=40, stale-if-error=86400");
    res.setHeader("X-Storefront-Render","database-snapshot");res.end(html);
  } catch(error) {
    console.error("[storefront_ssr_fallback]",String(error?.message||error));
    res.statusCode=200;res.setHeader("Content-Type","text/html; charset=utf-8");
    res.setHeader("Cache-Control","public, s-maxage=10, stale-while-revalidate=30");
    res.setHeader("X-Storefront-Render","static-fallback");res.end(html);
  }
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
    if (url.pathname === "/api/storefront" && (method === "GET" || method === "HEAD")) return await renderStorefront(res);
    if (url.pathname === "/api/internal/catalog_snapshot_sync" && method === "POST") {
      try {
        const result = await handleInternal(method, url, headers, rawBody || Buffer.alloc(0), getSql());
        if (!result) return jsonResponse(res, 404, { ok: false, error: "not_found" });
        return jsonResponse(res, result.status, result.body);
      } catch (error) {
        console.error("[catalog_snapshot_sync_failed]", String(error?.message || error), String(error?.code || ""));
        return jsonResponse(res, 500, { ok: false, error: "catalog_snapshot_sync_failed", code: String(error?.code || "") });
      }
    }
    const env = {
      ...process.env,
      DB: new NeonD1Compat(getSql()),
      INTERNAL_HANDLER: async (internalMethod, internalPath, payload) => {
        const body = payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
        const ts = String(Math.floor(Date.now()/1000));
        const nonce = crypto.randomUUID();
        const signed = ts + "\n" + nonce + "\n" + String(internalMethod).toUpperCase() + "\n" + internalPath + "\n" + body.toString("utf8");
        const signature = createHmac("sha256", process.env.INTERNAL_API_SECRET || "").update(signed).digest("hex");
        const internalUrl = new URL(internalPath, "https://internal.local");
        const internalHeaders = new Headers({
          "X-Worker-Timestamp": ts,
          "X-Worker-Nonce": nonce,
          "X-Worker-Signature": signature
        });
        const result = await handleInternal(String(internalMethod).toUpperCase(), internalUrl, internalHeaders, body, getSql());
        if (!result) throw new Error("internal_route_not_found");
        if (result.status < 200 || result.status >= 300) {
          throw new Error(String(result.body?.error || "internal_request_failed"));
        }
        return result.body;
      }
    };
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
