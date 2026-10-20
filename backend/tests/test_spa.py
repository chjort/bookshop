from fastapi.testclient import TestClient

from app import main


def test_spa_serves_index_for_unknown_paths_and_never_escapes_static(tmp_path, monkeypatch):
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("INDEX")
    (static / "app.js").write_text("JS")
    (tmp_path / "secret.txt").write_text("SECRET")
    monkeypatch.setattr(main, "STATIC_DIR", static)
    client = TestClient(main.app)

    assert client.get("/app.js").text == "JS"
    assert client.get("/genre/krimi").text == "INDEX"
    for evil in ["/..%2fsecret.txt", "/%2e%2e/secret.txt", "/..%2F..%2Fetc%2Fpasswd"]:
        r = client.get(evil)
        assert "SECRET" not in r.text and "root:" not in r.text
