"use strict";
const TOKEN_KEY = "qingtian_shop_token";
const $ = id => document.getElementById(id);
const state = { all: [], filter: "all", loading: false };
const I18N = {
 zh: {
  title:"订单详情", subtitle:"集中查看账号商品购买和账户充值订单。订单状态与交付信息来自你的账户记录。",
  backShop:"返回商城", home:"首页", myAccount:"我的账户", loading:"正在读取订单…", empty:"当前账户暂无订单记录。",
  loadFailed:"订单读取失败，请刷新重试。", partial:"部分订单暂时无法读取，已展示成功读取的记录。",
  all:"全部", goods:"商品订单", recharge:"充值订单", refresh:"刷新订单",
  goodsType:"商品订单", rechargeType:"充值订单", orderNo:"订单号", created:"创建时间", updated:"更新时间",
  amount:"订单金额", product:"商品", package:"套餐", method:"支付方式", paidAt:"入账时间",
  pending:"处理中", reserved:"处理中", delivered:"已交付", refunded:"已退款", failed:"失败", paid:"已入账", unknown:"状态待核实",
  details:"订单详情", hide:"收起详情", checkDelivery:"查询交付状态", checking:"正在查询…", delivery:"交付信息",
  noDelivery:"暂未返回交付内容；订单可能仍在处理中。", deliveryError:"交付状态查询失败，请稍后重试。",
  protocol:"协议", connection:"连接链接", clash:"Clash 配置", instructions:"使用说明", copy:"复制", copied:"已复制",
  paymentPending:"充值订单尚未入账。请联系官方客服获取当前有效收款方式，并提交订单号核验。", paymentPaid:"该充值订单已入账。",
  paymentMethodUsdt:"USDT（TRC20）", typeLabel:"订单类型", loadTime:"最近更新",
  unauthorized:"登录状态已失效，请重新登录。"
 },
 en: {
  title:"Order details", subtitle:"View account product purchases and account top-ups in one place.",
  backShop:"Back to store", home:"Home", myAccount:"My account", loading:"Loading orders…", empty:"No orders found for this account.",
  loadFailed:"Could not load orders. Refresh and try again.", partial:"Some order records could not be loaded. Successfully retrieved records are shown.",
  all:"All", goods:"Products", recharge:"Top-ups", refresh:"Refresh",
  goodsType:"Product order", rechargeType:"Top-up order", orderNo:"Order ID", created:"Created", updated:"Updated",
  amount:"Amount", product:"Product", package:"Plan", method:"Payment method", paidAt:"Credited at",
  pending:"Processing", reserved:"Processing", delivered:"Delivered", refunded:"Refunded", failed:"Failed", paid:"Credited", unknown:"Status unavailable",
  details:"Order details", hide:"Hide details", checkDelivery:"Check delivery", checking:"Checking…", delivery:"Delivery",
  noDelivery:"Delivery content is not available yet. The order may still be processing.", deliveryError:"Could not check delivery status. Try again later.",
  protocol:"Protocol", connection:"Connection link", clash:"Clash config", instructions:"Instructions", copy:"Copy", copied:"Copied",
  paymentPending:"This top-up has not been credited. Contact official support for the current payment instructions and provide the order ID.",
  paymentPaid:"This top-up has been credited.", paymentMethodUsdt:"USDT (TRC20)", typeLabel:"Order type", loadTime:"Last updated",
  unauthorized:"Your session has expired. Please sign in again."
 }
};
const lang = () => localStorage.getItem("qingtian_shop_language") === "en" ? "en" : "zh";
const t = key => I18N[lang()][key] || key;
const money = value => "¥" + (Number(value || 0)).toFixed(2);
const date = value => value ? new Date(Number(value) * 1000).toLocaleString(lang()==="zh"?"zh-CN":"en-US") : "—";
async function api(path) {
 const response = await fetch(path, { headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")}, cache:"no-store" });
 let data={}; try { data=await response.json(); } catch {}
 if(response.status===401){ localStorage.removeItem(TOKEN_KEY); location.replace("./auth.html"); throw new Error("unauthorized"); }
 if(!response.ok) throw new Error(data.error || "request_failed");
 return data;
}
function statusLabel(status) {
 const value=String(status||"unknown").toLowerCase();
 return t(value in I18N[lang()] ? value : "unknown");
}
function make(tag, cls, value) {
 const el=document.createElement(tag); if(cls)el.className=cls;
 if(value!==undefined)el.textContent=String(value); return el;
}
function normalize(kind, order) {
 return {...order, kind, id:String(order.order_id||""), created_at:Number(order.created_at||0), updated_at:Number(order.updated_at||order.created_at||0)};
}
async function load() {
 if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return;}
 state.loading=true; $("ordersList").replaceChildren(make("div","orders-state",t("loading")));
 const requests=await Promise.allSettled([api("/api/user/orders"), api("/api/user/recharge-orders")]);
 const failed=requests.filter(x=>x.status==="rejected");
 const goods=requests[0].status==="fulfilled"?(requests[0].value.orders||[]).map(x=>normalize("goods",x)):[];
  const recharges=requests[1].status==="fulfilled"?(requests[1].value.orders||[]).map(x=>normalize("recharge",x)):[];
  state.all=[...goods,...recharges].sort((a,b)=>b.created_at-a.created_at);
  state.loading=false; render();
 if(failed.length===2){$("ordersList").replaceChildren(make("div","orders-state",t("loadFailed")));return;}
 if(failed.length){const note=make("p","orders-notice",t("partial"));$("ordersList").prepend(note);}
}
function addInfo(parent,label,value) {
 const row=make("div","order-detail-row");row.append(make("span","order-detail-label",label),make("span","order-detail-value",value||"—"));parent.append(row);
}
function addCopy(parent,label,value) {
 if(!value)return;
 const row=make("div","order-copy-row");const code=make("code","",value);const btn=make("button","copy-button",t("copy"));
 btn.type="button";btn.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(value);btn.textContent=t("copied");setTimeout(()=>btn.textContent=t("copy"),1500);}catch{btn.textContent=value;}});
 row.append(make("span","order-detail-label",label),code,btn);parent.append(row);
}
function renderDelivery(parent, delivery) {
 if(!delivery){parent.append(make("p","order-detail-muted",t("noDelivery")));return;}
 if(typeof delivery==="string"){parent.append(make("pre","order-delivery-content",delivery));return;}
 if(delivery.protocol)addInfo(parent,t("protocol"),delivery.protocol);
 if(delivery.uri)addCopy(parent,t("connection"),delivery.uri);
 if(delivery.http_uri)addCopy(parent,"HTTP",delivery.http_uri);
 if(delivery.clash_yaml)addCopy(parent,t("clash"),delivery.clash_yaml);
 if(delivery.instructions)addInfo(parent,t("instructions"),delivery.instructions);
 if(!delivery.uri&&!delivery.http_uri&&!delivery.clash_yaml)parent.append(make("pre","order-delivery-content",JSON.stringify(delivery,null,2)));
}
function detailPanel(order) {
 const panel=make("section","order-detail-panel");
 addInfo(panel,t("typeLabel"),order.kind==="goods"?t("goodsType"):t("rechargeType"));
 addInfo(panel,t("orderNo"),order.id);
 addInfo(panel,t("created"),date(order.created_at));
 addInfo(panel,t("updated"),date(order.updated_at));
 addInfo(panel,t("amount"),money(order.amount_cny));
 if(order.kind==="goods") {
  addInfo(panel,t("product"),order.product_name||order.product_id);
  const deliveryBox=make("div","order-delivery-section");deliveryBox.append(make("strong","order-detail-section-title",t("delivery")));
  const delivery=make("div","order-delivery-content");
  const refresh=make("button","detail-action",t("checkDelivery"));refresh.type="button";
  refresh.addEventListener("click",async()=>{refresh.disabled=true;refresh.textContent=t("checking");delivery.replaceChildren(make("p","order-detail-muted",t("loading")));try{const result=await api("/api/buy/"+encodeURIComponent(order.id));delivery.replaceChildren();if(result.content)renderDelivery(delivery,result.content);else delivery.append(make("p","order-detail-muted",result.message||t("noDelivery")));}catch{delivery.replaceChildren(make("p","order-detail-muted",t("deliveryError")));}finally{refresh.disabled=false;refresh.textContent=t("checkDelivery");}});
  deliveryBox.append(refresh,delivery);panel.append(deliveryBox);
  } else {
  addInfo(panel,t("method"),order.payment_method==="USDT_TRC20"?t("paymentMethodUsdt"):order.payment_method);
  if(order.paid_at)addInfo(panel,t("paidAt"),date(order.paid_at));
  panel.append(make("p","order-detail-muted",order.status==="paid"?t("paymentPaid"):t("paymentPending")));
 }
 return panel;
}
function render() {
 const root=$("ordersList");root.replaceChildren();
 const list=state.all.filter(o=>state.filter==="all"||o.kind===state.filter);
 $("ordersCount").textContent=String(list.length);
 if(!list.length){root.append(make("div","orders-state",t("empty")));return;}
 for(const order of list) {
  const card=make("article","order-card");
  const top=make("div","order-top");
  const left=make("div","order-heading");left.append(make("span","order-kind",order.kind==="goods"?t("goodsType"):t("rechargeType")),make("h2","order-name",order.kind==="goods"?(order.product_name||order.product_id):t("rechargeType")));
  const st=statusLabel(order.status);const badge=make("span","order-status status-"+String(order.status||"unknown"),st);top.append(left,badge);
  const meta=make("div","order-meta",t("orderNo")+"："+order.id+"\n"+t("created")+"："+date(order.created_at));
  const bottom=make("div","order-bottom");bottom.append(make("strong","order-price",money(order.amount_cny)));
  const toggle=make("button","detail-toggle",t("details"));toggle.type="button";
  const panel=detailPanel(order);panel.hidden=true;
  toggle.addEventListener("click",()=>{panel.hidden=!panel.hidden;toggle.textContent=panel.hidden?t("details"):t("hide");});
  bottom.append(toggle);card.append(top,meta,bottom,panel);root.append(card);
 }
}
function applyLanguage() {
 document.documentElement.lang=lang()==="zh"?"zh-CN":"en";
 document.querySelectorAll("[data-i18n]").forEach(el=>{const key=el.dataset.i18n;if(I18N[lang()][key])el.textContent=t(key);});
 $("languageToggle").textContent=lang()==="zh"?"English":"中文";
 document.querySelectorAll("[data-filter]").forEach(btn=>{btn.textContent=t(btn.dataset.filter==="all"?"all":btn.dataset.filter);btn.classList.toggle("active",btn.dataset.filter===state.filter);});
 $("ordersTitle").textContent=t("title");$("ordersSubtitle").textContent=t("subtitle");
}
document.querySelectorAll("[data-filter]").forEach(btn=>btn.addEventListener("click",()=>{state.filter=btn.dataset.filter;applyLanguage();render();}));
$("languageToggle").addEventListener("click",()=>{localStorage.setItem("qingtian_shop_language",lang()==="zh"?"en":"zh");applyLanguage();render();});
$("refreshOrders").addEventListener("click",load);
applyLanguage();load();
