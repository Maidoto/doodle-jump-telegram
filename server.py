#!/usr/bin/env python3
import hashlib
import hmac
import json
import mimetypes
import os
import sqlite3
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qsl, quote, unquote, urlparse
from urllib.request import Request, urlopen

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR))).expanduser().resolve()
DB_PATH = DATA_DIR / "stats.sqlite3"
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    or os.environ.get("SUPABASE_SERVICE_KEY", "")
    or os.environ.get("SUPABASE_SECRET_KEY", "")
).strip()
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_KEY)
ALLOW_DEV_AUTH = os.environ.get("ALLOW_DEV_AUTH", "1" if not BOT_TOKEN else "0") == "1"
HOST = os.environ.get("HOST", "0.0.0.0" if os.environ.get("RENDER") else "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
MAX_BODY_BYTES = 64 * 1024
BLOCKED_STATIC_PATHS = {"/server.py", "/wsgi.py", "/pythonanywhere_wsgi.py", "/stats.sqlite3", "/.gitignore", "/render.yaml", "/README.md", "/DEPLOY.md", "/DEPLOY_FREE.md", "/requirements.txt", "/supabase_schema.sql"}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS players (
                user_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                photo_url TEXT,
                games_played INTEGER NOT NULL DEFAULT 0,
                best_score INTEGER NOT NULL DEFAULT 0,
                total_score INTEGER NOT NULL DEFAULT 0,
                total_shots INTEGER NOT NULL DEFAULT 0,
                total_hits INTEGER NOT NULL DEFAULT 0,
                total_jumps INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                score INTEGER NOT NULL,
                max_height INTEGER NOT NULL DEFAULT 0,
                shots INTEGER NOT NULL DEFAULT 0,
                hits INTEGER NOT NULL DEFAULT 0,
                jumps INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES players(user_id)
            )
            """
        )
        db.execute("CREATE INDEX IF NOT EXISTS idx_players_best_score ON players(best_score DESC)")
        db.execute("CREATE INDEX IF NOT EXISTS idx_scores_user_id ON scores(user_id)")


def parse_telegram_user(user):
    user_id = str(user.get("id") or "guest")
    first_name = str(user.get("first_name") or "").strip()
    last_name = str(user.get("last_name") or "").strip()
    username = str(user.get("username") or "").strip()
    name = " ".join(part for part in [first_name, last_name] if part).strip() or username or "Guest"

    return {
        "user_id": user_id,
        "name": name,
        "username": username,
        "first_name": first_name,
        "last_name": last_name,
        "photo_url": str(user.get("photo_url") or ""),
    }


def validate_init_data(init_data):
    if not init_data:
        raise ValueError("missing init data")

    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False)
    data = dict(pairs)
    received_hash = data.get("hash")

    if not received_hash:
        raise ValueError("missing hash")

    check_pairs = [(key, value) for key, value in pairs if key != "hash"]
    check_string = "\n".join(f"{key}={value}" for key, value in sorted(check_pairs))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise ValueError("invalid hash")

    user_json = data.get("user")
    if not user_json:
        raise ValueError("missing user")

    return parse_telegram_user(json.loads(user_json))


def dev_user_from_header(header_value):
    if not ALLOW_DEV_AUTH:
        raise ValueError("dev auth disabled")

    if header_value:
        try:
            return parse_telegram_user(json.loads(header_value))
        except Exception:
            pass

    return {
        "user_id": "dev-user",
        "name": "Guest",
        "username": "guest",
        "first_name": "Guest",
        "last_name": "",
        "photo_url": "",
    }


def player_from_headers(headers):
    init_data = headers.get("X-Telegram-Init-Data", "") or headers.get("x-telegram-init-data", "")

    if BOT_TOKEN and init_data:
        return validate_init_data(init_data)

    if BOT_TOKEN:
        raise ValueError("telegram auth required")

    return dev_user_from_header(headers.get("X-Dev-User", "") or headers.get("x-dev-user", ""))


def player_from_request(handler):
    return player_from_headers(handler.headers)


def clamp_int(value, minimum=0, maximum=1_000_000_000):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = minimum
    return max(minimum, min(maximum, number))


def upsert_player(db, player):
    db.execute(
        """
        INSERT INTO players (
            user_id, name, username, first_name, last_name, photo_url, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            name = excluded.name,
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            photo_url = excluded.photo_url,
            updated_at = excluded.updated_at
        """,
        (
            player["user_id"],
            player["name"],
            player["username"],
            player["first_name"],
            player["last_name"],
            player["photo_url"],
            now_iso(),
        ),
    )


def record_score_sqlite(player, payload):
    score = clamp_int(payload.get("score"))
    max_height = clamp_int(payload.get("max_height"))
    shots = clamp_int(payload.get("shots"), maximum=100_000)
    hits = clamp_int(payload.get("hits"), maximum=100_000)
    jumps = clamp_int(payload.get("jumps"), maximum=100_000)
    duration_ms = clamp_int(payload.get("duration_ms"), maximum=24 * 60 * 60 * 1000)

    with sqlite3.connect(DB_PATH) as db:
        db.row_factory = sqlite3.Row
        upsert_player(db, player)
        db.execute(
            """
            INSERT INTO scores (user_id, score, max_height, shots, hits, jumps, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (player["user_id"], score, max_height, shots, hits, jumps, duration_ms, now_iso()),
        )
        db.execute(
            """
            UPDATE players
            SET
                games_played = games_played + 1,
                best_score = max(best_score, ?),
                total_score = total_score + ?,
                total_shots = total_shots + ?,
                total_hits = total_hits + ?,
                total_jumps = total_jumps + ?,
                updated_at = ?
            WHERE user_id = ?
            """,
            (score, score, shots, hits, jumps, now_iso(), player["user_id"]),
        )
        return stats_for_player(db, player["user_id"])


def stats_for_player(db, user_id):
    db.row_factory = sqlite3.Row
    player = db.execute("SELECT * FROM players WHERE user_id = ?", (user_id,)).fetchone()

    if player is None:
        return {
            "mode": "server",
            "player": None,
            "leaderboard": [],
        }

    better_count = db.execute(
        "SELECT COUNT(*) AS count FROM players WHERE best_score > ?",
        (player["best_score"],),
    ).fetchone()["count"]

    player_dict = dict(player)
    player_dict["rank"] = better_count + 1

    leaderboard = [dict(row) for row in db.execute(
        """
        SELECT user_id, name, username, games_played, best_score, total_hits
        FROM players
        WHERE games_played > 0
        ORDER BY best_score DESC, updated_at ASC
        LIMIT 20
        """
    ).fetchall()]

    for index, row in enumerate(leaderboard, start=1):
        row["rank"] = index

    return {
        "mode": "server",
        "player": player_dict,
        "leaderboard": leaderboard,
    }

def supabase_headers(extra=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "doodle-jump-telegram-server/1.0",
    }

    # Legacy service_role keys are JWTs and should also be sent as Authorization.
    # New sb_secret_* keys are server-only API keys and should not be used in browsers.
    if not SUPABASE_KEY.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {SUPABASE_KEY}"

    if extra:
        headers.update(extra)

    return headers


def supabase_request(method, resource, body=None, extra_headers=None, return_headers=False):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{SUPABASE_URL}/rest/v1/{resource}",
        data=data,
        method=method,
        headers=supabase_headers(extra_headers),
    )

    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read().decode("utf-8")
            payload = json.loads(raw) if raw else None
            if return_headers:
                return payload, response.headers
            return payload
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {resource} failed: {exc.code} {raw}") from exc


def supabase_filter(value):
    return quote(str(value), safe="")


def supabase_player_payload(player):
    return {
        "user_id": player["user_id"],
        "name": player["name"],
        "username": player["username"],
        "first_name": player["first_name"],
        "last_name": player["last_name"],
        "photo_url": player["photo_url"],
        "updated_at": now_iso(),
    }


def supabase_upsert_player(player):
    supabase_request(
        "POST",
        "doodle_players?on_conflict=user_id",
        [supabase_player_payload(player)],
        {"Prefer": "resolution=merge-duplicates,return=minimal"},
    )


def supabase_get_player(user_id):
    rows = supabase_request(
        "GET",
        f"doodle_players?select=*&user_id=eq.{supabase_filter(user_id)}&limit=1",
    ) or []
    return rows[0] if rows else None


def supabase_update_player(user_id, fields):
    rows = supabase_request(
        "PATCH",
        f"doodle_players?user_id=eq.{supabase_filter(user_id)}",
        fields,
        {"Prefer": "return=representation"},
    ) or []
    return rows[0] if rows else supabase_get_player(user_id)


def supabase_insert_score(user_id, payload):
    supabase_request(
        "POST",
        "doodle_scores",
        [{"user_id": user_id, **payload, "created_at": now_iso()}],
        {"Prefer": "return=minimal"},
    )


def supabase_better_count(best_score):
    _, headers = supabase_request(
        "GET",
        f"doodle_players?select=user_id&best_score=gt.{clamp_int(best_score)}",
        extra_headers={"Prefer": "count=exact", "Range": "0-0"},
        return_headers=True,
    )
    content_range = headers.get("Content-Range", "0-0/0")
    try:
        return int(content_range.rsplit("/", 1)[1])
    except (IndexError, ValueError):
        return 0


def supabase_leaderboard():
    rows = supabase_request(
        "GET",
        "doodle_players?select=user_id,name,username,games_played,best_score,total_hits&games_played=gt.0&order=best_score.desc,updated_at.asc&limit=20",
    ) or []

    for index, row in enumerate(rows, start=1):
        row["rank"] = index

    return rows


def supabase_stats_from_row(row):
    if not row:
        return {
            "mode": "supabase",
            "player": None,
            "leaderboard": [],
        }

    row["rank"] = supabase_better_count(row.get("best_score", 0)) + 1
    return {
        "mode": "supabase",
        "player": row,
        "leaderboard": supabase_leaderboard(),
    }


def stats_payload_for_player_supabase(player):
    supabase_upsert_player(player)
    row = supabase_get_player(player["user_id"])
    return supabase_stats_from_row(row)


def record_score_supabase(player, payload):
    score = clamp_int(payload.get("score"))
    max_height = clamp_int(payload.get("max_height"))
    shots = clamp_int(payload.get("shots"), maximum=100_000)
    hits = clamp_int(payload.get("hits"), maximum=100_000)
    jumps = clamp_int(payload.get("jumps"), maximum=100_000)
    duration_ms = clamp_int(payload.get("duration_ms"), maximum=24 * 60 * 60 * 1000)

    supabase_upsert_player(player)
    current = supabase_get_player(player["user_id"]) or {}
    score_payload = {
        "score": score,
        "max_height": max_height,
        "shots": shots,
        "hits": hits,
        "jumps": jumps,
        "duration_ms": duration_ms,
    }

    supabase_insert_score(player["user_id"], score_payload)
    updated = supabase_update_player(player["user_id"], {
        "name": player["name"],
        "username": player["username"],
        "first_name": player["first_name"],
        "last_name": player["last_name"],
        "photo_url": player["photo_url"],
        "games_played": clamp_int(current.get("games_played")) + 1,
        "best_score": max(clamp_int(current.get("best_score")), score),
        "total_score": clamp_int(current.get("total_score")) + score,
        "total_shots": clamp_int(current.get("total_shots")) + shots,
        "total_hits": clamp_int(current.get("total_hits")) + hits,
        "total_jumps": clamp_int(current.get("total_jumps")) + jumps,
        "updated_at": now_iso(),
    })

    return supabase_stats_from_row(updated)

def is_blocked_static_path(path):
    return path in BLOCKED_STATIC_PATHS or path.startswith("/__pycache__/") or path.endswith(".pyc")


def safe_static_file(path):
    clean_path = unquote(path.split("?", 1)[0])

    if clean_path in ("", "/"):
        clean_path = "/index.html"

    if is_blocked_static_path(clean_path):
        return None

    candidate = (BASE_DIR / clean_path.lstrip("/")).resolve()

    if DATA_DIR != BASE_DIR and (candidate == DATA_DIR or DATA_DIR in candidate.parents):
        return None

    if candidate == BASE_DIR or BASE_DIR not in candidate.parents:
        return None

    if candidate.is_dir():
        candidate = (candidate / "index.html").resolve()

    if not candidate.is_file():
        return None

    return candidate


def json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def stats_payload_for_player(player):
    if USE_SUPABASE:
        return stats_payload_for_player_supabase(player)

    with sqlite3.connect(DB_PATH) as db:
        upsert_player(db, player)
        return stats_for_player(db, player["user_id"])


def record_score(player, payload):
    if USE_SUPABASE:
        return record_score_supabase(player, payload)

    return record_score_sqlite(player, payload)


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {format % args}")

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/stats":
            return self.handle_stats()

        if parsed.path == "/health":
            return self.send_json({"ok": True})

        return self.send_static_file(parsed.path)

    def send_static_file(self, path):
        file_path = safe_static_file(path)

        if file_path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        body = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(str(file_path))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_blocked_static_path(self, path):
        return is_blocked_static_path(path)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/score":
            return self.handle_score()

        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_stats(self):
        try:
            player = player_from_request(self)
            with sqlite3.connect(DB_PATH) as db:
                upsert_player(db, player)
                result = stats_for_player(db, player["user_id"])
            self.send_json(result)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.UNAUTHORIZED)

    def handle_score(self):
        try:
            player = player_from_request(self)
            payload = self.read_json_body()
            result = record_score(player, payload)
            self.send_json(result)
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def read_json_body(self):
        length = min(int(self.headers.get("Content-Length", "0") or "0"), MAX_BODY_BYTES)
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def wsgi_headers(environ):
    headers = {}

    for key, value in environ.items():
        if key.startswith("HTTP_"):
            name = key[5:].replace("_", "-").title()
            headers[name] = value

    if "CONTENT_TYPE" in environ:
        headers["Content-Type"] = environ["CONTENT_TYPE"]

    return headers


def wsgi_response(start_response, status, body, content_type="application/json; charset=utf-8", extra_headers=None):
    status_line = f"{int(status)} {HTTPStatus(int(status)).phrase}"
    headers = [
        ("Content-Type", content_type),
        ("Content-Length", str(len(body))),
        ("X-Content-Type-Options", "nosniff"),
    ]

    if extra_headers:
        headers.extend(extra_headers)

    start_response(status_line, headers)
    return [body]


def wsgi_json(start_response, payload, status=HTTPStatus.OK):
    return wsgi_response(
        start_response,
        status,
        json_bytes(payload),
        "application/json; charset=utf-8",
        [("Cache-Control", "no-store")],
    )


def serve_wsgi_static(path, start_response):
    file_path = safe_static_file(path)

    if file_path is None:
        return wsgi_json(start_response, {"error": "not found"}, HTTPStatus.NOT_FOUND)

    content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    body = file_path.read_bytes()
    return wsgi_response(start_response, HTTPStatus.OK, body, content_type)


def read_wsgi_json_body(environ):
    try:
        length = min(int(environ.get("CONTENT_LENGTH") or "0"), MAX_BODY_BYTES)
    except ValueError:
        length = 0

    raw = environ["wsgi.input"].read(length).decode("utf-8") if length else "{}"
    return json.loads(raw or "{}")


def application(environ, start_response):
    init_db()
    method = environ.get("REQUEST_METHOD", "GET").upper()
    path = environ.get("PATH_INFO", "/") or "/"

    if method == "GET" and path == "/health":
        return wsgi_json(start_response, {"ok": True})

    if method == "GET" and path == "/api/stats":
        try:
            player = player_from_headers(wsgi_headers(environ))
            return wsgi_json(start_response, stats_payload_for_player(player))
        except Exception as exc:
            return wsgi_json(start_response, {"error": str(exc)}, HTTPStatus.UNAUTHORIZED)

    if method == "POST" and path == "/api/score":
        try:
            player = player_from_headers(wsgi_headers(environ))
            payload = read_wsgi_json_body(environ)
            return wsgi_json(start_response, record_score(player, payload))
        except Exception as exc:
            return wsgi_json(start_response, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    if method == "GET":
        return serve_wsgi_static(path, start_response)

    return wsgi_json(start_response, {"error": "method not allowed"}, HTTPStatus.METHOD_NOT_ALLOWED)

def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), GameHandler)
    print(f"Doodle Jump Telegram server: http://{HOST}:{PORT}")
    if BOT_TOKEN:
        print("Telegram initData validation: enabled")
    else:
        print("Telegram initData validation: disabled, local dev mode")
    server.serve_forever()


if __name__ == "__main__":
    main()
