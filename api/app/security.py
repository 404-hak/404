"""Защита и отдача: доступ по ссылке, заголовки безопасности, сжатие, кэш. См. docs/audit/01-security.md.

Окружение:
  ACCESS_TOKEN  если задан — сайт, API и WebSocket только для своих. Дежурному отправляют ссылку
                https://<сервер>/?access=<токен>: сервер ставит cookie на 30 дней и убирает токен из адреса.
                Программы — заголовок Authorization: Bearer <токен>. Без токена — режим показа (открыто всем).
  ALLOWED_ORIGINS  через запятую: с каких адресов можно открывать WebSocket (по умолчанию — тот же хост).
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl, urlencode

from starlette.middleware.gzip import GZipMiddleware

log = logging.getLogger("404")

COOKIE = "access404"
COOKIE_DAYS = 30
# без доступа открыты только проверка живости (мониторинг) и robots.txt
PUBLIC = re.compile(r"^/(api/health|robots\.txt)$")
BUOY_PATH = re.compile(r"^/api/buoys/[^/]+/(audio|heartbeat)$")


def access_token() -> str:
    return os.getenv("ACCESS_TOKEN", "")


def buoy_token() -> str:
    return os.getenv("BUOY_TOKEN", "")


def cookie_value(token: str) -> str:
    """В cookie лежит не сам токен, а его подпись: украденная cookie не раскрывает ссылку доступа."""
    return hmac.new(token.encode(), b"404-access-v1", hashlib.sha256).hexdigest()


def _headers(scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}


def _https(scope, h: dict[str, str]) -> bool:
    return scope.get("scheme") in ("https", "wss") or h.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


DENIED_HTML = """<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>404 · нужен доступ</title><style>
html,body{height:100%;margin:0;background:#0B1628;color:#E2E8F0;font:16px/1.5 system-ui,sans-serif}
main{min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box}
section{max-width:420px}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 12px;color:#A2A9B4}
code{color:#E2E8F0;background:#13243A;padding:2px 6px;border-radius:6px}</style></head>
<body><main><section><h1>Нужна ссылка доступа</h1>
<p>Дашборд — только для дежурных. Попросите у старшего смены ссылку вида <code>…/?access=…</code> и откройте её один раз — дальше браузер запомнит вход на 30 дней.</p>
</section></main></body></html>"""


class AccessGate:
    """Пускает только со ссылкой доступа, cookie или Bearer-токеном (когда задан ACCESS_TOKEN)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = access_token()
        if scope["type"] not in ("http", "websocket") or not token:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if PUBLIC.match(path):
            return await self.app(scope, receive, send)
        # у буёв свой токен на свои два адреса (проверяет buoy_auth)
        if buoy_token() and BUOY_PATH.match(path):
            return await self.app(scope, receive, send)
        h = _headers(scope)
        auth = h.get("authorization", "")
        if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:].strip(), token):
            return await self.app(scope, receive, send)
        jar = SimpleCookie()
        try:
            jar.load(h.get("cookie", ""))
        except Exception:  # noqa: BLE001 — битая cookie = нет cookie
            jar = SimpleCookie()
        if COOKIE in jar and hmac.compare_digest(jar[COOKIE].value, cookie_value(token)):
            return await self.app(scope, receive, send)

        # ссылка доступа: ставим cookie и убираем токен из адреса (он не останется в истории и в Referer)
        query = parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)
        given = next((v for k, v in query if k == "access"), None)
        if scope["type"] == "http" and given is not None and hmac.compare_digest(given, token):
            rest = urlencode([(k, v) for k, v in query if k != "access"])
            location = path + (f"?{rest}" if rest else "")
            secure = "; Secure" if _https(scope, h) else ""
            cookie = f"{COOKIE}={cookie_value(token)}; Path=/; Max-Age={COOKIE_DAYS * 86400}; HttpOnly; SameSite=Strict{secure}"
            await send({"type": "http.response.start", "status": 303,
                        "headers": [(b"location", location.encode()), (b"set-cookie", cookie.encode()), (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": b""})
            return

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        wants_html = "text/html" in h.get("accept", "") and not path.startswith("/api/")
        body = DENIED_HTML.encode() if wants_html else b'{"detail":"\\u041d\\u0443\\u0436\\u0435\\u043d \\u0434\\u043e\\u0441\\u0442\\u0443\\u043f"}'
        ctype = b"text/html; charset=utf-8" if wants_html else b"application/json"
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", ctype), (b"cache-control", b"no-store"), (b"x-robots-tag", b"noindex, nofollow")]})
        await send({"type": "http.response.body", "body": body})


# Строгая политика содержимого пока «только отчёт»: Яндекс Карты грузят скрипты и картинки с многих
# доменов, включать её принудительно — после проверки на живом ключе (docs/audit/01-security.md, S8).
CSP_REPORT_ONLY = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://api-maps.yandex.ru https://*.yandex.ru https://*.yandex.net https://yastatic.net",
    "style-src 'self' 'unsafe-inline' https://*.yandex.ru https://*.yandex.net https://yastatic.net",
    "img-src 'self' data: blob: https://server.arcgisonline.com https://*.yandex.ru https://*.yandex.net https://yastatic.net",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: https://*.yandex.ru https://*.yandex.net",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
])
# Это включено сразу: ничего не ломает, а встраивание дашборда в чужой сайт (кликджекинг кнопок) запрещено
CSP_ENFORCED = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"


class Hardening:
    """Заголовки безопасности и кэша на каждый ответ."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        h = _headers(scope)
        https = _https(scope, h)
        private = bool(access_token())

        async def send_wrapped(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                have = {k.lower() for k, _ in headers}

                def add(k: str, v: str):
                    if k.encode() not in have:
                        headers.append((k.encode(), v.encode()))

                add("x-content-type-options", "nosniff")
                add("referrer-policy", "strict-origin-when-cross-origin")
                add("x-frame-options", "SAMEORIGIN")
                add("permissions-policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)")
                add("content-security-policy", CSP_ENFORCED)
                add("content-security-policy-report-only", CSP_REPORT_ONLY)
                add("cross-origin-opener-policy", "same-origin")
                if https:
                    add("strict-transport-security", "max-age=15552000")
                if private:
                    add("x-robots-tag", "noindex, nofollow")
                # кэш: файлы сборки с хэшем в имени — навсегда, страница и API — всегда свежие
                if path.startswith("/assets/"):
                    add("cache-control", "public, max-age=31536000, immutable")
                elif path.startswith("/api/") or path == "/ws":
                    add("cache-control", "no-store")
                elif path.startswith(("/brand/", "/geo/")):
                    add("cache-control", "public, max-age=86400")
                else:
                    add("cache-control", "no-cache")
            await send(message)

        await self.app(scope, receive, send_wrapped)


class Compress:
    """Сжатие gzip (сборка 0,6 МБ → 0,2 МБ, схема дельты 1,3 МБ → ~0,3 МБ). Звук не сжимаем:
    WAV почти не сжимается, а браузер запрашивает его кусками (Range) для перемотки."""

    def __init__(self, app):
        self.app = app
        self.gz = GZipMiddleware(app, minimum_size=800, compresslevel=6)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not scope.get("path", "").endswith("/audio"):
            return await self.gz(scope, receive, send)
        return await self.app(scope, receive, send)


def origin_allowed(origin: str | None, host: str | None) -> bool:
    """WebSocket только со своего сайта: иначе чужая страница откроет соединение с cookie дежурного."""
    if not origin:
        return True  # не браузер (скрипт, буй, тесты) — Origin не присылают
    allowed = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if origin.rstrip("/") in allowed:
        return True
    bare = re.sub(r"^https?://", "", origin.rstrip("/"))
    return bool(host) and bare == host


def startup_warnings() -> None:
    if not access_token():
        log.warning("404: ACCESS_TOKEN не задан — дашборд, тревоги и кнопки открыты всем, кто знает адрес (режим показа)")
    elif not buoy_token():
        log.warning("404: BUOY_TOKEN не задан — буи присылают звук с ACCESS_TOKEN; лучше дать буям свой токен")
    if os.getenv("DEMO", "1") != "0":
        log.warning("404: демо включено (DEMO=1) — «Сбросить» стирает базу и звуковые улики; на настоящих данных задайте DEMO=0")
