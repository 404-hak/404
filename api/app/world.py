"""Состояние системы: буи, алерты, отпечатки катеров, прогноз.

Хранение пока в памяти (Фаза 1). Алерты образуют цепочку SHA-256: хэш каждого
включает хэш предыдущего, поэтому подмена любой записи ломает всю цепочку дальше.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import forecast as fc
from . import geo, voice
from .models import Alert, AlertIn, Buoy, ChainCheck, Forecast, Match, Sector, State

TZ = ZoneInfo("Europe/Astrakhan")
GENESIS = "0" * 64
FP_DIM = 16
MATCH_THRESHOLD = 0.8
OFFLINE_AFTER = timedelta(seconds=60)


def _unit(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def cosine(a: list[float], b: list[float]) -> float:
    a, b = _unit(a), _unit(b)
    return sum(x * y for x, y in zip(a, b))


def canonical(a: Alert) -> str:
    """Поля, которые фиксирует хэш (статус обработки и текст — нет: это не улика)."""
    body = {
        "id": a.id, "buoy_id": a.buoy_id, "kind": a.kind, "ts": a.ts.isoformat(),
        "lat": a.lat, "lon": a.lon, "confidence": a.confidence,
        "fingerprint": a.fingerprint,
        "match": a.match.model_dump(mode="json") if a.match else None,
        "prev_hash": a.prev_hash,
    }
    return json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class World:
    def __init__(self, clock=None):
        self._clock = clock or (lambda: datetime.now(TZ))
        self.reset()

    # ---------- время ----------
    def now(self) -> datetime:
        return self._clock()

    # ---------- начальное состояние ----------
    def reset(self) -> None:
        now = self.now()
        rnd = random.Random(404)
        self.buoys: dict[str, Buoy] = {}
        for b in geo.BUOYS:
            self.buoys[b.id] = Buoy(
                id=b.id, name=b.name, lat=b.lat, lon=b.lon, sector=geo.sector_of(b.lat, b.lon),
                battery=rnd.randint(72, 100), last_seen=now, health=round(rnd.uniform(0.74, 0.9), 2),
            )
        self.vessels: dict[str, dict] = {}
        for vid in ("boat-A", "boat-B", "boat-C"):
            self.vessels[vid] = {"vector": _unit([rnd.gauss(0, 1) for _ in range(FP_DIM)]), "last_seen": None}
        self.alerts: list[Alert] = []
        self.override: fc.Conditions | None = None
        self._seq = 0
        self._seed_history(now)

    def _past(self, now: datetime, month: int, day: int, hh: int, mm: int) -> datetime:
        d = datetime(now.year, month, day, hh, mm, tzinfo=TZ)
        return d if d < now else d.replace(year=now.year - 1)

    def _seed_history(self, now: datetime) -> None:
        """Архив прошлых событий: из него берутся «горячие» сектора и узнаваемые катера."""
        hist = [
            (self._past(now, 4, 12, 23, 10), "b09", "motor", 0.91, "boat-B"),
            (self._past(now, 4, 20, 2, 5), "b01", "silence", 0.83, None),
            (self._past(now, 5, 2, 22, 30), "b03", "shot", 0.88, None),
            (self._past(now, 5, 5, 1, 40), "b04", "motor", 0.93, "boat-A"),
        ]
        for ts, bid, kind, conf, vid in sorted(hist):
            fp = self.vessels[vid]["vector"] if vid else None
            a = self._make_alert(AlertIn(buoy_id=bid, kind=kind, confidence=conf, ts=ts, fingerprint=fp))
            a.status = "resolved"

    # ---------- алерты ----------
    def _next_id(self, ts: datetime) -> str:
        self._seq += 1
        return f"A-{ts:%Y%m%d}-{self._seq:04d}"

    def _match(self, fp: list[float], ts: datetime) -> Match | None:
        best = max(((cosine(fp, v["vector"]), vid) for vid, v in self.vessels.items()), default=(0.0, None))
        sim, vid = best
        if vid is None or sim < MATCH_THRESHOLD:
            new_id = f"boat-{len(self.vessels) + 1:02d}"
            self.vessels[new_id] = {"vector": _unit(fp), "last_seen": ts.date()}
            return None
        seen = self.vessels[vid]["last_seen"]
        self.vessels[vid]["last_seen"] = ts.date()
        if seen is None:  # первое появление катера в архиве
            return None
        return Match(vessel_id=vid, last_seen=seen, similarity=round(sim, 2))

    def _make_alert(self, data: AlertIn) -> Alert:
        b = self.buoys[data.buoy_id]
        ts = data.ts or self.now()
        match = self._match(data.fingerprint, ts) if data.fingerprint and data.kind == "motor" else None
        dist = round(geo.haversine_km(*geo.INSPECTOR, b.lat, b.lon), 1)
        msg = voice.alert_message(data.kind, b.name, dist, match.last_seen if match else None,
                                  round(match.similarity * 100) if match else None, ts.date())
        prev = self.alerts[-1].hash if self.alerts else GENESIS
        a = Alert(id=self._next_id(ts), buoy_id=b.id, buoy_name=b.name, sector=b.sector, kind=data.kind,
                  ts=ts, lat=b.lat, lon=b.lon, confidence=round(data.confidence, 2), message=msg,
                  distance_km=dist, match=match,
                  fingerprint=[round(x, 5) for x in data.fingerprint] if data.fingerprint else None,
                  prev_hash=prev, hash="")
        a.hash = sha256(canonical(a))
        self.alerts.append(a)
        return a

    def add_alert(self, data: AlertIn) -> Alert:
        if data.buoy_id not in self.buoys:
            raise KeyError(data.buoy_id)
        return self._make_alert(data)

    def patch_alert(self, alert_id: str, status: str) -> Alert:
        for a in self.alerts:
            if a.id == alert_id:
                a.status = status  # type: ignore[assignment]
                return a
        raise KeyError(alert_id)

    def verify_chain(self) -> ChainCheck:
        prev = GENESIS
        for a in self.alerts:
            if a.prev_hash != prev or sha256(canonical(a)) != a.hash:
                return ChainCheck(ok=False, checked=len(self.alerts), broken_at=a.id)
            prev = a.hash
        return ChainCheck(ok=True, checked=len(self.alerts))

    def fingerprint_like(self, vessel_id: str, similarity: float, seed: int = 7) -> list[float]:
        """Отпечаток с заданным сходством с известным катером (для демо и тестов)."""
        base = self.vessels[vessel_id]["vector"]
        rnd = random.Random(seed)
        noise = [rnd.gauss(0, 1) for _ in range(FP_DIM)]
        dot = sum(x * y for x, y in zip(noise, base))
        orth = _unit([n - dot * b for n, b in zip(noise, base)])
        s = similarity
        return [s * b + math.sqrt(1 - s * s) * o for b, o in zip(base, orth)]

    # ---------- прогноз ----------
    def hot_sectors(self, k: int = 2) -> list[int]:
        counts: dict[int, int] = {}
        for a in self.alerts:
            counts[a.sector] = counts.get(a.sector, 0) + 1
        return [s for s, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]

    def forecast(self) -> Forecast:
        now = self.now()
        c = self.override or fc.conditions_for(now)
        r = fc.risk(c)
        hot = self.hot_sectors()
        lv = fc.level(r)
        return Forecast(ts=now, moon_phase=c.phase, moon_illumination=round(c.illumination, 2),
                        weekday=fc.WEEKDAYS[c.weekday], water_temp=c.water_temp, wind_ms=c.wind_ms,
                        risk=r, level=lv, hot_sectors=hot if lv != "low" else [],
                        message=fc.message(c, r, hot), demo=self.override is not None)

    # ---------- режим дашборда ----------
    def mode(self, f: Forecast | None = None) -> str:
        if any(a.status == "intercept" for a in self.alerts):
            return "intercept"
        if any(a.status == "new" for a in self.alerts):
            return "alarm"
        f = f or self.forecast()
        return "alertness" if f.level == "high" else "calm"

    # ---------- такт симуляции ----------
    def tick(self, rnd: random.Random) -> None:
        now = self.now()
        for b in self.buoys.values():
            if b.status != "offline":
                b.last_seen = now
                b.battery = max(5, b.battery - (1 if rnd.random() < 0.02 else 0))
                b.health = round(min(0.95, max(0.4, b.health + rnd.uniform(-0.01, 0.01))), 2)

    def _buoy_status(self, b: Buoy, f: Forecast) -> str:
        if self.now() - b.last_seen > OFFLINE_AFTER:
            return "offline"
        if any(a.buoy_id == b.id and a.status in ("new", "intercept") for a in self.alerts):
            return "alert"
        if f.level == "high" and b.sector in f.hot_sectors:
            return "warn"
        return "ok"

    def state(self) -> State:
        f = self.forecast()
        for b in self.buoys.values():
            b.status = self._buoy_status(b, f)  # type: ignore[assignment]
        sectors = []
        for n in range(1, geo.ROWS * geo.COLS + 1):
            (s, w), (nn, e) = geo.sector_bounds(n)
            sectors.append(Sector(n=n, south=s, west=w, north=nn, east=e))
        return State(mode=self.mode(f), now=self.now(), buoys=list(self.buoys.values()),
                     alerts=sorted(self.alerts, key=lambda a: a.ts, reverse=True)[:30],
                     forecast=f, sectors=sectors, links=geo.nerve_links(),
                     inspector=geo.INSPECTOR, center=geo.MAP_CENTER)
