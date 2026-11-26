import worker from "../worker.js";
import { storefrontIconUrl } from "../product-icons.js";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import nodemailer from "nodemailer";
import { createHash, createHmac, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";

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
  const supplierDeliverMatch = path.match(/^\/api\/internal\/supplier-deliver\/([a-f0-9-]{36})$/i);
  const catalogSync = path === "/api/internal/catalog_sync" && method === "POST";
  const catalogSnapshotSync = path === "/api/internal/catalog_snapshot_sync" && method === "POST";
  if (path !== "/api/internal/send_email" && path !== "/api/internal/buy" && !buyStatusMatch && !supplierDeliverMatch && !catalogSync && !catalogSnapshotSync) return null;
  const authorized = await verifyInternal(method, url, headers, rawBody, db, catalogSnapshotSync ? (process.env.CATALOG_SYNC_SECRET || "") : undefined).catch(() => false);
  if (!authorized) return { status: 401, body: { ok:false, error:"unauthorized" } };

  if (supplierDeliverMatch && method === "POST") {
    let data = {};
    try { data = JSON.parse(rawBody.toString("utf8") || "{}"); }
    catch { return {status:400,body:{ok:false,error:"invalid_json"}}; }
    const orderId = supplierDeliverMatch[1];
    const content = typeof data.content === "string" ? data.content.trim() : "";
    const supplierOrderId = String(data.supplier_order_id || "").trim().slice(0,128);
    if (data.confirmed !== true || !content || content.length > 20000) {
      return {status:400,body:{ok:false,error:"explicit_supplier_confirmation_and_delivery_content_required"}};
    }
    let rows = await db.unsafe("SELECT status,delivery_ciphertext FROM shop_supplier_orders WHERE order_id=$1",[orderId]);
    if (!rows.length) {
      const purchases = await db.unsafe("SELECT user_id,status FROM web_purchases WHERE order_id=$1",[orderId]);
      if (!purchases.length) return {status:404,body:{ok:false,error:"purchase_not_found"}};
      if (!["pending","reserved"].includes(String(purchases[0].status))) {
        return {status:409,body:{ok:false,error:"purchase_not_reconcilable",status:purchases[0].status}};
      }
      const now = Math.floor(Date.now()/1000);
      await db.unsafe("INSERT INTO shop_supplier_orders(order_id,user_id,status,created_at,updated_at,error_code) VALUES($1,$2,'pending',$3,$3,'manual_reconciliation_record_created') ON CONFLICT(order_id) DO NOTHING",[orderId,purchases[0].user_id,now]);
      rows = await db.unsafe("SELECT status,delivery_ciphertext FROM shop_supplier_orders WHERE order_id=$1",[orderId]);
    }
    if (!rows.length) return {status:404,body:{ok:false,error:"supplier_order_not_found"}};
    if (rows[0].status === "delivered" && rows[0].delivery_ciphertext) {
      return {status:200,body:{ok:true,status:"delivered",already_delivered:true}};
    }
    if (!["pending","processing"].includes(String(rows[0].status))) {
      return {status:409,body:{ok:false,error:"supplier_order_not_reconcilable",status:rows[0].status}};
    }
    const ciphertext = encryptDelivery(content);
    const updated = await db.unsafe(
      "UPDATE shop_supplier_orders SET status='delivered',supplier_order_id=COALESCE(NULLIF($2,''),supplier_order_id),delivery_ciphertext=$3,error_code=NULL,updated_at=$4 WHERE order_id=$1 AND status IN ('pending','processing') AND delivery_ciphertext IS NULL RETURNING order_id",
      [orderId,supplierOrderId,ciphertext,Math.floor(Date.now()/1000)]
    );
    if (!updated.length) return {status:409,body:{ok:false,error:"supplier_order_changed_retry_status_check"}};
    return {status:200,body:{ok:true,status:"delivered",order_id:orderId}};
  }

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
    let supplierPurchaseSubmitted = false;
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
      // From this point onward the supplier may have accepted the purchase,
      // even if the network times out before a response reaches us.
      supplierPurchaseSubmitted = true;
      const purchaseResponse = await fetch("http://167.253.96.220:8001/api/buy", {
        method:"POST", headers:{"x-api-key":apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({product_id:productId,qty:1}), signal:AbortSignal.timeout(25000)
      });
      const purchaseData = await purchaseResponse.json().catch(()=>null);
      // A 5xx or unreadable/malformed response does not prove the supplier
      // rejected the order: the purchase may have completed before the error.
      if (purchaseResponse.status >= 500 || !purchaseData || typeof purchaseData.success !== "boolean") {
        throw new Error("supplier_purchase_response_uncertain");
      }
      const supplierOrderId = String(purchaseData.order_id || "");
      const purchaseMessage = String(purchaseData.msg || "");
      const uncertainPurchase = purchaseData.uncertain === true ||
        /结果不确定|请人工核对|已受理采购|订单号暂不可读取|订单查询结果不确定|读取结果不确定/i.test(purchaseMessage);
      if (!purchaseResponse.ok || purchaseData.success === false) {
        if (supplierOrderId || uncertainPurchase) {
          await db.unsafe("UPDATE shop_supplier_orders SET status='pending',error_code='supplier_result_uncertain',supplier_order_id=$2,updated_at=$3 WHERE order_id=$1",[orderId,supplierOrderId,Math.floor(Date.now()/1000)]);
          return {status:200,body:{ok:true,status:"pending",error_code:"supplier_result_uncertain",supplier_order_id:supplierOrderId || null}};
        }
        await db.unsafe("UPDATE shop_supplier_orders SET status='failed',error_code=$2,updated_at=$3 WHERE order_id=$1",[orderId,purchaseMessage.slice(0,120)||"supplier_purchase_failed",Math.floor(Date.now()/1000)]);
        return {status:200,body:{ok:true,status:"failed",error_code:"supplier_purchase_failed"}};
      }
      const content = String(purchaseData.card || "");
      if (!content) {
        await db.unsafe("UPDATE shop_supplier_orders SET status='pending',error_code='supplier_delivery_pending',supplier_order_id=$2,updated_at=$3 WHERE order_id=$1",[orderId,supplierOrderId,Math.floor(Date.now()/1000)]);
        return {status:200,body:{ok:true,status:"pending",error_code:"supplier_delivery_pending"}};
      }
      const ciphertext = encryptDelivery(content);
      await db.unsafe("UPDATE shop_supplier_orders SET status='delivered',supplier_order_id=$2,delivery_ciphertext=$3,updated_at=$4 WHERE order_id=$1",[orderId,supplierOrderId,ciphertext,Math.floor(Date.now()/1000)]);
      return {status:200,body:{ok:true,status:"delivered",order_id:orderId,content}};
    } catch (error) {
      const status = supplierPurchaseSubmitted ? "pending" : "failed";
      const errorCode = supplierPurchaseSubmitted ? "supplier_result_uncertain" : "supplier_precheck_failed";
      await db.unsafe("UPDATE shop_supplier_orders SET status=$2,error_code=$3,updated_at=$4 WHERE order_id=$1",[orderId,status,errorCode,Math.floor(Date.now()/1000)]);
      return {status:200,body:{ok:true,status,error_code:errorCode}};
    }
  }

  if (buyStatusMatch && method === "GET") {
    const orderId = buyStatusMatch[1], userId = String(url.searchParams.get("user_id") || "");
    const rows = await db.unsafe("SELECT * FROM shop_supplier_orders WHERE order_id=$1 AND user_id=$2",[orderId,userId]);
    if (!rows.length) return {status:200,body:{ok:true,status:"pending"}};
    let row=rows[0];
    // Reconcile pending deliveries against the supplier's read-only order endpoint.
    // This GET never creates another purchase; only a confirmed content payload is saved.
    if (row.status === "pending" && row.supplier_order_id) {
      const apiKey = process.env.SHOP_BUY_API_KEY || "";
      if (apiKey) {
        try {
          const upstream = await fetch("http://167.253.96.220:8001/api/order/" + encodeURIComponent(String(row.supplier_order_id)), {
            method:"GET", headers:{"x-api-key":apiKey}, signal:AbortSignal.timeout(15000)
          });
          if (upstream.ok) {
            const result = await upstream.json().catch(()=>({}));
            const content = result && result.success === true ? String(result.content || result.card || "").trim() : "";
            if (content) {
              const ciphertext = encryptDelivery(content);
              const updated = await db.unsafe(
                "UPDATE shop_supplier_orders SET status='delivered',delivery_ciphertext=$2,error_code=NULL,updated_at=$3 WHERE order_id=$1 AND status='pending' AND delivery_ciphertext IS NULL RETURNING *",
                [orderId,ciphertext,Math.floor(Date.now()/1000)]
              );
              if (updated.length) row = updated[0];
              else {
                const latest = await db.unsafe("SELECT * FROM shop_supplier_orders WHERE order_id=$1 AND user_id=$2",[orderId,userId]);
                if (latest.length) row = latest[0];
              }
            }
          }
        } catch {
          // A temporary lookup failure leaves the order pending for the next poll.
        }
      }
    }
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
function storefrontPopularityScore(name,icon,source={}) {
  const n=String(name||"").toLowerCase(), i=String(icon||"").toLowerCase();
  const ranks={"shop-google":94,"shop-google-voice-logo":94,"shop-microsoft":92,"shop-apple":90,"shop-discord":88,"shop-telegram":86,"shop-whatsapp":84,"shop-instagram":82,"shop-tiktok":80,"shop-facebook":78,"shop-twitter-circle-fill":76,"shop-steam":70,"shop-amazon-circle-fill":64,"shop-youtube":94,"shop-yahoo":48};
  const rules=[
    [/chatgpt|openai|gpt[- ]?[45]/i,100],[/claude|anthropic/i,98],[/gemini|google ai/i,96],
    [/google|gmail|youtube|google voice/i,94],[/microsoft|office 365|office365|outlook|onedrive|teams/i,92],
    [/apple|icloud/i,90],[/discord/i,88],[/telegram/i,86],[/whatsapp/i,84],
    [/instagram/i,82],[/tiktok|tk账号/i,80],[/facebook|meta/i,78],[/x\.com|twitter/i,76],
    [/snapchat/i,74],[/reddit/i,72],[/steam/i,70],[/spotify/i,68],[/netflix/i,66],
    [/amazon/i,64],[/linkedin/i,62],[/github/i,60],[/notion/i,58],[/canva/i,56],
    [/capcut/i,54],[/adobe|photoshop|premiere/i,52],[/textnow/i,56],[/zoom/i,50],[/yahoo/i,48],[/skype/i,46]
  ];
  const hit=rules.find(([pattern])=>pattern.test(n));
  const base=hit?hit[1]:(ranks[i]||0);
  const hot=source?.IsHot===true || String(source?.IsHot||"").toLowerCase()==="true";
  const recommended=source?.IsRecommend===true || String(source?.IsRecommend||"").toLowerCase()==="true";
  return (hot?120:0)+(recommended?60:0)+base;
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
    rows.sort((a,b)=>storefrontPopularityScore(b.name,b.source?.Icon,b.source)-storefrontPopularityScore(a.name,a.source?.Icon,a.source) || Number(b.updated_at||0)-Number(a.updated_at||0) || String(a.name||"").localeCompare(String(b.name||"")));
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
      '<script>window.__QINGTIAN_INITIAL_PRODUCTS__='+payload+';</script><script src="./script.js?v=catalog-cache-copy-20261125-v6" defer></script>');
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


async function qingtianShopApi(method, url, headers, rawBody, res) {
  const path = url.pathname;
  const publicList = path === "/api/v1/shop/products" && method === "GET";
  const publicDetail = path === "/api/v1/shop/product/detail" && method === "GET";
  const authLogin = path === "/api/v1/passport/auth/login" && method === "POST";
  const authRegister = path === "/api/v1/passport/auth/register" && method === "POST";
  const adminList = path === "/api/v1/admin/shop/products" && method === "GET";
  const adminSave = path === "/api/v1/admin/shop/product/save" && method === "POST";
  const adminDelete = path === "/api/v1/admin/shop/product/delete" && method === "POST";
  const adminStatus = path === "/api/v1/admin/shop/product/status" && method === "POST";
  if (!(publicList || publicDetail || authLogin || authRegister || adminList || adminSave || adminDelete || adminStatus)) return false;
  const db = getSql();
  const body = rawBody?.length ? JSON.parse(rawBody.toString("utf8")) : {};
  const send = (status, payload) => { jsonResponse(res, status, payload); return true; };
  const passwordHash = value => createHash("sha256").update("lynli$" + value, "utf8").digest("hex");
  const issueToken = () => crypto.randomUUID().replace(/-/g, "");
  const money = value => Math.round((Number(value) || 0) * 100) / 100;
  if (publicList) {
    const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
    const size = Math.max(1, Math.min(60, Number.parseInt(url.searchParams.get("size") || "20", 10) || 20));
    const kw = (url.searchParams.get("keyword") || url.searchParams.get("kw") || "").trim();
    const category = (url.searchParams.get("category") || "").trim();
    const where = ["COALESCE(status,1)=1"];
    const args = [];
    if (kw) { args.push("%"+kw+"%"); where.push("(COALESCE(title,'') ILIKE $"+args.length+" OR COALESCE(name,'') ILIKE $"+args.length+")"); }
    if (category) { args.push(category); where.push("COALESCE(category,'')=$"+args.length); }
    const clause = where.join(" AND ");
    const countRows = await db.unsafe("SELECT COUNT(*)::int AS total FROM qingtian_shop.shop_products WHERE "+clause,args);
    const rows = await db.unsafe("SELECT id,COALESCE(NULLIF(title,''),name,'') AS title,COALESCE(name,'') AS name,COALESCE(subtitle,'') AS subtitle,COALESCE(category,'') AS category,COALESCE(price,0)::float8 AS base_price,COALESCE(stock,0)::int AS stock,COALESCE(sold,0)::int AS sold,COALESCE(image,'') AS image,COALESCE(detail,'') AS detail FROM qingtian_shop.shop_products WHERE "+clause+" ORDER BY COALESCE(sort,0) DESC,id DESC LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2),[...args,size,(page-1)*size]);
    const data = rows.map(row => ({...row,price:money(Number(row.base_price)*1.35),price_cents:Math.round(money(Number(row.base_price)*1.35)*100),image_url:row.image,cover:row.image,sold_out:Number(row.stock)<=0,in_stock:Number(row.stock)>0}));
    return send(200,{message:"",code:1,data,total:Number(countRows[0]?.total||0),page,size,pages:Math.ceil(Number(countRows[0]?.total||0)/size),has_more:page*size<Number(countRows[0]?.total||0)});
  }
  if (publicDetail) {
    const id = Number(url.searchParams.get("id") || 0);
    if (!Number.isSafeInteger(id) || id<=0) return send(400,{message:"商品ID不正确",status:"success",code:0,data:null});
    const rows = await db.unsafe("SELECT id,COALESCE(NULLIF(title,''),name,'') AS title,COALESCE(name,'') AS name,COALESCE(subtitle,'') AS subtitle,COALESCE(category,'') AS category,COALESCE(price,0)::float8 AS base_price,COALESCE(stock,0)::int AS stock,COALESCE(sold,0)::int AS sold,COALESCE(image,'') AS image,COALESCE(detail,'') AS detail FROM qingtian_shop.shop_products WHERE id=$1 AND COALESCE(status,1)=1",[id]);
    if (!rows.length) return send(200,{message:"商品不存在",status:"success",code:1,data:null});
    const row=rows[0],price=money(Number(row.base_price)*1.35);
    return send(200,{message:"",status:"success",code:1,data:{...row,price,price_cents:Math.round(price*100),image_url:row.image,sold_out:Number(row.stock)<=0,in_stock:Number(row.stock)>0}});
  }
  if (authLogin || authRegister) {
    const email=String(body.email||"").trim().toLowerCase(), password=String(body.password||"");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) return send(400,{message:"邮箱格式不正确",data:null});
    if (password.length<8 || password.length>20 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return send(400,{message:"密码须为8-20位，且同时包含字母和数字",data:null});
    if (authRegister) {
      const token=issueToken(), uuid=crypto.randomUUID(), subToken=issueToken();
      const exists=await db.unsafe("SELECT id FROM qingtian_shop.users WHERE lower(email)=lower($1) LIMIT 1",[email]);
      if (exists.length) return send(400,{message:"该邮箱已注册",data:null});
      const ids=await db.unsafe("SELECT COALESCE(MAX(short_id),9999)+1 AS short_id FROM qingtian_shop.users");
      const inserted=await db.unsafe("INSERT INTO qingtian_shop.users(email,password,uuid,token,created_at,short_id,sub_token,role) VALUES($1,$2,$3,$4,$5,$6,$7,'user') RETURNING id,email,nickname,avatar,role", [email,passwordHash(password),uuid,token,Math.floor(Date.now()/1000),Number(ids[0]?.short_id||10000),subToken]);
      const user=inserted[0];
      return send(200,{message:"",data:{token,isAdmin:0,role:"user",auth_data:token,user:{id:user.id,email:user.email,nickname:user.nickname||email.split("@")[0],avatar:user.avatar||"",role:"user"}}});
    }
    const rows=await db.unsafe("SELECT id,email,password,token,nickname,avatar,role,banned FROM qingtian_shop.users WHERE lower(email)=lower($1) LIMIT 1",[email]);
    const user=rows[0];
    if (!user || !user.password || user.password!==passwordHash(password) || Number(user.banned||0)!==0) return send(401,{message:"邮箱或密码错误",data:null});
    const token=issueToken(), now=Math.floor(Date.now()/1000);
    await db.unsafe("UPDATE qingtian_shop.users SET token=$1,last_login_at=$2,login_count=COALESCE(login_count,0)+1 WHERE id=$3",[token,now,user.id]);
    const role=["admin","super"].includes(String(user.role||"user"))?String(user.role):"user";
    const userInfo={id:user.id,email:user.email,nickname:user.nickname||email.split("@")[0],avatar:user.avatar||"",role};
    return send(200,{message:"",data:{token,isAdmin:role!=="user"?1:0,role,auth_data:token,user:userInfo}});
  }
  const authHeader=headers.get("authorization")||"";
  const token=(authHeader.startsWith("Bearer ")?authHeader.slice(7):String(body.token||"")).trim();
  if (!token) return send(401,{code:0,msg:"请先登录"});
  const users=await db.unsafe("SELECT id,email,role FROM qingtian_shop.users WHERE token=$1 LIMIT 1",[token]);
  let admin=users[0]||null;
  if (!admin) {
    // Primary Neon JWT support: admin product CRUD now shares the same
    // identity and role grants as the rest of the Neon-backed shop APIs.
    try {
      const parts=token.split(".");
      if(parts.length===3&&process.env.JWT_SECRET){
        const signed=parts[0]+"."+parts[1];
        const expected=createHmac("sha256",process.env.JWT_SECRET).update(signed).digest();
        const supplied=Buffer.from(parts[2],"base64url");
        if(supplied.length===expected.length&&timingSafeEqual(supplied,expected)){
          const claims=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));
          const now=Math.floor(Date.now()/1000);
          if(claims.sub&&Number(claims.exp)>now){
            const primaryRows=await db.unsafe("SELECT id,email,token_version FROM public.users WHERE id=$1 LIMIT 1",[claims.sub]);
            const primary=primaryRows[0];
            if(primary&&String(primary.email||"").toLowerCase()===String(claims.email||"").toLowerCase()&&Number(primary.token_version||0)===Number(claims.ver||0)){
              const isRoot=String(primary.email||"").toLowerCase()==="chulingli1988@outlook.com";
              const grants=isRoot?[]:await db.unsafe("SELECT role,status FROM public.admin_accounts WHERE user_id=$1 LIMIT 1",[primary.id]);
              const grant=grants[0];
              const role=isRoot?"super_admin":String(grant?.role||"");
              const active=isRoot||grant?.status==="active";
              const canRead=active&&["super_admin","operations_admin","viewer"].includes(role);
              const canManage=active&&["super_admin","operations_admin"].includes(role);
              if(canRead)admin={id:primary.id,email:primary.email,role,primary:true,canManageProducts:canManage};
            }
          }
        }
      }
    } catch {}
  }
  if (!admin || (!admin.primary && !["admin","super"].includes(String(admin.role||"")))) return send(403,{code:0,msg:"无管理权限"});
  if (admin.primary && (adminSave||adminDelete||adminStatus) && !admin.canManageProducts) return send(403,{code:0,msg:"无商品管理权限"});
  if (adminList) {
    const page=Math.max(1,Number.parseInt(url.searchParams.get("page")||"1",10)||1),size=Math.max(1,Math.min(60,Number.parseInt(url.searchParams.get("size")||"20",10)||20));
    const kw=(url.searchParams.get("keyword")||url.searchParams.get("kw")||"").trim();
    const cat=(url.searchParams.get("category")||"").trim();
    const status=url.searchParams.get("status");
    const where=[],args=[];
    if(kw){args.push("%"+kw+"%");where.push("(COALESCE(title,'') ILIKE $"+args.length+" OR COALESCE(name,'') ILIKE $"+args.length+")");}
    if(cat){args.push(cat);where.push("COALESCE(category,'')=$"+args.length);}
    if(status!==null&&status!==""){args.push(Number(status));where.push("COALESCE(status,0)=$"+args.length);}
    const clause=where.length?" WHERE "+where.join(" AND "):"";
    const count=await db.unsafe("SELECT COUNT(*)::int AS total FROM qingtian_shop.shop_products"+clause,args);
    const rows=await db.unsafe("SELECT id,COALESCE(NULLIF(title,''),name,'') AS title,name,subtitle,category,cost::float8 AS cost,price::float8 AS price,stock,sold,image,detail,source_url,status,created_at,updated_at,sort FROM qingtian_shop.shop_products"+clause+" ORDER BY COALESCE(sort,0) DESC,id DESC LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2),[...args,size,(page-1)*size]);
    return send(200,{code:1,data:{list:rows,total:Number(count[0]?.total||0),page,size},msg:"",message:"ok"});
  }
  if (adminSave) {
    const id=Number(body.id||0),title=String(body.title||body.name||"").trim();
    if(!title)return send(400,{code:0,msg:"商品标题不能为空"});
    const now=Math.floor(Date.now()/1000),values=[title,title,String(body.subtitle||""),String(body.category||"未分类"),Number(body.cost||0),Number(body.price||0),Number(body.stock||0),String(body.image||""),String(body.detail||""),String(body.source_url||""),Number(body.status??1),Number(body.sort||0),now];
    if(!values.slice(4,7).every(Number.isFinite))return send(400,{code:0,msg:"价格或库存格式不正确"});
    if(id>0){
      const updated=await db.unsafe("UPDATE qingtian_shop.shop_products SET name=$1,title=$2,subtitle=$3,category=$4,cost=$5,price=$6,stock=$7,image=$8,detail=$9,source_url=$10,status=$11,sort=$12,updated_at=$13 WHERE id=$14 RETURNING id",[...values,id]);
      if(!updated.length)return send(404,{code:0,msg:"商品不存在"});
      return send(200,{code:1,msg:"已保存",data:{id}});
    }
    const inserted=await db.unsafe("INSERT INTO qingtian_shop.shop_products(name,title,subtitle,category,cost,price,stock,image,detail,source_url,status,sort,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id",[...values.slice(0,12),now]);
    return send(200,{code:1,msg:"上架成功",data:{id:inserted[0].id}});
  }
  if (adminDelete) {
    const id=Number(body.id||0);if(!Number.isSafeInteger(id)||id<=0)return send(400,{code:0,msg:"缺少商品ID"});
    const rows=await db.unsafe("DELETE FROM qingtian_shop.shop_products WHERE id=$1 RETURNING id",[id]);
    return rows.length?send(200,{code:1,msg:"已删除"}):send(404,{code:0,msg:"商品不存在"});
  }
  if (adminStatus) {
    const id=Number(body.id||0),status=Number(body.status??1);
    if(!Number.isSafeInteger(id)||id<=0||![0,1].includes(status))return send(400,{code:0,msg:"参数不正确"});
    const rows=await db.unsafe("UPDATE qingtian_shop.shop_products SET status=$1,updated_at=$2 WHERE id=$3 RETURNING id",[status,Math.floor(Date.now()/1000),id]);
    return rows.length?send(200,{code:1,msg:status?"已上架":"已下架"}):send(404,{code:0,msg:"商品不存在"});
  }
  return send(404,{code:0,msg:"not_found"});
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

    if (url.pathname === "/api/internal/legacy-shop-migration") {
      if (method !== "POST") return jsonResponse(res, 405, {ok:false,error:"method_not_allowed"});
      const body = rawBody || Buffer.alloc(0);
      if (body.length > 5 * 1024 * 1024) return jsonResponse(res, 413, {ok:false,error:"payload_too_large"});
      const database = getSql();
      const authorized = await verifyInternal(method, url, headers, body, database, process.env.NODE_STORE_SECRET || "").catch(() => false);
      if (!authorized) return jsonResponse(res, 401, {ok:false,error:"unauthorized"});
      let data;
      try { data = JSON.parse(body.toString("utf8") || "{}"); }
      catch { return jsonResponse(res, 400, {ok:false,error:"invalid_json"}); }
      const orders = Array.isArray(data.orders) ? data.orders : [];
      const items = Array.isArray(data.items) ? data.items : [];
      const deliveries = Array.isArray(data.deliveries) ? data.deliveries : [];
      const addresses = Array.isArray(data.addresses) ? data.addresses : [];
      if (orders.length > 100 || items.length > 500 || deliveries.length > 500 || addresses.length > 500 ||
          !orders.length || orders.some(x => !Number.isSafeInteger(Number(x.id)) || !x.trade_no || !Number.isSafeInteger(Number(x.user_id)))) {
        return jsonResponse(res, 400, {ok:false,error:"payload_validation_failed"});
      }
      if (items.some(x => !Number.isSafeInteger(Number(x.id)) || !x.trade_no) ||
          deliveries.some(x => !Number.isSafeInteger(Number(x.id)) || !x.trade_no) ||
          addresses.some(x => !Number.isSafeInteger(Number(x.id)) || !Number.isSafeInteger(Number(x.user_id)))) {
        return jsonResponse(res, 400, {ok:false,error:"child_payload_validation_failed"});
      }
      const orderByTrade = new Map(orders.map(x => [String(x.trade_no), Number(x.id)]));
      if (orderByTrade.size !== orders.length ||
          [...items, ...deliveries].some(x => !orderByTrade.has(String(x.trade_no)))) {
        return jsonResponse(res, 400, {ok:false,error:"orphan_or_duplicate_trade_no"});
      }
      if (!process.env.DELIVERY_ENCRYPTION_KEY || Buffer.from(process.env.DELIVERY_ENCRYPTION_KEY,"hex").length !== 32) {
        return jsonResponse(res, 503, {ok:false,error:"delivery_encryption_not_configured"});
      }
      try {
        const result = await database.begin(async tx => {
          const userMap = new Map();
          for (const sourceUserId of [...new Set([...orders.map(x=>Number(x.user_id)), ...addresses.map(x=>Number(x.user_id))])]) {
            const mapped = await tx.unsafe("SELECT public_user_id FROM qingtian_shop.account_identity_map WHERE qingtian_user_id=$1 AND mapping_method='exact_email' LIMIT 1",[sourceUserId]);
            if (!mapped.length) throw new Error("unmapped_source_user:" + sourceUserId);
            userMap.set(sourceUserId, String(mapped[0].public_user_id));
          }
          let orderCount=0, itemCount=0, deliveryCount=0, addressCount=0;
          for (const row of orders) {
            const publicUserId=userMap.get(Number(row.user_id));
            await tx.unsafe("INSERT INTO qingtian_shop.legacy_shop_orders(source_id,trade_no,source_user_id,public_user_id,total_amount,cost_amount,status,created_at,paid_at,shipped_at,finished_at,source_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT(source_id) DO UPDATE SET trade_no=EXCLUDED.trade_no,source_user_id=EXCLUDED.source_user_id,public_user_id=EXCLUDED.public_user_id,total_amount=EXCLUDED.total_amount,cost_amount=EXCLUDED.cost_amount,status=EXCLUDED.status,created_at=EXCLUDED.created_at,paid_at=EXCLUDED.paid_at,shipped_at=EXCLUDED.shipped_at,finished_at=EXCLUDED.finished_at,source_payload=EXCLUDED.source_payload",
              [Number(row.id),String(row.trade_no),Number(row.user_id),publicUserId,row.total_amount??null,row.cost_amount??null,row.status??null,row.created_at??null,row.paid_at??null,row.shipped_at??null,row.finished_at??null,JSON.stringify(row)]);
            orderCount++;
          }
          for (const row of items) {
            const clean={...row}; delete clean.delivery_content;
            const cipher=Buffer.from(encryptDelivery(JSON.stringify(row)),"base64");
            await tx.unsafe("INSERT INTO qingtian_shop.legacy_shop_order_items(source_id,trade_no,source_order_id,source_payload,encrypted_payload) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(source_id) DO UPDATE SET trade_no=EXCLUDED.trade_no,source_order_id=EXCLUDED.source_order_id,source_payload=EXCLUDED.source_payload,encrypted_payload=EXCLUDED.encrypted_payload",
              [Number(row.id),String(row.trade_no),orderByTrade.get(String(row.trade_no)),JSON.stringify(clean),cipher]);
            itemCount++;
          }
          for (const row of deliveries) {
            const cipher=Buffer.from(encryptDelivery(JSON.stringify(row)),"base64");
            await tx.unsafe("INSERT INTO qingtian_shop.legacy_order_deliveries(source_id,trade_no,source_order_id,encrypted_payload) VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET trade_no=EXCLUDED.trade_no,source_order_id=EXCLUDED.source_order_id,encrypted_payload=EXCLUDED.encrypted_payload",
              [Number(row.id),String(row.trade_no),orderByTrade.get(String(row.trade_no)),cipher]);
            deliveryCount++;
          }
          for (const row of addresses) {
            // Addresses contain personal contact/location data: encrypt the complete source row.
            const cipher=Buffer.from(encryptDelivery(JSON.stringify(row)),"base64");
            await tx.unsafe("INSERT INTO qingtian_shop.legacy_shop_addresses(source_id,source_user_id,public_user_id,source_payload,encrypted_payload) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(source_id) DO UPDATE SET source_user_id=EXCLUDED.source_user_id,public_user_id=EXCLUDED.public_user_id,source_payload=EXCLUDED.source_payload,encrypted_payload=EXCLUDED.encrypted_payload",
              [Number(row.id),Number(row.user_id),userMap.get(Number(row.user_id)),JSON.stringify({encrypted:true,encryption_alg:"AES-256-GCM"}),cipher]);
            addressCount++;
          }
          return {orders:orderCount,items:itemCount,deliveries:deliveryCount,addresses:addressCount};
        });
        return jsonResponse(res,200,{ok:true,migrated:result});
      } catch (error) {
        const message=String(error?.message||"migration_failed");
        return jsonResponse(res,409,{ok:false,error:message.startsWith("unmapped_source_user:")?message:"migration_transaction_failed"});
      }
    }

    if (url.pathname === "/api/storefront" && (method === "GET" || method === "HEAD")) return await renderStorefront(res);
    if (await qingtianShopApi(method, url, headers, rawBody, res)) return;
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
