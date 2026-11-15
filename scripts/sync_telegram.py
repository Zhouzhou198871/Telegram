#!/usr/bin/env python3
"""Export allowlisted public catalog data from a pinned Telegram channel message.

The bot must be an administrator of the channel. The pinned message may contain
JSON as text/caption or attach a .json document. Only meta.public_site is exported.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"].strip()
CHANNEL = os.environ["CHANNEL_ID"].strip()
OUTPUT = Path(os.environ.get("OUTPUT_JSON", "_site/data.json"))
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024


def telegram_api(method, payload=None):
    url = f"https://api.telegram.org/bot{TOKEN}/{method}"
    body = json.dumps(payload or {}).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError(f"Telegram {method} failed: {result.get('description', 'unknown error')}")
    return result["result"]


def parse_json_text(value):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    # Permit a JSON code fence around the pinned payload.
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3].strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def pinned_snapshot(chat):
    pinned = chat.get("pinned_message") or {}
    snapshot = parse_json_text(pinned.get("text") or pinned.get("caption"))
    if snapshot:
        return snapshot

    document = pinned.get("document") or {}
    if not document:
        raise RuntimeError("Pinned message must contain JSON text or a .json document")
    file_name = (document.get("file_name") or "").lower()
    mime_type = (document.get("mime_type") or "").lower()
    if not file_name.endswith(".json") and mime_type not in ("application/json", "text/json"):
        raise RuntimeError("Pinned attachment is not recognized as a JSON file")

    file_info = telegram_api("getFile", {"file_id": document["file_id"]})
    file_path = file_info.get("file_path")
    if not file_path:
        raise RuntimeError("Telegram did not return a downloadable file path")

    url = f"https://api.telegram.org/file/bot{TOKEN}/{urllib.parse.quote(file_path)}"
    request = urllib.request.Request(url)
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(raw) > MAX_DOWNLOAD_BYTES:
        raise RuntimeError("Pinned JSON document exceeds 20 MB")
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Pinned JSON document is invalid: {exc}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("Pinned JSON root must be an object")
    return parsed


def pick(row, *keys):
    for key in keys:
        value = row.get(key)
        if isinstance(value, (str, int, float, bool)):
            return value
    return None


def clean_products(rows):
    if not isinstance(rows, list):
        return []
    output = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = {
            "id": pick(row, "id", "product_id"),
            "name": pick(row, "name", "title", "product_name"),
            "price": pick(row, "display_price", "price", "price_usdt", "price_cny"),
            "stock": pick(row, "stock", "supplier_stock", "inventory", "quantity"),
            "category": pick(row, "category_name", "category"),
            "description": pick(row, "public_description", "description", "brief"),
        }
        currency = pick(row, "currency")
        if currency:
            item["currency"] = currency
        # Preserve explicit CNY/USDT fields where present for the front-end formatter.
        for key in ("price_cny", "price_usdt"):
            value = pick(row, key)
            if value is not None:
                item[key] = value
        item = {key: value for key, value in item.items() if value is not None}
        if item.get("name"):
            output.append(item)
    return output


def clean_announcements(rows):
    if isinstance(rows, str):
        rows = [{"text": rows}]
    if not isinstance(rows, list):
        return []
    output = []
    for row in rows[:30]:
        if isinstance(row, str):
            if row.strip():
                output.append({"text": row.strip()[:3000]})
            continue
        if not isinstance(row, dict):
            continue
        item = {}
        title = pick(row, "title", "name")
        content = pick(row, "text", "content", "description")
        if title:
            item["title"] = str(title)[:200]
        if content:
            item["text"] = str(content)[:3000]
        date = pick(row, "date", "created_at")
        if date:
            item["date"] = date
        if item:
            output.append(item)
    return output


def main():
    if not TOKEN or not CHANNEL:
        raise RuntimeError("TELEGRAM_BOT_TOKEN and CHANNEL_ID must be configured as GitHub Secrets")

    chat = telegram_api("getChat", {"chat_id": CHANNEL})
    snapshot = pinned_snapshot(chat)
    if snapshot.get("schema_version") not in (None, 1):
        raise RuntimeError("Unsupported Telegram snapshot schema version")

    meta = snapshot.get("meta")
    if not isinstance(meta, dict):
        raise RuntimeError("Pinned JSON has no meta object")
    public_site = meta.get("public_site")
    if not isinstance(public_site, dict):
        raise RuntimeError("Pinned JSON has no meta.public_site object")

    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "products": clean_products(public_site.get("products")),
        "announcements": clean_announcements(public_site.get("announcements")),
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Public export complete: {len(payload['products'])} products, "
        f"{len(payload['announcements'])} announcements."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Public data sync failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise
