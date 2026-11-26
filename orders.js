"use strict";
const TOKEN_KEY="qingtian_shop_token",API_BASE="https://api.lynli.me";
const $=id=>document.getElementById(id);
const state={rows:[],page:1,pageSize:10,total:0,loading:false};
const labels={pending:"待付款",paid:"已付款",shipped:"已发货",completed:"已完成",cancelled:"已取消",closed:"已关闭",refunded:"已退款",failed:"失败",unknown:"状态待核实"};
const money=v=>"¥"+Number(v||0).toFixed(2);
const date=v=>v?new Date(Number(v)*1000).toLocaleString("zh-CN",{hour12:false}):"—";
function node(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e;}
async function api(path){
 const r=await fetch(API_BASE+path,{headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")},cache:"no-store"});
 let d={};try{d=await r.json()}catch{}
 if(r.status===401||Number(d.http_status)===401||d.message==="unauth"){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw Error("unauthorized")}
 if(!r.ok||d.status==="fail"||d.code===0)throw Error(d.message||"request_failed");
 return d;
}
function status(o){const s=String(o.status||"unknown").toLowerCase();return labels[s]||o.status_text||labels.unknown;}
function statusClass(o){return "status-"+String(o.status||"unknown").toLowerCase();}
function render(){
 const root=$("ordersList");root.replaceChildren();
 $("ordersCount").textContent=String(state.total);
 if(!state.rows.length){root.append(node("div","orders-state","当前账户暂无商品订单"));$("ordersPagination").replaceChildren();return;}
 for(const o of state.rows){
  const card=node("article","order-card");
  const head=node("div","order-card-head");
  const title=node("a","order-product-title",o.product_name||o.title||(o.items&&o.items[0]&&o.items[0].title)||"商品订单");
  title.href="./order-detail.html?trade_no="+encodeURIComponent(o.trade_no||"");
  head.append(title,node("span","order-status "+statusClass(o),status(o)));
  const created=node("div","order-created",date(o.created_at));
  const body=node("div","order-card-body");
  const left=node("div","order-fields");
  const fields=[
   ["订单号",o.trade_no||"—"],["支付状态",o.pay_status_text||((Number(o.status_code)>=1)?"已支付":"待支付")],
   ["发货状态",o.ship_status_text||status(o)],["支付方式",o.pay_method||"余额"],["购买数量",String(o.item_count||((o.items||[]).reduce((n,x)=>n+Number(x.qty||1),0))||1)]
  ];
  for(const [k,v] of fields){const row=node("div","order-field");row.append(node("span","order-field-label",k+"："),node("strong","order-field-value",v));left.append(row);}
  const right=node("div","order-card-right");right.append(node("span","order-amount-label","订单金额"),node("strong","order-amount",money(o.total_amount??o.amount)));
  const btn=node("a","order-view-button","查看详情");btn.href="./order-detail.html?trade_no="+encodeURIComponent(o.trade_no||"");right.append(btn);
  body.append(left,right);card.append(head,created,body);root.append(card);
 }
 renderPagination();
}
function renderPagination(){
 const root=$("ordersPagination");root.replaceChildren();
 const pages=Math.max(1,Math.ceil(state.total/state.pageSize));if(pages<=1)return;
 const add=(label,page,disabled=false,active=false)=>{const b=node("button","page-button"+(active?" active":""),label);b.disabled=disabled;b.addEventListener("click",()=>{if(page!==state.page){state.page=page;load()}});root.append(b)};
 add("‹",Math.max(1,state.page-1),state.page===1);
 let nums=[];if(pages<=8){for(let i=1;i<=pages;i++)nums.push(i)}else{nums=[1,2,3,4,5,6,"…",pages];if(state.page>5&&state.page<pages-2)nums=[1,"…",state.page-1,state.page,state.page+1,"…",pages]}
 for(const n of nums){if(n==="…"){root.append(node("span","page-ellipsis","…"));continue}add(String(n),n,false,n===state.page)}
 add("›",Math.min(pages,state.page+1),state.page===pages);
 const total=node("span","page-total","Total "+state.total);root.prepend(total);
}
async function load(){
 if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return}
 $("ordersList").replaceChildren(node("div","orders-state","正在读取全部订单…"));
 try{const d=await api("/api/v1/user/orders?page="+state.page+"&limit="+state.pageSize);state.rows=Array.isArray(d.data)?d.data:[];state.total=Number(d.total??d.count??state.rows.length);render()}
 catch(e){$("ordersList").replaceChildren(node("div","orders-state",e.message==="unauthorized"?"登录已失效，请重新登录":"订单读取失败，请稍后刷新"))}
}
load();
