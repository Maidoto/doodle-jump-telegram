# Doodle Jump Telegram

Telegram Mini App game built with HTML Canvas and a Python backend.

## Features

- Infinite Doodle Jump style gameplay
- PNG player, shooting pose, enemies, projectile
- WEBM map background
- Sound effects and music
- Telegram WebApp integration
- Score submission and leaderboard
- Supabase statistics backend with local SQLite fallback

## Deploy

Use `DEPLOY_FREE.md` for Render + Supabase setup.

Required environment variables on the server:

```text
TELEGRAM_BOT_TOKEN=your Telegram bot token
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your server-side Supabase key
ALLOW_DEV_AUTH=0
HOST=0.0.0.0
```

Run locally:

```bash
python server.py
```

Health check:

```text
/health
```
