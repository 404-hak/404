"""Звук буя: нейросеть, ухо буя, улики, хранение, связь, погода."""
from datetime import datetime, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.audio import dsp, synth
from app.audio import model as acoustic
from app.models import AlertIn
from app.sim import demo_clip
from app.store import Clips, Store
from app.weather import OpenMeteo
from app.world import ARCHIVE_VESSELS, TZ, World

NIGHT = datetime(2026, 11, 13, 23, 15, tzinfo=TZ)
MODEL = acoustic.load()
pytestmark = pytest.mark.skipif(MODEL is None, reason="нейросеть не обучена (tools/ml/train.py)")


class Clock:
    def __init__(self, t=NIGHT):
        self.t = t

    def __call__(self):
        return self.t


def wav(event, seed, **kw) -> bytes:
    x, _ = synth.scene(np.random.default_rng(seed), event, **kw)
    return dsp.write_wav(x)


def heard_motor(w, clock, buoy, clips):
    """Мотор поднимает тревогу со второго клипа подряд: первый — ждём подтверждения."""
    first = w.ingest(buoy, clips[0])
    assert first.alert is None and "подтверждения" in first.note
    clock.t += timedelta(seconds=6)
    return w.ingest(buoy, clips[1])


def test_model_card_is_honest():
    m = MODEL.meta
    assert m["classes"] == ["background", "motor", "shot"]
    ev = m["metrics"]["events"]
    assert ev["accuracy"] > 0.9 and ev["false_alarm_background"] <= 0.03
    assert m["metrics"]["vessels_held_out"]["auc"] > 0.85      # на катерах, которых не было в обучении
    assert 0 < m["thresholds"]["event"] < 1 and 0 < m["thresholds"]["match"] < 1


def test_demo_clip_is_heard_and_vessel_recognised():
    clock = Clock()
    w = World(clock=clock)
    res = heard_motor(w, clock, "b04", [demo_clip(0), demo_clip(1)])
    assert res.event == "motor" and res.alert and res.alert.kind == "motor" and res.alert.source == "audio"
    assert res.alert.match and res.alert.match.vessel_id == "boat-A"
    assert res.alert.audio_sha256 == res.sha256 and res.f0_hz
    check = w.verify_chain()
    assert check.ok and check.audio_checked == 1


def test_tampered_audio_breaks_evidence():
    clock = Clock()
    w = World(clock=clock)
    res = heard_motor(w, clock, "b04", [demo_clip(0), demo_clip(1)])
    w.clips.mem[res.sha256] = w.clips.mem[res.sha256][:-2] + b"\x00\x00"
    check = w.verify_chain()
    assert not check.ok and check.broken_at == res.alert.id and "подменён" in check.reason


def test_background_is_quiet_and_motor_repeats_are_one_alert():
    clock = Clock()
    w = World(clock=clock)
    n = len(w.alerts)
    r = w.ingest("b02", wav("background", 11, activity=0.8))
    assert r.alert is None and r.event == "background"
    v = synth.vessel(ARCHIVE_VESSELS["boat-B"])
    first = heard_motor(w, clock, "b02", [wav("motor", 12, v=v, snr_db=15), wav("motor", 14, v=v, snr_db=15)])
    clock.t += timedelta(seconds=6)
    again = w.ingest("b02", wav("motor", 13, v=v, snr_db=15))
    assert first.alert and again.alert is None and "продолжение" in again.note
    assert len(w.alerts) == n + 1


def test_shot_is_detected():
    w = World(clock=Clock())
    r = w.ingest("b03", wav("shot", 21, snr_db=18))
    assert r.event == "shot" and r.alert and r.alert.kind == "shot"


def test_silence_as_evidence():
    clock = Clock()
    w = World(clock=clock)
    for i in range(6):                                  # обычная ночь: лягушки и птицы
        w.ingest("b07", wav("background", 100 + i, activity=0.85))
        clock.t += timedelta(seconds=6)
    kinds = []
    for i in range(4):                                  # природа стихла
        r = w.ingest("b07", wav("background", 200 + i, activity=0.0))
        kinds.append(r.alert.kind if r.alert else None)
        clock.t += timedelta(seconds=6)
    assert "silence" in kinds
    assert w.buoys["b07"].health < 0.7


def test_same_vessel_closer_than_other_vessels():
    a, b = synth.vessel(9001), synth.vessel(9002)
    fa = [MODEL.fingerprint(synth.scene(np.random.default_rng(s), "motor", v=a, snr_db=15)[0]) for s in (1, 2, 3)]
    fb = [MODEL.fingerprint(synth.scene(np.random.default_rng(s), "motor", v=b, snr_db=15)[0]) for s in (4, 5, 6)]
    same = np.mean([np.dot(fa[0], fa[1]), np.dot(fa[0], fa[2]), np.dot(fb[0], fb[1])])
    diff = np.mean([np.dot(x, y) for x in fa for y in fb])
    assert same > diff


def test_store_survives_restart(tmp_path):
    store, clips = Store(tmp_path / "db.sqlite"), Clips(tmp_path / "clips")
    clock = Clock()
    w = World(clock=clock, store=store, clips=clips)
    res = heard_motor(w, clock, "b04", [demo_clip(0), demo_clip(1)])
    w.patch_alert(res.alert.id, "intercept")
    again = World(clock=Clock(), store=Store(tmp_path / "db.sqlite"), clips=Clips(tmp_path / "clips"))
    a = next(x for x in again.alerts if x.id == res.alert.id)
    assert a.status == "intercept" and a.audio_sha256 == res.sha256
    assert again.verify_chain().ok and len(again.alerts) == len(w.alerts)
    assert "boat-A" in again.vessels and again.recent[-1]["sha256"] == res.sha256


def test_offline_alert_once():
    clock = Clock()
    w = World(clock=clock)
    clock.t += timedelta(minutes=5)
    for bid in w.buoys:
        if bid != "b08":
            w.buoys[bid].last_seen = clock.t
    made = w.watch()
    assert [a.kind for a in made] == ["offline"] and made[0].buoy_id == "b08"
    assert w.watch() == []


def test_weather_from_open_meteo():
    def fake(url, params):
        key = "wind_speed_10m" if "wind" in params["hourly"] else "sea_surface_temperature"
        val = 2.0 if key == "wind_speed_10m" else 11.0
        return {"hourly": {"time": ["2026-11-13T19:00", "2026-11-13T20:00"], key: [val, val]}}
    om = OpenMeteo(fetch=fake)
    assert om.refresh()
    w = World(clock=Clock(datetime(2026, 11, 13, 23, 30, tzinfo=TZ)), weather=om)   # 19:30 UTC (Астрахань — UTC+4)
    f = w.forecast()
    assert f.weather == "open-meteo" and f.wind_ms == 2.0 and f.water_temp == 11.0


def test_audio_endpoint(monkeypatch):
    with TestClient(main.app) as c:
        c.post("/api/demo/reset")
        assert c.post("/api/buoys/b04/audio", content=demo_clip(0), headers={"Content-Type": "audio/wav"}).json()["alert"] is None
        r = c.post("/api/buoys/b04/audio", content=demo_clip(1), headers={"Content-Type": "audio/wav"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["event"] == "motor" and body["alert"]["kind"] == "motor"
        assert c.get(f"/api/alerts/{body['alert']['id']}/audio").content[:4] == b"RIFF"
        assert c.get("/api/clips?limit=1").json()[0]["sha256"] == body["sha256"]
        assert c.get("/api/evidence/verify").json()["audio_checked"] >= 1
        assert c.post("/api/buoys/b04/audio", content=b"not a wav").status_code == 422
        assert c.post("/api/buoys/zz/audio", content=demo_clip()).status_code == 404
        assert c.get("/api/model").json()["available"] is True
        assert c.post("/api/buoys/b05/heartbeat", json={"battery": 55}).json()["battery"] == 55
        monkeypatch.setattr(main, "BUOY_TOKEN", "s3cret")
        assert c.post("/api/buoys/b04/audio", content=demo_clip()).status_code == 401
        ok = c.post("/api/buoys/b04/audio", content=demo_clip(), headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200


def test_one_motor_heard_by_neighbours_is_one_alert():
    clock = Clock()
    w = World(clock=clock)
    v = synth.vessel(ARCHIVE_VESSELS["boat-C"])
    first = heard_motor(w, clock, "b04", [wav("motor", 31, v=v, snr_db=16), wav("motor", 33, v=v, snr_db=16)])
    clock.t += timedelta(seconds=5)
    neighbour = heard_motor(w, clock, "b01", [wav("motor", 32, v=v, snr_db=8), wav("motor", 34, v=v, snr_db=8)])  # Осетровый-1 в 8 км
    assert first.alert and neighbour.alert is None and "Камышовый-4" in neighbour.note


# ---------- лаборатория ----------
def test_lab_scenes_are_heard_right():
    with TestClient(main.app) as c:
        n = len(main.world.alerts)
        boat = c.post("/api/lab/scene", json={"preset": "motor-archive", "vessel": "boat-A", "duration_s": 12}).json()
        assert [a["kind"] for a in boat["verdict"]["alerts"]] == ["motor"]          # одна тревога — со второго клипа
        assert boat["motor"]["verdict"] == "узнан: boat-A"
        assert boat["spec"]["bands"] == 64 and len(boat["wave"]["min"]) == 1200 and boat["timeline"]
        silence = c.post("/api/lab/scene", json={"preset": "silence", "duration_s": 28}).json()
        assert "silence" in [a["kind"] for a in silence["verdict"]["alerts"]]
        for quiet in ("night", "oar", "airplane"):
            assert c.post("/api/lab/scene", json={"preset": quiet}).json()["verdict"]["alerts"] == [], quiet
        shot = c.post("/api/lab/scene", json={"preset": "shot", "snr_db": 12}).json()
        assert "shot" in [a["kind"] for a in shot["verdict"]["alerts"]]
        assert len(main.world.alerts) == n                                             # лаборатория ничего не меняет
        assert c.get(f"/api/lab/audio/{boat['id']}").content[:4] == b"RIFF"


def test_lab_upload_and_buoy_clip():
    with TestClient(main.app) as c:
        r = c.post("/api/lab/analyze?name=test.wav", content=wav("background", 77, activity=0.8), headers={"Content-Type": "audio/wav"})
        assert r.status_code == 200 and r.json()["title"] == "test.wav" and r.json()["source"] == "upload"
        assert c.post("/api/lab/analyze", content=b"nope").status_code == 422
        sha = c.post("/api/buoys/b03/audio", content=wav("background", 78, activity=0.6)).json()["sha256"]
        clip = c.post(f"/api/lab/clip/{sha}").json()
        assert clip["source"] == "buoy" and clip["sha256"] == sha and "Тростниковый-3" in clip["title"]
