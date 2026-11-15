"use strict";

const CONTACT_URL = "https://t.me/qingtian_Boss";
const DEFAULT_THEME = {
  background_effect: "particles",
  accent_color: "#00d9ff",
  glass_card: true,
  card_radius: 16
};

const grid = document.getElementById("productGrid");
const syncState = document.getElementById("syncState");
const announcementBox = document.getElementById("announcements");

function safeText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function formatPrice(product) {
  const value = product.price ?? product.price_usdt ?? product.price_cny;
  if (value === undefined || value === null || value === "") return "价格请咨询";
  const currency = product.currency || (product.price_cny !== undefined && product.price === undefined ? "CNY" : "USDT");
  const number = Number(value);
  const display = Number.isFinite(number) ? number.toFixed(2) : safeText(value);
  return currency === "CNY" || currency === "RMB" ? "¥" + display : display + " " + currency;
}

function setTextElement(tag, className, value, fallback = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = safeText(value, fallback);
  return element;
}

function renderAnnouncements(items) {
  announcementBox.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    announcementBox.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  items.slice(0, 5).forEach(item => {
    const text = typeof item === "string"
      ? item
      : safeText(item.title ? item.title + (item.text || item.content ? "\n" : "") : item.text || item.content);
    if (!text.trim()) return;
    const row = document.createElement("p");
    row.textContent = text;
    fragment.appendChild(row);
  });
  announcementBox.appendChild(fragment);
  announcementBox.hidden = announcementBox.childElementCount === 0;
}

function renderProducts(items) {
  grid.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    grid.appendChild(setTextElement("div", "empty-card", "暂无上架商品"));
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach(product => {
    if (!product || typeof product !== "object" || Array.isArray(product)) return;

    const card = document.createElement("article");
    card.className = "product-card";

    card.appendChild(setTextElement(
      "div", "product-category",
      product.category_name || product.category,
      "DIGITAL PRODUCT"
    ));

    card.appendChild(setTextElement(
      "h3", "product-name",
      product.name || product.title,
      "未命名商品"
    ));

    if (product.description) {
      card.appendChild(setTextElement("p", "product-description", product.description));
    }

    const meta = document.createElement("div");
    meta.className = "product-meta";
    meta.appendChild(setTextElement("div", "product-price", formatPrice(product)));

    const stockValue = product.stock ?? product.supplier_stock ?? product.inventory;
    const stockText = stockValue === undefined || stockValue === null
      ? "库存状态以实际页面为准"
      : "库存 " + safeText(stockValue);
    meta.appendChild(setTextElement("div", "product-stock", stockText));

    card.appendChild(meta);
    fragment.appendChild(card);
  });

  if (!fragment.childElementCount) {
    grid.appendChild(setTextElement("div", "empty-card", "暂无上架商品"));
  } else {
    grid.appendChild(fragment);
  }
}

async function loadCatalog() {
  grid.replaceChildren();
  grid.appendChild(setTextElement("div", "loading-card", "正在载入商品数据…"));

  try {
    const response = await fetch(new URL("./data.json", document.baseURI), { cache: "no-store" });
    if (!response.ok) throw new Error("data.json HTTP " + response.status);

    const data = await response.json();
    renderAnnouncements(data.announcements);
    renderProducts(data.products);

    const updated = data.updated_at ? new Date(data.updated_at) : null;
    syncState.textContent = updated && !Number.isNaN(updated.getTime())
      ? "数据更新：" + updated.toLocaleString()
      : "目录已载入";
  } catch (error) {
    renderAnnouncements([]);
    grid.replaceChildren();
    grid.appendChild(setTextElement("div", "empty-card", "商品数据暂时无法加载，请稍后刷新。"));
    syncState.textContent = "目录暂时不可用";
    console.error("Catalog load failed:", error);
  }
}

function applyTheme(themeConfig) {
  const theme = themeConfig && themeConfig.theme && typeof themeConfig.theme === "object"
    ? themeConfig.theme
    : DEFAULT_THEME;

  const color = /^#[0-9a-fA-F]{6}$/.test(theme.accent_color)
    ? theme.accent_color
    : DEFAULT_THEME.accent_color;
  const radius = Number.isFinite(Number(theme.card_radius))
    ? Math.max(0, Math.min(36, Number(theme.card_radius)))
    : DEFAULT_THEME.card_radius;
  const effects = ["particles", "cyber-grid", "solid", "minimal-dark"];
  const effect = effects.includes(theme.background_effect)
    ? theme.background_effect
    : DEFAULT_THEME.background_effect;

  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--card-radius", radius + "px");
  document.documentElement.style.setProperty("--card-blur", theme.glass_card === false ? "0px" : "14px");
  document.documentElement.style.setProperty(
    "--card-surface",
    theme.glass_card === false ? "rgba(12,20,32,.96)" : "rgba(12,20,32,.68)"
  );
  document.body.dataset.backgroundEffect = effect;

  const video = document.getElementById("vidage");
  if (video) {
    const showVideo = effect === "solid";
    video.style.display = showVideo ? "block" : "none";
    if (showVideo) video.play().catch(() => {});
    else video.pause();
  }
}

async function loadThemeConfig() {
  try {
    const response = await fetch(new URL("./theme_config.json", document.baseURI), { cache: "no-store" });
    if (!response.ok) throw new Error("theme_config.json HTTP " + response.status);
    applyTheme(await response.json());
  } catch (error) {
    applyTheme({ theme: DEFAULT_THEME });
    console.info("Using default theme:", error);
  }
}

function initializeVideo() {
  const video = document.getElementById("vidage");
  if (video) video.play().catch(() => {});
  if (typeof window.Vidage === "function") {
    try {
      new window.Vidage("#vidage");
    } catch (error) {
      console.warn("Vidage initialization failed; native video remains available.", error);
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("year").textContent = String(new Date().getFullYear());
  await loadThemeConfig();
  initializeVideo();
  await loadCatalog();
});
