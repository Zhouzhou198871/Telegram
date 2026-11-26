"use strict";
const TOKEN_KEY = "qingtian_shop_token";
const API_BASE = "https://api.lynli.me";
const $ = id => document.getElementById(id);
const state = { all: [], filter: "all", loading: false };
const TEXT = {
 title:"订单详情", subtitle:"查看你的商品订单、付款状态、发货进度与已交付卡密。",
 home:"首页", myAccount:"我的账户", loading:"正在读取订单…", empty:"当前账户暂无商品订单。",
 loadFailed:"订单读取失败，请稍后重试。", partial:"订单列表暂时不完整，请稍后重试。",
 all:"全部订单", goods:"商品订单",
 goodsType:"商品订单", orderNo:"订单号", created:"创建时间", updated:"更新时间",
 amount:"订单金额", product:"商品", quantity:"数量", unitPrice:"单价", method:"支付方式",
 paidAt:"付款时间", shippedAt:"发货时间", tracking:"物流单号", carrier:"物流公司",
 receiver:"收件人", phone:"联系电话", address:"收货地址", remark:"订单备注",
 pending:"待付款", paid:"已付款·待发货", shipped:"已发货", completed:"已完成",
 closed:"已退款", cancelled:"已取消", unknown:"状态待核实",
 details:"查看订单详情", hide:"收起详情", loadingDetail:"正在读取订单详情…",
 delivery:"交付内容", copy:"复制", copied:"已复制", deliveryEmpty:"暂无可展示的交付内容。",
 deliveryError:"订单详情读取失败，请稍后重试。", unauthorized:"登录状态已失效，请重新登录。",
 paymentMethodAlipay:"支付宝", paymentMethodWechat:"微信支付", paymentMethodUsdt:"USDT",
 copyFailed:"复制失败，请手动复制。", noDeliveryPending:"订单已付款，等待发货。", noDelivery:"暂无交付内容。", typeLabel:"订单类型",
 notAvailable:"—"
};
const t = key => TEXT[key] || key;
const money = value => "¥" + (Number(value || 0)).toFixed(2);
const date = value => value ? new Date(Number(value) * 1000).toLocaleString("zh-CN",{hour12:false}) : t("notAvailable");
async function api(path) {
 const response = await fetch(API_BASE + path, {
  headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")},
  cache:"no-store"
 });
 let data={}; try { data=await response.json(); } catch {}
 // 后端统一把业务错误包装成 HTTP 200，真实状态放在 http_status 中。
 if(response.status===401 || Number(data.http_status)===401 || data.message==="unauth" || data.message==="登录已过期"){
  localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw new Error("unauthorized");
 }
 if(!response.ok || data.status==="fail" || data.code===0) throw new Error(data.message||data.msg||"request_failed");
 return data;
}
function make(tag, cls, value) {
 const el=document.createElement(tag); if(cls)el.className=cls;
 if(value!==undefined)el.textContent=String(value); return el;
}
function addInfo(parent,label,value) {
 const row=make("div","order-detail-row");
 row.append(make("span","order-detail-label",label),make("span","order-detail-value",value||t("notAvailable")));
 parent.append(row);
}
function statusLabel(order) {
 const status=String(order.status||"unknown").toLowerCase();
 return t(status in TEXT ? status : "unknown");
}
function paymentMethod(value) {
 const map={alipay:t("paymentMethodAlipay"),wechat:t("paymentMethodWechat"),usdt:t("paymentMethodUsdt"),USDT_TRC20:t("paymentMethodUsdt")};
 return map[value]||value||t("notAvailable");
}
function deliveryPanel(parent,order) {
 const section=make("section","order-delivery-section");
 section.append(make("strong","order-detail-section-title",t("delivery")));
 const content=String(order.delivery_content||"").trim();
 if(order.delivery_available && content) {
  const pre=make("pre","order-delivery-content",content);
  const button=make("button","detail-action",t("copy"));button.type="button";
  button.addEventListener("click",async()=>{
   try{await navigator.clipboard.writeText(content);button.textContent=t("copied");}
   catch{button.textContent=t("copyFailed");}
  });
  section.append(pre,button);
 } else {
  const msg=order.status==="paid"?t("noDeliveryPending"):t("noDelivery");
  section.append(make("p","order-detail-muted",msg));
 }
 parent.append(section);
}
function detailPanel(order) {
 const panel=make("section","order-detail-panel");
 panel.append(make("p","order-detail-muted",t("loadingDetail")));
 return panel;
}
function renderDetail(panel,order) {
 panel.replaceChildren();
 addInfo(panel,t("typeLabel"),t("goodsType"));
 addInfo(panel,t("orderNo"),order.trade_no);
 addInfo(panel,t("created"),date(order.created_at));
 addInfo(panel,t("updated"),date(order.updated_at));
 addInfo(panel,t("amount"),money(order.total_amount??order.amount));
 addInfo(panel,t("method"),paymentMethod(order.pay_method));
 if(order.paid_at)addInfo(panel,t("paidAt"),date(order.paid_at));
 if(order.shipped_at)addInfo(panel,t("shippedAt"),date(order.shipped_at));
 const items=Array.isArray(order.items)?order.items:[];
 items.forEach(item=>{
  addInfo(panel,t("product"),item.title||order.product_name||"");
  addInfo(panel,t("quantity"),String(item.qty||1));
  addInfo(panel,t("unitPrice"),money(item.price));
 });
 if(order.receiver)addInfo(panel,t("receiver"),order.receiver);
 if(order.phone)addInfo(panel,t("phone"),order.phone);
 if(order.address)addInfo(panel,t("address"),order.address);
 if(order.tracking_company)addInfo(panel,t("carrier"),order.tracking_company);
 if(order.tracking_no)addInfo(panel,t("tracking"),order.tracking_no);
 if(order.remark)addInfo(panel,t("remark"),order.remark);
 deliveryPanel(panel,order);
}
async function load() {
 if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return;}
 state.loading=true;
 $("ordersList").replaceChildren(make("div","orders-state",t("loading")));
 try {
  const result=await api("/api/v1/user/orders?page=1&limit=100");
  const rows=Array.isArray(result.data)?result.data:[];
  state.all=rows.map(order=>({...order,kind:"goods",id:String(order.trade_no||order.id||"")}));
  state.loading=false;
  render();
 } catch(error) {
  state.loading=false;
  $("ordersList").replaceChildren(make("div","orders-state",error.message==="unauthorized"?t("unauthorized"):t("loadFailed")));
 }
}
function render() {
 const root=$("ordersList");root.replaceChildren();
 const list=state.all.filter(order=>state.filter==="all"||order.kind===state.filter);
 $("ordersCount").textContent=String(list.length);
 if(!list.length){root.append(make("div","orders-state",t("empty")));return;}
 for(const order of list) {
  const card=make("article","order-card");
  const top=make("div","order-top");
  const left=make("div","order-heading");
  left.append(make("span","order-kind",t("goodsType")),make("h2","order-name",order.product_name||order.title||t("goodsType")));
  const status=String(order.status||"unknown").toLowerCase();
  top.append(left,make("span","order-status status-"+status,statusLabel(order)));
  const meta=make("div","order-meta",t("orderNo")+"："+(order.trade_no||"—")+"\n"+t("created")+"："+date(order.created_at));
  const bottom=make("div","order-bottom");
  bottom.append(make("strong","order-price",money(order.total_amount??order.amount)));
  const toggle=make("button","detail-toggle",t("details"));toggle.type="button";
  const panel=detailPanel(order);panel.hidden=true;
  toggle.addEventListener("click",async()=>{
   const opening=panel.hidden;panel.hidden=!opening;
   toggle.textContent=opening?t("hide"):t("details");
   if(opening&&!panel.dataset.loaded) {
    toggle.disabled=true;
    try {
     const result=await api("/api/v1/user/orders/detail?trade_no="+encodeURIComponent(order.trade_no));
     if(!result.data)throw new Error("not_found");
     renderDetail(panel,result.data);panel.dataset.loaded="1";
    } catch(error) {
     panel.replaceChildren(make("p","order-detail-muted",error.message==="unauthorized"?t("unauthorized"):t("deliveryError")));
    } finally {toggle.disabled=false;}
   }
  });
  bottom.append(toggle);card.append(top,meta,bottom,panel);root.append(card);
 }
}
function applyLanguage() {
 document.documentElement.lang="zh-CN";
 document.querySelectorAll("[data-i18n]").forEach(el=>{const key=el.dataset.i18n;if(TEXT[key])el.textContent=t(key);});
 document.querySelectorAll("[data-filter]").forEach(btn=>{btn.textContent=t(btn.dataset.filter==="all"?"all":btn.dataset.filter);btn.classList.toggle("active",btn.dataset.filter===state.filter);});
 $("ordersTitle").textContent=t("title");$("ordersSubtitle").textContent=t("subtitle");
}
document.querySelectorAll("[data-filter]").forEach(btn=>btn.addEventListener("click",()=>{state.filter=btn.dataset.filter;applyLanguage();render();}));
applyLanguage();load();
