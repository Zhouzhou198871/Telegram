-- Qingtian Shop additions. Safe to apply to the existing fakabot-procurement-db.
-- Existing procurement, inventory, and payment tables are not modified.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    tg_user_id TEXT UNIQUE,
    balance TEXT NOT NULL DEFAULT '0.0000',
    balance_units INTEGER NOT NULL DEFAULT 0 CHECK(balance_units >= 0),
    verify_code TEXT,
    code_expires INTEGER,
    code_sent_at INTEGER,
    code_attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tg_user_id ON users(tg_user_id);

CREATE TABLE IF NOT EXISTS web_purchases (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    amount TEXT NOT NULL,
    amount_units INTEGER NOT NULL CHECK(amount_units > 0),
    status TEXT NOT NULL CHECK(status IN ('reserved','pending','delivered','refunded')),
    idempotency_key TEXT NOT NULL,
    server_order_id TEXT,
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_web_purchases_user_created
    ON web_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_purchases_status
    ON web_purchases(status, updated_at);
