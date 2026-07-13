# Doodle Jump Telegram

HTML/Canvas игра под Telegram Mini App: бесконечный уровень, PNG-персонаж, отдельная PNG-поза выстрела, PNG-враг, PNG-снаряд, WEBM-карта, звуки и статистика игроков.

## Локальный запуск

```powershell
cd C:\Users\Абдурахмон\doodle-jump-png
python server.py
```

Откройте `http://127.0.0.1:8000`.

Без `TELEGRAM_BOT_TOKEN` сервер работает в dev-режиме и сохраняет локального гостя. Если заданы `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`, статистика хранится в Supabase; иначе локально создаётся `stats.sqlite3`.

## Деплой

Подробные инструкции для бесплатного варианта Render/любой Python-хост + Supabase лежат в `DEPLOY_FREE.md`. Инструкции для PythonAnywhere/SQLite оставлены в `DEPLOY.md`.

## Запуск для Telegram

1. Создайте бота в BotFather.
2. Для production задайте переменную окружения:

```powershell
$env:TELEGRAM_BOT_TOKEN="ВАШ_ТОКЕН_БОТА"
python server.py
```

3. Разместите папку игры на HTTPS-домене.
4. В BotFather создайте Mini App или настройте кнопку Web App на URL вашего HTTPS-домена.

Сервер проверяет Telegram `initData`, если задан `TELEGRAM_BOT_TOKEN`. Результаты отправляются в `/api/score`, статистика читается из `/api/stats`.

## Ассеты

Файлы лежат в `assets/`:

- `player.png` - обычная модель персонажа
- `player-shoot.png` - модель персонажа во время выстрела вверх
- `enemy.png` - модель врага
- `projectile.png` - снаряд
- `background.png` - резервный фон
- `map.webm` - WEBM-карта для видеофона

Звуки лежат в `assets/sounds/`:

- `music.mp3` - фоновая музыка
- `shoot.mp3` - выстрел
- `hit.mp3` - попадание по врагу
- `jump.mp3` - прыжок от платформы
- `game-over.mp3` - проигрыш

## Управление

- `A` / `←` - влево
- `D` / `→` - вправо
- `Space` / `W` / `↑` - стрелять вверх
- `P` - пауза
- `R` - рестарт после проигрыша

На телефоне используются три кнопки внизу экрана.


