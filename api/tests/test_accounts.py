"""Учётные записи, роли и журнал действий (docs/audit/01-security.md S13)."""
import pytest
from fastapi.testclient import TestClient

from app import main, security
from app.accounts import Accounts
from app.ratelimit import Limiter


@pytest.fixture
def acc(monkeypatch):
    a = Accounts()                                   # в памяти: тесты не трогают общую базу
    monkeypatch.setattr(main, "accounts", a)
    monkeypatch.setattr(security, "ACCOUNTS", a)
    monkeypatch.setattr(main, "login_fail", Limiter(6, 900))
    monkeypatch.setattr(main, "login_ip", Limiter(50, 600))
    monkeypatch.delenv("ACCESS_TOKEN", raising=False)
    return a


def login(c: TestClient, who: str, pw: str):
    return c.post("/api/auth/login", json={"login": who, "password": pw})


def test_without_accounts_everything_is_open(acc):
    c = TestClient(main.app)
    me = c.get("/api/auth/me").json()
    assert me["accounts"] is False and me["role"] == "senior"


def test_login_required_once_someone_exists(acc):
    pw = acc.add("ivanov", "duty", "Иванов")
    c = TestClient(main.app)
    assert c.get("/api/state").status_code == 401
    page = c.get("/", headers={"accept": "text/html"})
    assert page.status_code == 401 and "Вход для дежурных" in page.text
    assert login(c, "ivanov", "wrong").status_code == 401
    r = login(c, "Ivanov", pw)
    assert r.status_code == 200 and "HttpOnly" in r.headers["set-cookie"]
    assert c.get("/api/state").status_code == 200
    assert c.get("/api/auth/me").json()["name"] == "Иванов"
    c.post("/api/auth/logout")
    assert c.get("/api/state").status_code == 401


def test_roles_and_journal(acc):
    acc.add("obs", "observer")
    pw_duty = acc.add("duty", "duty", "Петров")
    alert = next(a for a in main.world.alerts)
    c = TestClient(main.app)
    login(c, "obs", acc.update("obs", reset=True))
    assert c.patch(f"/api/alerts/{alert.id}", json={"status": "resolved"}).status_code == 403
    assert c.get("/api/users").status_code == 403
    c2 = TestClient(main.app)
    login(c2, "duty", pw_duty)
    r = c2.patch(f"/api/alerts/{alert.id}", json={"status": "resolved"})
    assert r.status_code == 200 and r.json()["resolved_by"] in ("Петров", None)   # закрытая раньше остаётся за прежним
    entries = c2.get("/api/journal").json()
    assert any(e["action"] == "alert.status" and e["actor"] == "Петров" for e in entries)
    check = c2.get("/api/evidence/verify").json()
    assert check["journal_checked"] >= 3 and len(check["journal_head"]) == 64


def test_journal_tampering_is_detected(acc):
    acc.record("Иванов", "alert.status", "A-1", after="resolved")
    acc.record("Петров", "alert.status", "A-2", after="intercept")
    assert acc.verify() == (2, None)
    acc.mem_journal[0]["actor"] = "Сидоров"
    assert acc.verify() == (2, "1")


def test_brute_force_is_slowed_down(acc):
    acc.add("ivanov", "duty")
    c = TestClient(main.app)
    codes = [login(c, "ivanov", f"bad{i}").status_code for i in range(8)]
    assert codes[:6] == [401] * 6 and 429 in codes[6:]


def test_senior_manages_team(acc):
    pw = acc.add("boss", "senior", "Старший")
    c = TestClient(main.app)
    login(c, "boss", pw)
    r = c.post("/api/users", json={"login": "new.one", "name": "Новый", "role": "observer"})
    assert r.status_code == 201 and len(r.json()["password"]) == 14
    assert c.patch("/api/users/boss", json={"disabled": True}).status_code == 422   # себя не отключить
    assert {u["login"] for u in c.get("/api/users").json()} == {"boss", "new.one"}
