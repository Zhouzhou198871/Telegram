"use strict";

const API_BASE = "https://qingtian-shop-api.chulingli1988.workers.dev";
const TOKEN_KEY = "qingtian_shop_token";
const $ = id => document.getElementById(id);
const token = () => localStorage.getItem(TOKEN_KEY) || "";

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (token()) headers.set("Authorization", "Bearer " + token());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(API_BASE + path, {
      ...options,
      headers,
      cache: "no-store",
      signal: controller.signal
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok && response.status !== 202) {
      const errorCode = response.status >= 500 ? "server_error" : (data.error || "request_failed");
      const error = new Error(errorCode);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("request_timeout");
      timeoutError.code = "request_timeout";
      throw timeoutError;
    }
    if (error instanceof TypeError || !error.status) {
      const networkError = new Error("network_error");
      networkError.code = "network_error";
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function message(element, text, kind = "") {
  if (!element) return;
  element.textContent = text || "";
  element.className = "form-message" + (kind ? " " + kind : "");
}

function safeText(tag, className, value, fallback = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value === null || value === undefined || value === "" ? fallback : String(value);
  return el;
}

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4) + " USDT" : "价格暂不可用";
}

const AUTH_I18N = {
 zh:{eyebrow:"SECURE EMAIL ACCESS",title:"欢迎回来",subtitle:"使用邮箱验证码，安全进入你的晴天号铺账户。",support:"联系客服 ↗",emailLabel:"邮箱地址",codeLabel:"邮箱验证码",codePlaceholder:"输入 6 位验证码",sendCode:"获取验证码",sending:"发送中…",resend:"重新获取",retry:" 秒后重试",login:"安全登录",logging:"正在登录…",agreePrefix:"我已阅读并同意",terms:"用户协议",privacy:"隐私政策",securityNote:"验证码 5 分钟内有效，请勿向任何人透露。",invalidEmail:"请输入有效的邮箱地址。",invalidCode:"请输入 6 位数字验证码。",needAgreement:"请先勾选并同意用户协议和隐私政策。",passwordLabel:"设置密码",confirmPasswordLabel:"确认密码",passwordPlaceholder:"请设置8-20位包含字母和数字的密码",confirmPasswordPlaceholder:"请再次输入密码",invalidPassword:"密码须为8-20位，且同时包含字母和数字。",passwordMismatch:"两次输入的密码不一致",registered:"该邮箱已注册，请直接登录或更换邮箱。",sent:"验证码已发送，请检查邮箱。",sendFailed:"验证码发送失败，请稍后重试。",tooMany:"发送过于频繁，请稍后再试。",wrongCode:"验证码不正确。",expired:"验证码已过期，请重新获取。",tooManyAttempts:"验证次数过多，请重新获取验证码。",loginFailed:"登录失败，请检查验证码后重试。",requestTimeout:"服务器响应超时，请稍后重试。",networkError:"网络连接失败，请检查网络后重试。",serverError:"服务器暂时出现故障，请稍后重试。"},
 en:{eyebrow:"SECURE EMAIL ACCESS",title:"Welcome Back",subtitle:"Sign in securely to your Qingtian Store account with an email code.",support:"Support ↗",emailLabel:"Email address",codeLabel:"Verification code",codePlaceholder:"Enter 6-digit code",sendCode:"Send Code",sending:"Sending…",resend:"Send Again",retry:"s to retry",login:"Secure Login",logging:"Signing in…",agreePrefix:"I have read and agree to the",terms:"Terms of Service",privacy:"Privacy Policy",securityNote:"Codes expire in 5 minutes. Never share your code.",invalidEmail:"Please enter a valid email address.",invalidCode:"Please enter the 6-digit verification code.",needAgreement:"Please accept the Terms of Service and Privacy Policy.",passwordLabel:"Set password",confirmPasswordLabel:"Confirm password",passwordPlaceholder:"Use 8-20 characters with letters and numbers",confirmPasswordPlaceholder:"Enter your password again",invalidPassword:"Use 8-20 characters with both letters and numbers.",passwordMismatch:"The passwords do not match.",registered:"This email is already registered. Please sign in or use another email.",sent:"Code sent. Please check your inbox.",sendFailed:"Unable to send the code. Please try again.",tooMany:"Too many requests. Please try again later.",wrongCode:"The verification code is incorrect.",expired:"Code expired. Please request a new one.",tooManyAttempts:"Too many attempts. Please request a new code.",loginFailed:"Sign-in failed. Please check your code and try again.",requestTimeout:"The server took too long to respond. Please try again.",networkError:"Network connection failed. Please check your connection.",serverError:"The server encountered an error. Please try again later."}
};
let authLanguage=localStorage.getItem("qingtian_auth_language")==="en"?"en":"zh";
const authText=key=>AUTH_I18N[authLanguage][key]||AUTH_I18N.zh[key]||key;
function setAuthLanguage(lang){
 authLanguage=lang==="en"?"en":"zh";localStorage.setItem("qingtian_auth_language",authLanguage);
 document.documentElement.lang=authLanguage==="en"?"en":"zh-CN";
 document.querySelectorAll("[data-i18n]").forEach(el=>{const k=el.dataset.i18n;if(AUTH_I18N[authLanguage][k])el.textContent=authText(k);});
 document.querySelectorAll("[data-lang-label]").forEach(el=>el.classList.toggle("active",el.dataset.langLabel===authLanguage));
 $("code").placeholder=authText("codePlaceholder");
 if($("password"))$("password").placeholder=authText("passwordPlaceholder");
 if($("confirmPassword"))$("confirmPassword").placeholder=authText("confirmPasswordPlaceholder");
 $("sendCode").textContent=window.authCodeCooldown>0?window.authCodeCooldown+authText("retry"):authText("sendCode");
 $("loginButton").querySelector(".login-button-text").textContent=$("loginButton").classList.contains("loading")?authText("logging"):(document.body.dataset.authMode==="register"?(authLanguage==="en"?"Register & Sign In":"注册并登录"):authText("login"));
 if(document.body.dataset.authMode==="register"){
  $("authTitle").textContent=authLanguage==="en"?"Create Account":"创建账号";
  document.querySelector(".auth-subtitle").textContent=authLanguage==="en"?"Verify a new email to automatically create your account and sign in.":"输入新邮箱并验证，即可自动注册并登录晴天号铺。";
  document.querySelector(".auth-switch").innerHTML=authLanguage==="en"?'Already have an account? <a href="./auth.html">Sign in</a>':'已有账号？<a href="./auth.html">返回登录</a>';
 }
}
function setFieldError(input,target,text){target.textContent=text||"";input.classList.toggle("invalid",Boolean(text));input.setAttribute("aria-invalid",text?"true":"false");}
function initParticleBackground(){
 const canvas=$("particleCanvas"),ctx=canvas&&canvas.getContext("2d");if(!canvas||!ctx)return;
 canvas.style.position="fixed";canvas.style.inset="0";canvas.style.zIndex="0";canvas.style.pointerEvents="none";
 let w=0,h=0,particles=[],raf=0;const pointer={x:-1000,y:-1000,active:false};
 const reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 function resize(){
  const dpr=Math.min(window.devicePixelRatio||1,2);w=window.innerWidth;h=window.innerHeight;
  canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);
  canvas.style.width=w+"px";canvas.style.height=h+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const n=Math.min(150,Math.max(65,Math.floor(w*h/9500)));
  particles=Array.from({length:n},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.42,vy:(Math.random()-.5)*.42,r:Math.random()*1.55+.7,blue:Math.random()>.48}));
 }
 function move(e){const p=e.touches?e.touches[0]:e;pointer.x=p.clientX;pointer.y=p.clientY;pointer.active=true;}
 function leave(){pointer.active=false;pointer.x=-1000;pointer.y=-1000;}
 function draw(){
  ctx.clearRect(0,0,w,h);
  for(let i=0;i<particles.length;i++){
   const p=particles[i];
   if(pointer.active){const dx=p.x-pointer.x,dy=p.y-pointer.y,d=Math.hypot(dx,dy)||1;if(d<145){const f=(145-d)/145*.024;p.vx+=dx/d*f;p.vy+=dy/d*f;}}
   p.vx*=.994;p.vy*=.994;p.x+=p.vx;p.y+=p.vy;
   if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1;
   p.x=Math.max(0,Math.min(w,p.x));p.y=Math.max(0,Math.min(h,p.y));
   ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
   ctx.fillStyle=p.blue?"#1E3A8A":"#94A3B8";
   ctx.shadowBlur=p.blue?7:4;ctx.shadowColor=p.blue?"#1E3A8A":"#94A3B8";ctx.fill();ctx.shadowBlur=0;
   for(let j=i+1;j<particles.length;j++){
    const q=particles[j],dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy);
    if(d<125){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=p.blue||q.blue?"rgba(30,58,138,"+((1-d/125)*.40)+")":"rgba(100,116,139,"+((1-d/125)*.30)+")";ctx.lineWidth=.8;ctx.stroke();}
   }
  }
  if(pointer.active){const g=ctx.createRadialGradient(pointer.x,pointer.y,0,pointer.x,pointer.y,145);g.addColorStop(0,"rgba(30,58,138,.08)");g.addColorStop(1,"rgba(30,58,138,0)");ctx.fillStyle=g;ctx.fillRect(pointer.x-145,pointer.y-145,290,290);}
  if(!reduced)raf=requestAnimationFrame(draw);
 }
 resize();draw();
 window.addEventListener("resize",resize,{passive:true});
 window.addEventListener("pointermove",move,{passive:true});
 window.addEventListener("pointerleave",leave,{passive:true});
 window.addEventListener("touchstart",move,{passive:true});
 window.addEventListener("touchmove",move,{passive:true});
 window.addEventListener("touchend",leave,{passive:true});
 document.addEventListener("visibilitychange",()=>{if(document.hidden)cancelAnimationFrame(raf);else if(!reduced)draw();});
}
function initAuth(){
 if(token()){location.replace("./shop.html");return;}
 const form=$("authForm"),send=$("sendCode"),msg=$("authMessage"),login=$("loginButton"),email=$("email"),code=$("code");
 const emailError=$("emailError"),codeError=$("codeError"),password=$("password"),confirmPassword=$("confirmPassword"),passwordError=$("passwordError"),confirmPasswordError=$("confirmPasswordError"),legalError=$("legalError");let cooldown=0,timer=null;window.authCodeCooldown=0;
 $("languageToggle").addEventListener("click",()=>setAuthLanguage(authLanguage==="zh"?"en":"zh"));setAuthLanguage(authLanguage);initParticleBackground();
 const validEmail=()=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
 // 输入时清除错误；验证码输入仅保留数字且最多 6 位
 email.addEventListener("input",()=>setFieldError(email,emailError,""));
 code.addEventListener("input",()=>{code.value=code.value.replace(/\\D/g,"").slice(0,6);setFieldError(code,codeError,"");});
 password.addEventListener("input",()=>{setFieldError(password,passwordError,"");setFieldError(confirmPassword,confirmPasswordError,confirmPassword.value&&confirmPassword.value!==password.value?authText("passwordMismatch"):"");});
 confirmPassword.addEventListener("input",()=>setFieldError(confirmPassword,confirmPasswordError,confirmPassword.value!==password.value?authText("passwordMismatch"):""));
 $("agreeTerms").addEventListener("change",()=>{legalError.textContent="";});
 // 获取验证码：邮箱校验通过后调用真实接口，成功后启动 60 秒倒计时
 send.addEventListener("click",async()=>{
  if(cooldown>0||send.disabled)return;
  if(!email.value.trim()||!validEmail()){setFieldError(email,emailError,authText("invalidEmail"));email.focus();return;}
  setFieldError(email,emailError,"");message(msg,"");
  send.disabled=true;send.textContent=authText("sending");
  try{
   await api("/api/auth/send_code",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase()})});
   message(msg,authText("sent"),"success");cooldown=60;window.authCodeCooldown=cooldown;
   const tick=()=>{send.textContent=cooldown+authText("retry");};tick();
   timer=setInterval(()=>{cooldown--;window.authCodeCooldown=cooldown;if(cooldown<=0){clearInterval(timer);timer=null;send.disabled=false;send.textContent=authText("resend");}else tick();},1000);
  }catch(error){
   const errorMessage = error.message === "request_timeout" ? authText("requestTimeout")
    : error.message === "network_error" ? authText("networkError")
    : error.message === "server_error" ? authText("serverError")
    : error.message === "too_many_requests" ? authText("tooMany")
    : authText("sendFailed");
   message(msg,errorMessage,"error");
   send.disabled=false;send.textContent=authText("sendCode");
  }
 });
 // 注册校验顺序：邮箱 -> 验证码 -> 密码 -> 协议；提交邮箱、验证码和密码
 form.addEventListener("submit",async e=>{
  e.preventDefault();message(msg,"");
  if(!email.value.trim()||!validEmail()){setFieldError(email,emailError,authText("invalidEmail"));email.focus();return;}
  if(!/^\d{6}$/.test(code.value.trim())){setFieldError(code,codeError,authText("invalidCode"));code.focus();return;}
  const passwordValue=password.value;
  if(!/^(?=.*[A-Za-z])(?=.*\d).{8,20}$/.test(passwordValue)){setFieldError(password,passwordError,authText("invalidPassword"));password.focus();return;}
  if(passwordValue!==confirmPassword.value){setFieldError(confirmPassword,confirmPasswordError,authText("passwordMismatch"));confirmPassword.focus();return;}
  if(!$("agreeTerms").checked){legalError.textContent=authText("needAgreement");return;}
  setFieldError(email,emailError,"");setFieldError(code,codeError,"");setFieldError(password,passwordError,"");setFieldError(confirmPassword,confirmPasswordError,"");legalError.textContent="";
  login.disabled=true;login.classList.add("loading");login.querySelector(".login-button-text").textContent=authText("logging");
  try{
   const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase(),code:code.value.trim(),password:passwordValue})});
   if(!result.token)throw new Error(result.error||"login_failed");
   localStorage.setItem(TOKEN_KEY,result.token);
   window.location.replace("/shop.html");
  }catch(error){
   const errorCode=String(error.message||"");
   let text=errorCode==="request_timeout"?authText("requestTimeout")
    :errorCode==="network_error"?authText("networkError")
    :errorCode==="server_error"?authText("serverError")
    :authText("loginFailed");
   if(errorCode==="invalid_code")text=authText("wrongCode");
   else if(errorCode==="code_expired")text=authText("expired");
   else if(errorCode==="too_many_attempts")text=authText("tooManyAttempts");
   else if(["email_already_registered","already_registered","user_exists"].includes(errorCode))text=authText("registered");
   else if(errorCode==="weak_password")text=authText("invalidPassword");
   else if(errorCode==="password_mismatch")text=authText("passwordMismatch");
   else if(errorCode==="invalid_credentials")text="邮箱或验证码不正确，请检查后重试。";
   else if(errorCode&&errorCode!=="login_failed"&&!/^[a-z0-9_ -]{1,60}$/i.test(errorCode))text=errorCode;
   message(msg,text,"error");login.disabled=false;login.classList.remove("loading");
   login.querySelector(".login-button-text").textContent=document.body.dataset.authMode==="register"?(authLanguage==="en"?"Register & Sign In":"注册并登录"):authText("login");
  }
 });
}
async function loadUser() {
  const data = await api("/api/user/info");
  $("accountEmail").textContent = data.user.email;
  $("balance").textContent = Number(data.user.balance || 0).toFixed(4);
}

function renderProducts(items) {
  const grid = $("productGrid");
  grid.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    grid.appendChild(safeText("div", "empty-card", "暂无上架商品"));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const card = document.createElement("article");
    card.className = "product-card shop-product-card";
    card.appendChild(safeText("div", "product-category", item.category, "DIGITAL PRODUCT"));
    card.appendChild(safeText("h3", "product-name", item.name, "未命名商品"));
    const meta = document.createElement("div");
    meta.className = "product-meta";
    meta.appendChild(safeText("div", "product-price", formatPrice(item.price_usdt)));
    meta.appendChild(safeText("div", "product-stock", "库存 " + Number(item.stock || 0)));
    card.appendChild(meta);
    const buyButton = document.createElement("button");
    buyButton.type = "button";
    buyButton.className = "primary-button buy-button";
    buyButton.textContent = item.purchasable === false ? "暂不可购买" : "立即购买";
    buyButton.disabled = item.purchasable === false;
    buyButton.addEventListener("click", () => purchase(item, buyButton));
    card.appendChild(buyButton);
    fragment.appendChild(card);
  }
  if (!fragment.childElementCount) grid.appendChild(safeText("div", "empty-card", "暂无上架商品"));
  else grid.appendChild(fragment);
}

async function loadProducts() {
  const grid = $("productGrid");
  grid.replaceChildren(safeText("div", "loading-card", "正在连接商品目录…"));
  try {
    const data = await api("/api/products");
    renderProducts(data.items || []);
    message($("shopMessage"), data.count ? "商品目录已更新。" : "暂无上架商品。", "success");
  } catch {
    grid.replaceChildren(safeText("div", "empty-card", "商品目录暂时无法加载，请稍后刷新。"));
    message($("shopMessage"), "目录连接失败，请稍后重试。", "error");
  }
}

function showDelivery(content) {
  $("deliveryContent").textContent = String(content || "");
  $("deliveryModal").hidden = false;
}

async function pollPurchase(orderId, button) {
  for (let i = 0; i < 30; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      const data = await api("/api/buy/" + encodeURIComponent(orderId));
      if (data.status === "delivered" && data.content) {
        showDelivery(data.content);
        await loadUser();
        button.disabled = false;
        button.textContent = "立即购买";
        return;
      }
      if (data.status === "refunded") {
        message($("shopMessage"), "采购未完成，余额已退回。", "error");
        await loadUser();
        button.disabled = false;
        button.textContent = "重新购买";
        return;
      }
    } catch {}
  }
  message($("shopMessage"), "订单仍在处理中，请稍后刷新订单状态或联系客服。", "error");
  button.disabled = false;
  button.textContent = "查询订单";
  button.onclick = async () => {
    button.disabled = true;
    await pollPurchase(orderId, button);
  };
}

async function purchase(item, button) {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "提交订单…";
  message($("shopMessage"), "正在核验商品与余额…");
  const idempotencyKey = crypto.randomUUID();
  try {
    const result = await api("/api/buy", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ product_id: item.product_id })
    });
    if (result.status === "delivered" && result.content) {
      showDelivery(result.content);
      message($("shopMessage"), "购买成功，卡密已交付。", "success");
      await loadUser();
      button.disabled = false;
      button.textContent = "立即购买";
      return;
    }
    if (result.status === "pending" && result.order_id) {
      button.textContent = "订单处理中…";
      message($("shopMessage"), "订单已受理，正在等待交付。");
      await pollPurchase(result.order_id, button);
      return;
    }
    if (result.status === "refunded") {
      message($("shopMessage"), "采购失败，余额已退回。", "error");
      await loadUser();
    } else if (result.error === "insufficient_balance") {
      message($("shopMessage"), "余额不足，请先联系客户充值。", "error");
    } else {
      message($("shopMessage"), "购买未完成，请稍后重试。", "error");
    }
  } catch (error) {
    const text = error.status === 402 ? "余额不足，请先联系客户充值。" :
      error.message === "product_unavailable" ? "商品已售罄或下架。" :
      "购买请求失败，请稍后重试。";
    message($("shopMessage"), text, "error");
  }
  button.disabled = false;
  button.textContent = "立即购买";
}

function initShop() {
  if (!token()) {
    location.replace("./auth.html");
    return;
  }
  $("year").textContent = String(new Date().getFullYear());
  $("logout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.replace("./auth.html");
  });
  $("refreshProducts").addEventListener("click", loadProducts);
  $("closeModal").addEventListener("click", () => { $("deliveryModal").hidden = true; });
  $("deliveryModal").addEventListener("click", event => {
    if (event.target === $("deliveryModal")) $("deliveryModal").hidden = true;
  });
  $("copyDelivery").addEventListener("click", async () => {
    const text = $("deliveryContent").textContent;
    try {
      await navigator.clipboard.writeText(text);
      $("copyDelivery").textContent = "已复制";
    } catch {
      $("deliveryContent").focus();
      $("copyDelivery").textContent = "请长按复制";
    }
  });
  loadUser().then(loadProducts).catch(() => {
    localStorage.removeItem(TOKEN_KEY);
    location.replace("./auth.html");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page === "auth") initAuth();
  if (document.body.dataset.page === "shop") initShop();
});
