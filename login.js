"use strict";

(function(){
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const referralCode = String(params.get("ref") || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  if (referralCode) localStorage.setItem("qingtian_referral_code", referralCode);
  const githubToken = hashParams.get("github_token") || params.get("github_token");
  if (githubToken) {
    localStorage.setItem("qingtian_shop_token", githubToken);
    localStorage.removeItem("qingtian_referral_code");
    params.delete("github_token");
    hashParams.delete("github_token");
    const query = params.toString();
    const hash = hashParams.toString();
    const cleanUrl = window.location.pathname + (query ? "?" + query : "") + (hash ? "#" + hash : "");
    window.history.replaceState(null, "", cleanUrl);
    window.location.replace("./shop.html");
    return;
  }
  const githubError = params.get("github_error");
  if (githubError) {
    params.delete("github_error");
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    const showGithubError = () => {
      const box = document.getElementById("loginMessage");
      if (box) {
        box.textContent = githubError === "verified_email_required" ? "请先在 GitHub 账号中验证邮箱后再登录。" : "GitHub 登录未完成，请重试。";
        box.className = "form-message error";
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showGithubError, { once: true });
    else showGithubError();
  }
})();

(function () {
  function initLoginPage() {
    if (!document.body || document.body.dataset.page !== "login") return;
    const $ = id => document.getElementById(id);
    const githubButton = $("githubLoginButton");
    if (githubButton) {
      const refCode = localStorage.getItem("qingtian_referral_code") || "";
      githubButton.href = "/api/auth/github/start" + (refCode ? "?ref=" + encodeURIComponent(refCode) : "");
      fetch("/api/auth/github/status", { cache: "no-store" }).then(r => r.json()).then(data => { if (data.enabled) githubButton.hidden = false; }).catch(() => {});
    }
    const form = $("loginForm"), email = $("email"), password = $("password"), code = $("code");
    const passwordPanel = $("passwordPanel"), codePanel = $("codePanel");
    const passwordTab = $("passwordTab"), codeTab = $("codeTab");
    const sendButton = $("sendCode"), loginButton = $("loginButton"), messageBox = $("loginMessage");
    if (!form || !email || !passwordPanel || !codePanel || !passwordTab || !codeTab) {
      console.error("[login] Required login elements are missing.");
      return;
    }

    if (typeof token === "function" && token()) {
      localStorage.removeItem("qingtian_referral_code");
      window.location.replace("./shop.html");
      return;
    }

    let mode = "password", cooldown = 0, countdownTimer = null;
    const validEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    const showMessage = (text, kind = "error") => {
      if (!messageBox) return;
      messageBox.textContent = text || "";
      messageBox.className = "form-message" + (kind ? " " + kind : "");
    };

    function setMode(nextMode) {
      mode = nextMode === "code" ? "code" : "password";
      const isCode = mode === "code";
      passwordPanel.hidden = isCode;
      codePanel.hidden = !isCode;
      passwordPanel.style.display = isCode ? "none" : "block";
      codePanel.style.display = isCode ? "flex" : "none";
      passwordTab.setAttribute("aria-selected", String(!isCode));
      codeTab.setAttribute("aria-selected", String(isCode));
      password.required = !isCode;
      code.required = isCode;
      showMessage("");
    }
    passwordTab.addEventListener("click", event => { event.preventDefault(); setMode("password"); });
    codeTab.addEventListener("click", event => { event.preventDefault(); setMode("code"); });

    $("forgotPassword")?.addEventListener("click", event => {
      event.preventDefault();
      window.location.href = "./reset-password.html";
    });
    email.addEventListener("input", () => email.classList.remove("invalid"));
    password.addEventListener("input", () => password.classList.remove("invalid"));
    code.addEventListener("input", () => {
      code.value = code.value.replace(/\\D/g, "").slice(0, 6);
      code.classList.remove("invalid");
    });

    setMode("password");

    sendButton.addEventListener("click", async () => {
      if (cooldown > 0 || sendButton.disabled) return;
      if (!validEmail()) {
        email.classList.add("invalid"); email.focus();
        showMessage("请输入有效的邮箱地址。"); return;
      }
      sendButton.disabled = true; sendButton.textContent = "发送中…"; showMessage("");
      try {
        await api("/api/auth/send_code", {
          method: "POST",
          body: JSON.stringify({ email: email.value.trim().toLowerCase(), referral_code: localStorage.getItem("qingtian_referral_code") || "" })
        });
        showMessage("验证码已发送，请检查邮箱。", "success");
        cooldown = 60;
        const tick = () => { sendButton.textContent = cooldown + " 秒后重试"; };
        tick();
        countdownTimer = window.setInterval(() => {
          cooldown -= 1;
          if (cooldown <= 0) {
            window.clearInterval(countdownTimer); countdownTimer = null;
            sendButton.disabled = false; sendButton.textContent = "重新获取";
          } else tick();
        }, 1000);
      } catch (error) {
        const reason = error.message === "request_timeout" ? "服务器响应超时，请稍后重试。" :
          error.message === "network_error" ? "暂时无法完成请求，请稍后重试。" :
          error.message === "server_error" ? "服务器暂时出现故障，请稍后重试。" :
          error.message === "too_many_requests" ? "验证码发送过于频繁，请稍后再试。" :
          "验证码发送失败，请稍后重试。";
        showMessage(reason); sendButton.disabled = false; sendButton.textContent = "获取验证码";
      }
    });

    form.addEventListener("submit", async event => {
      event.preventDefault(); showMessage("");
      if (!validEmail()) {
        email.classList.add("invalid"); email.focus();
        showMessage("请输入有效的邮箱地址。"); return;
      }
      const payload = { email: email.value.trim().toLowerCase() };
      if (mode === "password") {
        if (!password.value) {
          password.classList.add("invalid"); password.focus();
          showMessage("请输入登录密码。"); return;
        }
        payload.password = password.value;
      } else {
        if (!/^\d{6}$/.test(code.value.trim())) {
          code.classList.add("invalid"); code.focus();
          showMessage("请输入 6 位数字验证码。"); return;
        }
        payload.code = code.value.trim();
      }
      loginButton.disabled = true; loginButton.textContent = "正在登录…";
      try {
        const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
        if (!result.token) throw new Error(result.error || "login_failed");
        localStorage.setItem(TOKEN_KEY, result.token);
        localStorage.removeItem("qingtian_referral_code");
        window.location.replace("/shop.html");
      } catch (error) {
        const reasonCode = String(error.message || "");
        let reason = reasonCode === "request_timeout" ? "服务器响应超时，请稍后重试。" :
          reasonCode === "network_error" ? "暂时无法完成请求，请稍后重试。" :
          reasonCode === "server_error" ? "服务器暂时出现故障，请稍后重试。" :
          "登录失败，请检查登录信息后重试。";
        if (reasonCode === "invalid_code") reason = "验证码不正确。";
        else if (reasonCode === "code_expired") reason = "验证码已过期，请重新获取。";
        else if (reasonCode === "too_many_attempts") reason = "验证次数过多，请重新获取验证码。";
        else if (reasonCode === "invalid_credentials") reason = mode === "password" ? "邮箱或密码不正确，请检查后重试。" : "邮箱或验证码不正确，请检查后重试。";
        else if (reasonCode === "invalid_password" || reasonCode === "weak_password") reason = "密码不正确，请检查后重试。";
        showMessage(reason); loginButton.disabled = false; loginButton.textContent = "登 录";
      }
    });
    console.info("[login] Login page handlers initialized.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLoginPage, { once: true });
  } else {
    initLoginPage();
  }
})();