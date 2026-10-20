from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz_reports_ok_and_version_when_db_reachable():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "version" in r.json()
