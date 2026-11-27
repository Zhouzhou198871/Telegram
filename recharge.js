"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const token = () => localStorage.getItem("qingtian_shop_token") || "";
  const money = value => "¥" + Number(value || 0).toFixed(2);
  const date = value => new Date(Number(value) * 1000).toLocaleString("zh-CN", { hour12: false });
  const bonusFor = value => {
    const cents = Math.round(Number(value) * 100);
    return Number.isSafeInteger(cents) && cents > 0 ? Math.floor(cents / 1000) * 0.5 : 0;
  };
  let method = "ALIPAY";

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw Error(data.error || "request_failed");
    return data;
  }

  function msg(value, kind = "") {
    $("message").textContent = value;
    $("message").className = "message " + kind;
  }

  function updateBonusPreview() {
    const amount = Number($("amount").value || 0);
    const bonus = bonusFor(amount);
    const valid = Number.isFinite(amount) && amount > 0;
    $("bonusPreview").textContent = valid
      ? "本次预计赠送 " + money(bonus) + "，预计到账 " + money(amount + bonus) + "（每满 ¥10 赠送 ¥0.50）"
      : "请输入充值金额，系统将自动计算赠送金额。";
  }

  async function load() {
    if (!token()) {
      location.replace("./auth.html");
      return;
    }
    try {
      const account = await api("/api/user/info");
      $("balance").textContent = money(account.user?.balance_cny);
      const data = await api("/api/user/recharge-orders");
      const rows = data.orders || [];
      const body = $("history");
      body.replaceChildren();
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">暂无充值订单</td></tr>';
        return;
      }
      const statuses = { paid: "已入账", cancelled: "已取消", expired: "已过期" };
      rows.forEach(order => {
        const amount = Number(order.amount_cny || 0);
        const bonus = bonusFor(amount);
        const values = [
          date(order.created_at),
          order.order_id,
          money(amount),
          money(bonus),
          money(amount + bonus),
          order.payment_method === "USDT_TRC20" ? "USDT（TRC20）" : "支付宝",
          order.status === "pending"
            ? (order.payment_method === "ALIPAY" ? "待付款" : "待核验")
            : (statuses[order.status] || order.status)
        ];
        const tr = document.createElement("tr");
        values.forEach(value => {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        });
        body.append(tr);
      });
    } catch (error) {
      if (["auth_required", "invalid_token", "token_expired", "token_revoked"].includes(error.message)) {
        localStorage.removeItem("qingtian_shop_token");
        location.replace("./auth.html");
        return;
      }
      msg("账户信息或充值记录读取失败，请稍后重试。", "error");
    }
  }

  document.querySelectorAll("[data-method]").forEach(button => {
    button.addEventListener("click", () => {
      method = button.dataset.method;
      document.querySelectorAll("[data-method]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    });
  });

  $("amount").addEventListener("input", updateBonusPreview);

  $("create").addEventListener("click", async () => {
    const amount = String($("amount").value || "").trim();
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !Number.isSafeInteger(Math.round(Number(amount) * 100))) {
      msg("请输入大于 ¥0 的有效金额，最多保留两位小数。", "error");
      return;
    }
    const button = $("create");
    button.disabled = true;
    button.textContent = "正在创建订单…";
    try {
      const data = await api("/api/user/recharge-orders", {
        method: "POST",
        body: JSON.stringify({ amount_cny: amount, payment_method: method })
      });
      const order = data.order;
      if (method === "ALIPAY") {
        if (!order?.checkout_url) throw Error("alipay_checkout_missing");
        msg("支付宝订单已创建，正在跳转安全支付页面…", "success");
        location.assign(order.checkout_url);
        return;
      }
      const bonus = bonusFor(order.amount_cny);
      $("resultTitle").textContent = "充值订单已创建 · 待付款";
      $("resultText").textContent = "订单号：" + order.order_id + "；充值金额：" + money(order.amount_cny) + "；赠送：" + money(bonus) + "；预计到账：" + money(Number(order.amount_cny) + bonus) + "；方式：USDT（TRC20）。请联系官方客服获取当前收款信息，付款后提交订单号与凭证，核验通过后余额入账。";
      $("contact").href = "https://t.me/qingtian_Boss?text=" + encodeURIComponent("你好，我已创建充值订单：" + order.order_id + "，金额：" + money(order.amount_cny) + "，预计赠送：" + money(bonus) + "，付款方式：USDT（TRC20），请提供当前收款指引。");
      $("result").hidden = false;
      msg("充值订单已创建并写入账户记录。", "success");
      await load();
    } catch (error) {
      msg(error.message === "invalid_amount" ? "请输入大于 ¥0 的有效金额。" : "充值订单创建失败，请稍后重试。", "error");
    } finally {
      button.disabled = false;
      button.textContent = "创建充值订单";
    }
  });

  updateBonusPreview();
  load();
  setInterval(load, 12000);
})();