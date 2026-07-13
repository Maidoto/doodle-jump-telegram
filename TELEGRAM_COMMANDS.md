# Telegram Group Commands

After deploying to Render, set the Telegram webhook:

```bash
python set_webhook.py https://your-render-url.onrender.com
```

The bot supports these commands in private chats and groups:

```text
/play  - send a Play button
/stats - show your game statistics
/top   - show the leaderboard
/help  - show commands
```

Render environment variables:

```text
TELEGRAM_BOT_TOKEN=your Telegram bot token
WEBAPP_URL=https://your-render-url.onrender.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your server-side Supabase key
ALLOW_DEV_AUTH=0
HOST=0.0.0.0
```
