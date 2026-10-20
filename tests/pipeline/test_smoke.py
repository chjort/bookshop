"""Unit tests for scripts/smoke_test.py against a local fake server. — pro-qa"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2] / "scripts"))
import smoke_test  # noqa: E402


def serve(health, code=200):
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/healthz":
                body, c = json.dumps(health).encode(), code
            else:
                body, c = b'<div id="root"></div>', 200
            self.send_response(c)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}"


@pytest.fixture
def https_ok(monkeypatch):
    # The fake server is plain HTTP; let the HTTPS check pass by rewriting.
    real = smoke_test.fetch
    monkeypatch.setattr(smoke_test, "fetch", lambda u, timeout=30: real(u.replace("https://", "http://")))


def run(health, sha="abc", env=None, code=200):
    srv, base = serve(health, code)
    try:
        return smoke_test.check(base.replace("http://", "https://"), sha, env, attempts=2, delay=0)
    finally:
        srv.shutdown()


def test_passes_when_version_matches(https_ok):
    assert run({"status": "ok", "version": "abc"}) == []


def test_fails_on_wrong_version(https_ok):
    assert "version" in run({"status": "ok", "version": "old"})[0]


def test_fails_when_db_unavailable(https_ok):
    assert "healthz not ok" in run({"status": "db_unavailable", "version": "abc"}, code=503)[0]


def test_fails_on_wrong_env(https_ok):
    assert "env" in run({"status": "ok", "version": "abc", "env": "prd"}, env="dev")[0]


def test_rejects_plain_http():
    assert "not HTTPS" in smoke_test.check("http://x", "abc")[0]
