# -*- coding: utf-8 -*-
"""Private origin API for Qingtian Shop. Only the signed Cloudflare Worker may call it."""
import hashlib
import hmac
import html
import logging
import os
import re
import smtplib
import sqlite3
import sys
import time
from contextlib import contextmanager
from email.message import EmailMessage
from pathlib import Path
from threading import RLock
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(os.getenv("FAKABOT_PROJECT_ROOT", "/opt/fakabot-staging")).resolve()
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from products.catalog import get_all_products
from products.local_inventory import finalize_reservation, get_local_products, reserve_one
from supplier_client import DahaoshangClient, SupplierDeliveryPending

LOG = logging.getLogger("qingtian-shop-origin")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
DB_PATH = Path(os.getenv("WEB_DB_PATH", "/var/lib/qingtian-shop/web.sqlite3"))
KEY_PATH = Path(os.getenv("DELIVERY_KEY_FILE", "/etc/qingtian-shop/delivery.key"))
ENABLE_LOCAL_DELIVERY = os.getenv("ENABLE_LOCAL_DELIVERY", "false").lower() == "true"
ENABLE_UPSTREAM_PURCHASES = os.getenv("ENABLE_UPSTREAM_PURCHASES", "false").lower() == "true"
CORS_ORIGINS = [x.strip() for x in os.getenv(
    "CORS_ORIGINS", "https://zhouzhou198871.github.io"
).split(",") if x.strip()]
LOCK = RLock()

app = FastAPI(title="Qingtian Shop Origin", version="1.0.0", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Worker-Timestamp", "X-Worker-Nonce", "X-Worker-Signature"],
)


@contextmanager
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(DB_PATH.parent, 0o700)
    conn = sqlite3.connect(DB_PATH, timeout=20)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute("PRAGMA busy_timeout=20000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db() as c:
        c.execute("""CREATE TABLE IF NOT EXISTS api_nonces (
            nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS web_purchases (
            order_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            status TEXT NOT NULL,
            delivery_ciphertext TEXT,
            supplier_order_id TEXT,
            error_code TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_web_purchases_user ON web_purchases(user_id, created_at)")
    os.chmod(DB_PATH, 0o600)


def delivery_cipher():
    from cryptography.fernet import Fernet
    KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(KEY_PATH.parent, 0o700)
    if not KEY_PATH.exists():
        key = Fernet.generate_key()
        fd = os.open(KEY_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(key)
            f.flush()
            os.fsync(f.fileno())
    os.chmod(KEY_PATH, 0o600)
    return Fernet(KEY_PATH.read_bytes().strip())


def clean_text(value):
    value = html.unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    value = re.sub(r"(?i)https?://\S+|www\.\S+", "", value)
    value = re.sub(r"\s+@[A-Za-z][A-Za-z0-9_]{3,}\b.*$", "", value)
    return re.sub(r"\s{2,}", " ", value).strip()


def clean_title(value):
    blocked = re.compile(
        r"代开|刷粉|会员|视频教程|撸羊毛|不懂不要买|随机国|盲盒|"
        r"联系客服|联系(?:QQ|微信|飞机|TG|Telegram)|加(?:QQ|微信|群)|网址|官网",
        re.I,
    )
    parts = re.split(r"\s*[|｜]\s*", clean_text(value))
    safe = [p for p in parts if p and "@" not in p and not blocked.search(p)]
    return " | ".join(safe) or "数字商品"


def sanitize_delivery_content(value):
    """Remove advertising/contact copy while preserving account/password fields."""
    url_re = re.compile(r"(?i)https?://\S+|www\.\S+")
    contact_re = re.compile(
        r"(?i)(联系(?:客服|QQ|微信|飞机|TG|Telegram)|加(?:我|QQ|微信|群)|"
        r"客服(?:QQ|微信)?|网址|官网|加入(?:群|频道)|TG群|Telegram群)"
    )
    promo_re = re.compile(r"代开|刷粉|视频教程|撸羊毛|不懂不要买|随机国|盲盒", re.I)
    out = []
    for raw in str(value or "").replace("\r", "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.match(r"(?i)^(联系|客服|加我|加QQ|加微信|网址|官网|加入|视频教程|代开|刷粉|撸羊毛|不懂不要买)", line):
            continue
        line = url_re.sub("", line)
        marker = contact_re.search(line)
        if marker:
            prefix = line[:marker.start()].strip(" |,，;；:-：")
            if prefix and re.search(r"(?i)(账号|帐号|account|login|user|密码|password|邮箱|email|----)", prefix):
                line = prefix
            else:
                continue
        if promo_re.search(line):
            marker = promo_re.search(line)
            prefix = line[:marker.start()].strip(" |,，;；:-：")
            if prefix and re.search(r"(?i)(账号|帐号|account|login|user|密码|password|邮箱|email|----)", prefix):
                line = prefix
            else:
                continue
        line = re.sub(r"\s+@[A-Za-z][A-Za-z0-9_]{3,}\b.*$", "", line).strip()
        line = re.sub(r"\s{2,}", " ", line)
        if line:
            out.append(line)
    return "\n".join(out)[:12000]


def verify_worker_signature(request, body):
    secret = os.getenv("INTERNAL_API_SECRET", "").strip()
    if not secret:
        raise HTTPException(503, "origin_auth_not_configured")
    ts = request.headers.get("X-Worker-Timestamp", "")
    nonce = request.headers.get("X-Worker-Nonce", "")
    signature = request.headers.get("X-Worker-Signature", "")
    if not ts.isdigit() or not re.fullmatch(r"[a-f0-9-]{24,64}", nonce):
        raise HTTPException(401, "unauthorized")
    if abs(int(time.time()) - int(ts)) > 60:
        raise HTTPException(401, "expired_request")
    path = request.url.path + (("?" + request.url.query) if request.url.query else "")
    message = f"{ts}\n{nonce}\n{request.method.upper()}\n{path}\n".encode() + body
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "unauthorized")
    with db() as c:
        c.execute("DELETE FROM api_nonces WHERE expires_at < ?", (int(time.time()),))
        try:
            c.execute("INSERT INTO api_nonces(nonce,expires_at) VALUES(?,?)", (nonce, int(ts) + 120))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "replayed_request")


async def worker_only(request: Request):
    body = await request.body()
    verify_worker_signature(request, body)


class SendEmailIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    code: str = Field(min_length=6, max_length=6)


class BuyIn(BaseModel):
    order_id: str = Field(min_length=12, max_length=80)
    user_id: str = Field(min_length=8, max_length=80)
    product_id: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    tg_user_id: Optional[str] = None
    expected_price_usdt: str = Field(min_length=1, max_length=32)


def product_rows():
    rows = list(get_all_products() or [])
    local = get_local_products() or []
    by_id = {str(p.get("id")): p for p in rows if isinstance(p, dict) and p.get("id")}
    for p in local:
        if isinstance(p, dict) and p.get("id"):
            by_id[str(p["id"])] = p
    return list(by_id.values())


def public_product(p):
    try:
        stock = int(p.get("supplier_stock", p.get("stock", p.get("inventory", 0))) or 0)
    except (TypeError, ValueError):
        stock = 0
    local = p.get("is_local_inventory") is True
    on_sale = local or p.get("is_on_sale") is True or p.get("is_upstream") is not True
    price = str(p.get("price_usdt") or p.get("price") or "0")
    try:
        if float(price) <= 0:
            return None
    except ValueError:
        return None
    if stock <= 0 or not on_sale:
        return None
    return {
        "product_id": str(p.get("id") or ""),
        "name": clean_title(p.get("name") or p.get("title") or ""),
        "category": clean_text(p.get("category_name") or p.get("category") or "数字商品"),
        "price_usdt": price,
        "stock": stock,
        "currency": "USDT",
        "is_local_inventory": local,
        "purchasable": ENABLE_LOCAL_DELIVERY if local else ENABLE_UPSTREAM_PURCHASES,
    }


def find_product(product_id):
    return next((p for p in product_rows() if str(p.get("id")) == str(product_id)), None)


def purchase_row(order_id):
    with db() as c:
        row = c.execute("SELECT * FROM web_purchases WHERE order_id=?", (order_id,)).fetchone()
    return dict(row) if row else None


def save_purchase(order_id, status, *, content=None, supplier_order_id=None, error_code=None):
    ciphertext = delivery_cipher().encrypt(sanitize_delivery_content(content).encode()).decode() if content else None
    with db() as c:
        c.execute("""UPDATE web_purchases SET status=?,delivery_ciphertext=COALESCE(?,delivery_ciphertext),
            supplier_order_id=COALESCE(?,supplier_order_id),error_code=?,updated_at=? WHERE order_id=?""",
            (status, ciphertext, supplier_order_id, error_code, int(time.time()), order_id))


def delivery_from_row(row):
    if not row or row.get("status") != "delivered" or not row.get("delivery_ciphertext"):
        return None
    return sanitize_delivery_content(delivery_cipher().decrypt(row["delivery_ciphertext"].encode()).decode())


@app.on_event("startup")
def startup():
    init_db()
    delivery_cipher()


@app.get("/health")
def health():
    return {"ok": True, "service": "qingtian-shop-origin", "local_delivery": ENABLE_LOCAL_DELIVERY, "upstream_purchases": ENABLE_UPSTREAM_PURCHASES}


@app.post("/api/send_email", dependencies=[Depends(worker_only)])
def send_email(data: SendEmailIn):
    email = data.email.strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "invalid_email")
    host = os.getenv("SMTP_HOST", "smtp.qiye.aliyun.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("SMTP_USER", "Boss@lynli.me")
    password = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM", "Boss@lynli.me")
    if not password:
        raise HTTPException(503, "smtp_not_configured")
    message = EmailMessage()
    message["Subject"] = "晴天商城登录验证码"
    message["From"] = sender
    message["To"] = email
    message.set_content(
        f"您的晴天商城验证码是：{data.code}\n\n验证码 5 分钟内有效，请勿向任何人透露。"
    )
    try:
        with smtplib.SMTP_SSL(host, port, timeout=15) as smtp:
            smtp.login(user, password)
            smtp.send_message(message)
    except Exception as exc:
        LOG.error("SMTP delivery failed: %s", type(exc).__name__)
        raise HTTPException(502, "email_delivery_failed")
    return {"ok": True}


@app.get("/api/products", dependencies=[Depends(worker_only)])
def products():
    try:
        items = [item for p in product_rows() if (item := public_product(p))]
    except Exception as exc:
        LOG.error("Catalog read failed: %s", type(exc).__name__)
        raise HTTPException(503, "catalog_unavailable")
    return {"ok": True, "count": len(items), "items": items, "updated_at": int(time.time())}


@app.post("/api/buy", dependencies=[Depends(worker_only)])
def buy(data: BuyIn):
    existing = purchase_row(data.order_id)
    if existing:
        if existing["user_id"] != data.user_id or existing["product_id"] != data.product_id:
            raise HTTPException(409, "order_conflict")
        return {
            "ok": True, "status": existing["status"], "order_id": data.order_id,
            "content": delivery_from_row(existing), "error_code": existing["error_code"],
        }

    product = find_product(data.product_id)
    item = public_product(product) if product else None
    if not item:
        return {"ok": True, "status": "failed", "error_code": "product_unavailable"}
    if product.get("is_local_inventory") is True and not ENABLE_LOCAL_DELIVERY:
        return {"ok": True, "status": "failed", "error_code": "local_delivery_disabled"}
    if product.get("is_local_inventory") is not True and not ENABLE_UPSTREAM_PURCHASES:
        return {"ok": True, "status": "failed", "error_code": "upstream_purchase_disabled"}
    if item["price_usdt"] != data.expected_price_usdt:
        return {"ok": True, "status": "failed", "error_code": "price_changed"}

    now = int(time.time())
    with db() as c:
        c.execute("""INSERT OR IGNORE INTO web_purchases
            (order_id,user_id,product_id,status,created_at,updated_at)
            VALUES(?,?,?,'processing',?,?)""",
            (data.order_id, data.user_id, data.product_id, now, now))
        row = c.execute("SELECT * FROM web_purchases WHERE order_id=?", (data.order_id,)).fetchone()
        if not row or row["user_id"] != data.user_id:
            raise HTTPException(409, "order_conflict")
        if row["status"] != "processing":
            return {"ok": True, "status": row["status"], "order_id": data.order_id,
                    "content": delivery_from_row(dict(row))}

    if product.get("is_local_inventory") is True:
        reserved = reserve_one(data.order_id)
        if not reserved:
            save_purchase(data.order_id, "failed", error_code="out_of_stock")
            return {"ok": True, "status": "failed", "error_code": "out_of_stock"}
        if not finalize_reservation(data.order_id):
            save_purchase(data.order_id, "pending", error_code="local_finalize_pending")
            return {"ok": True, "status": "pending", "error_code": "delivery_pending"}
        save_purchase(data.order_id, "delivered", content=reserved)
        row = purchase_row(data.order_id)
        return {"ok": True, "status": "delivered", "order_id": data.order_id,
                "content": delivery_from_row(row)}

    supplier_id = str(product.get("supplier_product_id") or "")
    supplier_cost = str(product.get("supplier_price_cny") or product.get("price_cny") or "")
    if not supplier_id or not supplier_cost:
        save_purchase(data.order_id, "failed", error_code="supplier_config_missing")
        return {"ok": True, "status": "failed", "error_code": "supplier_config_missing"}

    try:
        client = DahaoshangClient()
        client.preflight_purchase(supplier_id, supplier_cost, quantity=1,
                                  model_id=product.get("supplier_model_id"), email=data.email)
    except Exception as exc:
        LOG.warning("Supplier preflight rejected: %s", type(exc).__name__)
        save_purchase(data.order_id, "failed", error_code="supplier_preflight_failed")
        return {"ok": True, "status": "failed", "error_code": "supplier_preflight_failed"}

    # A timeout after this point may mean the supplier accepted the order.
    # Never retry or refund automatically; reconcile by supplier order ID.
    try:
        result = client.buy_with_balance(
            supplier_id, quantity=1, model_id=product.get("supplier_model_id"),
            email=data.email, expected_price_cny=supplier_cost,
        )
        content = sanitize_delivery_content(result.get("content") or "")
        if not content:
            save_purchase(data.order_id, "pending",
                          supplier_order_id=result.get("supplier_order_id"),
                          error_code="delivery_content_pending")
            return {"ok": True, "status": "pending", "error_code": "delivery_pending"}
        save_purchase(data.order_id, "delivered", content=content,
                      supplier_order_id=result.get("supplier_order_id"))
        row = purchase_row(data.order_id)
        return {"ok": True, "status": "delivered", "order_id": data.order_id,
                "content": delivery_from_row(row)}
    except SupplierDeliveryPending as exc:
        save_purchase(data.order_id, "pending", supplier_order_id=exc.order_id,
                      error_code="supplier_delivery_pending")
        return {"ok": True, "status": "pending", "error_code": "delivery_pending"}
    except Exception as exc:
        LOG.error("Supplier purchase outcome requires reconciliation: %s", type(exc).__name__)
        save_purchase(data.order_id, "pending", error_code="supplier_outcome_unknown")
        return {"ok": True, "status": "pending", "error_code": "manual_reconciliation_required"}


@app.get("/api/buy/{order_id}", dependencies=[Depends(worker_only)])
def buy_status(order_id: str, user_id: str):
    row = purchase_row(order_id)
    if not row or row["user_id"] != user_id:
        raise HTTPException(404, "order_not_found")
    if row["status"] == "pending" and row.get("supplier_order_id"):
        try:
            result = DahaoshangClient().get_order(row["supplier_order_id"])
            content = sanitize_delivery_content(result.get("content") or "")
            if content:
                save_purchase(order_id, "delivered", content=content)
                row = purchase_row(order_id)
        except Exception as exc:
            LOG.info("Supplier delivery still pending: %s", type(exc).__name__)
    return {
        "ok": True, "status": row["status"], "order_id": order_id,
        "content": delivery_from_row(row), "error_code": row.get("error_code"),
    }
