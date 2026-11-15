#!/usr/bin/env python3
"""Export only allowlisted public fields from the JSON document pinned in Telegram."""
import json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"].strip()
CHANNEL = os.environ["CHANNEL_ID"].strip()
OUTPUT = Path(os.environ.get("OUTPUT_JSON", "_site/data.json"))

def api(method, payload=None):
    url = f"https://api.telegram.org/bot{TOKEN}/{method}"
    body = json.dumps(payload or {}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read().decode())
    if not data.get("ok"):
        raise RuntimeError(f"Telegram {method} failed: {data.get('description','unknown error')}")
    return data["result"]

def download_snapshot():
    chat = api("getChat", {"chat_id": CHANNEL})
    pinned = chat.get("pinned_message") or {}
    doc = pinned.get("document") or {}
    if not doc:
        raise RuntimeError("Pinned message does not contain a JSON document")
    info = api("getFile", {"file_id": doc["file_id"]})
    path = info.get("file_path", "")
    if not path.lower().endswith(".json"):
        raise RuntimeError("Pinned archive is not a .json document")
    url = f"https://api.telegram.org/file/bot{TOKEN}/{urllib.parse.quote(path)}"
    with urllib.request.urlopen(url, timeout=60) as res:
        snapshot = json.loads(res.read().decode("utf-8-sig"))
    if not isinstance(snapshot, dict) or snapshot.get("schema_version") != 1:
        raise RuntimeError("Unsupported archive schema; refusing to publish")
    return snapshot

def clean_products(rows):
    if not isinstance(rows, list): return []
    mapping = {
        "id": ("id", "product_id"), "name": ("name", "title"),
        "price": ("display_price", "price"), "price_usdt": ("price_usdt",),
        "price_cny": ("price_cny",), "stock": ("stock", "supplier_stock", "in_stock"),
        "category": ("category", "category_name"), "category_name": ("category_name", "category"),
        "icon": ("display_icon", "icon"), "description": ("public_description", "description")
    }
    result = []
    for row in rows:
        if not isinstance(row, dict): continue
        item = {}
        for out_key, candidates in mapping.items():
            for key in candidates:
                value = row.get(key)
                if isinstance(value, (str, int, float, bool)):
                    item[out_key] = value
                    break
        if item.get("name"): result.append(item)
    return result

def clean_announcements(rows):
    if isinstance(rows, str): rows = [{"text": rows}]
    if not isinstance(rows, list): return []
    result = []
    for row in rows[:20]:
        if isinstance(row, str):
            if row.strip(): result.append({"text": row.strip()[:2000]})
        elif isinstance(row, dict):
            item = {}
            if isinstance(row.get("title"), str): item["title"] = row["title"][:160]
            text = row.get("text") or row.get("content")
            if isinstance(text, str): item["text"] = text[:2000]
            if item: result.append(item)
    return result

def main():
    snapshot = download_snapshot()
    meta = snapshot.get("meta") if isinstance(snapshot.get("meta"), dict) else {}
    public = meta.get("public_site") if isinstance(meta.get("public_site"), dict) else {}
    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source_updated_at": snapshot.get("updated_at"),
        "products": clean_products(public.get("products", [])),
        "announcements": clean_announcements(public.get("announcements", []))
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Public export ready: {len(payload['products'])} products, {len(payload['announcements'])} announcements.")

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        print(f"Public data sync failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
