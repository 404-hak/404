"""Симулятор буёв: шлёт в API звук, как настоящие гидрофоны, — весь путь «звук → нейросеть → алерт».

    cd api && .venv/bin/python -m app.buoysim                   # к http://localhost:8000, клип раз в 6 с
    .venv/bin/python -m app.buoysim --every 3 --events 0.08     # чаще и с событиями чаще
    .venv/bin/python -m app.buoysim --token SECRET              # если на сервере задан BUOY_TOKEN

Гидрофоны под водой: каждый буй слышит подводную природу своей живости. Иногда мимо проходит катер —
громко у одного буя и тише у соседей (тот же мотор, тот же отпечаток); иногда — выстрел; иногда у
одного буя надолго стихает природа (человек в камышах); иногда рядом разговаривают люди — сервер
узнаёт голоса и тревогу не поднимает. Катера — из архива (boat-A, B, C: сервер должен их узнать)
и новые. Сервер решает сам: симулятор только «издаёт звук».
"""
from __future__ import annotations

import argparse
import json
import math
import time
import urllib.error
import urllib.request

import numpy as np

from . import geo
from .audio import dsp, synth
from .world import ARCHIVE_VESSELS


def post(api: str, path: str, body: bytes, ctype: str, token: str | None) -> dict:
    req = urllib.request.Request(api.rstrip("/") + path, data=body, method="POST", headers={"Content-Type": ctype})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def km(a: geo.BuoySeed, b: geo.BuoySeed) -> float:
    return geo.haversine_km(a.lat, a.lon, b.lat, b.lon)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--every", type=float, default=6.0, help="секунд между клипами каждого буя")
    ap.add_argument("--events", type=float, default=0.04, help="вероятность события на такт")
    ap.add_argument("--token")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--once", action="store_true", help="один такт и выход (проверка)")
    a = ap.parse_args()
    r = np.random.default_rng(a.seed)
    buoys = geo.BUOYS
    base = {b.id: float(r.uniform(0.5, 0.9)) for b in buoys}         # обычная живость природы у каждого буя
    boat = None                                                        # (vessel, центр, оставшихся тактов)
    quiet = {}                                                         # буй → тактов тишины
    print(f"симулятор буёв → {a.api}: {len(buoys)} буёв, клип раз в {a.every:g} с")
    while True:
        t0 = time.time()
        if boat is None and r.random() < a.events:
            known = r.random() < 0.5
            seed = int(r.choice(list(ARCHIVE_VESSELS.values()))) if known else int(r.integers(10_000, 1 << 30))
            boat = (synth.vessel(seed), buoys[int(r.integers(len(buoys)))], int(r.integers(2, 5)))
            print(f"  ⛵ катер {'из архива' if known else 'новый'} у буя {boat[1].name}")
        shot_at = buoys[int(r.integers(len(buoys)))] if r.random() < a.events / 3 else None
        if not quiet and r.random() < a.events / 2:
            quiet[buoys[int(r.integers(len(buoys)))].id] = int(r.integers(4, 8))
        talk = buoys[int(r.integers(len(buoys)))] if r.random() < a.events / 2 else None    # люди говорят у буя
        # звук доходит сначала до ближайшего буя: он и поднимает тревогу, соседи её подтверждают
        src = boat[1] if boat else shot_at
        order = sorted(buoys, key=lambda b: km(src, b)) if src else buoys
        for b in order:
            act = base[b.id] * (0.1 if b.id in quiet else 1) * float(r.uniform(0.85, 1.1))
            event, v, snr = "background", None, None
            if boat:
                d = km(boat[1], b)
                if d < 9:                                              # слышно на соседних буях, дальше — тише
                    event, v, snr = "motor", boat[0], 16 - 3.2 * d
            if shot_at and km(shot_at, b) < 6:
                event, snr = "shot", 18 - 3 * km(shot_at, b)
            if talk is b and event == "background":
                event, snr = "voice", float(r.uniform(6, 16))
            x, _ = synth.scene(r, event, v=v, activity=min(1, act), snr_db=snr, medium="water")
            try:
                res = post(a.api, f"/api/buoys/{b.id}/audio", dsp.write_wav(x), "audio/wav", a.token)
                if res.get("alert"):
                    al = res["alert"]
                    m = f" · {al['match']['vessel_id']} {math.floor(al['match']['similarity'] * 100)} %" if al.get("match") else ""
                    print(f"  🔔 {b.name}: {al['kind']} ({al['confidence']:.2f}){m}")
            except urllib.error.HTTPError as e:
                print(f"  {b.name}: {e.code} {e.read().decode('utf-8', 'replace')[:120]}")
            except OSError as e:
                print(f"  сервер недоступен: {e}")
                break
        if boat:
            boat = (boat[0], boat[1], boat[2] - 1) if boat[2] > 1 else None
        quiet = {k: n - 1 for k, n in quiet.items() if n > 1}
        if a.once:
            return
        time.sleep(max(0.0, a.every - (time.time() - t0)))


if __name__ == "__main__":
    main()
