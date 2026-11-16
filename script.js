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
  const response = await fetch(API_BASE + path, { ...options, headers, cache: "no-store" });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok && response.status !== 202) {
    const error = new Error(data.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return data;
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
 zh:{eyebrow:"SECURE EMAIL ACCESS",title:"欢迎回来",subtitle:"使用邮箱验证码，安全进入你的晴天号铺账户。",support:"联系客服 ↗",emailLabel:"邮箱地址",codeLabel:"邮箱验证码",codePlaceholder:"输入 6 位验证码",sendCode:"获取验证码",sending:"发送中…",resend:"重新获取",retry:" 秒后重试",login:"安全登录",logging:"正在登录…",agreePrefix:"我已阅读并同意",terms:"用户协议",privacy:"隐私政策",securityNote:"验证码 5 分钟内有效，请勿向任何人透露。",invalidEmail:"请输入有效的邮箱地址。",invalidCode:"请输入 6 位数字验证码。",needAgreement:"请先勾选并同意用户协议和隐私政策。",sent:"验证码已发送，请检查邮箱。",sendFailed:"验证码发送失败，请稍后重试。",tooMany:"发送过于频繁，请稍后再试。",wrongCode:"验证码不正确。",expired:"验证码已过期，请重新获取。",tooManyAttempts:"验证次数过多，请重新获取验证码。",loginFailed:"登录失败，请检查验证码后重试。"},
 en:{eyebrow:"SECURE EMAIL ACCESS",title:"Welcome Back",subtitle:"Sign in securely to your Qingtian Store account with an email code.",support:"Support ↗",emailLabel:"Email address",codeLabel:"Verification code",codePlaceholder:"Enter 6-digit code",sendCode:"Send Code",sending:"Sending…",resend:"Send Again",retry:"s to retry",login:"Secure Login",logging:"Signing in…",agreePrefix:"I have read and agree to the",terms:"Terms of Service",privacy:"Privacy Policy",securityNote:"Codes expire in 5 minutes. Never share your code.",invalidEmail:"Please enter a valid email address.",invalidCode:"Please enter the 6-digit verification code.",needAgreement:"Please accept the Terms of Service and Privacy Policy.",sent:"Code sent. Please check your inbox.",sendFailed:"Unable to send the code. Please try again.",tooMany:"Too many requests. Please try again later.",wrongCode:"The verification code is incorrect.",expired:"Code expired. Please request a new one.",tooManyAttempts:"Too many attempts. Please request a new code.",loginFailed:"Sign-in failed. Please check your code and try again."}
};
let authLanguage=localStorage.getItem("qingtian_auth_language")==="en"?"en":"zh";
const authText=key=>AUTH_I18N[authLanguage][key]||AUTH_I18N.zh[key]||key;
function setAuthLanguage(lang){
 authLanguage=lang==="en"?"en":"zh";localStorage.setItem("qingtian_auth_language",authLanguage);
 document.documentElement.lang=authLanguage==="en"?"en":"zh-CN";
 document.querySelectorAll("[data-i18n]").forEach(el=>{const k=el.dataset.i18n;if(AUTH_I18N[authLanguage][k])el.textContent=authText(k);});
 document.querySelectorAll("[data-lang-label]").forEach(el=>el.classList.toggle("active",el.dataset.langLabel===authLanguage));
 $("code").placeholder=authText("codePlaceholder");
 $("sendCode").textContent=window.authCodeCooldown>0?window.authCodeCooldown+authText("retry"):authText("sendCode");
 $("loginButton").querySelector(".login-button-text").textContent=$("loginButton").classList.contains("loading")?authText("logging"):authText("login");
}
function setFieldError(input,target,text){target.textContent=text||"";input.classList.toggle("invalid",Boolean(text));input.setAttribute("aria-invalid",text?"true":"false");}
function initParticleBackground(){
 const canvas=$("particleCanvas"),ctx=canvas&&canvas.getContext("2d");if(!canvas||!ctx)return;
 let w=0,h=0,particles=[],raf=0;const pointer={x:-1000,y:-1000,active:false};
 const reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 function resize(){const dpr=Math.min(window.devicePixelRatio||1,2);w=innerWidth;h=innerHeight;canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);canvas.style.width=w+"px";canvas.style.height=h+"px";ctx.setTransform(dpr,0,0,dpr,0,0);const n=Math.min(115,Math.max(38,Math.floor(w*h/13500)));particles=Array.from({length:n},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.34,vy:(Math.random()-.5)*.34,r:Math.random()*1.35+.55,blue:Math.random()>.27}));}
 function move(e){const p=e.touches?e.touches[0]:e;pointer.x=p.clientX;pointer.y=p.clientY;pointer.active=true;}
 function leave(){pointer.active=false;pointer.x=-1000;pointer.y=-1000;}
 function draw(){ctx.clearRect(0,0,w,h);for(let i=0;i<particles.length;i++){const p=particles[i];if(pointer.active){const dx=p.x-pointer.x,dy=p.y-pointer.y,d=Math.hypot(dx,dy)||1;if(d<145){const f=(145-d)/145*.024;p.vx+=dx/d*f;p.vy+=dy/d*f;}}p.vx*=.994;p.vy*=.994;p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1;p.x=Math.max(0,Math.min(w,p.x));p.y=Math.max(0,Math.min(h,p.y));ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=p.blue?"rgba(0,217,255,.82)":"rgba(235,247,255,.76)";ctx.shadowBlur=p.blue?10:5;ctx.shadowColor=p.blue?"#00d9ff":"#dceeff";ctx.fill();ctx.shadowBlur=0;for(let j=i+1;j<particles.length;j++){const q=particles[j],dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy);if(d<112){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle="rgba(65,177,226,"+((1-d/112)*.22)+")";ctx.lineWidth=.65;ctx.stroke();}}}if(pointer.active){const g=ctx.createRadialGradient(pointer.x,pointer.y,0,pointer.x,pointer.y,145);g.addColorStop(0,"rgba(0,217,255,.09)");g.addColorStop(1,"rgba(0,217,255,0)");ctx.fillStyle=g;ctx.fillRect(pointer.x-145,pointer.y-145,290,290);}if(!reduced)raf=requestAnimationFrame(draw);}
 resize();draw();window.addEventListener("resize",resize,{passive:true});window.addEventListener("pointermove",move,{passive:true});window.addEventListener("pointerleave",leave,{passive:true});window.addEventListener("touchstart",move,{passive:true});window.addEventListener("touchmove",move,{passive:true});window.addEventListener("touchend",leave,{passive:true});document.addEventListener("visibilitychange",()=>{if(document.hidden)cancelAnimationFrame(raf);else if(!reduced)draw();});
}
function initAuth(){
 if(token()){location.replace("./shop.html");return;}
 const form=$("authForm"),send=$("sendCode"),msg=$("authMessage"),login=$("loginButton"),email=$("email"),code=$("code");
 const emailError=$("emailError"),codeError=$("codeError"),legalError=$("legalError");let cooldown=0,timer=null;window.authCodeCooldown=0;
 $("languageToggle").addEventListener("click",()=>setAuthLanguage(authLanguage==="zh"?"en":"zh"));setAuthLanguage(authLanguage);initParticleBackground();
 const validEmail=()=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
 email.addEventListener("input",()=>setFieldError(email,emailError,""));code.addEventListener("input",()=>setFieldError(code,codeError,""));
 send.addEventListener("click",async()=>{if(cooldown>0||send.disabled)return;if(!validEmail()){setFieldError(email,emailError,authText("invalidEmail"));email.focus();return;}send.disabled=true;send.textContent=authText("sending");message(msg,"");try{await api("/api/auth/send_code",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase()})});message(msg,authText("sent"),"success");cooldown=60;window.authCodeCooldown=cooldown;const tick=()=>{send.textContent=cooldown+authText("retry");};tick();timer=setInterval(()=>{cooldown--;window.authCodeCooldown=cooldown;if(cooldown<=0){clearInterval(timer);timer=null;send.disabled=false;send.textContent=authText("resend");}else tick();},1000);}catch(error){message(msg,error.message==="too_many_requests"?authText("tooMany"):authText("sendFailed"),"error");send.disabled=false;send.textContent=authText("sendCode");}});
 form.addEventListener("submit",async e=>{e.preventDefault();message(msg,"");if(!validEmail()){setFieldError(email,emailError,authText("invalidEmail"));email.focus();return;}if(!/^\d{6}$/.test(code.value.trim())){setFieldError(code,codeError,authText("invalidCode"));code.focus();return;}if(!$("agreeTerms").checked||!$("agreePrivacy").checked){legalError.textContent=authText("needAgreement");return;}legalError.textContent="";login.disabled=true;login.classList.add("loading");login.querySelector(".login-button-text").textContent=authText("logging");try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase(),code:code.value.trim()})});if(!result.token)throw new Error("login_failed");localStorage.setItem(TOKEN_KEY,result.token);location.replace("./shop.html");}catch(error){const text=error.message==="invalid_code"?authText("wrongCode"):error.message==="code_expired"?authText("expired"):error.message==="too_many_attempts"?authText("tooManyAttempts"):authText("loginFailed");message(msg,text,"error");login.disabled=false;login.classList.remove("loading");login.querySelector(".login-button-text").textContent=authText("login");}});
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
