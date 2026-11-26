(() => {
 const TOKEN_KEY="qingtian_shop_token", $=id=>document.getElementById(id);
 const money=v=>"¥"+Number(v||0).toFixed(2);
 const date=v=>v?new Date(Number(v)*1000).toLocaleString("zh-CN",{hour12:false}):"—";
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 async function api(path,options={}){
  const r=await fetch(path,{...options,cache:"no-store",headers:{Accept:"application/json",Authorization:"Bearer "+(localStorage.getItem(TOKEN_KEY)||""),...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(r.status===401&&["invalid_token","token_expired","token_revoked","auth_required"].includes(d.error)){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");throw new Error("登录状态已失效");}
  if(!r.ok)throw new Error(d.message||d.error||"request_failed");return d;
 }
 function table(headers,rows,empty){
  if(!rows.length)return '<div class="wb-empty">'+esc(empty)+'</div>';
  return '<table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
 }
 async function load(){
  const [info,keys,usage,billing]=await Promise.allSettled([api("/api/user/info"),api("/api/user/api-keys"),api("/api/user/api-usage"),api("/api/user/api-billing")]);
  const user=info.status==="fulfilled"?(info.value.user||{}):{};
  const balance=Number(user.balance_cny||0),eligible=keys.status==="fulfilled"&&!!keys.value.eligible;
  $("wbBalance").textContent=money(balance);$("wbEligibility").textContent=eligible?"已达标":"未达标";
  $("wbEligibilityNote").className="wb-status "+(eligible?"good":"warn");
  $("wbEligibilityNote").textContent=eligible?"当前余额满足 API 调用条件（¥500）。":"当前余额未达到 ¥500，API 密钥创建与调用暂不可用。当前余额："+money(balance);
  $("wbCreateKey").disabled=!eligible;
  const logs=usage.status==="fulfilled"?(usage.value.logs||[]):[];
  $("wbCallCount").textContent=String(logs.length);
  const keysBox=$("wbKeys");keysBox.replaceChildren();
  const keyItems=keys.status==="fulfilled"?(keys.value.keys||[]):[];
  if(!keyItems.length)keysBox.innerHTML='<div class="wb-empty">暂无 API 密钥。</div>';
  keyItems.forEach(k=>{
   const el=document.createElement("div");el.className="wb-key";
   const info=document.createElement("div"),strong=document.createElement("strong"),small=document.createElement("small"),btn=document.createElement("button");
   strong.textContent=(k.key_prefix||"qt_live_")+"••••••";small.textContent=(k.label||"API Key")+" · "+(k.revoked?"已撤销":"有效")+" · 创建于 "+date(k.created_at);
   info.append(strong,small);btn.className="wb-btn danger";btn.textContent=k.revoked?"已撤销":"撤销密钥";btn.disabled=!!k.revoked;
   btn.addEventListener("click",async()=>{if(!confirm("确定撤销此 API 密钥？撤销后不可恢复。"))return;try{await api("/api/user/api-keys/"+encodeURIComponent(k.id),{method:"DELETE"});await load();}catch(e){alert(e.message);}});
   el.append(info,btn);keysBox.append(el);
  });
  $("wbUsage").innerHTML=table(["时间","接口","方法","HTTP 状态"],logs.map(x=>[esc(date(x.created_at)),esc(x.endpoint),esc(x.method),esc(x.status_code)]),"暂无 API 调用记录。");
  const entries=billing.status==="fulfilled"?(billing.value.entries||[]):[];
  $("wbBilling").innerHTML=table(["时间","订单号","商品 ID","类型","金额","余额"],entries.map(x=>[esc(date(x.created_at)),esc(x.order_id),esc(x.product_id),x.action==="refund"?"退款":"扣费",(x.action==="refund"?"+":"−")+money(x.amount_cny),money(x.balance_after_cny)]),"暂无 API 扣费或退款记录。");
 }
 $("wbCreateKey").addEventListener("click",async()=>{
  const label=prompt("为 API 密钥设置名称","默认 API 密钥");if(label===null)return;
  try{const d=await api("/api/user/api-keys",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label})});$("wbNewKey").hidden=false;$("wbNewKeyValue").value=d.key.key;await load();}
  catch(e){alert(e.message);}
 });
 $("wbCopyNewKey").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("wbNewKeyValue").value);alert("已复制");}catch{ $("wbNewKeyValue").select();document.execCommand("copy");}});
 $("wbTestProducts").addEventListener("click",async()=>{
  const key=$("wbTestKey").value.trim(),box=$("wbProducts");if(!key){box.innerHTML='<div class="wb-empty">请先输入 API Key。</div>';return;}
  box.innerHTML='<div class="wb-empty">正在查询上游同步商品目录…</div>';
  try{
   const r=await fetch("/api/v1/products",{headers:{Authorization:"Bearer "+key},cache:"no-store"}),d=await r.json();
   if(!r.ok)throw new Error(d.message||d.error||"商品查询失败");
   const items=d.items||[];
   box.innerHTML=table(["商品","商品 ID","人民币售价","库存","可购买","价格核验"],items.slice(0,50).map(x=>[
    '<span style="display:inline-flex;align-items:center;gap:7px">'+(x.icon_url?'<img src="'+esc(x.icon_url)+'" alt="" width="24" height="24" style="object-fit:contain">':"")+'<span>'+esc(x.name)+'</span></span>',
    esc(x.product_id),money(x.price_cny),esc(x.stock),x.purchasable?"是":"否",x.price_verified?"已核验":"待同步"
   ]),"没有可展示的商品。");
  }catch(e){box.innerHTML='<div class="wb-status warn">'+esc(e.message)+'</div>';}
 });
 if(!localStorage.getItem(TOKEN_KEY)){location.replace("./auth.html");return;}
 load().catch(e=>{$("wbEligibilityNote").textContent=e.message;$("wbEligibilityNote").className="wb-status warn";});
})();