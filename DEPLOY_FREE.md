# Free Hosting With Supabase Stats

This setup keeps the game server lightweight and stores statistics in Supabase PostgreSQL instead of local SQLite.

## 1. Create Supabase database

1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase_schema.sql` from this folder.
4. Copy these values from Supabase:
   - Project URL: `SUPABASE_URL`
   - Server-side key: `SUPABASE_SERVICE_ROLE_KEY` or a server-only Secret key

Never put the service/secret key into browser JavaScript. It must only be an environment variable on the server.

## 2. Deploy on Render or another Python host

Use `render.yaml` or create a Python web service manually.

Environment variables:

```text
TELEGRAM_BOT_TOKEN=your Telegram bot token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your server-side Supabase key
ALLOW_DEV_AUTH=0
HOST=0.0.0.0
```

Build command:

```bash
python -m py_compile server.py
```

Start command:

```bash
python server.py
```

Health check:

```text
/health
```

## 3. Connect Telegram

After deploy, open:

```text
https://your-host/health
```

If it returns `{"ok": true}`, put this URL into BotFather as your Mini App / Web App URL:

```text
https://your-host/
```

## Local fallback

If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set, the server still uses local `stats.sqlite3` for development.
