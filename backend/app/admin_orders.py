"""Admin order list, detail and status actions (ADR 0007). No emails in R1."""

import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, get_args

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.auth import ApiError, require_admin, require_json
from app.db import engine

Status = Literal["awaiting_payment", "paid", "shipped", "cancelled"]
PAGE_SIZE = 25
# "BH-7K3Q9", "bh7k3q9" or "7K3Q9", spaces ignored (Crockford base32, see orders.CROCKFORD)
ORDER_NUMBER = re.compile(r"^(?:BH-?)?([0-9A-HJKMNP-TV-Z]{5})$")


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/api/admin/orders", dependencies=[Depends(require_admin), Depends(no_store)]
)


class OrderRow(BaseModel):
    order_number: str
    created_at: datetime
    customer_name: str
    email: str
    total_cents: int
    amount_sats: int
    status: Status
    status_changed_at: datetime


class OrderList(BaseModel):
    items: list[OrderRow]
    page: int
    page_size: int
    total: int
    counts: dict[Status, int]


class OrderLine(BaseModel):
    book_id: int
    isbn: str
    title: str
    author: str
    unit_price_cents: int
    qty: int


class OrderDetail(OrderRow):
    lines: list[OrderLine]
    subtotal_cents: int
    shipping_cents: int
    address_line: str
    address_line2: str | None
    postal_code: str
    city: str
    country: str
    btc_address: str
    rate_eur_per_btc: Decimal
    rate_source: str
    rate_at: datetime
    paid_at: datetime | None
    shipped_at: datetime | None
    cancelled_at: datetime | None


def search(q: str) -> tuple[str, dict]:
    """SQL condition for the owner's search box: order number, or part of name or email."""
    q = q.strip()
    if not q:
        return "TRUE", {}
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    params = {"like": f"%{escaped}%"}
    where = "(customer_name ILIKE :like OR email ILIKE :like)"
    if m := ORDER_NUMBER.match(q.replace(" ", "").upper()):
        # A five-letter name like "Mette" also looks like an order number, so match both.
        where = f"(order_number = :number OR {where})"
        params["number"] = "BH-" + m[1]
    return where, params


@router.get("", response_model=OrderList)
def list_orders(
    status: Status | None = None,
    q: Annotated[str, Query(max_length=100)] = "",
    page: Annotated[int, Query(ge=1)] = 1,
):
    where, params = search(q)
    with engine.connect() as conn:
        counts = dict.fromkeys(get_args(Status), 0) | dict(
            conn.execute(
                text(f"SELECT status::text, count(*) FROM orders WHERE {where} GROUP BY status"),
                params,
            ).all()
        )
        if status:
            where += " AND status = CAST(:status AS order_status)"
            params["status"] = status
        items = conn.execute(
            text(
                f"SELECT * FROM orders WHERE {where} ORDER BY created_at DESC, id DESC "
                "LIMIT :limit OFFSET :offset"
            ),
            {**params, "limit": PAGE_SIZE, "offset": (page - 1) * PAGE_SIZE},
        ).mappings()
        return {
            "items": list(items),
            "page": page,
            "page_size": PAGE_SIZE,
            "total": counts[status] if status else sum(counts.values()),
            "counts": counts,
        }


def load(conn, order_number: str) -> dict:
    o = (
        conn.execute(text("SELECT * FROM orders WHERE order_number = :n"), {"n": order_number})
        .mappings()
        .first()
    )
    if o is None:
        raise ApiError(404, "not_found", "Order not found.")
    lines = conn.execute(
        text("SELECT * FROM order_lines WHERE order_id = :id ORDER BY id"), {"id": o["id"]}
    ).mappings()
    return {**o, "rate_at": o["rate_fetched_at"], "lines": list(lines)}


@router.get("/{order_number}", response_model=OrderDetail)
def get_order(order_number: str):
    with engine.connect() as conn:
        return load(conn, order_number.upper())


def transition(order_number: str, expected: Status, new: Status, stamp: str) -> dict:
    """One conditional UPDATE decides the race; the loser gets 409 with the current status."""
    number = order_number.upper()
    with engine.begin() as conn:
        order_id = conn.execute(
            text(
                f"UPDATE orders SET status = '{new}', {stamp} = now(), status_changed_at = now() "
                f"WHERE order_number = :n AND status = '{expected}' RETURNING id"
            ),
            {"n": number},
        ).scalar()
        if order_id is not None and new == "cancelled":
            # Same transaction, and only when this request won: stock can't come back twice.
            # Lock the books in id order first, like placement and import, so a cancel can't
            # deadlock with an import that holds some of the same rows (ADR 0003).
            book_ids = (
                conn.execute(
                    text("SELECT book_id FROM order_lines WHERE order_id = :id"), {"id": order_id}
                )
                .scalars()
                .all()
            )
            conn.execute(
                text("SELECT id FROM books WHERE id = ANY(:ids) ORDER BY id FOR UPDATE"),
                {"ids": book_ids},
            )
            conn.execute(
                text(
                    "UPDATE books b SET stock = b.stock + l.qty FROM order_lines l "
                    "WHERE l.order_id = :id AND b.id = l.book_id"
                ),
                {"id": order_id},
            )
        order = load(conn, number)
    if order_id is None:
        current = order["status"]
        raise ApiError(
            409,
            "invalid_transition",
            f"Order is {current.replace('_', ' ')}.",
            current_status=current,
            status_changed_at=order["status_changed_at"].isoformat(),
        )
    return order


@router.post(
    "/{order_number}/paid", response_model=OrderDetail, dependencies=[Depends(require_json)]
)
def mark_paid(order_number: str):
    return transition(order_number, "awaiting_payment", "paid", "paid_at")


@router.post(
    "/{order_number}/ship", response_model=OrderDetail, dependencies=[Depends(require_json)]
)
def mark_shipped(order_number: str):
    return transition(order_number, "paid", "shipped", "shipped_at")


@router.post(
    "/{order_number}/cancel", response_model=OrderDetail, dependencies=[Depends(require_json)]
)
def cancel(order_number: str):
    return transition(order_number, "awaiting_payment", "cancelled", "cancelled_at")


@router.api_route(
    "/{order_number}/{action}",
    methods=["GET", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def wrong_method(order_number: str, action: str):
    """A wrong method on an action path is 405 with a {"code"} body, not the SPA's 404."""
    if action not in ("paid", "ship", "cancel"):
        raise ApiError(404, "not_found", "Not found.")
    raise ApiError(405, "method_not_allowed", "Use POST.", headers={"Allow": "POST"})
