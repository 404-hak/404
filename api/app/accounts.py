"""Учётные записи, сессии и журнал действий (docs/audit/01-security.md S13, 06-backend.md B1).

Роли: наблюдатель (только смотрит), дежурный (решает по тревогам, лаборатория), старший (+ команда, демо).
Пока нет ни одной учётной записи — вход не нужен (режим показа или ссылка доступа ACCESS_TOKEN).
Первая учётная запись — из командной строки (папка api/):

    .venv/bin/python -m app.accounts add ivanov senior "Иванов И. И."     # печатает пароль

Журнал действий — отдельная хэш-цепочка, только дописывается: кто и когда начал перехват, закрыл тревогу,
вошёл, добавил человека, сбросил демо. Подменить запись незаметно нельзя — проверка в /api/evidence/verify.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sys
import time
from datetime import datetime, timedelta, timezone

ROLES = {"observer": 0, "duty": 1, "senior": 2}
ROLE_TITLE = {"observer": "наблюдатель", "duty": "дежурный", "senior": "старший"}
SESSION_DAYS = 14

SCHEMA = """
CREATE TABLE IF NOT EXISTS users    (login TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, pw TEXT NOT NULL,
                                     created TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, login TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS journal  (seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
                                     target TEXT, data TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS anchors  (ts TEXT NOT NULL, seal TEXT NOT NULL, alerts_head TEXT NOT NULL, journal_head TEXT NOT NULL);
"""


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(pw: str, stored: str) -> bool:
    try:
        _, salt, want = stored.split("$")
        h = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
        return hmac.compare_digest(h.hex(), want)
    except (ValueError, TypeError):
        return False


def new_password() -> str:
    """Пароль, который удобно продиктовать: три группы по четыре знака без похожих букв."""
    abc = "abcdefghjkmnpqrstuvwxyz23456789"
    return "-".join("".join(secrets.choice(abc) for _ in range(4)) for _ in range(3))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Accounts:
    """Люди, сессии и журнал. Живут в той же SQLite, что и тревоги; без базы — в памяти (тесты)."""

    def __init__(self, store=None):
        self.store = store
        self.mem_users: dict[str, dict] = {}
        self.mem_sessions: dict[str, tuple[str, float]] = {}
        self.mem_journal: list[dict] = []
        if store:
            with store.lock, store.db:
                store.db.executescript(SCHEMA)

    # ---------- люди ----------
    def _rows(self, sql: str, args: tuple = ()) -> list[tuple]:
        return self.store._r(sql, args) if self.store else []

    def enabled(self) -> bool:
        """Вход нужен, как только заведена хотя бы одна действующая учётная запись (ответ помним 3 с)."""
        at, val = getattr(self, "_en", (0.0, False))
        if time.monotonic() - at < 3:
            return val
        if self.store:
            val = bool(self._rows("SELECT 1 FROM users WHERE disabled = 0 LIMIT 1"))
        else:
            val = any(not u["disabled"] for u in self.mem_users.values())
        self._en = (time.monotonic(), val)
        return val

    def users(self) -> list[dict]:
        if self.store:
            rows = self._rows("SELECT login, name, role, created, disabled FROM users ORDER BY created")
            return [{"login": l, "name": n, "role": r, "created": c, "disabled": bool(d)} for l, n, r, c, d in rows]
        return [{k: v for k, v in u.items() if k != "pw"} for u in self.mem_users.values()]

    def get(self, login: str) -> dict | None:
        if self.store:
            r = self._rows("SELECT login, name, role, pw, created, disabled FROM users WHERE login = ?", (login,))
            if not r:
                return None
            l, n, ro, pw, c, d = r[0]
            return {"login": l, "name": n, "role": ro, "pw": pw, "created": c, "disabled": bool(d)}
        return self.mem_users.get(login)

    def add(self, login: str, role: str, name: str = "", password: str | None = None) -> str:
        login = login.strip().lower()
        if not login or not login.replace(".", "").replace("-", "").replace("_", "").isalnum() or len(login) > 40:
            raise ValueError("логин: латиница, цифры, точка, дефис; до 40 знаков")
        if role not in ROLES:
            raise ValueError(f"роль: {', '.join(ROLES)}")
        if self.get(login):
            raise ValueError("такой логин уже есть")
        pw = password or new_password()
        u = {"login": login, "name": (name or login).strip()[:80], "role": role, "pw": hash_password(pw), "created": _now(), "disabled": False}
        if self.store:
            self.store._w("INSERT INTO users (login, name, role, pw, created, disabled) VALUES (?, ?, ?, ?, ?, 0)",
                          (u["login"], u["name"], u["role"], u["pw"], u["created"]))
        else:
            self.mem_users[login] = u
        self._en = (0.0, False)
        return pw

    def update(self, login: str, *, role: str | None = None, disabled: bool | None = None, reset: bool = False) -> str | None:
        u = self.get(login)
        if not u:
            raise KeyError(login)
        if role is not None and role not in ROLES:
            raise ValueError(f"роль: {', '.join(ROLES)}")
        pw = new_password() if reset else None
        u.update({k: v for k, v in {"role": role, "disabled": disabled}.items() if v is not None})
        if pw:
            u["pw"] = hash_password(pw)
        if self.store:
            self.store._w("UPDATE users SET role = ?, disabled = ?, pw = ? WHERE login = ?", (u["role"], int(u["disabled"]), u["pw"], login))
        else:
            self.mem_users[login] = u
        if disabled or reset:
            self.end_sessions(login)
        self._en = (0.0, False)
        return pw

    # ---------- сессии ----------
    def login(self, login: str, password: str) -> str | None:
        u = self.get(login.strip().lower())
        if not u or u["disabled"] or not check_password(password, u["pw"]):
            return None
        sid = secrets.token_urlsafe(32)
        expires = time.time() + SESSION_DAYS * 86400
        key = hashlib.sha256(sid.encode()).hexdigest()       # в базе — хэш: утечка базы не даёт войти
        if self.store:
            self.store._w("INSERT INTO sessions (sid, login, expires) VALUES (?, ?, ?)", (key, u["login"], expires))
            self.store._w("DELETE FROM sessions WHERE expires < ?", (time.time(),))
        else:
            self.mem_sessions[key] = (u["login"], expires)
        return sid

    def session_user(self, sid: str | None) -> dict | None:
        if not sid:
            return None
        key = hashlib.sha256(sid.encode()).hexdigest()
        if self.store:
            r = self._rows("SELECT login, expires FROM sessions WHERE sid = ?", (key,))
            hit = r[0] if r else None
        else:
            hit = self.mem_sessions.get(key)
        if not hit or hit[1] < time.time():
            return None
        u = self.get(hit[0])
        if not u or u["disabled"]:
            return None
        return {"login": u["login"], "name": u["name"], "role": u["role"]}

    def logout(self, sid: str | None) -> None:
        if not sid:
            return
        key = hashlib.sha256(sid.encode()).hexdigest()
        if self.store:
            self.store._w("DELETE FROM sessions WHERE sid = ?", (key,))
        else:
            self.mem_sessions.pop(key, None)

    def end_sessions(self, login: str) -> None:
        if self.store:
            self.store._w("DELETE FROM sessions WHERE login = ?", (login,))
        else:
            for k in [k for k, (l, _) in self.mem_sessions.items() if l == login]:
                self.mem_sessions.pop(k, None)

    # ---------- журнал действий: хэш-цепочка ----------
    def _journal_rows(self) -> list[dict]:
        if self.store:
            rows = self._rows("SELECT seq, ts, actor, action, target, data, prev, hash FROM journal ORDER BY seq")
            return [{"seq": s, "ts": t, "actor": a, "action": ac, "target": tg, "data": json.loads(d), "prev": p, "hash": h}
                    for s, t, a, ac, tg, d, p, h in rows]
        return list(self.mem_journal)

    @staticmethod
    def _entry_hash(e: dict) -> str:
        body = json.dumps({k: e[k] for k in ("seq", "ts", "actor", "action", "target", "data", "prev")},
                          sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(body.encode()).hexdigest()

    def record(self, actor: str, action: str, target: str | None = None, **data) -> dict:
        if self.store:
            last = self._rows("SELECT seq, hash FROM journal ORDER BY seq DESC LIMIT 1")
            seq, prev = (last[0][0] + 1, last[0][1]) if last else (1, "0" * 64)
        else:
            seq = len(self.mem_journal) + 1
            prev = self.mem_journal[-1]["hash"] if self.mem_journal else "0" * 64
        e = {"seq": seq, "ts": _now(), "actor": actor, "action": action, "target": target, "data": data, "prev": prev}
        e["hash"] = self._entry_hash(e)
        if self.store:
            self.store._w("INSERT INTO journal (seq, ts, actor, action, target, data, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                          (seq, e["ts"], actor, action, target, json.dumps(data, ensure_ascii=False), prev, e["hash"]))
        else:
            self.mem_journal.append(e)
        return e

    def journal(self, limit: int = 100) -> list[dict]:
        return list(reversed(self._journal_rows()))[: max(1, min(limit, 1000))]

    def head(self) -> str:
        rows = self._journal_rows()
        return rows[-1]["hash"] if rows else "0" * 64

    # ---------- печать цепочки: хэш вершин, который хранят вне сервера ----------
    def anchor(self, alerts_head: str, alerts: int) -> dict:
        """Записать печать: SHA-256 от вершины цепочки тревог и вершины журнала. Скопированная вне сервера
        (бумажный журнал смены, почта, внешний журнал по ANCHOR_WEBHOOK), она доказывает, что прошлое не переписали."""
        jh = self.head()
        seal = hashlib.sha256(f"404-seal-v1|{alerts_head}|{jh}".encode()).hexdigest()
        a = {"ts": _now(), "seal": seal, "alerts_head": alerts_head, "journal_head": jh, "alerts": alerts}
        if self.store:
            self.store._w("INSERT INTO anchors (ts, seal, alerts_head, journal_head) VALUES (?, ?, ?, ?)", (a["ts"], seal, alerts_head, jh))
        else:
            self.mem_anchors = [*getattr(self, "mem_anchors", []), a]
        return a

    def anchors(self) -> list[dict]:
        if self.store:
            return [{"ts": t, "seal": s, "alerts_head": ah, "journal_head": jh}
                    for t, s, ah, jh in self._rows("SELECT ts, seal, alerts_head, journal_head FROM anchors ORDER BY ts")]
        return list(getattr(self, "mem_anchors", []))

    def clear_anchors(self) -> None:
        """Только для сброса демо: вместе с демо-тревогами уходят и их печати."""
        if self.store:
            self.store._w("DELETE FROM anchors")
        else:
            self.mem_anchors = []

    def verify(self) -> tuple[int, str | None]:
        """(сколько проверено, номер первой испорченной записи или None)."""
        prev = "0" * 64
        rows = self._journal_rows()
        for e in rows:
            if e["prev"] != prev or self._entry_hash(e) != e["hash"]:
                return len(rows), str(e["seq"])
            prev = e["hash"]
        return len(rows), None


def _cli(argv: list[str]) -> None:
    import os
    from pathlib import Path

    from .store import Store
    data = Path(os.getenv("DATA_DIR") or Path(__file__).resolve().parents[1] / "data")
    acc = Accounts(Store(data / "404-team.db"))
    if len(argv) >= 3 and argv[0] == "add":
        pw = acc.add(argv[1], argv[2], " ".join(argv[3:]))
        acc.record("командная строка", "user.add", argv[1], role=argv[2])
        print(f"Добавлен {argv[1]} ({ROLE_TITLE[argv[2]]}). Пароль: {pw}")
    elif len(argv) == 2 and argv[0] == "reset":
        pw = acc.update(argv[1], reset=True)
        acc.record("командная строка", "user.reset", argv[1])
        print(f"Новый пароль для {argv[1]}: {pw}")
    elif argv[:1] == ["list"]:
        for u in acc.users():
            print(f"{u['login']:<16} {ROLE_TITLE[u['role']]:<12} {u['name']}{' (отключён)' if u['disabled'] else ''}")
    else:
        print("Команды: add <логин> <observer|duty|senior> [Имя] · reset <логин> · list")


if __name__ == "__main__":
    _cli(sys.argv[1:])
