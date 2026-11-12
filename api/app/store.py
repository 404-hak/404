"""Хранение: SQLite для алертов, катеров и буёв; папка для звуковых клипов-улик.

Данные переживают перезапуск сервера. Клип хранится под своим SHA-256 — этот же хэш
входит в цепочку алертов, поэтому подмену звука видно так же, как подмену записи.
Без базы (тесты, DATA_DIR не задан) всё живёт в памяти процесса.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from pathlib import Path

from .models import Alert, Buoy

SCHEMA = """
CREATE TABLE IF NOT EXISTS alerts  (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vessels (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS buoys   (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clips   (sha TEXT PRIMARY KEY, buoy_id TEXT NOT NULL, ts TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS clips_ts ON clips (ts);
CREATE TABLE IF NOT EXISTS meta    (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""


class Store:
    """SQLite в режиме WAL; один процесс, запросы из разных потоков — под замком."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()

    def _w(self, sql: str, args: tuple = ()) -> None:
        with self.lock, self.db:
            self.db.execute(sql, args)

    def _r(self, sql: str, args: tuple = ()) -> list[tuple]:
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    # ---------- алерты ----------
    def has_alerts(self) -> bool:
        return bool(self._r("SELECT 1 FROM alerts LIMIT 1"))

    def save_alert(self, a: Alert, seq: int) -> None:
        self._w("INSERT INTO alerts (id, seq, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                (a.id, seq, a.model_dump_json()))

    def save_alerts(self, alerts: list[Alert]) -> None:
        with self.lock, self.db:
            self.db.executemany("INSERT OR REPLACE INTO alerts (id, seq, data) VALUES (?, ?, ?)",
                                [(a.id, i, a.model_dump_json()) for i, a in enumerate(alerts)])

    def load_alerts(self) -> list[Alert]:
        return [Alert.model_validate_json(d) for (d,) in self._r("SELECT data FROM alerts ORDER BY seq")]

    # ---------- катера ----------
    def save_vessel(self, vid: str, v: dict) -> None:
        self._w("INSERT OR REPLACE INTO vessels (id, data) VALUES (?, ?)", (vid, json.dumps(v, default=str)))

    def clear_vessels(self) -> None:
        self._w("DELETE FROM vessels")

    def load_vessels(self) -> dict[str, dict]:
        return {i: json.loads(d) for i, d in self._r("SELECT id, data FROM vessels")}

    # ---------- буи ----------
    def save_buoy(self, b: Buoy) -> None:
        self._w("INSERT OR REPLACE INTO buoys (id, data) VALUES (?, ?)", (b.id, b.model_dump_json()))

    def load_buoys(self) -> dict[str, Buoy]:
        return {i: Buoy.model_validate_json(d) for i, d in self._r("SELECT id, data FROM buoys")}

    # ---------- клипы ----------
    def save_clip(self, rec: dict) -> None:
        self._w("INSERT OR REPLACE INTO clips (sha, buoy_id, ts, data) VALUES (?, ?, ?, ?)",
                (rec["sha256"], rec["buoy_id"], rec["ts"], json.dumps(rec, ensure_ascii=False, default=str)))

    def recent_clips(self, limit: int = 50, buoy_id: str | None = None) -> list[dict]:
        if buoy_id:
            rows = self._r("SELECT data FROM clips WHERE buoy_id = ? ORDER BY ts DESC LIMIT ?", (buoy_id, limit))
        else:
            rows = self._r("SELECT data FROM clips ORDER BY ts DESC LIMIT ?", (limit,))
        return [json.loads(d) for (d,) in rows]

    # ---------- служебное ----------
    def get_meta(self, k: str) -> str | None:
        r = self._r("SELECT v FROM meta WHERE k = ?", (k,))
        return r[0][0] if r else None

    def set_meta(self, k: str, v: str) -> None:
        self._w("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", (k, v))

    def clear(self) -> None:
        with self.lock, self.db:
            for t in ("alerts", "vessels", "buoys", "clips"):
                self.db.execute(f"DELETE FROM {t}")


class Clips:
    """Звук клипов по SHA-256: в папке (data/clips) или в памяти."""

    def __init__(self, folder: Path | None = None):
        self.folder = folder
        self.mem: dict[str, bytes] = {}
        if folder:
            folder.mkdir(parents=True, exist_ok=True)

    def put(self, wav: bytes) -> str:
        sha = hashlib.sha256(wav).hexdigest()
        if self.folder:
            p = self.folder / f"{sha}.wav"
            if not p.exists():
                p.write_bytes(wav)
        else:
            self.mem[sha] = wav
        return sha

    def get(self, sha: str) -> bytes | None:
        if self.folder:
            p = self.folder / f"{sha}.wav"
            return p.read_bytes() if p.exists() else None
        return self.mem.get(sha)

    def path(self, sha: str) -> Path | None:
        if self.folder:
            p = self.folder / f"{sha}.wav"
            return p if p.exists() else None
        return None

    def clear(self) -> None:
        if self.folder:
            for p in self.folder.glob("*.wav"):
                p.unlink()
        self.mem.clear()
