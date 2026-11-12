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
from .models import Alert, AlertIn, Buoy, ChainCheck, Forecast, Match, NightForecast, NightStat, Sector, State, Stats

TZ = ZoneInfo("Europe/Astrakhan")
GENESIS = "0" * 64
FP_DIM = 16
MATCH_THRESHOLD = 0.8
OFFLINE_AFTER = timedelta(seconds=60)
HISTORY_NIGHTS = 60

# Демо-история: где и что «слышали» буи. Веса держат сектор 7 самым горячим, 5 — вторым,
# как в сценарии защиты («Рекомендую усилить сектор 7»).
SYNTH_BUOY_WEIGHT = {"b01": 5, "b04": 5, "b09": 5, "b03": 3, "b05": 3}
SYNTH_KINDS = (("motor", 50), ("silence", 22), ("offline", 18), ("shot", 10))
SYNTH_HOURS = ((21, 1), (22, 2), (23, 3), (0, 4), (1, 4), (2, 3), (3, 2), (4, 1))


def night_of(ts: datetime) -> date:
    """Ночь, к которой относится момент: до полудня — ещё прошлая ночь."""
    t = ts.astimezone(TZ)
    return t.date() - timedelta(days=1) if t.hour < 12 else t.date()


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
        """Архив прошлых событий: из него берутся «горячие» сектора и узнаваемые катера.

        Четыре опорных события сценария и сгенерированная демо-история за последние ночи
        (помечена synthetic: это не реальные данные заповедника).
        """
        hist = [
            (self._past(now, 4, 12, 23, 10), "b09", "motor", 0.91, "boat-B", False, 21),
            (self._past(now, 4, 20, 2, 5), "b01", "silence", 0.83, None, False, 34),
            (self._past(now, 5, 2, 22, 30), "b03", "shot", 0.88, None, False, 12),
            (self._past(now, 5, 5, 1, 40), "b04", "motor", 0.93, "boat-A", False, 17),
        ]
        hist += self._synthetic_history(now)
        for ts, bid, kind, conf, vid, synth, react in sorted(hist, key=lambda h: h[0]):
            fp = self.vessels[vid]["vector"] if vid else None
            a = self._make_alert(AlertIn(buoy_id=bid, kind=kind, confidence=conf, ts=ts, fingerprint=fp))
            a.status = "resolved"
            a.synthetic = synth
            a.intercept_at = ts + timedelta(minutes=react)
            a.resolved_at = a.intercept_at + timedelta(minutes=25 + react)

    def _synthetic_history(self, now: datetime) -> list[tuple]:
        """Демо-история: в тёмные тёплые ночи событий больше — как предсказывает формула риска."""
        out = []
        ids = list(self.buoys)
        weights = [SYNTH_BUOY_WEIGHT.get(i, 1) for i in ids]
        tonight = night_of(now)
        for k in range(1, HISTORY_NIGHTS + 1):
            d = tonight - timedelta(days=k)
            rnd = random.Random(f"404-{d.isoformat()}")
            r = fc.risk(fc.conditions_for(datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ)))
            n = (rnd.random() < 0.12 + 0.55 * r) + (rnd.random() < 0.25 * r) + (rnd.random() < 0.08 * r)
            for _ in range(n):
                hour = rnd.choices([h for h, _ in SYNTH_HOURS], [w for _, w in SYNTH_HOURS])[0]
                day = d + timedelta(days=1) if hour < 12 else d
                ts = datetime(day.year, day.month, day.day, hour, rnd.randrange(60), tzinfo=TZ)
                kind = rnd.choices([k for k, _ in SYNTH_KINDS], [w for _, w in SYNTH_KINDS])[0]
                bid = rnd.choices(ids, weights)[0]
                react = round(min(60, max(4, rnd.lognormvariate(2.7, 0.45))))
                out.append((ts, bid, kind, round(rnd.uniform(0.7, 0.96), 2), None, True, react))
        return out

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
                if status == "intercept" and a.intercept_at is None:
                    a.intercept_at = self.now()
                if status == "resolved" and a.resolved_at is None:
                    a.resolved_at = self.now()
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

    # ---------- аналитика ----------
    def stats(self, days: int = 30) -> Stats:
        """Сводка по последним ночам: события по ночам, типам, секторам, часам и скорость реакции."""
        tonight = night_of(self.now())
        first = tonight - timedelta(days=days - 1)
        window = [a for a in self.alerts if first <= night_of(a.ts) <= tonight]
        nights = []
        for k in range(days):
            d = first + timedelta(days=k)
            c = fc.conditions_for(datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ))
            evs = [a for a in window if night_of(a.ts) == d]
            kinds: dict[str, int] = {}
            for a in evs:
                kinds[a.kind] = kinds.get(a.kind, 0) + 1
            nights.append(NightStat(date=d, risk=fc.risk(c), moon_illumination=round(c.illumination, 2),
                                    events=len(evs), by_kind=kinds))
        by_kind = {k: 0 for k, _ in SYNTH_KINDS}
        by_sector = {n: 0 for n in range(1, geo.ROWS * geo.COLS + 1)}
        by_hour = [0] * 24
        reactions = []
        for a in window:
            by_kind[a.kind] = by_kind.get(a.kind, 0) + 1
            by_sector[a.sector] += 1
            by_hour[a.ts.astimezone(TZ).hour] += 1
            done = a.intercept_at or a.resolved_at
            if done:
                reactions.append((done - a.ts).total_seconds() / 60)
        reactions.sort()
        median = None
        if reactions:
            m = len(reactions) // 2
            median = round(reactions[m] if len(reactions) % 2 else (reactions[m - 1] + reactions[m]) / 2, 1)
        return Stats(days=days, nights=nights, by_kind=by_kind, by_sector=by_sector, by_hour=by_hour,
                     total=len(window), reaction_median_min=median, synthetic=any(a.synthetic for a in window))

    def nights(self, days: int = 14) -> list[NightForecast]:
        """Прогноз риска на ближайшие ночи: настоящая луна, сезонная вода, день недели."""
        tonight = night_of(self.now())
        out = []
        for k in range(days):
            d = tonight + timedelta(days=k)
            c = fc.conditions_for(datetime(d.year, d.month, d.day, 23, 0, tzinfo=TZ))
            r = fc.risk(c)
            out.append(NightForecast(date=d, weekday=fc.WEEKDAYS[c.weekday], moon_phase=c.phase,
                                     moon_illumination=round(c.illumination, 2), water_temp=c.water_temp,
                                     risk=r, level=fc.level(r)))
        return out
