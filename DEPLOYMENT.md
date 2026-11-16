# 晴天商城部署说明

## 项目地址

GitHub 仓库：Zhouzhou198871/Telegram
GitHub Pages：https://zhouzhou198871.github.io/telegram/
Worker API：https://qingtian-shop-api.chulingli1988.workers.dev
167 源站：https://shop-origin.lynli.me

## 1. 167 服务器

本项目的 API 从 /opt/fakabot-staging 读取现有产品目录与本地库存。部署包不包含卡密库存 JSON、供应商会话或密钥。

    python3 -m venv /opt/qingtian-shop/venv
    /opt/qingtian-shop/venv/bin/pip install -r /opt/fakabot-staging/requirements.txt

创建 /etc/qingtian-shop.env，权限设为 600：

    SMTP_HOST=smtp.qiye.aliyun.com
    SMTP_PORT=465
    SMTP_USER=Boss@lynli.me
    SMTP_FROM=Boss@lynli.me
    SMTP_PASSWORD=阿里云企业邮箱SMTP客户端授权码
    INTERNAL_API_SECRET=随机生成的高强度密钥
    ENABLE_LIVE_PURCHASES=false
    CORS_ORIGINS=https://zhouzhou198871.github.io
    FAKABOT_PROJECT_ROOT=/opt/fakabot-staging
    WEB_DB_PATH=/var/lib/qingtian-shop/web.sqlite3
    DELIVERY_KEY_FILE=/etc/qingtian-shop/delivery.key

创建目录、安装服务：

    install -d -m 700 /var/lib/qingtian-shop /etc/qingtian-shop
    chmod 600 /etc/qingtian-shop.env
    install -m 644 systemd/qingtian-shop.service /etc/systemd/system/qingtian-shop.service
    systemctl daemon-reload
    systemctl enable --now qingtian-shop.service
    systemctl status qingtian-shop.service --no-pager

FastAPI 仅监听 127.0.0.1:8085，不直接暴露公网。

注意：当前 167 尚未配置 supplier_session_private.pem 和有效的 Dahaoshang session 文件。真实上游采购必须在会话授权完成后才能开启。当前 ENABLE_LIVE_PURCHASES 默认关闭。

## 2. Cloudflare Tunnel 源站路由

给 167 当前使用的 Tunnel 增加一条 ingress，放在 catch-all 之前，不要覆盖已有规则：

    - hostname: shop-origin.lynli.me
      service: http://127.0.0.1:8085

创建 shop-origin.lynli.me 的 proxied CNAME，目标指向 167 当前 Tunnel 的 UUID 域名。Worker 通过 HTTPS 域名连接源站，HMAC 密钥不会通过公网明文 HTTP 传输。

## 3. 阿里云企业邮箱 SMTP 授权码

在阿里云企业邮箱管理控制台打开 Boss@lynli.me 的邮箱账号设置，进入客户端设置/安全设置，启用 SMTP 服务并生成客户端授权码。这里使用的是 SMTP 客户端授权码，不是邮箱网页登录密码。

SMTP 参数：
- SMTP 主机：smtp.qiye.aliyun.com
- 端口：465
- 加密：SSL
- 用户名/发件人：Boss@lynli.me

将授权码放入 167 的 SMTP_PASSWORD。不要把授权码提交到 GitHub 或 Worker 代码。

## 4. Cloudflare Worker 与 D1

本项目复用已有 D1 数据库 fakabot-procurement-db，新增 users 与 web_purchases 表，不修改原有采购、支付、库存表。

Worker Secrets：
- JWT_SECRET：JWT HS256 签名密钥
- CODE_PEPPER：邮箱验证码哈希密钥
- INTERNAL_API_SECRET：与 167 环境文件完全一致
- ADMIN_API_KEY：后台余额充值接口密钥

部署后在 Worker 的 Secrets 中录入以上四项。也可在本地使用 Wrangler：

    npx wrangler secret put JWT_SECRET
    npx wrangler secret put CODE_PEPPER
    npx wrangler secret put INTERNAL_API_SECRET
    npx wrangler secret put ADMIN_API_KEY
    npx wrangler deploy

wrangler.toml 已配置 D1 binding、SERVER_ORIGIN 和 FRONTEND_ORIGIN。

## 5. 余额充值

邮箱注册后的初始余额是 0 USDT。管理员通过 POST /api/admin/credit 充值，Header 使用 X-Admin-Key，值为 ADMIN_API_KEY。JSON 示例：

    {"email":"customer@example.com","amount_usdt":"10.0000"}

前端不能自行提交 tg_user_id。Worker 只读取 D1 用户记录中的 tg_user_id；尚未绑定时为 NULL。当前商品采购以 D1 用户 ID 和邮箱归属订单。

## 6. GitHub Pages 与 Actions

仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。

Pages 工作流会在 main 分支相关文件变更后自动部署。Worker 工作流需要 GitHub Secrets：
- CLOUDFLARE_API_TOKEN：具备 Workers Scripts Edit 和 D1 Edit 权限
- CLOUDFLARE_ACCOUNT_ID：Cloudflare 账户 ID

Pages 站点：https://zhouzhou198871.github.io/telegram/

如果 Pages 尚未启用，先在上述设置中启用一次。GitHub Actions 需要 pages:write 和 id-token:write 权限。

## 7. 安全边界

- 浏览器只请求 Worker，不直连 167。
- 验证码哈希存储，5 分钟过期，60 秒发送间隔，最多校验 5 次。
- JWT 有效期 7 天。
- Worker 在 D1 原子预扣余额。
- 已确认的采购失败才退款；采购结果不确定时保持 pending，不自动重试，防止重复采购。
- 167 将交付内容 Fernet 加密后写入本地 SQLite，用户只能通过 Worker 查询自己的订单。
- 不要把本地库存 JSON、供应商会话文件、SMTP 授权码或私钥提交到 Git。
