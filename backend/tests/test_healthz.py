from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz_reports_ok_and_version_when_db_reachable():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "version" in r.json()


def test_healthz_reports_env_and_database_name_only(monkeypatch):
    import os

    from sqlalchemy.engine import make_url

    import app.main

    monkeypatch.setattr(app.main, "APP_ENV", "dev")
    body = client.get("/healthz").json()
    url = make_url(os.environ["DATABASE_URL"])
    assert body["env"] == "dev"
    assert body["db"] == url.database
    assert set(body) == {"status", "version", "env", "db"}
    raw = client.get("/healthz").text
    for secret in filter(None, [url.host, url.username, url.password, "postgresql"]):
        assert secret not in raw
