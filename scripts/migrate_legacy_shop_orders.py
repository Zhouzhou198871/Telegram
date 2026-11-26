#!/usr/bin/env python3
"""Export legacy Qingtian shop orders from local MySQL and import into Vercel/Neon.
Sensitive delivery fields are transmitted only over HTTPS and are encrypted by the
Vercel API before storage. Never print payloads or credentials.
"""
import sys, os, json, time, uuid, hmac, hashlib, urllib.request, urllib.error
from pathlib import Path
from decimal import Decimal
from datetime import date, datetime

API_URL = "https://shop.lynli.me/api/internal/legacy-shop-migration"
ENV_FILE = "/etc/lynli-api/node-store.env"
APP_DIR = "/opt/lynli-api"

def fail(msg):
    print("FAILED: " + msg)
    raise SystemExit(1)

def load_secret(path):
    p = Path(path)
    if not p.is_file():
        fail("未找到服务器内部签名配置文件 " + path)
    for raw in p.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == "NODE_STORE_SECRET":
            v = v.strip().strip('"').strip("'")
            if v:
                return v
    fail("配置文件中没有 NODE_STORE_SECRET；未输出任何密钥")

def json_default(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    return str(v)

def rows(cur, sql, args=()):
    cur.execute(sql, args)
    return list(cur.fetchall())

def main():
    sys.path.insert(0, APP_DIR)
    try:
        import db
        import pymysql
    except Exception as e:
        fail("导入原服务器数据库模块失败：" + type(e).__name__)

    secret = load_secret(ENV_FILE)
    if len(secret) < 16:
        fail("NODE_STORE_SECRET长度异常，停止迁移")

    try:
        conn = pymysql.connect(**db.DB_CONFIG, cursorclass=pymysql.cursors.DictCursor,
                               connect_timeout=15, read_timeout=30, write_timeout=30)
    except Exception as e:
        fail("连接源MySQL失败：" + type(e).__name__)

    try:
        with conn.cursor() as cur:
            orders = rows(cur, "SELECT * FROM shop_orders ORDER BY id")
            if not orders:
                fail("源 shop_orders 为空，停止发送")
            trade_nos = [str(x["trade_no"]) for x in orders]
            placeholders = ",".join(["%s"] * len(trade_nos))
            items = rows(cur, f"SELECT * FROM shop_order_items WHERE trade_no IN ({placeholders}) ORDER BY id", trade_nos)
            deliveries = rows(cur, f"SELECT * FROM order_deliveries WHERE trade_no IN ({placeholders}) ORDER BY id", trade_nos)
            addresses = rows(cur, "SELECT * FROM shop_addresses ORDER BY id")
    except Exception as e:
        fail("读取源表失败：" + type(e).__name__)
    finally:
        conn.close()

    payload = {"orders": orders, "items": items, "deliveries": deliveries, "addresses": addresses}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=json_default).encode("utf-8")
    if len(body) > 5 * 1024 * 1024:
        fail("数据超过接口5MB限制；未发送，需拆分批次")

    ts = str(int(time.time()))
    nonce = str(uuid.uuid4())
    message = ts + "\n" + nonce + "\nPOST\n/api/internal/legacy-shop-migration\n" + body.decode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        API_URL, data=body, method="POST",
        headers={"Content-Type":"application/json",
                 "X-Worker-Timestamp":ts, "X-Worker-Nonce":nonce,
                 "X-Worker-Signature":signature}
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.loads(response.read().decode("utf-8"))
            status = response.status
    except urllib.error.HTTPError as e:
        # API errors contain only safe error codes; never print request/response payloads.
        try:
            err = json.loads(e.read().decode("utf-8"))
            code = str(err.get("error", "http_error"))
        except Exception:
            code = "http_error"
        fail("Vercel接口返回HTTP " + str(e.code) + "：" + code)
    except Exception as e:
        fail("请求Vercel接口失败：" + type(e).__name__)

    if status != 200 or not result.get("ok"):
        fail("Vercel接口未确认导入：" + str(result.get("error", "unknown_error")))
    migrated = result.get("migrated", {})
    expected = {"orders":len(orders), "items":len(items),
                "deliveries":len(deliveries), "addresses":len(addresses)}
    if migrated != expected:
        fail("接口返回计数与源数据不一致；请核对Neon，源数据未删除")
    print("IMPORT_OK")
    print("源数据行数：订单=%d，商品明细=%d，交付记录=%d，收货地址=%d" %
          (len(orders), len(items), len(deliveries), len(addresses)))
    print("Vercel确认写入：订单=%d，商品明细=%d，加密交付记录=%d，收货地址=%d" %
          (migrated["orders"], migrated["items"], migrated["deliveries"], migrated["addresses"]))
    print("订单编号：" + ", ".join(trade_nos))
    print("源MySQL未删除、未修改。交付敏感字段未输出。")

if __name__ == "__main__":
    main()
