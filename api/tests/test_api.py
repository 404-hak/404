from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app import forecast as fc
from app import geo
from app.main import app
from app.models import AlertIn
from app.sim import DEMO_NIGHT
from app.world import TZ, World

FRIDAY_NIGHT = datetime(2026, 11, 13, 23, 15, tzinfo=TZ)  # пятница


def world_at(dt=FRIDAY_NIGHT) -> World:
    return World(clock=lambda: dt)


def test_moon_known_dates():
    _, new, _ = fc.moon(datetime(2024, 4, 8, 18, 21, tzinfo=timezone.utc))   # новолуние 8 апреля 2024
    _, full, _ = fc.moon(datetime(2024, 4, 23, 23, 49, tzinfo=timezone.utc))  # полнолуние 23 апреля 2024
    assert new < 0.02
    assert full > 0.98


def test_demo_night_risk_is_91():
    assert fc.risk(DEMO_NIGHT) == 0.91
    assert fc.level(fc.risk(DEMO_NIGHT)) == "high"


def test_sectors():
    assert geo.sector_of(45.61, 47.77) == 7       # Камышовый-4 — южная кромка, запад
    assert geo.sector_of(45.90, 48.35) == 3
    assert len({geo.sector_of(b.lat, b.lon) for b in geo.BUOYS}) >= 5


def test_forecast_recommends_hot_sector():
    w = world_at()
    w.override = DEMO_NIGHT
    f = w.forecast()
    assert f.hot_sectors[0] == 7
    assert f.message == "Безлунная ночь, пятница, вода +12°. Риск 91\u00a0%. Рекомендую усилить сектор 7."
    assert w.mode() == "alertness"


def test_motor_alert_recognises_vessel():
    w = world_at()
    fp = w.fingerprint_like("boat-A", 0.89)
    a = w.add_alert(AlertIn(buoy_id="b04", kind="motor", confidence=0.94, fingerprint=fp))
    assert a.match and a.match.vessel_id == "boat-A" and a.match.similarity == 0.89
    assert a.message.startswith("Буй Камышовый-4 услышал мотор. Похоже на тот же катер, что был здесь 5 мая (89\u00a0%).")
    assert a.message.endswith("\u00a0км от вас.")
    assert w.mode() == "alarm"
    w.patch_alert(a.id, "intercept")
    assert w.mode() == "intercept"


def test_unknown_vessel_is_registered():
    w = world_at()
    a = w.add_alert(AlertIn(buoy_id="b06", kind="motor", confidence=0.8, fingerprint=[1.0] + [0.0] * 15))
    assert a.match is None
    assert "Катер раньше не встречался" in a.message


def test_hash_chain_detects_tampering():
    w = world_at()
    w.add_alert(AlertIn(buoy_id="b02", kind="shot", confidence=0.9))
    assert w.verify_chain().ok
    victim = w.alerts[1]
    victim.confidence = 0.1
    check = w.verify_chain()
    assert not check.ok and check.broken_at == victim.id


def test_api_flow():
    with TestClient(app) as client:
        client.post("/api/demo/reset")
        st = client.get("/api/state").json()
        assert len(st["buoys"]) == 10 and len(st["sectors"]) == 9
        r = client.post("/api/alerts", json={"buoy_id": "b04", "kind": "silence", "confidence": 0.86})
        assert r.status_code == 201
        a = r.json()
        assert len(a["hash"]) == 64 and a["prev_hash"] != a["hash"]
        assert client.get("/api/state").json()["mode"] == "alarm"
        assert client.patch(f"/api/alerts/{a['id']}", json={"status": "resolved"}).json()["status"] == "resolved"
        assert client.get("/api/evidence/verify").json()["ok"] is True
        assert client.post("/api/alerts", json={"buoy_id": "nope", "kind": "shot", "confidence": 0.5}).status_code == 404
        with client.websocket_connect("/ws") as ws:
            assert "buoys" in ws.receive_json()
