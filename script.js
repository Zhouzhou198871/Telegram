"use strict";

const API_BASE = "";
const TOKEN_KEY = "qingtian_shop_token";

// Consume OAuth tokens before the shop initializes any authenticated API requests.
(() => {
  const referralCode = String(new URLSearchParams(window.location.search).get("ref") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  if (referralCode) localStorage.setItem("qingtian_referral_code", referralCode);
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const oauthToken = params.get("github_token");
  if (oauthToken) {
    localStorage.setItem(TOKEN_KEY, oauthToken);
    localStorage.removeItem("qingtian_referral_code");
    params.delete("github_token");
    const cleanHash = params.toString();
    history.replaceState(null, "", window.location.pathname + window.location.search + (cleanHash ? "#" + cleanHash : ""));
  }
})();
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
  return Number.isFinite(n) ? "¥" + n.toFixed(2) : "价格暂不可用";
}

function displayProductName(item) {
  const raw = String(item?.name || item?.title || "数字商品");
  const cleaned = raw
    .replace(/^\s*\[货号\s*\d+\]\s*/i, "")
    .replace(/^\s*货号\s*[:：#]?\s*\d+\s*/i, "")
    .replace(/^[🟥🟦🟩🟨🟪⬛⬜🔴🟢🔵🟡🟣⭐️✨]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "数字商品";
}
const SHOP_I18N = {
 zh:{loggedIn:"已登录",balanceLabel:"账户余额",accountInfo:"账户信息",inviteRewards:"邀请奖励",orderHistory:"历史订单",support:"联系客服",language:"语言",logout:"退出登录",home:"首页",myAccount:"我的账户",shopping:"商品购买",allProducts:"全部商品",catalogHeading:"上架商品",productHeading:"商品购买",searchResults:"搜索结果",heroEyebrow:"晴天号铺 · 商品商城",heroTitle:"精选账号与数字商品",heroSubtitle:"安全选购 · 即时交付",heroCopy:"商品售价与库存以最新同步数据为准，下单时会再次核验商品状态。",tagStock:"库存核验",tagPrice:"明码标价",tagDelivery:"在线交付",catalogEyebrow:"商品购买",refreshProducts:"刷新商品 ↻",searchPlaceholder:"搜索商品名称…",category:"商品分类",allCategories:"全部分类",sort:"商品排序",defaultSort:"默认排序",priceLowHigh:"价格从低到高",priceHighLow:"价格从高到低",stockHighLow:"库存从高到低",loadingCatalog:"正在连接商品目录…",noProducts:"暂无上架商品",noMatches:"没有找到符合条件的商品",stockLabel:"库存",buyNow:"立即购买",notAvailable:"暂不可购买",submitting:"提交订单…",checking:"正在核验商品与余额…",delivered:"购买成功，卡密已交付。",insufficient:"余额不足，请先联系客户充值。",catalogUpdated:"商品目录已更新。",catalogStale:"库存数据已超过30分钟未同步，商品暂时停止购买。",catalogEmpty:"暂无上架商品。",catalogFailed:"目录连接失败，请稍后重试。",temporaryError:"网络暂时不可用，已保留登录状态。请点击刷新目录重试。"},
 en:{loggedIn:"Signed in",balanceLabel:"Account balance",accountInfo:"Account details",inviteRewards:"Referral rewards",orderHistory:"Order history",support:"Support",language:"Language",logout:"Sign out",home:"Home",myAccount:"My account",shopping:"Shop",allProducts:"All products",catalogHeading:"Available products",productHeading:"Shop products",searchResults:"Search results",heroEyebrow:"Qingtian Store · Digital goods",heroTitle:"Selected accounts and digital goods",heroSubtitle:"Shop securely · Instant delivery",heroCopy:"Prices and stock reflect the latest catalog sync. Product availability is checked again when ordering.",tagStock:"Stock verified",tagPrice:"Clear pricing",tagDelivery:"Online delivery",catalogEyebrow:"Shop products",refreshProducts:"Refresh ↻",searchPlaceholder:"Search products…",category:"Category",allCategories:"All categories",sort:"Sort products",defaultSort:"Default sort",priceLowHigh:"Price: low to high",priceHighLow:"Price: high to low",stockHighLow:"Stock: high to low",loadingCatalog:"Connecting to product catalog…",noProducts:"No products available",noMatches:"No matching products found",stockLabel:"Stock",buyNow:"Buy now",notAvailable:"Unavailable",submitting:"Submitting…",checking:"Checking product and balance…",delivered:"Purchase complete. Your code has been delivered.",insufficient:"Insufficient balance. Please contact support to top up.",catalogUpdated:"Product catalog updated.",catalogStale:"Inventory has not synced for over 30 minutes. Purchases are temporarily paused.",catalogEmpty:"No products available.",catalogFailed:"Could not connect to the catalog. Please try again.",temporaryError:"Network unavailable. Your session is saved; refresh the catalog to retry."}
};
function currentShopLanguage(){return localStorage.getItem("qingtian_shop_language")==="en"?"en":"zh";}
function updateShopHeading(){
 const heading=$("catalogHeading")||document.querySelector(".section-heading h2");
 if(!heading)return;
 const dict=SHOP_I18N[currentShopLanguage()];
 heading.textContent=document.body.dataset.shopView==="products"?dict.allProducts:dict.catalogHeading;
}
function setShopView(view, options={}){
 const next=view==="products"?"products":view==="nodes"?"nodes":"home";
 document.body.dataset.shopView=next;
 document.querySelectorAll("[data-shop-view]").forEach(link=>{
  const active=link.dataset.shopView===next;
  link.classList.toggle("is-active",active);
  if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
 });
 updateShopHeading();
 if(options.scroll&&next==="products")$("catalog")?.scrollIntoView({behavior:"smooth",block:"start"});
 else if(options.scroll&&next==="nodes")$("nodeCatalog")?.scrollIntoView({behavior:"smooth",block:"start"});
 else if(options.scroll&&next==="home")window.scrollTo({top:0,behavior:"smooth"});
}

function applyShopLanguage(){
 const lang=currentShopLanguage(),dict=SHOP_I18N[lang];document.documentElement.lang=lang==="en"?"en":"zh-CN";
 document.querySelectorAll("[data-i18n]").forEach(el=>{const v=dict[el.dataset.i18n];if(v===undefined)return;const tail=el.lastElementChild;if(tail){el.textContent=v+" ";el.appendChild(tail);}else el.textContent=v;});
 document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{const v=dict[el.dataset.i18nPlaceholder];if(v!==undefined)el.placeholder=v;});
 const label=$("languageToggleLabel");if(label)label.textContent=lang==="zh"?"English":"中文";updateShopHeading();
 const category=$("categoryFilter"),sort=$("sortProducts");if(category?.options[0])category.options[0].textContent=dict.allCategories;
 if(sort?.options.length>=4){sort.options[0].textContent=dict.defaultSort;sort.options[1].textContent=dict.priceLowHigh;sort.options[2].textContent=dict.priceHighLow;sort.options[3].textContent=dict.stockHighLow;}
}
function setAvatar(imageId,initialId,url,initial){const image=$(imageId),fallback=$(initialId);if(!image||!fallback)return;if(url){image.src=url;image.hidden=false;fallback.hidden=true;}else{image.removeAttribute("src");image.hidden=true;fallback.hidden=false;fallback.textContent=initial||"晴";}}

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

function initPolicyModal(){
 const policyModal = $("policyModal");
 if(!policyModal)return;
 const policyModalTitle = $("policyModalTitle");
 const policyModalContent = $("policyModalContent");
 const closeButton = $("policyModalClose");
 const confirmButton = $("policyModalConfirm");
 let previousBodyOverflow = "";
 let returnFocus = null;
 const closePolicyModal = () => {
  if(policyModal.hidden)return;
  policyModal.hidden = true;
  policyModal.setAttribute("aria-hidden","true");
  document.body.style.overflow = previousBodyOverflow;
  if(returnFocus && typeof returnFocus.focus === "function")returnFocus.focus();
 };
 // 捕获阶段统一拦截所有协议/隐私入口，避免其他监听器或默认 href 导航抢先执行
 document.addEventListener("click",event=>{
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const link = target && target.closest('a[data-policy],a[href*="terms.html"],a[href*="privacy.html"]');
  if(!link)return;
  const href = (link.getAttribute("href") || "").toLowerCase();
  const policyType = link.dataset.policy || (href.includes("terms.html") ? "terms" : "privacy");
  if(policyType !== "terms" && policyType !== "privacy")return;
  event.preventDefault();
  event.stopPropagation();
  if(event.stopImmediatePropagation)event.stopImmediatePropagation();
  const isTerms = policyType === "terms";
  policyModalTitle.textContent = isTerms
   ? (authLanguage === "en" ? "Terms of Service" : "用户协议")
   : (authLanguage === "en" ? "Privacy Policy" : "隐私政策");
  const policyTemplate = $(isTerms ? "termsPolicyTemplate" : "privacyPolicyTemplate");
  policyModalContent.innerHTML = policyTemplate ? policyTemplate.innerHTML : "";
  previousBodyOverflow = document.body.style.overflow;
  returnFocus = link;
  policyModal.hidden = false;
  policyModal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
  closeButton && closeButton.focus();
 },true);
 if(closeButton)closeButton.addEventListener("click",closePolicyModal);
 if(confirmButton)confirmButton.addEventListener("click",closePolicyModal);
 policyModal.addEventListener("click",event=>{
  if(event.target === policyModal)closePolicyModal();
 });
 document.addEventListener("keydown",event=>{
  if(event.key === "Escape" && !policyModal.hidden)closePolicyModal();
 });
}

function initAuth(){
 if(token()){localStorage.removeItem("qingtian_referral_code");location.replace("./shop.html");return;}
 const form=$("authForm"),send=$("sendCode"),msg=$("authMessage"),login=$("loginButton"),email=$("email"),code=$("code");
 const emailError=$("emailError"),codeError=$("codeError"),password=$("password"),confirmPassword=$("confirmPassword"),passwordError=$("passwordError"),confirmPasswordError=$("confirmPasswordError"),legalError=$("legalError");let cooldown=0,timer=null;window.authCodeCooldown=0;
 const languageToggle=$("languageToggle");if(languageToggle)languageToggle.addEventListener("click",()=>setAuthLanguage(authLanguage==="zh"?"en":"zh"));setAuthLanguage(authLanguage);initParticleBackground();

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
   await api("/api/auth/send_code",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase(),referral_code:localStorage.getItem("qingtian_referral_code")||""})});
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
   localStorage.removeItem("qingtian_referral_code");
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
  const data = await api("/api/user/info"), user = data.user || {};
  const email = String(user.email || "晴天用户"), nickname = String(user.nickname || "我的账户");
  const initial = (nickname.trim()[0] || email.trim()[0] || "晴").toUpperCase();
  $("accountEmail").textContent = email; $("accountName").textContent = nickname;
  const triggerName = $("accountTriggerName"); if (triggerName) triggerName.textContent = nickname || "晴天";
  setAvatar("avatarImage","avatarInitial",user.avatar_url,initial);
  setAvatar("avatarImageLarge","avatarInitialLarge",user.avatar_url,initial);
  $("balance").textContent = "¥" + Number(user.balance_cny ?? (Number(user.balance || 0) * 4)).toFixed(2);
}

let allProducts = [];

const PRODUCT_SOURCE_ICONS = {
  "shop-amazon-circle-fill": "amazon",
  "shop-discord": "discord",
  "shop-google-voice-logo": "googlevoice",
  "shop-google": "google",
  "shop-instagram": "instagram",
  "shop-linkedin": "linkedin",
  "shop-skype": "skype",
  "shop-steam": "steam",
  "shop-tiktok": "tiktok",
  "shop-telegram": "telegram",
  "shop-textnow": "textnow",
  "shop-twitter-circle-fill": "x",
  "shop-whatsapp": "whatsapp",
  "shop-yahoo": "yahoo",
  "shop-youtube": "youtube",
  "shop-facebook": "facebook",
  "shop-microsoft": "microsoft",
  "shop-apple": "apple"
};

const PRODUCT_BRAND_ICONS = [
  [/chatgpt|openai|gpt[- ]?4|gpt[- ]?5/i, "openai"],
  [/claude|anthropic/i, "claude"],
  [/gemini|google ai/i, "googlegemini"],
  [/discord/i, "discord"],
  [/telegram/i, "telegram"],
  [/spotify/i, "spotify"],
  [/netflix/i, "netflix"],
  [/youtube/i, "youtube"],
  [/tiktok/i, "tiktok"],
  [/instagram/i, "instagram"],
  [/facebook|meta/i, "facebook"],
  [/whatsapp/i, "whatsapp"],
  [/microsoft|office 365|office365|onedrive|outlook/i, "microsoft"],
  [/windows/i, "windows"],
  [/apple|icloud/i, "apple"],
  [/adobe|photoshop|premiere/i, "adobe"],
  [/steam/i, "steam"],
  [/github/i, "github"],
  [/notion/i, "notion"],
  [/canva/i, "canva"],
  [/figma/i, "figma"],
  [/dropbox/i, "dropbox"],
  [/zoom/i, "zoom"],
  [/perplexity/i, "perplexity"],
  [/capcut/i, "capcut"],
  [/midjourney/i, "midjourney"],
  [/cursor/i, "cursor"],
  [/vscode|visual studio code/i, "visualstudiocode"],
  [/x\.com|twitter/i, "x"],
  [/amazon/i, "amazon"],
  [/google voice/i, "googlevoice"],
  [/google|gmail/i, "google"],
  [/linkedin/i, "linkedin"],
  [/skype|teams/i, "skype"],
  [/textnow/i, "textnow"],
  [/yahoo/i, "yahoo"]
];

function productBrandIcon(item) {
  const name = String(item.name || "");
  const custom = [item.icon_url, item.logo_url, item.image_url].find(value =>
    typeof value === "string" && /^https:\/\//i.test(value)
  );
  if (custom) return custom;
  const sourceIcon = String(item.icon || item.source?.Icon || "").trim().toLowerCase();
  const slug = PRODUCT_SOURCE_ICONS[sourceIcon] ||
    PRODUCT_BRAND_ICONS.find(([pattern]) => pattern.test(name))?.[1];
  return slug ? "https://cdn.simpleicons.org/" + slug : "";
}

function createProductCover(item) {
  const wrap=document.createElement("div");
  wrap.className="product-cover";
  const candidates=[item.image_url,item.cover_url,item.product_image_url,item.banner_url,item.image];
  const imageUrl=candidates.find(value=>typeof value==="string"&&(value.startsWith("https://")||value.startsWith("http://")));
  const fallback=()=>{
    const art=document.createElement("div");art.className="product-cover-art";
    const label=document.createElement("span");label.className="product-cover-kicker";label.textContent=String(item.category||"DIGITAL GOODS");
    const name=document.createElement("strong");name.textContent=displayProductName(item);
    const sub=document.createElement("small");sub.textContent="QINGTIAN · DIGITAL STORE";
    art.append(label,name,sub);wrap.replaceChildren(art);
  };
  if(imageUrl){
    const image=document.createElement("img");image.className="product-cover-image";image.alt=displayProductName(item);image.loading="lazy";image.decoding="async";image.referrerPolicy="no-referrer";image.src=imageUrl;
    image.addEventListener("error",fallback,{once:true});wrap.append(image);
  }else fallback();
  return wrap;
}

function createProductIcon(item) {
  const wrap = document.createElement("div");
  wrap.className = "product-icon-wrap";
  const fallback = document.createElement("span");
  fallback.className = "product-icon-fallback";
  fallback.textContent = (displayProductName(item).trim().charAt(0) || "软").toUpperCase();
  fallback.setAttribute("aria-hidden", "true");
  const iconUrl = productBrandIcon(item);
  if (!iconUrl) {
    wrap.appendChild(fallback);
    return wrap;
  }
  const image = document.createElement("img");
  image.className = "product-icon-image";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = iconUrl;
  image.addEventListener("error", () => {
    image.remove();
    wrap.appendChild(fallback);
  }, { once: true });
  wrap.appendChild(image);
  return wrap;
}

function drawFilteredProducts() {
  const grid = $("productGrid");
  const query = String($("productSearch")?.value || "").trim().toLowerCase();
  const category = String($("categoryFilter")?.value || "");
  const sort = String($("sortProducts")?.value || "default");
  let items = allProducts.filter(item => {
    const name = String(item.name || "").toLowerCase();
    const rawCategory = String(item.category || "").trim();
    return (!query || name.includes(query) || rawCategory.toLowerCase().includes(query)) &&
      (!category || rawCategory === category);
  });
  if (sort === "price-asc") items.sort((a,b) => Number(a.price_cny ?? Number(a.price_usdt || 0) * 4) - Number(b.price_cny ?? Number(b.price_usdt || 0) * 4));
  if (sort === "price-desc") items.sort((a,b) => Number(b.price_cny ?? Number(b.price_usdt || 0) * 4) - Number(a.price_cny ?? Number(a.price_usdt || 0) * 4));
  if (sort === "stock-desc") items.sort((a,b) => Number(b.stock || 0) - Number(a.stock || 0));
  grid.replaceChildren();
  if (!items.length) {
    const t=SHOP_I18N[currentShopLanguage()];grid.appendChild(safeText("div","empty-card",allProducts.length?t.noMatches:t.noProducts));
    return;
  }
  const fragment = document.createDocumentFragment();
  const categoryNames = currentShopLanguage()==="en"
    ? {"digital":"Digital goods","account":"Account products","accounts":"Account products","discord":"Discord accounts","game":"Game accounts","software":"Software services","subscription":"Subscriptions","其他":"Other products","其他商品":"Other products","数字商品":"Digital goods","账号商品":"Account products","Discord 账号":"Discord accounts","游戏账号":"Game accounts","软件服务":"Software services","订阅服务":"Subscriptions"}
    : {"digital":"数字商品","account":"账号商品","accounts":"账号商品","discord":"Discord 账号","game":"游戏账号","software":"软件服务","subscription":"订阅服务","其他":"其他商品"};
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const card = document.createElement("article");
    card.className = "product-card shop-product-card";
    const rawCategory = String(item.category || "").trim();
    const categoryLabel = categoryNames[rawCategory.toLowerCase()] || categoryNames[rawCategory] || rawCategory || "商品";
    card.appendChild(createProductCover(item));
    const cardHead = document.createElement("div");
    cardHead.className = "product-card-head";
    cardHead.appendChild(createProductIcon(item));
    const titleWrap = document.createElement("div");
    titleWrap.className = "product-title-wrap";
    titleWrap.appendChild(safeText("div", "product-category", categoryLabel, "商品"));
    titleWrap.appendChild(safeText("h3", "product-name", displayProductName(item), "未命名商品"));
    cardHead.appendChild(titleWrap);
    card.appendChild(cardHead);
    const description = String(item.description || item.description_zh || item.summary || "").trim();
    if (description) card.appendChild(safeText("p", "product-description", description, ""));
    const meta = document.createElement("div");
    meta.className = "product-meta";
    meta.appendChild(safeText("div","product-price",formatPrice(item.price_cny ?? Number(item.price_usdt || 0)*4)));
    meta.appendChild(safeText("div","product-stock",SHOP_I18N[currentShopLanguage()].stockLabel+" "+Number(item.stock||0)));
    card.appendChild(meta);
    const stock = Number(item.stock || 0);
    const stockLine = document.createElement("div");
    stockLine.className = "product-stock-track";
    const stockFill = document.createElement("span");
    stockFill.style.width = stock > 0 ? Math.max(8, Math.min(100, stock * 5)) + "%" : "0%";
    stockLine.appendChild(stockFill);
    card.appendChild(stockLine);
    const buyButton = document.createElement("button");
    buyButton.type = "button";
    buyButton.className = "primary-button buy-button";
    buyButton.textContent = item.purchasable === false ? SHOP_I18N[currentShopLanguage()].notAvailable : SHOP_I18N[currentShopLanguage()].buyNow;
    buyButton.disabled = item.purchasable === false;
    buyButton.addEventListener("click", () => purchase(item, buyButton));
    card.appendChild(buyButton);
    fragment.appendChild(card);
  }
  if (!fragment.childElementCount) grid.appendChild(safeText("div", "empty-card", "暂无上架商品"));
  else grid.appendChild(fragment);
}

function renderProducts(items) {
  allProducts = Array.isArray(items) ? items.filter(item => item && typeof item === "object") : [];
  const select = $("categoryFilter");
  const current = select.value;
  const categories = [...new Set(allProducts.map(item => String(item.category || "").trim()).filter(Boolean))];
  select.replaceChildren(new Option(SHOP_I18N[currentShopLanguage()].allCategories, ""));
  const categoryNames = currentShopLanguage()==="en"
    ? {"digital":"Digital goods","account":"Account products","accounts":"Account products","discord":"Discord accounts","game":"Game accounts","software":"Software services","subscription":"Subscriptions","其他":"Other products","其他商品":"Other products","数字商品":"Digital goods","账号商品":"Account products","Discord 账号":"Discord accounts","游戏账号":"Game accounts","软件服务":"Software services","订阅服务":"Subscriptions"}
    : {"digital":"数字商品","account":"账号商品","accounts":"账号商品","discord":"Discord 账号","game":"游戏账号","software":"软件服务","subscription":"订阅服务","其他":"其他商品"};
  for (const category of categories) {
    const label = categoryNames[category.toLowerCase()] || categoryNames[category] || category;
    select.add(new Option(label, category));
  }
  if (categories.includes(current)) select.value = current;
  drawFilteredProducts();
}

async function loadProducts() {
  const grid = $("productGrid");
  grid.replaceChildren(safeText("div", "loading-card", SHOP_I18N[currentShopLanguage()].loadingCatalog));
  try {
    const data = await api("/api/products");
    renderProducts(data.items || []);
    const t=SHOP_I18N[currentShopLanguage()];
    if (data.catalog_stale === true) message($("shopMessage"),t.catalogStale,"error");
    else message($("shopMessage"),data.count?t.catalogUpdated:t.catalogEmpty,"success");
  } catch {
    grid.replaceChildren(safeText("div", "empty-card", "商品目录暂时无法加载，请稍后刷新。"));
    message($("shopMessage"),SHOP_I18N[currentShopLanguage()].catalogFailed,"error");
  }
}


async function loadNodeProducts() {
  const grid=$("nodeProductGrid");
  if(!grid)return;
  grid.replaceChildren(safeText("div","loading-card","正在读取自营节点套餐…"));
  try{
    const data=await api("/api/node-products"),items=Array.isArray(data.products)?data.products:[];
    grid.replaceChildren();
    if(!items.length){grid.appendChild(safeText("div","empty-card","节点套餐暂未开放，请稍后刷新。"));return;}
    const labels={vless:"VLESS Reality",vmess:"VMess",socks5:"SOCKS5",hysteria2:"Hysteria2",mtproto:"Telegram MTProto"};
    for(const item of items){
      const card=document.createElement("article");card.className="product-card node-product-card";
      const head=document.createElement("div");head.className="product-card-head";
      const icon=document.createElement("div");icon.className="product-icon-wrap";icon.appendChild(safeText("span","product-icon-fallback",item.protocol==="mtproto"?"T":String(item.name||"节").slice(0,1)));
      const title=document.createElement("div");title.className="product-title-wrap";
      title.appendChild(safeText("div","product-category","自营节点"));
      title.appendChild(safeText("h3","product-name",item.name||labels[item.protocol]||"节点线路"));
      head.append(icon,title);card.append(head);
      card.appendChild(safeText("span","node-protocol-tag",labels[item.protocol]||item.protocol));
      card.appendChild(safeText("span","node-protocol-tag",item.provisioning_ready?"已接入":"接入准备中"));
      card.appendChild(safeText("p","product-description",item.description||"自有服务器线路，购买后自动开通。"));
      const plans=document.createElement("div");plans.className="node-plan-list";
      for(const pkg of item.packages||[]){
        const button=document.createElement("button");button.type="button";button.className="node-plan-button";
        const span=document.createElement("span");span.textContent=pkg.name||String(pkg.duration_days)+" 天";
        const price=document.createElement("strong");price.textContent="¥"+Number(pkg.price_cny||0).toFixed(2);
        button.append(span,price);
        button.addEventListener("click",()=>buyNodePackage(pkg,button,item.protocol));
        plans.append(button);
      }
      if(!plans.childElementCount)plans.append(safeText("div","empty-card",item.server_present?"套餐准备中":"线路接入中"));
      card.append(plans);grid.append(card);
    }
  }catch(error){
    grid.replaceChildren(safeText("div","empty-card","节点套餐暂时无法加载，请稍后刷新。"));
    message($("nodeShopMessage"),"节点服务暂时不可用。","error");
  }
}
async function buyNodePackage(pkg,button,protocol){
  if(button.disabled)return;
  button.disabled=true;
  const old=button.innerHTML;button.textContent="正在开通…";
  message($("nodeShopMessage"),"正在扣除余额并开通节点，请勿重复提交。");
  try{
    const result=await api("/api/user/node-orders",{
      method:"POST",
      headers:{"Idempotency-Key":crypto.randomUUID()},
      body:JSON.stringify({package_id:pkg.package_id})
    });
    if(result.status!=="fulfilled"||!result.delivery)throw new Error(result.error||result.status||"node_provision_failed");
    showNodeDelivery(result.delivery);
    message($("nodeShopMessage"),"节点已开通，配置已生成。","success");
    await loadUser();
  }catch(error){
    const text=error.status===402||error.message==="insufficient_balance"?"余额不足，请先充值。":
      error.message==="node_package_unavailable"?"该套餐暂不可购买。":
      "节点开通未完成，若余额发生变化请到账户信息查看订单状态。";
    message($("nodeShopMessage"),text,"error");
  }finally{
    button.disabled=false;
    button.innerHTML=old;
  }
}
function showNodeDelivery(delivery){
  let content=delivery.clash_yaml||delivery.uri||"";
  if(delivery.http_uri){
    const sections=[];
    if(delivery.uri)sections.push("HTTPS 连接\n"+delivery.uri);
    sections.push("HTTP 连接\n"+delivery.http_uri);
    if(delivery.clash_yaml)sections.push("Clash 配置\n"+delivery.clash_yaml);
    content=sections.join("\n\n");
  }
  $("deliveryTitle").textContent=delivery.protocol==="mtproto"?"Telegram 代理已开通":"节点已开通";
  $("deliveryContent").textContent=content;
  $("copyDelivery").textContent=delivery.protocol==="mtproto"?"复制 Telegram 链接":delivery.http_uri?"复制 HTTP/HTTPS 配置":"复制 Clash 配置";
  const modalCopy=document.querySelector(".modal-copy");
  if(modalCopy)modalCopy.textContent=delivery.http_uri?"HTTP、HTTPS 与 Clash 配置已生成，请分别选择适合的客户端使用。":delivery.instructions||"请立即复制并保存节点配置。";
  $("deliveryModal").hidden=false;
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
  button.textContent=SHOP_I18N[currentShopLanguage()].submitting;
  message($("shopMessage"),SHOP_I18N[currentShopLanguage()].checking);
  const idempotencyKey = crypto.randomUUID();
  try {
    const result = await api("/api/buy", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ product_id: item.product_id })
    });
    if (result.status === "delivered" && result.content) {
      showDelivery(result.content);
      message($("shopMessage"),SHOP_I18N[currentShopLanguage()].delivered,"success");
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
      message($("shopMessage"),SHOP_I18N[currentShopLanguage()].insufficient,"error");
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
  const year = $("year");
  if (year) year.textContent = String(new Date().getFullYear());
  $("logout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.replace("./auth.html");
  });
  applyShopLanguage();
  document.querySelectorAll("[data-shop-view]").forEach(link=>link.addEventListener("click",event=>{
    event.preventDefault();
    setShopView(link.dataset.shopView,{scroll:true});
  }));
  const accountToggle=$("accountMenuToggle"),accountMenu=$("accountMenu");
  accountToggle?.addEventListener("click",()=>{
    const opening=accountMenu.hidden;
    accountMenu.hidden=!opening;
    accountToggle.setAttribute("aria-expanded",String(opening));
  });
  document.addEventListener("click",event=>{
    if(accountMenu&&!accountMenu.hidden&&!event.target.closest(".account-menu-wrap")){
      accountMenu.hidden=true;accountToggle?.setAttribute("aria-expanded","false");
    }
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&accountMenu&&!accountMenu.hidden){accountMenu.hidden=true;accountToggle?.setAttribute("aria-expanded","false");accountToggle?.focus();}
  });
  setShopView("home");
  const languageToggle=$("languageToggle");
  if(languageToggle)languageToggle.addEventListener("click",()=>{localStorage.setItem("qingtian_shop_language",currentShopLanguage()==="zh"?"en":"zh");applyShopLanguage();if(allProducts.length)drawFilteredProducts();});
  $("productSearch").addEventListener("input", () => {drawFilteredProducts();updateShopHeading();});
  $("categoryFilter").addEventListener("change", () => {drawFilteredProducts();updateShopHeading();});
  $("sortProducts").addEventListener("change", drawFilteredProducts);
  $("refreshProducts").addEventListener("click", loadProducts);
  $("refreshNodeProducts")?.addEventListener("click",loadNodeProducts);
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
  loadUser().catch(error => {
    // Do not block public catalog requests when account-profile hydration is unavailable.
    const code=String(error?.message||"");
    const invalidSession=error?.status===401||["auth_required","invalid_token","token_expired","token_revoked"].includes(code);
    if(invalidSession){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");return;}
    message($("shopMessage"),SHOP_I18N[currentShopLanguage()].temporaryError,"error");
  }).finally(()=>{
    if(token()){loadProducts();loadNodeProducts();}
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "auth" || page === "login") initPolicyModal();
  if (page === "auth") initAuth();
  if (document.body.dataset.page === "shop") initShop();
});
