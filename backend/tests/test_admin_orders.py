from datetime import datetime

import pytest
from sqlalchemy import text
from test_orders import SHIPPING, place, rate, seed, stock  # noqa: F401  (rate is autouse)

from app.db import engine


def when(iso):
    return datetime.fromisoformat(iso)


def act(client, number, action, **kw):
    return client.post(f"/api/admin/orders/{number}/{action}", json={}, **kw)


@pytest.fixture
def order(admin):
    """An awaiting-payment order for 2 × Alfa and 1 × Beta; returns (order_number, book ids)."""
    ids = seed()
    r = place(admin, [{"book_id": ids["Alfa"], "qty": 2}, {"book_id": ids["Beta"], "qty": 1}])
    return r.json()["order_number"], ids


def test_admin_routes_need_a_session_before_anything_else(client, order):
    number, _ = order
    client.cookies.clear()
    for r in (
        client.get("/api/admin/orders"),
        client.get(f"/api/admin/orders/{number}"),
        act(client, number, "paid"),
        client.post(f"/api/admin/orders/{number}/cancel", data={"x": "1"}),  # not JSON either
    ):
        assert r.status_code == 401
        assert r.json()["code"] == "not_authenticated" and "detail" not in r.json()
    assert client.get("/api/admin/me").json()["code"] == "not_authenticated"
    assert client.get(f"/api/admin/orders/{number}").status_code == 401


def test_actions_need_json_content_type(admin, order):
    number, _ids = order
    for action in ("paid", "cancel"):
        r = admin.post(f"/api/admin/orders/{number}/{action}", data={"x": "1"})
        assert r.status_code == 415 and r.json()["code"] == "unsupported_media_type"
    # X-Requested-With is not needed
    assert act(admin, number, "cancel").status_code == 200


def test_login_415_uses_the_code_shape(client):
    r = client.post("/api/admin/login", data={"username": "a", "password": "b"})
    assert r.status_code == 415 and r.json()["code"] == "unsupported_media_type"


def test_mark_paid_then_shipped_never_changes_stock(admin, order):
    number, ids = order
    assert (stock(ids["Alfa"]), stock(ids["Beta"])) == (1, 0)

    r = act(admin, number.lower(), "paid")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    o = r.json()
    assert o["status"] == "paid" and o["paid_at"] and o["status_changed_at"] == o["paid_at"]
    assert not any("email" in k and k != "email" for k in o)  # no email fields in R1

    o = act(admin, number, "ship").json()
    assert o["status"] == "shipped" and o["shipped_at"]
    assert (stock(ids["Alfa"]), stock(ids["Beta"])) == (1, 0)


def test_cancel_puts_reserved_copies_back_onto_current_stock_once(admin, order):
    number, ids = order
    with engine.begin() as conn:  # the owner re-stocked Alfa meanwhile
        conn.execute(text("UPDATE books SET stock = 5 WHERE id = :i"), {"i": ids["Alfa"]})

    o = act(admin, number, "cancel").json()
    assert o["status"] == "cancelled" and o["cancelled_at"]
    assert (stock(ids["Alfa"]), stock(ids["Beta"])) == (7, 1)

    again = act(admin, number, "cancel")
    assert again.status_code == 409
    assert (stock(ids["Alfa"]), stock(ids["Beta"])) == (7, 1)


@pytest.mark.parametrize(
    ("first", "then", "current"),
    [
        (None, "ship", "awaiting_payment"),  # ship before paid
        ("paid", "cancel", "paid"),  # cancel after paid
        ("paid", "paid", "paid"),  # double click / other tab
        ("cancel", "paid", "cancelled"),  # pay a cancelled order
    ],
)
def test_other_transitions_are_409_with_current_status(admin, order, first, then, current):
    number, _ = order
    if first:
        changed_at = act(admin, number, first).json()["status_changed_at"]
    r = act(admin, number, then)
    assert r.status_code == 409
    body = r.json()
    assert body["code"] == "invalid_transition" and body["current_status"] == current
    if first:
        assert when(body["status_changed_at"]) == when(changed_at)
    assert admin.get(f"/api/admin/orders/{number}").json()["status"] == current


def test_unknown_order_is_404(admin):
    for r in (admin.get("/api/admin/orders/BH-ZZZZZ"), act(admin, "bh-zzzzz", "paid")):
        assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_detail_has_what_the_owner_needs_to_match_the_payment(admin, order):
    number, _ids = order
    o = admin.get(f"/api/admin/orders/{number.lower()}").json()
    assert o["order_number"] == number and o["status"] == "awaiting_payment"
    assert (o["subtotal_cents"], o["shipping_cents"], o["total_cents"]) == (3300, 300, 3600)
    assert o["amount_sats"] == 56250 and o["rate_eur_per_btc"] == "64000.12"
    assert o["rate_source"] == "kraken" and o["rate_at"]
    assert o["btc_address"].startswith("bc1q") and o["country"] == "DK"
    assert [(line["title"], line["qty"]) for line in o["lines"]] == [("Alfa", 2), ("Beta", 1)]
    assert o["customer_name"] == SHIPPING["name"] and o["address_line2"] is None


def test_list_filters_counts_and_sorts_newest_first(admin, order):
    first, ids = order
    second = place(admin, [{"book_id": ids["Alfa"], "qty": 1}]).json()["order_number"]
    act(admin, first, "paid")

    r = admin.get("/api/admin/orders")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    body = r.json()
    assert [o["order_number"] for o in body["items"]] == [second, first]
    assert body["counts"] == {"awaiting_payment": 1, "paid": 1, "shipped": 0, "cancelled": 0}
    assert (body["page"], body["page_size"], body["total"]) == (1, 25, 2)
    row = body["items"][1]
    assert (row["customer_name"], row["email"], row["total_cents"], row["amount_sats"]) == (
        "Mette Hansen",
        "mette@example.dk",
        3600,
        56250,
    )

    paid = admin.get("/api/admin/orders?status=paid").json()
    assert [o["order_number"] for o in paid["items"]] == [first] and paid["total"] == 1
    assert admin.get("/api/admin/orders?status=bogus").status_code == 422


def test_search_by_order_number_name_or_email(admin, order):
    number, ids = order
    other = place(
        admin,
        [{"book_id": ids["Alfa"], "qty": 1}],
        shipping={**SHIPPING, "name": "Jens Nygaard", "email": "jens_n@example.dk"},
    ).json()["order_number"]

    def found(q):
        return [
            o["order_number"]
            for o in admin.get("/api/admin/orders", params={"q": q}).json()["items"]
        ]

    assert found(number) == [number]
    assert found(" " + number[3:].lower() + " ") == [number]
    assert found("bh" + number[3:]) == [number]
    assert found("NYGAARD") == [other]
    assert found("mette@") == [number]
    assert found("_") == [other]  # _ is a literal, not a wildcard
    assert found("%") == []
    counts = admin.get("/api/admin/orders", params={"q": "jens"}).json()["counts"]
    assert counts["awaiting_payment"] == 1


def test_list_paging_and_query_limits(admin, order):
    assert admin.get("/api/admin/orders?page=0").status_code == 422
    far = admin.get("/api/admin/orders?page=99")
    assert far.status_code == 200 and far.json()["items"] == [] and far.json()["total"] == 1
    assert admin.get("/api/admin/orders", params={"q": "x" * 100}).status_code == 200
    assert admin.get("/api/admin/orders", params={"q": "x" * 101}).status_code == 422


def test_list_pages_25_at_a_time(admin, order):
    _, ids = order
    with engine.begin() as conn:
        conn.execute(text("UPDATE books SET stock = 100 WHERE id = :i"), {"i": ids["Alfa"]})
    for _ in range(25):
        place(admin, [{"book_id": ids["Alfa"], "qty": 1}])
    one, two = (admin.get(f"/api/admin/orders?page={p}").json() for p in (1, 2))
    assert len(one["items"]) == 25 and len(two["items"]) == 1 and two["total"] == 26
    assert two["items"][0]["order_number"] == order[0]  # oldest last


@pytest.mark.parametrize(
    "url",
    [
        "/api/admin/orders?page=0",
        "/api/admin/orders?page=abc",
        "/api/admin/orders?status=foo",
        "/api/admin/orders?q=" + "x" * 101,
    ],
)
def test_validation_errors_use_the_code_shape(admin, url):
    """#91: 422s on admin order routes are {"code": ...}, never FastAPI's {"detail": ...}."""
    r = admin.get(url)
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error" and "detail" not in body
    assert body["fields"] and all(f.startswith("query.") for f in body["fields"])
    assert r.headers["cache-control"] == "no-store"


def test_validation_errors_elsewhere_keep_fastapi_shape(client):
    r = client.post("/api/admin/login", json={})
    assert r.status_code == 422 and "detail" in r.json()


def test_wrong_method_on_an_action_is_405_with_code(admin, client, order):
    number, _ = order
    r = admin.get(f"/api/admin/orders/{number}/paid")
    assert r.status_code == 405 and r.json()["code"] == "method_not_allowed"
    assert r.headers["allow"] == "POST" and "detail" not in r.json()
    assert admin.get(f"/api/admin/orders/{number}/nope").json()["code"] == "not_found"
    client.cookies.clear()
    assert client.get(f"/api/admin/orders/{number}/paid").status_code == 401


@pytest.mark.parametrize("actions", [[], ["paid"], ["paid", "ship"], ["cancel"]])
def test_public_order_hides_payment_details_unless_awaiting(admin, actions):
    """Only an awaiting-payment order exposes the BTC address, amount and QR URI."""
    ids = seed()
    placed = place(admin, [{"book_id": ids["Alfa"], "qty": 1}]).json()
    for action in actions:
        assert act(admin, placed["order_number"], action).status_code == 200
    body = admin.get(f"/api/orders/{placed['token']}").json()
    hidden = ("btc_address", "bip21_uri", "amount_btc", "amount_sats")
    if not actions:
        assert body["status"] == "awaiting_payment"
        assert all(body[k] for k in hidden)
    else:
        assert body["status"] != "awaiting_payment"
        assert all(body[k] is None for k in hidden)
        assert body["total_cents"] and body["lines"]
