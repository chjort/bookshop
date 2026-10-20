import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from app import csv_import, orders, rates
from app.db import engine

HEADER = "title,author,ISBN,genre,price,count\n"
SHIPPING = {
    "name": "Mette Hansen",
    "email": "mette@example.dk",
    "address_line": "Nygårdsvej 41",
    "postal_code": "2100",
    "city": "København Ø",
}


@pytest.fixture(autouse=True)
def rate(monkeypatch):
    rates.reset_cache()
    monkeypatch.setattr(rates, "SOURCES", [("kraken", lambda: Decimal("64000.123"))])
    yield
    rates.reset_cache()


def seed():
    books, _ = csv_import.parse(
        (
            HEADER
            + (
                "Alfa,Karen Blixen,9798570901650,G,12.50,3\n"
                "Beta,Peter Møller,9781502809193,G,8.00,1\n"
            )
        ).encode()
    )
    with engine.begin() as conn:
        csv_import.save(conn, books)
        return dict(conn.execute(text("SELECT title, id FROM books")).all())


def stock(book_id):
    with engine.connect() as conn:
        return conn.execute(text("SELECT stock FROM books WHERE id = :i"), {"i": book_id}).scalar()


def place(client, lines, key=None, shipping=SHIPPING):
    return client.post(
        "/api/orders",
        json={"lines": lines, "shipping": shipping},
        headers={"Idempotency-Key": str(key or uuid.uuid4())},
    )


def test_rate_endpoint_includes_shipping(client):
    r = client.get("/api/rates/btc-eur").json()
    assert r["eur_per_btc"] == "64000.12" and r["source"] == "kraken"
    assert r["shipping_cents"] == 300


def test_falls_back_to_coingecko_then_503(client, monkeypatch):
    def down():
        raise OSError("down")

    monkeypatch.setattr(rates, "SOURCES", [("kraken", down), ("coingecko", lambda: Decimal(60000))])
    assert client.get("/api/rates/btc-eur").json()["source"] == "coingecko"
    rates.reset_cache()
    monkeypatch.setattr(rates, "SOURCES", [("kraken", down), ("coingecko", down)])
    r = client.get("/api/rates/btc-eur")
    assert r.status_code == 503 and r.json()["code"] == "rate_unavailable"
    ids = seed()
    assert place(client, [{"book_id": ids["Alfa"], "qty": 1}]).status_code == 503
    assert stock(ids["Alfa"]) == 3


def test_placing_an_order_reserves_stock_and_awaits_payment(client):
    ids = seed()
    r = place(
        client,
        [{"book_id": ids["Alfa"], "qty": 2}, {"book_id": ids["Beta"], "qty": 1}],
        shipping={**SHIPPING, "address_line2": "c/o Jensen"},
    )
    assert r.status_code == 201
    o = r.json()
    assert o["status"] == "awaiting_payment"
    assert (o["subtotal_cents"], o["shipping_cents"], o["total_cents"]) == (3300, 300, 3600)
    # 3600 cents / 64000.12 EUR/BTC = 56249.89… sats, rounded up
    assert o["amount_sats"] == 56250 and o["amount_btc"] == "0.00056250"
    assert o["btc_address"] == "bc1qtestaddress0000000000000000000000000"
    assert o["order_number"].startswith("BH-") and len(o["order_number"]) == 8
    assert o["bip21_uri"] == (
        f"bitcoin:{o['btc_address']}?amount=0.00056250&message={o['order_number']}"
    )
    assert o["address_line2"] == "c/o Jensen"
    assert stock(ids["Alfa"]) == 1 and stock(ids["Beta"]) == 0

    page = client.get(f"/api/orders/{o['token']}")
    assert page.status_code == 200 and page.headers["cache-control"] == "no-store"
    assert page.json()["order_number"] == o["order_number"] and page.json()["token"] is None


def test_retry_with_same_key_returns_same_order_once(client):
    ids = seed()
    key = uuid.uuid4()
    first = place(client, [{"book_id": ids["Alfa"], "qty": 1}], key=key)
    again = place(client, [{"book_id": ids["Alfa"], "qty": 1}], key=key)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["token"] == first.json()["token"]
    assert again.json()["order_number"] == first.json()["order_number"]
    assert stock(ids["Alfa"]) == 2
    other = place(client, [{"book_id": ids["Alfa"], "qty": 2}], key=key)
    assert other.status_code == 422 and other.json()["code"] == "idempotency_key_reused"


def test_cannot_order_more_than_stock(client):
    ids = seed()
    r = place(client, [{"book_id": ids["Beta"], "qty": 2}, {"book_id": 999999, "qty": 1}])
    assert r.status_code == 409 and r.json()["code"] == "stock_changed"
    assert sorted(r.json()["lines"], key=lambda x: x["book_id"]) == [
        {"book_id": ids["Beta"], "available": 1},
        {"book_id": 999999, "available": 0},
    ]
    assert stock(ids["Beta"]) == 1
    place(client, [{"book_id": ids["Beta"], "qty": 1}])
    assert place(client, [{"book_id": ids["Beta"], "qty": 1}]).status_code == 409


def test_validation(client):
    ids = seed()
    line = [{"book_id": ids["Alfa"], "qty": 1}]
    assert client.post("/api/orders", json={"lines": line, "shipping": SHIPPING}).status_code == 400
    for bad in [
        {"postal_code": "210"},
        {"email": "nope"},
        {"name": "  "},
        {"name": "a\x00b"},
        {"address_line": "Testvej\n1"},
        {"city": "Aarhus\x7f"},
        {"address_line2": "c/o\x00"},
        {"email": "qa\x00@example.dk"},
    ]:
        assert place(client, line, shipping={**SHIPPING, **bad}).status_code == 422
    assert place(client, [{"book_id": ids["Alfa"], "qty": 11}]).status_code == 422
    assert place(client, []).status_code == 422
    assert stock(ids["Alfa"]) == 3


def test_unknown_token_is_404(client):
    r = client.get("/api/orders/not-a-token")
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_no_private_key_or_plain_token_is_stored(client):
    ids = seed()
    o = place(client, [{"book_id": ids["Alfa"], "qty": 1}]).json()
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM orders")).mappings().one()
    assert o["token"] not in str(dict(row))
    assert bytes(row["token_hash"]) == orders.token_hash(o["token"])


def test_amount_rounds_up():
    assert orders.amount_sats(100, Decimal("30000.00")) == 3334  # 3333.33… → 3334
