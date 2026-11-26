(() => {
 const TOKEN_KEY="qingtian_shop_token";
 const $=id=>document.getElementById(id);
 const money=v=>"¥"+Number(v||0).toFixed(2);
 const date=v=>v?new Date(Number(v)*1000).toLocaleString("zh-CN",{hour12:false}):"—";
 async function api(path){
  const r=await fetch(path,{cache:"no-store",headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")}});
  const d=await r.json().catch(()=>({}));
  if(r.status===401||["invalid_token","token_expired","token_revoked"].includes(d.error)){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw new Error("auth");}
  if(!r.ok)throw new Error(d.error||"request_failed");return d;
 }
 function row(order,type){
  const wrap=document.createElement("div");wrap.className="wb-order";
  const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("small"),amount=document.createElement("b");
  name.textContent=type==="goods"?(order.product_name||order.product_id||"账号商品"):"账户充值";
  meta.textContent=(order.order_id||"")+" · "+date(order.created_at);
  amount.textContent=money(order.amount_cny);
  info.append(name,meta);wrap.append(info,amount);return wrap;
 }
 async function init(){
  if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return;}
  const box=$("wbRecentOrders");
  const results=await Promise.allSettled([api("/api/user/info"),api("/api/user/orders"),api("/api/user/recharge-orders")]);
  if(results[0].status==="fulfilled")$("wbBalance").textContent=money(results[0].value.user?.balance_cny);
  else $("wbBalance").textContent="暂不可用";
  const goods=results[1].status==="fulfilled"?(results[1].value.orders||[]):[];
  const recharge=results[2].status==="fulfilled"?(results[2].value.orders||[]):[];
  $("wbGoodsCount").textContent=String(goods.length);
  $("wbRechargeCount").textContent=String(recharge.length);
  const all=[...goods.map(x=>({...x,_type:"goods"})),...recharge.map(x=>({...x,_type:"recharge"}))].sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0)).slice(0,6);
  box.replaceChildren();
  if(!all.length){box.textContent=results.slice(1).every(x=>x.status==="fulfilled")?"暂时没有订单记录。":"订单数据暂时无法读取，请稍后重试。";box.className="wb-state";return;}
  box.className="";
  all.forEach(x=>box.append(row(x,x._type)));
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();