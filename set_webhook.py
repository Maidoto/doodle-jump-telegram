#!/usr/bin/env python3
import json
import os
import sys
from urllib.request import Request, urlopen


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    app_url = os.environ.get("WEBAPP_URL", "").strip().rstrip("/")

    if len(sys.argv) > 1:
        app_url = sys.argv[1].strip().rstrip("/")

    if not token:
        raise SystemExit("Set TELEGRAM_BOT_TOKEN first")

    if not app_url:
        raise SystemExit("Pass your Render URL: python set_webhook.py https://your-app.onrender.com")

    webhook_url = f"{app_url}/telegram/webhook"
    payload = json.dumps({
        "url": webhook_url,
        "drop_pending_updates": True,
        "allowed_updates": ["message", "edited_message", "callback_query"],
    }).encode("utf-8")
    request = Request(
        f"https://api.telegram.org/bot{token}/setWebhook",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urlopen(request, timeout=20) as response:
        print(response.read().decode("utf-8"))


if __name__ == "__main__":
    main()
