"use strict";
const TOKEN_KEY="qingtian_shop_token",API_BASE="https://api.lynli.me";
const $=id=>document.getElementById(id);
const q=new URLSearchParams(location.search),tradeNo=q.get("trade_no")||"";
const money=v=>"¥"+Number(v||0).toFixed(2);
const date=v=>v?new Date(Number(v)*1000).toLocaleString("zh-CN",{hour12:false}):"—";
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;}
async function api(){
 const r=await fetch(API_BASE+"/api/v1/user/orders/detail?trade_no="+encodeURIComponent(tradeNo),{headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||"")},cache:"no-store"});
 let d={};try{d=await r.json()}catch{}
 if(r.status===401||Number(d.http_status)===401||d.message==="unauth"){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw Error("unauthorized")}
 if(!r.ok||d.status==="fail"||d.code===0)throw Error(d.message||"request_failed");
 return d.data;
}
function row(parent,label,value){const r=el("div","detail-row");r.append(el("span","detail-label",label),el("strong","detail-value",value||"—"));parent.append(r);}
function copyButton(text,label="复制卡密"){const b=el("button","blue-button",label);b.type="button";b.onclick=async()=>{try{await navigator.clipboard.writeText(text);b.textContent="已复制"}catch{b.textContent="复制失败"}};return b;}
function section(title,icon){const s=el("section","detail-section");const h=el("h2","detail-section-head",icon+" "+title);s.append(h);return s;}
function render(o){
 $("detailTitle").textContent="订单详情";$("detailLoading").remove();
 const basic=section("基本信息","ⓘ"),b=el("div","detail-section-body");
 row(b,"商品名称",(o.items||[]).map(x=>x.title).filter(Boolean).join("、")||o.product_name);
 const no=el("div","detail-row");no.append(el("span","detail-label","订单号"));const nv=el("code","detail-number",o.trade_no||tradeNo);no.append(nv,copyButton(o.trade_no||tradeNo,"复制"));b.append(no);
 row(b,"创建时间",date(o.created_at));row(b,"更新时间",date(o.updated_at));basic.append(b);$("detailContent").append(basic);
 const stat=section("订单状态","◷"),sb=el("div","detail-section-body");
 row(sb,"支付状态",o.paid_at||Number(o.status_code)>=1?"已支付":"待支付");
 row(sb,"发货状态",o.status_text||({shipped:"已发货",completed:"已完成",paid:"待发货",cancelled:"已取消"}[o.status]||"处理中"));
 row(sb,"支付方式",o.pay_method||"余额");if(o.paid_at)row(sb,"付款时间",date(o.paid_at));if(o.shipped_at)row(sb,"发货时间",date(o.shipped_at));stat.append(sb);$("detailContent").append(stat);
 const amount=section("金额信息","▣"),ab=el("div","detail-section-body");
 const items=Array.isArray(o.items)?o.items:[];items.forEach((it,i)=>{row(ab,"商品"+(i+1)+" 单价",money(it.price));row(ab,"商品"+(i+1)+" 数量",String(it.qty||1));});
 row(ab,"总金额",money(o.total_amount??o.amount));amount.append(ab);$("detailContent").append(amount);
 const delivered=Number(o.status_code)===2||Number(o.status_code)===3||["shipped","completed","delivered"].includes(String(o.status||"").toLowerCase());
 const creds=section("卡密信息","♙"),cb=el("div","detail-section-body");
 let count=0;
 for(const [i,it] of items.entries()){
  const value=String(it.delivery_content||"").trim();if(!value)continue;count++;
  const wrap=el("div","credential-card");wrap.append(el("strong","credential-title",(it.title||"商品")+" · 卡密 "+count));
  const pre=el("pre","credential-content",value);wrap.append(pre,copyButton(value));cb.append(wrap);
 }
 if(!count&&delivered&&Array.isArray(o.delivery_items)){for(const d of o.delivery_items){const value=String(d.delivery_content||"").trim();if(!value)continue;count++;const wrap=el("div","credential-card");wrap.append(el("strong","credential-title",d.title||"商品卡密"),el("pre","credential-content",value),copyButton(value));cb.append(wrap)}}
 if(!delivered||!count)cb.append(el("p","detail-muted",delivered?"该订单暂无可显示的卡密。":"订单尚未发货，发货后可在此查看卡密。"));
 creds.append(cb);$("detailContent").append(creds);
 $("downloadOrder").onclick=()=>{const lines=["订单号："+(o.trade_no||tradeNo),"商品："+items.map(x=>x.title).join("、"),"金额："+money(o.total_amount??o.amount),"状态："+(o.status_text||o.status||"")];for(const it of items){if(it.delivery_content)lines.push("\n"+it.title+"\n"+it.delivery_content)}const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="订单-"+tradeNo+".txt";a.click();URL.revokeObjectURL(a.href)};
}
(async()=>{if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return}if(!tradeNo){$("detailLoading").textContent="缺少订单号";return}try{const o=await api();if(!o)throw Error("订单不存在");render(o)}catch(e){$("detailLoading").textContent=e.message==="unauthorized"?"登录已失效，请重新登录":"订单详情读取失败，请刷新重试"}})();
