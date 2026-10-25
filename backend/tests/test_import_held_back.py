"""ADR 0003 amendment 2026-10-25: the file's count is copies on the shelf, and the import
holds back copies in Awaiting payment and Paid orders."""

import threading
import time

import psycopg
import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from test_admin_import import HEADER, upload
from test_orders import place, rate  # noqa: F401  (rate is autouse)

from app import admin_orders, csv_import, orders
from app.db import engine

ALFA, BETA, GAMMA = "9798570901650", "9781502809193", "9798528548340"
SHIPPING = {
    "name": "Testa Testesen",
    "email": "testa@example.com",
    "address_line": "Prøvevej 1",
    "postal_code": "9999",
    "city": "Testby",
}


def csv(**counts):
    names = {"alfa": ALFA, "beta": BETA, "gamma": GAMMA}
    rows = "".join(f"{k.title()},A,{names[k]},G,10.00,{n}\n" for k, n in counts.items())
    return HEADER + rows


def ids():
    with engine.connect() as conn:
        return dict(conn.execute(text("SELECT isbn, id FROM books")).all())


def stock():
    with engine.connect() as conn:
        return dict(conn.execute(text("SELECT isbn, stock FROM books")).all())


def order(client, **qty):
    book = ids()
    names = {"alfa": ALFA, "beta": BETA, "gamma": GAMMA}
    lines = [{"book_id": book[names[k]], "qty": n} for k, n in qty.items()]
    r = place(client, lines, shipping=SHIPPING)
    assert r.status_code == 201, r.json()
    return r.json()["order_number"]


def act(client, number, action):
    r = client.post(f"/api/admin/orders/{number}/{action}", json={})
    assert r.status_code == 200, r.json()


def test_reimport_with_an_open_order_subtracts_its_copies(admin):
    upload(admin, csv(alfa=5, beta=2))
    order(admin, alfa=2)
    r = upload(admin, csv(alfa=5, beta=2)).json()
    assert r == {"created": 0, "updated": 2, "skipped": 0, "held_back": 2, "errors": []}
    assert stock() == {ALFA: 3, BETA: 2}


def test_no_open_orders_gives_the_file_count_and_held_back_0(admin):
    upload(admin, csv(alfa=5))
    r = upload(admin, csv(alfa=7)).json()
    assert r["held_back"] == 0 and stock() == {ALFA: 7}


def test_a_new_isbn_gets_its_count_and_holds_nothing_back(admin):
    upload(admin, csv(alfa=5))
    order(admin, alfa=1)
    r = upload(admin, csv(gamma=4)).json()
    assert r["created"] == 1 and r["held_back"] == 0
    assert stock()[GAMMA] == 4


def test_cancel_after_the_import_gives_the_copies_back(admin):
    upload(admin, csv(alfa=5, beta=2))
    number = order(admin, alfa=2, beta=1)
    upload(admin, csv(alfa=6, beta=2))
    assert stock() == {ALFA: 4, BETA: 1}
    act(admin, number, "cancel")
    assert stock() == {ALFA: 6, BETA: 2}  # the shelf count again


def test_count_below_held_gives_stock_0_and_holds_back_only_the_count(admin):
    upload(admin, csv(alfa=5, beta=5))
    order(admin, alfa=3, beta=1)
    r = upload(admin, csv(alfa=1, beta=5)).json()
    assert r["skipped"] == 0 and r["errors"] == []  # the row imports, with no error
    assert stock() == {ALFA: 0, BETA: 4}
    assert r["held_back"] == 1 + 1  # min(count, held) per book


def test_shipped_and_cancelled_orders_hold_nothing_back(admin):
    upload(admin, csv(alfa=9))
    shipped, cancelled = order(admin, alfa=2), order(admin, alfa=3)
    act(admin, shipped, "paid")
    act(admin, shipped, "ship")
    act(admin, cancelled, "cancel")
    r = upload(admin, csv(alfa=7)).json()
    assert r["held_back"] == 0 and stock() == {ALFA: 7}


def test_held_copies_add_up_across_orders_lines_and_open_statuses(admin):
    upload(admin, csv(alfa=10, beta=10))
    order(admin, alfa=1, beta=2)
    act(admin, order(admin, alfa=3), "paid")
    act(admin, order(admin, beta=1, alfa=1), "paid")
    r = upload(admin, csv(alfa=10, beta=10)).json()
    assert r["held_back"] == 5 + 3 and stock() == {ALFA: 5, BETA: 7}


def test_reimporting_the_same_file_with_orders_open_is_stable(admin):
    upload(admin, csv(alfa=5, beta=2))
    order(admin, alfa=2, beta=1)
    first = upload(admin, csv(alfa=5, beta=2)).json()
    after_first = stock()
    second = upload(admin, csv(alfa=5, beta=2)).json()
    assert first == second and first["held_back"] == 3
    assert stock() == after_first == {ALFA: 3, BETA: 1}


def test_books_missing_from_the_file_or_skipped_keep_stock_and_hold_nothing_back(admin):
    upload(admin, csv(alfa=5, beta=5, gamma=5))
    order(admin, alfa=1, beta=2, gamma=3)
    file = csv(alfa=5) + f"Beta,A,{BETA},G,10.00,x\n"  # Beta skipped, Gamma missing
    r = upload(admin, file).json()
    assert r["skipped"] == 1 and r["held_back"] == 1
    assert stock() == {ALFA: 4, BETA: 3, GAMMA: 2}


# Concurrency: two connections. One transaction is held open, the other must wait for it.


def background(fn):
    out = {}

    def run():
        try:
            out["value"] = fn()
        except BaseException as e:  # noqa: BLE001  re-raised in finish()
            out["error"] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t, out


def assert_blocked(t):
    time.sleep(0.5)
    assert t.is_alive(), "expected the second transaction to wait for the row locks"


def finish(t, out):
    t.join(10)
    assert not t.is_alive()
    if "error" in out:
        raise out["error"]
    return out.get("value")


@pytest.fixture
def pause(monkeypatch):
    """Pause a request inside its transaction, after it has changed stock."""
    inside, release = threading.Event(), threading.Event()

    def wrap(module, name):
        real = getattr(module, name)

        def paused(*a, **kw):
            inside.set()
            assert release.wait(10)
            return real(*a, **kw)

        monkeypatch.setattr(module, name, paused)

    return wrap, inside, release


def import_now(content):
    books, _ = csv_import.parse(content.encode())
    with engine.begin() as conn:
        return csv_import.save(conn, books)


def test_import_waits_for_a_placement_in_flight(admin, pause):
    upload(admin, csv(alfa=5, beta=5))
    order(admin, alfa=1)
    wrap, inside, release = pause
    wrap(orders, "load_order")
    placing, placed = background(lambda: order(admin, alfa=2, beta=1))
    assert inside.wait(10)
    importing, imported = background(lambda: import_now(csv(alfa=6, beta=4)))
    assert_blocked(importing)
    release.set()
    finish(placing, placed)
    assert finish(importing, imported) == (0, 2, 4)
    assert stock() == {ALFA: 6 - 3, BETA: 4 - 1}


def test_placement_waits_for_an_import_in_flight(admin):
    upload(admin, csv(alfa=5, beta=5))
    order(admin, alfa=1)
    books, _ = csv_import.parse(csv(alfa=6, beta=4).encode())
    with engine.begin() as conn:
        assert csv_import.save(conn, books) == (0, 2, 1)
        placing, placed = background(lambda: order(admin, alfa=2, beta=1))
        assert_blocked(placing)
    finish(placing, placed)
    assert stock() == {ALFA: 6 - 3, BETA: 4 - 1}


def test_import_waits_for_a_multi_title_cancel_in_flight(admin, pause):
    upload(admin, csv(alfa=5, beta=5, gamma=5))
    order(admin, alfa=1)  # stays open
    number = order(admin, gamma=1, beta=2, alfa=2)
    wrap, inside, release = pause
    wrap(admin_orders, "load")
    cancelling, cancelled = background(lambda: act(admin, number, "cancel"))
    assert inside.wait(10)
    importing, imported = background(lambda: import_now(csv(alfa=6, beta=6, gamma=6)))
    assert_blocked(importing)
    release.set()
    finish(cancelling, cancelled)
    assert finish(importing, imported) == (0, 3, 1)
    assert stock() == {ALFA: 5, BETA: 6, GAMMA: 6}


def test_multi_title_cancel_waits_for_an_import_in_flight(admin):
    upload(admin, csv(alfa=5, beta=5, gamma=5))
    number = order(admin, gamma=1, beta=2, alfa=2)
    books, _ = csv_import.parse(csv(alfa=6, beta=6, gamma=6).encode())
    with engine.begin() as conn:
        # The order is still open when the import sums, so its copies are held back.
        assert csv_import.save(conn, books) == (0, 3, 5)
        cancelling, cancelled = background(lambda: act(admin, number, "cancel"))
        assert_blocked(cancelling)
    finish(cancelling, cancelled)
    assert stock() == {ALFA: 6, BETA: 6, GAMMA: 6}


def test_a_multi_title_cancel_locks_its_books_in_id_order(admin):
    upload(admin, csv(alfa=5, beta=5, gamma=5))
    number = order(admin, gamma=1, beta=2, alfa=2)
    first, *rest = sorted(ids().values())
    with engine.begin() as conn:
        conn.execute(text("SELECT id FROM books WHERE id = :i FOR UPDATE"), {"i": first})
        cancelling, cancelled = background(lambda: act(admin, number, "cancel"))
        assert_blocked(cancelling)
        # Waiting on the lowest id, the cancel must not hold any higher one yet.
        with engine.begin() as other:
            other.execute(text("SET LOCAL lock_timeout = '200ms'"))
            try:
                other.execute(
                    text("SELECT id FROM books WHERE id = ANY(:ids) FOR UPDATE"), {"ids": rest}
                )
            except OperationalError as e:
                assert isinstance(e.orig, psycopg.errors.LockNotAvailable)
                pytest.fail("cancel locked a higher book id before the lowest one")
    finish(cancelling, cancelled)
    assert stock() == {ALFA: 5, BETA: 5, GAMMA: 5}
