import logging
import uuid

from sqlalchemy import text

from app import csv_import, logsafe
from app.db import engine

TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde"


def access_record(path):
    # Same shape as uvicorn's access log: '%s - "%s %s HTTP/%s" %d'
    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:5", "GET", path, "1.1", 200),
        None,
    )


def test_access_log_masks_token_on_both_paths():
    f = logsafe.MaskOrderTokens()
    for path in (f"/api/orders/{TOKEN}", f"/order/{TOKEN}", f"/order/{TOKEN}?x=1"):
        rec = access_record(path)
        f.filter(rec)
        line = rec.getMessage()
        assert TOKEN not in line and TOKEN[4:12] not in line
        assert "/AbCd…" in line


def test_other_paths_are_untouched():
    rec = access_record("/api/orders")
    logsafe.MaskOrderTokens().filter(rec)
    assert '"GET /api/orders HTTP/1.1"' in rec.getMessage()


def test_filter_is_installed_on_uvicorn_access():
    import app.main  # noqa: F401

    assert any(
        isinstance(f, logsafe.MaskOrderTokens) for f in logging.getLogger("uvicorn.access").filters
    )


def test_real_server_logs_have_no_token(monkeypatch):
    """Run the app under uvicorn and check what its loggers actually emit."""
    import socket
    import threading
    import time
    from decimal import Decimal

    import httpx
    import uvicorn

    from app import rates
    from app.main import app

    books, _ = csv_import.parse(
        b"title,author,ISBN,genre,price,count\nT,A,9798570901650,G,1.00,1\n"
    )
    with engine.begin() as conn:
        csv_import.save(conn, books)
        book_id = conn.execute(text("SELECT id FROM books")).scalar()
    rates.reset_cache()
    monkeypatch.setattr(rates, "SOURCES", [("kraken", lambda: Decimal(60000))])

    lines = []

    class Collect(logging.Handler):
        def emit(self, record):
            lines.append(self.format(record))

    handler = Collect()
    loggers = [logging.getLogger(n) for n in ("uvicorn.access", "uvicorn.error", "app")]
    for lg in loggers:
        lg.addHandler(handler)
        lg.setLevel(logging.DEBUG)

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, port=port, log_config=None, access_log=True))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        while not server.started:
            time.sleep(0.05)
        base = f"http://127.0.0.1:{port}"
        o = httpx.post(
            f"{base}/api/orders",
            json={
                "lines": [{"book_id": book_id, "qty": 1}],
                "shipping": {
                    "name": "N",
                    "email": "n@example.dk",
                    "address_line": "A",
                    "postal_code": "2100",
                    "city": "C",
                },
            },
            headers={"Idempotency-Key": str(uuid.uuid4())},
        ).json()
        token = o["token"]
        assert httpx.get(f"{base}/api/orders/{token}").status_code == 200
        httpx.get(f"{base}/order/{token}")
        assert httpx.get(f"{base}/api/orders/{token}x").status_code == 404
    finally:
        server.should_exit = True
        thread.join(5)
        for lg in loggers:
            lg.removeHandler(handler)

    access = [line for line in lines if "/order" in line]
    assert len(access) >= 4, lines
    assert all(token not in line for line in lines)
    assert any(f"/api/orders/{token[:4]}…" in line for line in access)
    assert any(f"/order/{token[:4]}…" in line for line in access)
