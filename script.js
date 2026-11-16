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

function initAuth() {
  if (token()) {
    location.replace("./shop.html");
    return;
  }
  const form = $("authForm");
  const sendButton = $("sendCode");
  const msg = $("authMessage");
  let cooldown = 0;
  let timer = null;

  sendButton.addEventListener("click", async () => {
    const email = $("email").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      message(msg, "请先输入有效邮箱地址。", "error");
      return;
    }
    sendButton.disabled = true;
    sendButton.textContent = "发送中…";
    try {
      await api("/api/auth/send_code", { method: "POST", body: JSON.stringify({ email }) });
      message(msg, "验证码已发送，请检查邮箱。", "success");
      cooldown = 60;
      sendButton.textContent = cooldown + " 秒后重发";
      timer = setInterval(() => {
        cooldown -= 1;
        if (cooldown <= 0) {
          clearInterval(timer);
          sendButton.disabled = false;
          sendButton.textContent = "重新获取";
        } else {
          sendButton.textContent = cooldown + " 秒后重发";
        }
      }, 1000);
    } catch (error) {
      message(msg, error.message === "too_many_requests" ? "发送过于频繁，请稍后再试。" : "验证码发送失败，请稍后重试。", "error");
      sendButton.disabled = false;
      sendButton.textContent = "获取验证码";
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const email = $("email").value.trim().toLowerCase();
    const code = $("code").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      message(msg, "请检查邮箱和 6 位验证码。", "error");
      return;
    }
    const button = $("loginButton");
    button.disabled = true;
    button.textContent = "验证中…";
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, code })
      });
      if (!result.token) throw new Error("login_failed");
      localStorage.setItem(TOKEN_KEY, result.token);
      location.replace("./shop.html");
    } catch (error) {
      const text = error.message === "invalid_code" ? "验证码不正确。" :
        error.message === "code_expired" ? "验证码已过期，请重新获取。" :
        error.message === "too_many_attempts" ? "验证次数过多，请重新获取验证码。" :
        "登录失败，请检查验证码后重试。";
      message(msg, text, "error");
      button.disabled = false;
      button.innerHTML = "安全登录 <span>→</span>";
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
