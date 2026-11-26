"use strict";
(() => {
  const TOKEN_KEY = "qingtian_shop_token";
  const $ = id => document.getElementById(id);
  const token = () => localStorage.getItem(TOKEN_KEY) || "";
  const money = value => "¥" + Number(value || 0).toFixed(2);
  const dateText = value => value ? new Date(Number(value) * 1000).toLocaleString("zh-CN", {hour12:false}) : "—";
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options, cache: "no-store",
      headers: { Accept:"application/json", "Content-Type":"application/json", Authorization:"Bearer " + token(), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "request_failed");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function message(id, text, kind = "") {
    const el = $(id); if (!el) return;
    el.textContent = text || "";
    el.className = "profile-message" + (kind ? " " + kind : "");
  }
  function setAvatar(url, nickname) {
    const img=$("avatarPreview"), fallback=$("avatarFallback");
    if (url) { img.src=url; img.hidden=false; fallback.hidden=true; }
    else { img.hidden=true; fallback.hidden=false; fallback.textContent=(nickname || "晴").trim()[0] || "晴"; }
    const headerImg=$("headerAvatarImage"), headerFallback=$("headerAvatarFallback");
    if (headerImg && headerFallback) {
      if (url) { headerImg.src=url; headerImg.hidden=false; headerFallback.hidden=true; }
      else { headerImg.hidden=true; headerFallback.hidden=false; headerFallback.textContent=(nickname || "晴").trim()[0] || "晴"; }
    }
  }
  async function compressAvatar(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10*1024*1024) throw new Error("invalid_avatar");
    const bitmap=await createImageBitmap(file), canvas=document.createElement("canvas");
    const scale=Math.min(1,320/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close?.();
    return canvas.toDataURL("image/webp",0.82);
  }
  let avatarData = null, currentBalance = 0;
  async function loadAccount() {
    const data=await api("/api/user/info"), user=data.user || {};
    $("email").value=user.email || ""; $("nickname").value=user.nickname || "";
    currentBalance=Number(user.balance_cny || 0); $("balance").textContent=money(currentBalance);
    setAvatar(user.avatar_url,user.nickname);
  }
  function setServiceTab(tab) {
    document.querySelectorAll("[data-service-tab]").forEach(button => {
      const active=button.dataset.serviceTab===tab;
      button.classList.toggle("active",active); button.setAttribute("aria-selected",String(active));
    });
    document.querySelectorAll("[data-service-panel]").forEach(panel => { panel.hidden=panel.dataset.servicePanel!==tab; });
    if (tab==="history") loadRechargeHistory();
    if (tab==="api") loadApiCenter();
  }
  async function loadRechargeHistory() {
    const body=$("rechargeHistoryBody"); body.replaceChildren();
    try {
      const data=await api("/api/user/recharge-orders");
      const orders=data.orders || [];
      if (!orders.length) { const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="recharge-empty";td.textContent="暂无充值订单";tr.append(td);body.append(tr);return; }
      const statusMap={pending:"待核验",paid:"已入账",cancelled:"已取消",expired:"已过期"};
      orders.forEach(order=>{
        const tr=document.createElement("tr");
        [dateText(order.created_at),order.order_id,money(order.amount_cny),order.payment_method==="USDT_TRC20"?"USDT（TRC20）":order.payment_method,statusMap[order.status]||order.status].forEach(value=>{const td=document.createElement("td");td.textContent=value;tr.append(td);});
        body.append(tr);
      });
    } catch (error) { const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.className="recharge-empty";td.textContent=error.message==="auth_required"?"登录状态已失效，请重新登录。":"充值记录读取失败，请稍后重试。";tr.append(td);body.append(tr); }
  }
  async function createRecharge() {
    const amount=String($("rechargeAmount").value || "").trim();
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(amount) || Number(amount)<80 || Number(amount)>50000) { message("rechargeMessage","请输入 ¥80 至 ¥50,000 之间的有效金额。","error"); return; }
    const button=$("createRechargeOrder"); button.disabled=true; button.textContent="正在创建订单…";
    try {
      const data=await api("/api/user/recharge-orders",{method:"POST",body:JSON.stringify({amount_cny:amount})});
      const order=data.order, result=$("rechargeResult");
      $("rechargeResultTitle").textContent="充值订单已创建 · 待付款";
      $("rechargeResultText").textContent="订单号："+order.order_id+"；金额："+money(order.amount_cny)+"。请先联系官方客服获取实时收款地址，付款后提交订单号与凭证，核验通过后余额自动入账。";
      $("rechargeContact").href="https://t.me/qingtian_Boss?text="+encodeURIComponent("你好，我已创建充值订单："+order.order_id+"，金额："+money(order.amount_cny)+"，请提供当前收款方式。");
      result.hidden=false; message("rechargeMessage","订单已写入账户充值记录。","success");
    } catch (error) { message("rechargeMessage",error.message==="amount_out_of_range"?"充值金额需在 ¥80 至 ¥50,000 之间。":"充值订单创建失败，请稍后重试。","error"); }
    finally { button.disabled=false; button.textContent="创建充值订单"; }
  }
  async function loadApiCenter() {
    try {
      const data=await api("/api/user/api-keys");
      const eligible=Boolean(data.eligible);
      $("apiStatus").classList.toggle("ready",eligible); $("apiStatus").classList.toggle("locked",!eligible);
      $("apiStatusText").textContent=eligible?"余额已达标，可创建 API 密钥":"余额未达到 ¥200 开通门槛";
      $("apiBalanceHint").textContent=eligible?"当前余额满足 API 服务要求。密钥请妥善保管；泄露后立即撤销。":"当前余额："+money(currentBalance)+"；开通要求：可用余额不少于 ¥200.00。";
      $("createApiKey").disabled=!eligible;
      renderApiKeys(data.keys || []);
      await loadApiUsage();
    } catch { message("apiMessage","API 服务状态读取失败，请稍后重试。","error"); }
  }
  function renderApiKeys(keys) {
    const root=$("apiKeyList"); root.replaceChildren();
    if (!keys.length) { const p=document.createElement("p");p.className="recharge-empty";p.textContent="尚未创建 API 密钥";root.append(p);return; }
    keys.forEach(key=>{
      const row=document.createElement("div");row.className="api-key-row";
      const info=document.createElement("div"),name=document.createElement("strong"),meta=document.createElement("small");
      name.textContent=key.label+(key.revoked?"（已撤销）":"");
      meta.textContent=key.key_prefix+"••••  · 创建于 "+dateText(key.created_at)+(key.last_used_at?" · 最近调用 "+dateText(key.last_used_at):"");
      info.append(name,meta);row.append(info);
      if(!key.revoked){const btn=document.createElement("button");btn.type="button";btn.textContent="撤销";btn.addEventListener("click",()=>revokeApiKey(key.id));row.append(btn);}
      root.append(row);
    });
  }
  async function createApiKey() {
    const button=$("createApiKey");button.disabled=true;message("apiMessage","正在申请密钥…");
    try {
      const data=await api("/api/user/api-keys",{method:"POST",body:JSON.stringify({label:$("apiKeyLabel").value.trim()})});
      $("newApiKey").textContent=data.key.key;$("apiKeyOnce").hidden=false;
      message("apiMessage","密钥创建成功。请立即复制，完整密钥只显示这一次。","success");
      await loadApiCenter();
    } catch(error) {
      message("apiMessage",error.message==="api_balance_requirement"?"账户余额不足 ¥500，暂不能开通 API。":error.message==="api_key_limit"?"最多同时保留 5 个有效密钥，请先撤销旧密钥。":"API 密钥创建失败，请稍后重试。","error");
    } finally {button.disabled=false;}
  }
  async function revokeApiKey(id) {
    if(!window.confirm("确定撤销此 API 密钥？撤销后立即失效。")) return;
    try { await api("/api/user/api-keys/"+encodeURIComponent(id),{method:"DELETE"});message("apiMessage","密钥已撤销。","success");await loadApiCenter(); }
    catch { message("apiMessage","撤销失败，请稍后重试。","error"); }
  }
  async function loadApiUsage() {
    const body=$("apiUsageBody");body.replaceChildren();
    try {
      const data=await api("/api/user/api-usage"),logs=data.logs||[];
      if(!logs.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.className="recharge-empty";td.textContent="暂无调用记录";tr.append(td);body.append(tr);return;}
      logs.forEach(log=>{const tr=document.createElement("tr");[dateText(log.created_at),log.endpoint,log.method,String(log.status_code)].forEach(value=>{const td=document.createElement("td");td.textContent=value;tr.append(td);});body.append(tr);});
    } catch { const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.className="recharge-empty";td.textContent="调用记录读取失败";tr.append(td);body.append(tr); }
  }
  async function revokePasswordFlow() {
    const current=$("currentPassword").value,next=$("newPassword").value,confirm=$("confirmPassword").value;
    if(!current){message("passwordMessage","请填写当前密码。","error");return;}
    if(!/^(?=.*[A-Za-z])(?=.*\d).{8,20}$/.test(next)){message("passwordMessage","新密码需为 8–20 位，并同时包含字母和数字。","error");return;}
    if(next!==confirm){message("passwordMessage","两次输入的新密码不一致。","error");return;}
    const button=$("changePassword");button.disabled=true;
    try {
      await api("/api/user/change-password",{method:"POST",body:JSON.stringify({current_password:current,new_password:next})});
      localStorage.removeItem(TOKEN_KEY);message("passwordMessage","密码修改成功，请使用新密码重新登录。","success");
      setTimeout(()=>location.replace("./auth.html"),900);
    } catch(error) {
      const msg=error.message==="invalid_current_password"?"当前密码不正确。":error.message==="weak_password"?"新密码格式不符合要求。":"密码修改失败，请稍后重试。";
      message("passwordMessage",msg,"error");
    } finally {button.disabled=false;}
  }
  async function init() {
    if(!token()){location.replace("./auth.html");return;}
    try { await loadAccount(); }
    catch(error) { if(["auth_required","invalid_token","token_expired","token_revoked"].includes(error.message)){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");return;} message("profileMessage","账户资料读取失败，请稍后重试。","error"); }
    $("chooseAvatar").addEventListener("click",()=>$("avatarFile").click());
    $("avatarFile").addEventListener("change",async()=>{const file=$("avatarFile").files?.[0];if(!file)return;try{avatarData=await compressAvatar(file);setAvatar(avatarData,$("nickname").value);}catch{message("profileMessage","头像处理失败，请更换图片。","error");}});
    $("saveProfile").addEventListener("click",async()=>{
      const nickname=$("nickname").value.trim();if(!nickname){message("profileMessage","请填写昵称。","error");return;}
      const button=$("saveProfile");button.disabled=true;
      try{await api("/api/user/profile",{method:"POST",body:JSON.stringify({nickname,...(avatarData?{avatar_data_url:avatarData}:{})})});avatarData=null;message("profileMessage","账户资料已保存。","success");}
      catch{message("profileMessage","保存失败，请稍后重试。","error");}
      finally{button.disabled=false;}
    });
    $("changePassword").addEventListener("click",revokePasswordFlow);
    const openAccountCenter=(tab="recharge")=>{$("accountCenter").hidden=false;setServiceTab(tab);$("accountCenter").scrollIntoView({behavior:"smooth",block:"start"});};
    $("openAccountCenter").addEventListener("click",()=>openAccountCenter("recharge"));
    $("closeAccountCenter").addEventListener("click",()=>$("accountCenter").hidden=true);
    const deepLink=String(location.hash||"").toLowerCase();
    if(deepLink==="#accountcenter")openAccountCenter("api");
    else if(deepLink==="#recharge")openAccountCenter("recharge");
    document.querySelectorAll("[data-service-tab]").forEach(button=>button.addEventListener("click",()=>setServiceTab(button.dataset.serviceTab)));
    document.querySelectorAll("[data-recharge-amount]").forEach(button=>button.addEventListener("click",()=>{$("rechargeAmount").value=button.dataset.rechargeAmount;document.querySelectorAll("[data-recharge-amount]").forEach(x=>x.setAttribute("aria-pressed",String(x===button)));}));
    $("createRechargeOrder").addEventListener("click",createRecharge);
    $("createApiKey").addEventListener("click",createApiKey);
    $("copyApiKey").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("newApiKey").textContent);message("apiMessage","密钥已复制。","success");}catch{message("apiMessage","复制失败，请手动复制密钥。","error");}});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();