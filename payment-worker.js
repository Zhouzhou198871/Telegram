import postgres from "postgres";

const enc = new TextEncoder();
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const pem = value => {
  const s = String(value || "").replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  if (!s) throw new Error("alipay_key_not_configured");
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
const canonical = p => Object.keys(p).filter(k => k !== "sign" && k !== "sign_type" && p[k] !== "" && p[k] != null).sort().map(k => k + "=" + p[k]).join("&");
const b64 = bytes => { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
async function sign(env, p) {
  const key = await crypto.subtle.importKey("pkcs8", pem(env.ALIPAY_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(canonical(p))));
}
async function verify(env, p) {
  if (!p.sign) return false;
  const key = await crypto.subtle.importKey("spki", pem(env.ALIPAY_PUBLIC_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Uint8Array.from(atob(p.sign), c => c.charCodeAt(0)), enc.encode(canonical(p)));
}
const db = env => {
  if (!env.HYPERDRIVE?.connectionString) throw new Error("database_not_configured");
  return postgres(env.HYPERDRIVE.connectionString, { max: 3, fetch_types: false, prepare: false });
};
const apiAuth = (req, env) => {
  const expected = String(env.QINGTIANPAY_API_KEY || "");
  return !!expected && String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") === expected;
};
const money = v => /^\d{1,12}(?:\.\d{1,2})?$/.test(String(v)) && Number(v) > 0 ? Number(v).toFixed(2) : null;
async function schema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS qingtianpay_provider_orders (
    order_no TEXT PRIMARY KEY, external_order_no TEXT NOT NULL UNIQUE,
    amount NUMERIC(12,2) NOT NULL, subject TEXT NOT NULL, buyer_ref TEXT,
    status TEXT NOT NULL DEFAULT 'pending', checkout_url TEXT NOT NULL,
    trade_no TEXT, created_at BIGINT NOT NULL, paid_at BIGINT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_qingtianpay_provider_orders_status ON qingtianpay_provider_orders(status,created_at)`;
}
async function create(req, env) {
  if (!apiAuth(req, env)) return json({ ok:false,error:"unauthorized" },401);
  if (!env.ALIPAY_APP_ID || !env.ALIPAY_PRIVATE_KEY || !env.ALIPAY_PUBLIC_KEY || !env.ALIPAY_NOTIFY_URL) return json({ok:false,error:"alipay_not_configured"},503);
  let b; try { b=await req.json(); } catch { return json({ok:false,error:"invalid_json"},400); }
  const external=String(b.external_order_no||"").trim(), price=money(b.amount), subject=String(b.subject||"晴天号铺账户充值").slice(0,128);
  if (!external || external.length>64 || !price) return json({ok:false,error:"invalid_payment_request"},400);
  const sql=db(env);
  try {
    await schema(sql);
    const old=await sql`SELECT order_no,checkout_url,status,amount FROM qingtianpay_provider_orders WHERE external_order_no=${external} LIMIT 1`;
    if(old.length) {
      if(Number(old[0].amount).toFixed(2)!==price) return json({ok:false,error:"order_amount_conflict"},409);
      return json({ok:true,order:{order_no:old[0].order_no,checkout_url:old[0].checkout_url,status:old[0].status}});
    }
    const orderNo="QT"+Date.now()+crypto.randomUUID().replace(/-/g,"").slice(0,10).toUpperCase();
    const p={app_id:String(env.ALIPAY_APP_ID),method:"alipay.trade.wap.pay",format:"JSON",charset:"utf-8",sign_type:"RSA2",timestamp:new Date().toISOString().replace("T"," ").slice(0,19),version:"1.0",notify_url:String(env.ALIPAY_NOTIFY_URL),biz_content:JSON.stringify({out_trade_no:orderNo,total_amount:price,subject,product_code:"QUICK_WAP_WAY",passback_params:btoa(external)})};
    p.sign=await sign(env,p);
    const u=new URL(env.ALIPAY_GATEWAY||"https://openapi.alipay.com/gateway.do");
    for(const [k,v] of Object.entries(p)) u.searchParams.set(k,v);
    const now=Math.floor(Date.now()/1000);
    await sql`INSERT INTO qingtianpay_provider_orders(order_no,external_order_no,amount,subject,buyer_ref,status,checkout_url,created_at) VALUES(${orderNo},${external},${price},${subject},${String(b.buyer_ref||"")},'pending',${u.toString()},${now})`;
    return json({ok:true,order:{order_no:orderNo,checkout_url:u.toString(),status:"pending"}},201);
  } catch(e) { console.error("payment_create_error",String(e?.message||e)); return json({ok:false,error:"payment_create_failed"},500); }
  finally { await sql.end(); }
}
async function getOrder(req,env,no) {
  if(!apiAuth(req,env)) return json({ok:false,error:"unauthorized"},401);
  const sql=db(env);
  try {
    await schema(sql);
    const r=await sql`SELECT order_no,external_order_no,amount,status,trade_no,created_at,paid_at FROM qingtianpay_provider_orders WHERE order_no=${no} LIMIT 1`;
    if(!r.length) return json({ok:false,error:"order_not_found"},404);
    const x=r[0]; return json({ok:true,order:{order_no:x.order_no,external_order_no:x.external_order_no,amount:Number(x.amount).toFixed(2),status:x.status,trade_no:x.trade_no,created_at:Number(x.created_at),paid_at:x.paid_at?Number(x.paid_at):null}});
  } catch(e) { console.error("payment_status_error",String(e?.message||e)); return json({ok:false,error:"payment_status_failed"},500); }
  finally { await sql.end(); }
}
async function notify(req,env) {
  const form=await req.formData(), p={}; for(const [k,v] of form.entries()) p[k]=String(v);
  try {
    if(!await verify(env,p) || String(p.app_id||"")!==String(env.ALIPAY_APP_ID||"")) return new Response("fail",{status:400});
    if(!["TRADE_SUCCESS","TRADE_FINISHED"].includes(String(p.trade_status||""))) return new Response("success");
    const no=String(p.out_trade_no||""), trade=String(p.trade_no||""), price=money(p.total_amount);
    if(!no||!trade||!price) return new Response("fail",{status:400});
    const sql=db(env);
    try {
      await schema(sql);
      await sql.begin(async tx=>{
        const rows=await tx`SELECT amount,status FROM qingtianpay_provider_orders WHERE order_no=${no} FOR UPDATE`;
        if(!rows.length || Number(rows[0].amount).toFixed(2)!==price) throw new Error("notify_order_mismatch");
        await tx`UPDATE qingtianpay_provider_orders SET status='paid',trade_no=${trade},paid_at=${Math.floor(Date.now()/1000)} WHERE order_no=${no} AND status='pending'`;
      });
    } finally { await sql.end(); }
    return new Response("success");
  } catch(e) { console.error("alipay_notify_error",String(e?.message||e)); return new Response("fail",{status:500}); }
}
export default { async fetch(req,env) {
  const u=new URL(req.url);
  if(req.method==="OPTIONS") return new Response(null,{status:204});
  if(u.pathname==="/health") return json({ok:true,service:"qingtianpay-cloudflare"});
  if(u.pathname==="/api/v1/payments"&&req.method==="POST") return create(req,env);
  if(u.pathname==="/api/alipay/notify"&&req.method==="POST") return notify(req,env);
  const m=u.pathname.match(/^\/api\/v1\/orders\/([A-Za-z0-9_-]+)$/);
  if(m&&req.method==="GET") return getOrder(req,env,decodeURIComponent(m[1]));
  return json({ok:false,error:"not_found"},404);
} };
