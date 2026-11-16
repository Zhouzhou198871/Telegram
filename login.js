"use strict";

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page !== "login") return;
  if (typeof token === "function" && token()) {
    window.location.replace("./shop.html");
    return;
  }
  const $id = id => document.getElementById(id);
  const form = $id("loginForm"), email = $id("email"), password = $id("password"), code = $id("code");
  const passwordPanel = $id("passwordPanel"), codePanel = $id("codePanel");
  const passwordTab = $id("passwordTab"), codeTab = $id("codeTab");
  const sendButton = $id("sendCode"), loginButton = $id("loginButton"), messageBox = $id("loginMessage");
  let mode = "password", cooldown = 0, countdownTimer = null;
  const validEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
  const showMessage = (text, kind = "error") => { messageBox.textContent = text || ""; messageBox.className = "form-message" + (kind ? " " + kind : ""); };
  const setMode = next => {
    mode = next === "code" ? "code" : "password";
    const isCode = mode === "code";
    passwordPanel.hidden = isCode; codePanel.hidden = !isCode;
    passwordTab.setAttribute("aria-selected", String(!isCode)); codeTab.setAttribute("aria-selected", String(isCode));
    passwordTab.tabIndex = isCode ? -1 : 0; codeTab.tabIndex = isCode ? 0 : -1;
    password.required = !isCode; code.required = isCode; showMessage("");
  };
  passwordTab.addEventListener("click", () => setMode("password"));
  codeTab.addEventListener("click", () => setMode("code"));
  $id("forgotPassword").addEventListener("click", event => { event.preventDefault(); alert("请联系客服重置密码"); });
  email.addEventListener("input", () => email.classList.remove("invalid"));
  password.addEventListener("input", () => password.classList.remove("invalid"));
  code.addEventListener("input", () => { code.value = code.value.replace(/\D/g, "").slice(0, 6); code.classList.remove("invalid"); });

  sendButton.addEventListener("click", async () => {
    if (cooldown > 0 || sendButton.disabled) return;
    if (!validEmail()) { email.classList.add("invalid"); email.focus(); showMessage("请输入有效的邮箱地址。"); return; }
    sendButton.disabled = true; sendButton.textContent = "发送中…"; showMessage("");
    try {
      await api("/api/auth/send_code", { method: "POST", body: JSON.stringify({ email: email.value.trim().toLowerCase() }) });
      showMessage("验证码已发送，请检查邮箱。", "success"); cooldown = 60;
      const tick = () => { sendButton.textContent = cooldown + " 秒后重试"; }; tick();
      countdownTimer = window.setInterval(() => {
        cooldown -= 1;
        if (cooldown <= 0) { window.clearInterval(countdownTimer); countdownTimer = null; sendButton.disabled = false; sendButton.textContent = "重新获取"; }
        else tick();
      }, 1000);
    } catch (error) {
      const reason = error.message === "request_timeout" ? "服务器响应超时，请稍后重试。" : error.message === "network_error" ? "网络连接失败，请检查网络后重试。" : error.message === "server_error" ? "服务器暂时出现故障，请稍后重试。" : error.message === "too_many_requests" ? "验证码发送过于频繁，请稍后再试。" : "验证码发送失败，请稍后重试。";
      showMessage(reason); sendButton.disabled = false; sendButton.textContent = "获取验证码";
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault(); showMessage("");
    if (!validEmail()) { email.classList.add("invalid"); email.focus(); showMessage("请输入有效的邮箱地址。"); return; }
    const payload = { email: email.value.trim().toLowerCase() };
    if (mode === "password") {
      if (!password.value) { password.classList.add("invalid"); password.focus(); showMessage("请输入登录密码。"); return; }
      payload.password = password.value;
    } else {
      if (!/^\d{6}$/.test(code.value.trim())) { code.classList.add("invalid"); code.focus(); showMessage("请输入 6 位数字验证码。"); return; }
      payload.code = code.value.trim();
    }
    loginButton.disabled = true; loginButton.textContent = "正在登录…";
    try {
      const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      if (!result.token) throw new Error(result.error || "login_failed");
      localStorage.setItem(TOKEN_KEY, result.token); window.location.replace("/shop.html");
    } catch (error) {
      const reasonCode = String(error.message || "");
      let reason = reasonCode === "request_timeout" ? "服务器响应超时，请稍后重试。" : reasonCode === "network_error" ? "网络连接失败，请检查网络后重试。" : reasonCode === "server_error" ? "服务器暂时出现故障，请稍后重试。" : "登录失败，请检查登录信息后重试。";
      if (reasonCode === "invalid_code") reason = "验证码不正确。";
      else if (reasonCode === "code_expired") reason = "验证码已过期，请重新获取。";
      else if (reasonCode === "too_many_attempts") reason = "验证次数过多，请重新获取验证码。";
      else if (reasonCode === "invalid_credentials") reason = mode === "password" ? "邮箱或密码不正确，请检查后重试。" : "邮箱或验证码不正确，请检查后重试。";
      else if (reasonCode === "invalid_password" || reasonCode === "weak_password") reason = "密码不正确，请检查后重试。";
      showMessage(reason); loginButton.disabled = false; loginButton.textContent = "登 录";
    }
  });
  setMode("password");
});
