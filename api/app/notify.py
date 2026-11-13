"""Уведомления дежурному вне сайта: каждая новая тревога — сообщением в Telegram.

Окружение:
  TELEGRAM_BOT_TOKEN  токен бота от @BotFather
  TELEGRAM_CHAT_ID    куда писать: личный чат дежурного или группа смены (id чата)
  PUBLIC_URL          адрес дашборда для ссылки в сообщении (необязательно)

Не задано — уведомлений нет, всё остальное работает как раньше. Сообщение уходит в фоне:
медленный или недоступный Telegram не задерживает приём звука с буёв.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
from collections.abc import Callable

from .models import Alert

log = logging.getLogger("404")

TITLE = {"motor": "мотор", "shot": "выстрел", "silence": "тишина как улика", "offline": "буй не на связи"}


def text(a: Alert, public_url: str = "") -> str:
    """Текст сообщения: что, где, насколько уверены, где катер, ссылка на карту."""
    lines = [f"404 · тревога: {TITLE.get(a.kind, a.kind)} — буй {a.buoy_name}, сектор {a.sector}", a.message]
    if a.kind in ("motor", "shot"):
        lines.append(f"Уверенность сети: {round(a.confidence * 100)} %")
    if a.estimate:
        lines.append(f"Где источник: ≈ {a.estimate.lat:.4f}, {a.estimate.lon:.4f} ± {a.estimate.radius_km:.1f} км "
                     f"(по громкости у {a.estimate.buoys} буёв)")
    lines.append(f"Буй: {a.lat:.4f}, {a.lon:.4f}")
    if public_url:
        lines.append(public_url.rstrip("/") + "/")
    return "\n".join(lines)


def post(url: str, payload: dict) -> None:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()


class Telegram:
    def __init__(self, token: str, chat_id: str, public_url: str = ""):
        self.url = f"https://api.telegram.org/bot{token}/sendMessage"
        self.chat_id, self.public_url = chat_id, public_url

    def send(self, a: Alert) -> None:
        if a.synthetic:
            return
        payload = {"chat_id": self.chat_id, "text": text(a, self.public_url), "disable_web_page_preview": True}

        def run():
            try:
                post(self.url, payload)
            except Exception as e:                   # нет сети, неверный токен — пишем в лог, тревога остаётся на сайте
                log.warning("Telegram: сообщение о тревоге %s не ушло: %s", a.id, e)

        threading.Thread(target=run, daemon=True).start()


def from_env() -> Callable[[Alert], None] | None:
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN", ""), os.getenv("TELEGRAM_CHAT_ID", "")
    if not (token and chat):
        return None
    log.info("404: тревоги уходят и в Telegram (чат %s)", chat)
    return Telegram(token, chat, os.getenv("PUBLIC_URL", "")).send
