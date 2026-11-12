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


def test_history_keeps_scenario():
    w = world_at()
    assert w.hot_sectors()[0] == 7                     # демо-история не ломает «усилить сектор 7»
    assert w.verify_chain().ok
    assert any(a.synthetic for a in w.alerts)
    assert all(a.resolved_at and a.intercept_at for a in w.alerts if a.status == "resolved")


def test_stats_and_nights():
    w = world_at()
    s = w.stats(30)
    assert len(s.nights) == 30 and s.nights[-1].date.isoformat() == "2026-11-13"
    assert s.total == sum(n.events for n in s.nights) == sum(s.by_kind.values()) == sum(s.by_hour)
    assert s.reaction_median_min and 4 <= s.reaction_median_min <= 60
    nights = w.nights(14)
    assert len(nights) == 14 and nights[0].date.isoformat() == "2026-11-13"
    assert all(n.level == fc.level(n.risk) for n in nights)


def test_patch_records_times():
    w = world_at()
    a = w.add_alert(AlertIn(buoy_id="b04", kind="motor", confidence=0.9))
    w.patch_alert(a.id, "intercept")
    w.patch_alert(a.id, "resolved")
    assert a.intercept_at == a.resolved_at == FRIDAY_NIGHT
    assert w.verify_chain().ok                         # время обработки не входит в хэш


def test_stats_endpoints():
    c = TestClient(app)
    assert c.get("/api/stats?days=7").json()["days"] == 7
    assert len(c.get("/api/forecast/nights?days=5").json()) == 5
