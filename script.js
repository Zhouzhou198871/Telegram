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
const SHOP_I18N = {
 zh:{loggedIn:"已登录",balanceLabel:"账户余额",accountInfo:"账户信息",inviteRewards:"邀请奖励",orderHistory:"历史订单",support:"联系客服",language:"语言",logout:"退出登录",home:"首页",myAccount:"我的账户",shopping:"商品购买",allProducts:"全部商品",catalogHeading:"上架商品",productHeading:"商品购买",searchResults:"搜索结果",heroEyebrow:"晴天号铺 · 商品商城",heroTitle:"精选账号与数字商品",heroSubtitle:"安全选购 · 即时交付",heroCopy:"商品库存与售价实时读取，支持在线下单。下单前请核对商品信息。",tagStock:"实时库存",tagPrice:"明码标价",tagDelivery:"在线交付",catalogEyebrow:"商品购买",searchPlaceholder:"搜索商品名称…",category:"商品分类",allCategories:"全部分类",sort:"商品排序",defaultSort:"默认排序",priceLowHigh:"价格从低到高",priceHighLow:"价格从高到低",stockHighLow:"库存从高到低",loadingCatalog:"正在加载商品…",noProducts:"暂无上架商品",noMatches:"没有找到符合条件的商品",stockLabel:"库存",buyNow:"立即购买",notAvailable:"暂不可购买",submitting:"提交订单…",checking:"正在核验商品与余额…",delivered:"购买成功，卡密已交付。",insufficient:"余额不足，请先联系客户充值。",catalogUpdated:"商品目录已更新。",catalogStale:"商品信息暂未完成更新，相关商品已暂停购买。",catalogEmpty:"暂无上架商品。",catalogFailed:"商品目录暂时不可用，请稍后重试。",temporaryError:"网络暂时不可用，已保留登录状态。请稍后再试。"}
};
function currentShopLanguage(){return "zh";}
function updateShopHeading(){
 const heading=$("catalogHeading")||document.querySelector(".section-heading h2");
 if(!heading)return;
 const dict=SHOP_I18N[currentShopLanguage()];
 heading.textContent=document.body.dataset.shopView==="products"?dict.allProducts:dict.catalogHeading;
}
function setShopView(view, options={}){
 const next=view==="products"?"products":"home";
 document.body.dataset.shopView=next;
 document.querySelectorAll("[data-shop-view]").forEach(link=>{
  const active=link.dataset.shopView===next;
  link.classList.toggle("is-active",active);
  if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
 });
 updateShopHeading();
 if(options.scroll&&next==="products")$("catalog")?.scrollIntoView({behavior:"smooth",block:"start"});
 else if(options.scroll&&next==="home")window.scrollTo({top:0,behavior:"smooth"});
}

function applyShopLanguage(){
 document.documentElement.lang="zh-CN";
 const dict=SHOP_I18N.zh;
 document.querySelectorAll("[data-i18n]").forEach(el=>{const v=dict[el.dataset.i18n];if(v===undefined)return;const tail=el.lastElementChild;if(tail){el.textContent=v+" ";el.appendChild(tail);}else el.textContent=v;});
 document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{const v=dict[el.dataset.i18nPlaceholder];if(v!==undefined)el.placeholder=v;});
 updateShopHeading();
 const category=$("categoryFilter"),sort=$("sortProducts");if(category?.options[0])category.options[0].textContent=dict.allCategories;
 if(sort?.options.length>=4){sort.options[0].textContent=dict.defaultSort;sort.options[1].textContent=dict.priceLowHigh;sort.options[2].textContent=dict.priceHighLow;sort.options[3].textContent=dict.stockHighLow;}
}
function setAvatar(imageId,initialId,url,initial){const image=$(imageId),fallback=$(initialId);if(!image||!fallback)return;if(url){image.src=url;image.hidden=false;fallback.hidden=true;}else{image.removeAttribute("src");image.hidden=true;fallback.hidden=false;fallback.textContent=initial||"晴";}}

const AUTH_I18N = {
 zh:{eyebrow:"邮箱安全验证",title:"欢迎回来",subtitle:"使用邮箱验证码，安全进入你的晴天号铺账户。",support:"联系客服 ↗",emailLabel:"邮箱地址",codeLabel:"邮箱验证码",codePlaceholder:"输入 6 位验证码",sendCode:"获取验证码",sending:"发送中…",resend:"重新获取",retry:" 秒后重试",login:"安全登录",logging:"正在登录…",agreePrefix:"我已阅读并同意",terms:"用户协议",privacy:"隐私政策",securityNote:"验证码 5 分钟内有效，请勿向任何人透露。",invalidEmail:"请输入有效的邮箱地址。",invalidCode:"请输入 6 位数字验证码。",needAgreement:"请先勾选并同意用户协议和隐私政策。",passwordLabel:"设置密码",confirmPasswordLabel:"确认密码",passwordPlaceholder:"请设置8-20位包含字母和数字的密码",confirmPasswordPlaceholder:"请再次输入密码",invalidPassword:"密码须为8-20位，且同时包含字母和数字。",passwordMismatch:"两次输入的密码不一致",registered:"该邮箱已注册，请直接登录或更换邮箱。",sent:"验证码已发送，请检查邮箱。",sendFailed:"验证码发送失败，请稍后重试。",tooMany:"发送过于频繁，请稍后再试。",wrongCode:"验证码不正确。",expired:"验证码已过期，请重新获取。",tooManyAttempts:"验证次数过多，请重新获取验证码。",loginFailed:"登录失败，请检查验证码后重试。",requestTimeout:"服务器响应超时，请稍后重试。",networkError:"网络连接失败，请检查网络后重试。",serverError:"服务器暂时出现故障，请稍后重试。"}
};
const authText=key=>AUTH_I18N.zh[key]||key;
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
   ? ("用户协议")
   : ("隐私政策");
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
 initParticleBackground();

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
   const normalizedEmail=email.value.trim().toLowerCase();
   const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:normalizedEmail,code:code.value.trim(),password:passwordValue})});
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
   login.querySelector(".login-button-text").textContent=document.body.dataset.authMode==="register"?("注册并登录"):authText("login");
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
let visibleProductLimit = 48;
let catalogLoadInFlight = false;

function createProductCover(item) {
  const wrap=document.createElement("div");
  wrap.className="product-cover";
  const candidates=[item.image_url,item.cover_url,item.product_image_url,item.banner_url,item.image];
  const imageUrl=candidates.find(value=>typeof value==="string"&&(value.startsWith("https://")||value.startsWith("http://")));
  const fallback=()=>{
    const art=document.createElement("div");art.className="product-cover-art";
    const label=document.createElement("span");label.className="product-cover-kicker";label.textContent=String(item.category||"DIGITAL GOODS");
    const name=document.createElement("strong");name.textContent=cleanProductTitle(item.name);
    const sub=document.createElement("small");sub.textContent="QINGTIAN · DIGITAL STORE";
    art.append(label,name,sub);wrap.replaceChildren(art);
  };
  if(imageUrl){
    const image=document.createElement("img");image.className="product-cover-image";image.alt=String(item.name||"商品图片");image.loading="lazy";image.decoding="async";image.referrerPolicy="no-referrer";image.src=imageUrl;
    image.addEventListener("error",fallback,{once:true});wrap.append(image);
  }else fallback();
  return wrap;
}

function createProductIcon(item) {
  const wrap = document.createElement("div");
  wrap.className = "product-icon-wrap";
  const fallback = document.createElement("span");
  fallback.className = "product-icon-fallback";
  fallback.textContent = (String(item.name || "软").trim().charAt(0) || "软").toUpperCase();
  fallback.setAttribute("aria-hidden", "true");
  const isGoogleGmail = /google.*gmail|gmail.*google/i.test(String(item.name || ""));
  const iconUrl = isGoogleGmail
    ? "https://play-lh.googleusercontent.com/c6KD_8-GvnGRJA4lRQ4y5YnUa3-LOeYAS7ubw1jWyB9bmr6Kj6zzRvh2A5WBB-Vd3e6zhElmhDv07fCJx2Fc=w240-h480"
    : String(item.icon_url || "").trim();
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

const PRODUCT_CACHE_KEY = "qingtian_legacy_catalog_cache_v3";
const PRODUCT_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function cleanProductTitle(value) {
  return String(value || "")
    .replace(/^\s*\[货号[^\]]*\]\s*/i, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .split(/[|｜]/)[0]
    .replace(/\s+/g, " ")
    .trim() || "数字商品";
}

function cleanProductDescription(item) {
  const raw = String(item.description || item.description_zh || item.summary || item.name || "");
  const parts = raw.split(/[|｜]/).map(x => x.trim()).filter(Boolean);
  const details = parts.length > 1 ? parts.slice(1) : [];
  const text = details
    .filter(x => !/^\[?货号/i.test(x) && !/单次最多购买|最多购买\s*\d+/i.test(x))
    .join(" · ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 76 ? text.slice(0, 73) + "…" : text;
}

function readCachedProducts() {
  try {
    const cached = JSON.parse(localStorage.getItem(PRODUCT_CACHE_KEY) || "null");
    if (!cached || !Array.isArray(cached.items) || !cached.items.length) return false;
    renderProducts(cached.items, { verified: false });
    return true;
  } catch { return false; }
}

function saveCachedProducts(items) {
  try {
    localStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify({
      saved_at: Date.now(),
      items: items.map(item => ({
        product_id: item.product_id, name: item.name, category: item.category,
        icon: item.icon, icon_url: item.icon_url, is_hot: item.is_hot === true, is_recommend: item.is_recommend === true, price_cny: item.price_cny, price_usdt: item.price_usdt,
        stock: item.stock, purchasable: item.purchasable, legacy_migrated: item.legacy_migrated === true
      }))
    }));
  } catch {}
}

function drawFilteredProducts() {
  const grid = $("productGrid");
  const query = String($("productSearch")?.value || "").trim().toLowerCase();
  const category = String($("categoryFilter")?.value || "");
  const sort = String($("sortProducts")?.value || "default");
  let items = allProducts.filter(item => {
    const name = String(item.name || "").toLowerCase();
    const rawCategory = String(item.category || "").trim();
    const searchable = [
      item.name, item.category, item.product_id, item.supplier_product_id, item.icon
    ].filter(Boolean).join(" ").toLowerCase();
    return (!query || searchable.includes(query)) &&
      (!category || rawCategory === category);
  });
  if (sort === "default") {
    const popularity = item => {
      const upstreamPriority = (item.is_hot === true || String(item.is_hot).toLowerCase() === "true" ? 120 : 0) + (item.is_recommend === true || String(item.is_recommend).toLowerCase() === "true" ? 60 : 0);
      const name=String(item.name||"").toLowerCase(), icon=String(item.icon||"").toLowerCase();
      const rules=[
        [/chatgpt|openai|gpt[- ]?[45]/i,100],[/claude|anthropic/i,98],[/gemini|google ai/i,96],
        [/google|gmail|youtube|google voice/i,94],[/microsoft|office 365|office365|outlook|onedrive|teams/i,92],
        [/apple|icloud/i,90],[/discord/i,88],[/telegram/i,86],[/whatsapp/i,84],
        [/instagram/i,82],[/tiktok|tk账号/i,80],[/facebook|meta/i,78],[/x\.com|twitter/i,76],
        [/snapchat/i,74],[/reddit/i,72],[/steam/i,70],[/spotify/i,68],[/netflix/i,66],
        [/amazon/i,64],[/linkedin/i,62],[/github/i,60],[/notion/i,58],[/canva/i,56],
        [/capcut/i,54],[/adobe|photoshop|premiere/i,52],[/textnow/i,56],[/zoom/i,50],[/yahoo/i,48],[/skype/i,46]
      ];
      const hit=rules.find(([pattern])=>pattern.test(name));
      if(hit)return upstreamPriority+hit[1];
      const ranks={"shop-google":94,"shop-google-voice-logo":94,"shop-microsoft":92,"shop-apple":90,"shop-discord":88,"shop-telegram":86,"shop-whatsapp":84,"shop-instagram":82,"shop-tiktok":80,"shop-facebook":78,"shop-twitter-circle-fill":76,"shop-steam":70,"shop-amazon-circle-fill":64,"shop-youtube":94,"shop-yahoo":48};
      return upstreamPriority+(ranks[icon]||0);
    };
    items.sort((a,b)=>popularity(b)-popularity(a));
  }
  if (sort === "price-asc") items.sort((a,b) => Number(a.price_cny ?? Number(a.price_usdt || 0) * 4) - Number(b.price_cny ?? Number(b.price_usdt || 0) * 4));
  if (sort === "price-desc") items.sort((a,b) => Number(b.price_cny ?? Number(b.price_usdt || 0) * 4) - Number(a.price_cny ?? Number(a.price_usdt || 0) * 4));
  if (sort === "stock-desc") items.sort((a,b) => Number(b.stock || 0) - Number(a.stock || 0));
  grid.replaceChildren();
  const moreButton = $("loadMoreProducts");
  if (moreButton) moreButton.hidden = true;
  if (!items.length) {
    const t=SHOP_I18N[currentShopLanguage()];grid.appendChild(safeText("div","empty-card",allProducts.length?t.noMatches:t.noProducts));
    return;
  }
  const fragment = document.createDocumentFragment();
  const visibleItems = items.slice(0, visibleProductLimit);
  const categoryNames = {"digital":"数字商品","account":"账号商品","accounts":"账号商品","discord":"Discord 账号","game":"游戏账号","software":"软件服务","subscription":"订阅服务","其他":"其他商品"};
  for (const item of visibleItems) {
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
    titleWrap.appendChild(safeText("h3", "product-name", cleanProductTitle(item.name), "数字商品"));
    cardHead.appendChild(titleWrap);
    card.appendChild(cardHead);
    const description = cleanProductDescription(item);
    if (description) card.appendChild(safeText("p", "product-description", description, ""));
    const meta = document.createElement("div");
    meta.className = "product-meta";
    meta.appendChild(safeText("div","product-price",item.price_verified === true ? formatPrice(item.price_cny ?? Number(item.price_usdt || 0)*4) : item.catalog_verified === false ? "价格核验中" : "价格核验失败"));
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
    buyButton.textContent = item.legacy_migrated === true ? "价格已迁移，购买功能未切换" : item.catalog_verified === false || item.price_verified !== true ? ("价格核验中") : item.purchasable === false ? SHOP_I18N[currentShopLanguage()].notAvailable : SHOP_I18N[currentShopLanguage()].buyNow;
    buyButton.disabled = item.legacy_migrated === true || item.catalog_verified === false || item.price_verified !== true || item.purchasable === false;
    buyButton.addEventListener("click", () => purchase(item, buyButton));
    card.appendChild(buyButton);
    fragment.appendChild(card);
  }
  if (!fragment.childElementCount) grid.appendChild(safeText("div", "empty-card", "暂无上架商品"));
  else grid.appendChild(fragment);
  if (moreButton && items.length > visibleItems.length) {
    moreButton.hidden = false;
    moreButton.textContent = `加载更多商品（剩余 ${items.length-visibleItems.length} 件）`;
  }
}

function renderCatalogCategoryStrip(categories, selectedCategory = "") {
  const strip = $("catalogCategoryStrip");
  if (!strip) return;
  strip.replaceChildren();
  const labels = {"digital":"数字商品","account":"账号类","accounts":"账号类","discord":"Discord账号","game":"游戏账号","software":"软件服务","subscription":"协议服务","其他":"其他商品"};
  const icons = {"digital":"✦","account":"👤","accounts":"👤","discord":"◉","game":"🎮","software":"▣","subscription":"⌁"};
  const addChip = (value,label,item,iconOverride) => {
    const button=document.createElement("button"); button.type="button"; button.className="catalog-category-chip"; button.setAttribute("aria-pressed",String(value===selectedCategory));
    if(iconOverride) button.appendChild(safeText("span","category-chip-fallback",iconOverride));
    else if(item&&item.icon_url){const img=document.createElement("img");img.src=item.icon_url;img.alt="";img.loading="lazy";img.onerror=()=>img.replaceWith(safeText("span","category-chip-fallback",icons[String(value).toLowerCase()]||"✦"));button.appendChild(img);}
    else button.appendChild(safeText("span","category-chip-fallback",icons[String(value).toLowerCase()]||"✦"));
    button.appendChild(safeText("span","",label));
    button.addEventListener("click",()=>{$("categoryFilter").value=value;visibleProductLimit=48;renderCatalogCategoryStrip(categories,value);drawFilteredProducts();$("productGrid")?.scrollIntoView({behavior:"smooth",block:"start"});});
    strip.appendChild(button);
  };
  addChip("","全部商品",allProducts[0]);
  for(const category of categories){const first=allProducts.find(item=>String(item.category||"").trim()===category);addChip(category,labels[category.toLowerCase()]||category,first);}
}
function renderProducts(items, options = {}) {
  // Preserve the current product list position while rendering the catalog.
  const verified = options.verified !== false;
  allProducts = Array.isArray(items) ? items.filter(item => item && typeof item === "object").map(item => ({...item, catalog_verified: verified})) : [];
  const select = $("categoryFilter");
  const current = select.value;
  const categories = [...new Set(allProducts.map(item => String(item.category || "").trim()).filter(Boolean))];
  renderCatalogCategoryStrip(categories, current);
  select.replaceChildren(new Option(SHOP_I18N[currentShopLanguage()].allCategories, ""));
  const categoryNames = {"digital":"数字商品","account":"账号商品","accounts":"账号商品","discord":"Discord 账号","game":"游戏账号","software":"软件服务","subscription":"订阅服务","其他":"其他商品"};
  for (const category of categories) {
    const label = categoryNames[category.toLowerCase()] || categoryNames[category] || category;
    select.add(new Option(label, category));
  }
  if (categories.includes(current)) select.value = current;
  drawFilteredProducts();
}

async function loadProducts() {
  if (catalogLoadInFlight) return;
  catalogLoadInFlight = true;
  const grid = $("productGrid");
  grid.replaceChildren(safeText("div", "loading-card", SHOP_I18N.zh.loadingCatalog));
  try {
    // The live purchasable supplier catalog, prices and stock are all read
    // from Neon public.shop_catalog. Its product_id is the same stable key
    // consumed by /api/buy, so the existing balance/order/delivery flow stays intact.
    const result = await api("/api/products");
    if (result.ok !== true || !Array.isArray(result.items)) throw new Error("catalog_unavailable");
    const items = result.items.map(row => ({
      product_id: String(row.product_id),
      supplier_product_id: String(row.supplier_product_id || row.product_id),
      name: String(row.name || "数字商品"),
      category: String(row.category || "未分类"),
      description: String(row.description || ""),
      icon: String(row.icon || ""),
      icon_url: String(row.icon_url || ""),
      image_url: String(row.image_url || ""),
      is_hot: row.is_hot === true,
      is_recommend: row.is_recommend === true,
      price_cny: Number(row.price_cny || 0),
      price_usdt: Number(row.price_usdt || 0),
      stock: Number(row.stock || 0),
      purchasable: row.purchasable === true,
      price_verified: row.price_verified === true,
      legacy_migrated: false
    }));
    saveCachedProducts(items);
    renderProducts(items, { verified: true });
    message($("shopMessage"), "", "");
  } catch (error) {
    grid.replaceChildren(safeText("div", "empty-card", "商品目录暂时无法加载，请稍后再试。"));
    message($("shopMessage"),SHOP_I18N.zh.catalogFailed,"error");
  } finally {
    catalogLoadInFlight = false;
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
  message($("shopMessage"), "订单仍在处理中，系统正在查询状态，请稍后查看订单详情或联系客服。", "error");
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
  // Make every account shortcut navigate explicitly on touch and desktop.
  document.querySelectorAll("#accountMenu .account-card-link").forEach(link=>{
    link.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      const href=link.getAttribute("href");
      if(href) window.location.assign(new URL(href,document.baseURI).href);
    });
  });
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
  $("productSearch").addEventListener("input", () => {visibleProductLimit=48;drawFilteredProducts();updateShopHeading();});
  $("categoryFilter").addEventListener("change", () => {visibleProductLimit=48;drawFilteredProducts();updateShopHeading();});
  $("sortProducts").addEventListener("change", () => {visibleProductLimit=48;drawFilteredProducts();});
  $("loadMoreProducts")?.addEventListener("click",()=>{visibleProductLimit+=48;drawFilteredProducts();});

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
  const initialCatalog = Array.isArray(window.__QINGTIAN_INITIAL_PRODUCTS__) ? window.__QINGTIAN_INITIAL_PRODUCTS__ : null;
  if (initialCatalog && initialCatalog.length) renderProducts(initialCatalog, { verified: false });
  else readCachedProducts();
  loadProducts();
  loadUser().catch(error => {
    // Do not block public catalog requests when account-profile hydration is unavailable.
    const code=String(error?.message||"");
    const invalidSession=error?.status===401||["auth_required","invalid_token","token_expired","token_revoked"].includes(code);
    if(invalidSession){localStorage.removeItem(TOKEN_KEY);location.replace("./auth.html");return;}
    message($("shopMessage"),SHOP_I18N[currentShopLanguage()].temporaryError,"error");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "auth" || page === "login") initPolicyModal();
  if (page === "auth") initAuth();
  if (document.body.dataset.page === "shop") initShop();
});
