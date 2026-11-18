# Vercel migration preview

This branch routes the existing shop Worker API through a Node serverless function and a Neon PostgreSQL compatibility adapter. It is a preview migration only.

## Required environment variables

- DATABASE_URL
- JWT_SECRET
- CODE_PEPPER
- ADMIN_API_KEY
- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET
- GITHUB_REDIRECT_URI
- FRONTEND_ORIGIN
- SERVER_ORIGIN
- INTERNAL_API_SECRET

Do not place credentials in Git. Do not point production traffic here until data import, email delivery, Telegram webhook cutover, product delivery, and payment/order regression tests pass.

The PostgreSQL adapter preserves the D1-style prepared-statement interface used by worker.js, translating positional placeholders and the limited SQLite expressions used by the shop API. Batch statements execute in a PostgreSQL transaction.
