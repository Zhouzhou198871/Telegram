"use strict";
const TOKEN_KEY="qingtian_shop_token";
const $=id=>document.getElementById(id);
const q=new URLSearchParams(location.search),orderId=q.get("trade_no")||"";
const money=v=>"¥"+Number(v||0).toFixed(2);
const date=v=>v?new Date(Number(v)*1000).toLocaleString("zh-CN",{hour12:false}):"—";
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
async function api(path){
 const r=await fetch(path,{headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")},cache:"no-store"});
 const d=await r.json().catch(()=>({}));
 if(r.status===401||["auth_required","invalid_token","token_expired","token_revoked"].includes(d.error)){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw Error("unauthorized");}
 if(!r.ok||d.ok===false)throw Error(d.error||"request_failed");
 return d;
}
function row(parent,label,value){const r=el("div","detail-row");r.append(el("span","detail-label",label),el("strong","detail-value",value||"—"));parent.append(r);}
function copyButton(text,label="复制卡密"){const b=el("button","blue-button",label);b.type="button";b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.textContent="已复制"}catch{b.textContent="复制失败"}};return b;}
function section(title,icon){const s=el("section","detail-section");s.append(el("h2","detail-section-head",icon+" "+title));return s;}
function render(order,delivery){
 $("detailLoading").remove();
 const basic=section("基本信息","ⓘ"),b=el("div","detail-section-body");
 row(b,"商品名称",order.product_name||"数字商品");
 const no=el("div","detail-row");no.append(el("span","detail-label","订单号"));no.append(el("code","detail-number",order.order_id||orderId),copyButton(order.order_id||orderId,"复制"));b.append(no);
 row(b,"创建时间",date(order.created_at));row(b,"更新时间",date(order.updated_at));basic.append(b);$("detailContent").append(basic);
 const stat=section("订单状态","◷"),sb=el("div","detail-section-body");
 const status=String(delivery.status||order.status||"pending");
 const statusLabel=({pending:"处理中",reserved:"已扣款，等待发货",delivered:"已发货",refunded:"已退款",failed:"失败"})[status]||"状态待核实";
 row(sb,"支付状态",status==="refunded"?"已退款":"已扣账户余额");row(sb,"发货状态",statusLabel);row(sb,"支付方式","账户余额");
 row(sb,"付款金额",money(order.amount_cny));stat.append(sb);$("detailContent").append(stat);
 const creds=section("卡密信息","♙"),cb=el("div","detail-section-body");
 const content=String(delivery.content||"").trim();
 if(content){const wrap=el("div","credential-card");wrap.append(el("strong","credential-title","商品交付内容"),el("pre","credential-content",content),copyButton(content));cb.append(wrap);}
 else cb.append(el("p","detail-muted",status==="refunded"?"该订单已退款。":status==="delivered"?"订单已发货，但暂无可显示的交付内容。":"订单尚未完成发货，稍后刷新即可查询。"));
 creds.append(cb);$("detailContent").append(creds);
 $("downloadOrder").onclick=()=>{const lines=["订单号："+orderId,"商品："+(order.product_name||"数字商品"),"金额："+money(order.amount_cny),"状态："+statusLabel];if(content)lines.push("\n交付内容\n"+content);const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="订单-"+orderId+".txt";a.click();URL.revokeObjectURL(a.href);};
}
(async()=>{
 if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return;}
 if(!orderId){$("detailLoading").textContent="缺少订单号";return;}
 try{
  const delivery=await api("/api/buy/"+encodeURIComponent(orderId));
  if(String(delivery.order_id||"")!==orderId)throw Error("order_not_found");
  render(delivery,delivery);
 }catch(e){$("detailLoading").textContent=e.message==="unauthorized"?"登录已失效，请重新登录":e.message==="order_not_found"?"订单不存在或不属于当前账户":"订单详情读取失败，请刷新重试";}
})();
