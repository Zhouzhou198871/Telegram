"use strict";
const TOKEN_KEY="qingtian_shop_token";
const $=id=>document.getElementById(id);
const state={rows:[],loading:false};
const labels={pending:"待发货",reserved:"处理中",delivered:"已发货",refunded:"已退款",failed:"失败"};
const money=v=>"¥"+Number(v||0).toFixed(2);
const date=v=>v?new Date(Number(v)*1000).toLocaleString("zh-CN",{hour12:false}):"—";
function node(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e;}
async function api(path){
 const r=await fetch(path,{headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")},cache:"no-store"});
 let d={};try{d=await r.json()}catch{}
 if(r.status===401||["auth_required","invalid_token","token_expired","token_revoked"].includes(d.error)){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw Error("unauthorized")}
 if(!r.ok||d.ok===false)throw Error(d.error||"request_failed");
 return d;
}
function status(o){return labels[String(o.status||"").toLowerCase()]||"状态待核实";}
function render(){
 const root=$("ordersList");root.replaceChildren();
 $("ordersCount").textContent=String(state.rows.length);
 if(!state.rows.length){root.append(node("div","orders-state","当前 Neon 账户暂无商品订单"));$("ordersPagination").replaceChildren();return;}
 for(const o of state.rows){
  const card=node("article","order-card"),head=node("div","order-card-head");
  const title=node("a","order-product-title",o.product_name||"数字商品");
  title.href="./order-detail.html?trade_no="+encodeURIComponent(o.order_id);
  head.append(title,node("span","order-status status-"+String(o.status||"unknown"),status(o)));
  const created=node("div","order-created",date(o.created_at)),body=node("div","order-card-body");
  const left=node("div","order-fields");
  const fields=[["订单号",o.order_id],["支付状态","已扣账户余额"],["发货状态",status(o)],["支付方式","账户余额"],["购买数量","1"]];
  for(const [k,v] of fields){const row=node("div","order-field");row.append(node("span","order-field-label",k+"："),node("strong","order-field-value",v));left.append(row);}
  const right=node("div","order-card-right");right.append(node("span","order-amount-label","订单金额"),node("strong","order-amount",money(o.amount_cny)));
  const btn=node("a","order-view-button","查看详情");btn.href=title.href;right.append(btn);
  body.append(left,right);card.append(head,created,body);root.append(card);
 }
 $("ordersPagination").replaceChildren();
}
async function load(){
 if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return;}
 if(state.loading)return;state.loading=true;
 $("ordersList").replaceChildren(node("div","orders-state","正在读取 Neon 订单…"));
 try{const d=await api("/api/user/orders");state.rows=Array.isArray(d.orders)?d.orders:[];render();}
 catch(e){$("ordersList").replaceChildren(node("div","orders-state",e.message==="unauthorized"?"登录已失效，请重新登录":"订单读取失败，请稍后刷新"));}
 finally{state.loading=false;}
}
load();
