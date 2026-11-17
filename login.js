"use strict";

(function () {
  function initLoginPage() {
    if (!document.body || document.body.dataset.page !== "login") return;
    const $ = id => document.getElementById(id);
    const form = $("loginForm"), email = $("email"), password = $("password"), code = $("code");
    const passwordPanel = $("passwordPanel"), codePanel = $("codePanel");
    const passwordTab = $("passwordTab"), codeTab = $("codeTab");
    const sendButton = $("sendCode"), loginButton = $("loginButton"), messageBox = $("loginMessage");
    if (!form || !email || !passwordPanel || !codePanel || !passwordTab || !codeTab) {
      console.error("[login] Required login elements are missing.");
      return;
    }

    if (typeof token === "function" && token()) {
      window.location.replace("./shop.html");
      return;
    }

    let mode = "password", cooldown = 0, countdownTimer = null;
    const validEmail = () => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.value.trim());
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
      alert("请联系客服重置密码。");
    });
    email.addEventListener("input", () => email.classList.remove("invalid"));
    password.addEventListener("input", () => password.classList.remove("invalid"));
    code.addEventListener("input", () => {
      code.value = code.value.replace(/\\D/g, "").slice(0, 6);
      code.classList.remove("invalid");
    });

    // Pointer Events + document-level movement: works with Android touch, iPhone touch and desktop mouse.
    const slider = $("sliderVerify"), track = $("sliderTrack"), fill = $("sliderFill");
    const thumb = $("sliderThumb"), sliderText = $("sliderText");
    let sliderVerified = false, dragging = false, pointerId = null, startX = 0, startLeft = 0, currentLeft = 0;
    const maxLeft = () => Math.max(0, track.clientWidth - thumb.getBoundingClientRect().width - 2);
    function paintSlider(left, animate = false) {
      currentLeft = Math.max(0, Math.min(maxLeft(), left));
      thumb.style.transition = animate ? "left .18s ease,background .18s ease" : "none";
      fill.style.transition = animate ? "width .18s ease" : "none";
      thumb.style.left = currentLeft + "px";
      fill.style.width = (sliderVerified ? track.clientWidth : currentLeft + thumb.offsetWidth / 2) + "px";
    }
    function resetSlider() {
      dragging = false; pointerId = null;
      paintSlider(0, true);
    }
    function passSlider() {
      sliderVerified = true; dragging = false; pointerId = null;
      slider.classList.add("is-verified");
      sliderText.textContent = "验证通过";
      thumb.textContent = "✓";
      thumb.setAttribute("aria-label", "验证已通过");
      thumb.disabled = true;
      paintSlider(maxLeft(), true);
    }
    thumb.addEventListener("pointerdown", event => {
      if (sliderVerified || thumb.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      dragging = true; pointerId = event.pointerId;
      startX = event.clientX; startLeft = currentLeft;
      thumb.style.transition = "none";
      try { thumb.setPointerCapture(event.pointerId); } catch (_) {}
    });
    document.addEventListener("pointermove", event => {
      if (!dragging || event.pointerId !== pointerId) return;
      event.preventDefault();
      paintSlider(startLeft + event.clientX - startX);
    }, { passive: false });
    document.addEventListener("pointerup", event => {
      if (!dragging || event.pointerId !== pointerId) return;
      if (currentLeft >= maxLeft() - 5) passSlider();
      else resetSlider();
    });
    document.addEventListener("pointercancel", event => {
      if (dragging && event.pointerId === pointerId) resetSlider();
    });
    thumb.addEventListener("dragstart", event => event.preventDefault());
    thumb.addEventListener("keydown", event => {
      if (sliderVerified) return;
      if (event.key === "ArrowRight") { event.preventDefault(); paintSlider(currentLeft + 14); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); paintSlider(currentLeft - 14); }
      else if (event.key === "End") { event.preventDefault(); paintSlider(maxLeft()); passSlider(); }
      else if (event.key === "Home") { event.preventDefault(); paintSlider(0); }
    });
    window.addEventListener("resize", () => paintSlider(sliderVerified ? maxLeft() : 0));
    thumb.style.touchAction = "none";
    setMode("password");
    paintSlider(0);

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
          body: JSON.stringify({ email: email.value.trim().toLowerCase() })
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
          error.message === "network_error" ? "网络连接失败，请检查网络后重试。" :
          error.message === "server_error" ? "服务器暂时出现故障，请稍后重试。" :
          error.message === "too_many_requests" ? "验证码发送过于频繁，请稍后再试。" :
          "验证码发送失败，请稍后重试。";
        showMessage(reason); sendButton.disabled = false; sendButton.textContent = "获取验证码";
      }
    });

    form.addEventListener("submit", async event => {
      event.preventDefault(); showMessage("");
      if (!sliderVerified) { showMessage("请先完成滑动验证。"); return; }
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
        if (!/^\\d{6}$/.test(code.value.trim())) {
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
        window.location.replace("/shop.html");
      } catch (error) {
        const reasonCode = String(error.message || "");
        let reason = reasonCode === "request_timeout" ? "服务器响应超时，请稍后重试。" :
          reasonCode === "network_error" ? "网络连接失败，请检查网络后重试。" :
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