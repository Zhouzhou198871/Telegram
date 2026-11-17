"use strict";
(function(){
 const $=id=>document.getElementById(id);
 const form=$("resetForm"),email=$("email"),code=$("code"),send=$("sendCode"),password=$("password"),confirmPassword=$("confirmPassword");
 const message=$("message"),submit=$("submitButton"),passwordGroup=$("passwordGroup"),confirmGroup=$("confirmGroup");
 let stage=1,cooldown=0,timer=null;
 const validEmail=()=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
 const validPassword=()=>/^(?=.*[A-Za-z])(?=.*\d).{8,20}$/.test(password.value);
 function show(text,kind="error"){message.textContent=text||"";message.className="message"+(kind?" "+kind:"");}
 function setStage(next){
  stage=next;
  $("stepOne").classList.toggle("done",stage===2);$("stepOne").classList.toggle("active",stage===1);
  $("stepTwo").classList.toggle("active",stage===2);
  passwordGroup.hidden=stage!==2;confirmGroup.hidden=stage!==2;
  email.readOnly=stage===2;send.hidden=stage===2;
  submit.textContent=stage===1?"验证并继续":"确认重置密码";
  if(stage===2)password.focus();
 }
 send.addEventListener("click",async()=>{
  if(cooldown>0||send.disabled)return;
  if(!validEmail()){show("请输入有效的注册邮箱。");email.focus();return;}
  send.disabled=true;send.textContent="发送中…";show("");
  try{
   await api("/api/auth/forgot_password",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase()})});
   show("如果该邮箱已注册，验证码将发送至邮箱，请注意查收。","success");
   cooldown=60;const tick=()=>send.textContent=cooldown+" 秒后重试";tick();
   timer=window.setInterval(()=>{cooldown--;if(cooldown<=0){clearInterval(timer);timer=null;send.disabled=false;send.textContent="重新获取"}else tick()},1000);
  }catch(e){show(e.message==="network_error"?"网络连接失败，请检查网络后重试。":e.message==="request_timeout"?"请求超时，请稍后重试。":"暂时无法发送验证码，请稍后重试。");send.disabled=false;send.textContent="重新获取"}
 });
 code.addEventListener("input",()=>{code.value=code.value.replace(/\D/g,"").slice(0,6)});
 form.addEventListener("submit",async e=>{
  e.preventDefault();show("");
  if(!validEmail()){show("请输入有效的注册邮箱。");email.focus();return;}
  if(!/^\d{6}$/.test(code.value.trim())){show("请输入 6 位邮箱验证码。");code.focus();return;}
  if(stage===1){setStage(2);show("邮箱验证码已填写，请设置新密码。","success");return;}
  if(!validPassword()){show("密码需为 8–20 位，并同时包含字母和数字。");password.focus();return;}
  if(password.value!==confirmPassword.value){show("两次输入的密码不一致，请重新确认。");confirmPassword.focus();return;}
  submit.disabled=true;submit.textContent="正在安全更新…";
  try{
   await api("/api/auth/reset_password",{method:"POST",body:JSON.stringify({email:email.value.trim().toLowerCase(),code:code.value.trim(),password:password.value})});
   show("密码已重置成功，正在返回登录页面…","success");
   localStorage.removeItem("qingtian_shop_token");
   window.setTimeout(()=>location.replace("./auth.html?password_reset=1"),900);
  }catch(err){
   const map={invalid_reset_code:"验证码不正确，请检查后重试。",reset_code_expired:"验证码已过期，请重新获取。",too_many_attempts:"验证码错误次数过多，请重新获取。",weak_password:"密码格式不符合要求，请重新设置。"};
   show(map[err.message]||"重置失败，请检查信息后重试。");
  }finally{submit.disabled=false;submit.textContent="确认重置密码"}
 });
 setStage(1);
})();