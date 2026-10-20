"""Cart checkout and bitcoin payment page (ADR 0004)."""

import hashlib
import hmac
import json
import os
import secrets
import uuid
from base64 import urlsafe_b64encode
from datetime import datetime
from decimal import ROUND_CEILING, Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import rates
from app.db import engine

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

router = APIRouter(prefix="/api")

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class RateOut(BaseModel):
    eur_per_btc: Decimal
    source: Literal["kraken", "coingecko"]
    fetched_at: datetime
    shipping_cents: int


class CartLineIn(BaseModel):
    book_id: int
    qty: int = Field(ge=1, le=10)


class ShippingIn(BaseModel):
    name: Annotated[Text, StringConstraints(max_length=200)]
    email: EmailStr
    address_line: Annotated[Text, StringConstraints(max_length=200)]
    address_line2: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None
    ) = None
    postal_code: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{4}$")]
    city: Annotated[Text, StringConstraints(max_length=100)]

    @field_validator("address_line2")
    @classmethod
    def blank_is_none(cls, v):
        return v or None


class OrderIn(BaseModel):
    lines: list[CartLineIn] = Field(min_length=1, max_length=50)
    shipping: ShippingIn


class OrderLineOut(BaseModel):
    title: str
    author: str
    unit_price_cents: int
    qty: int


class OrderOut(BaseModel):
    order_number: str
    token: str | None = None
    status: Literal["awaiting_payment", "paid", "shipped", "cancelled"]
    lines: list[OrderLineOut]
    subtotal_cents: int
    shipping_cents: int
    total_cents: int
    eur_per_btc: Decimal
    rate_source: str
    rate_fetched_at: datetime
    amount_sats: int
    amount_btc: str
    btc_address: str
    bip21_uri: str
    created_at: datetime
    # Delivery details, so the payment page can echo them (design 3.4)
    customer_name: str
    email: str
    address_line: str
    address_line2: str | None
    postal_code: str
    city: str


def error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse({"code": code, "message": message, **extra}, status_code=status)


def shipping_cents(conn) -> int:
    return int(
        conn.execute(text("SELECT value FROM settings WHERE key = 'shipping_cents'")).scalar_one()
    )


def amount_sats(total_cents: int, rate: Decimal) -> int:
    """Round up to the next satoshi so the owner is never short."""
    # Decimal's // truncates toward zero, so ADR 0004's -(-a // b) can't be used here.
    return int((Decimal(total_cents) * 1_000_000 / rate).to_integral_value(ROUND_CEILING))


def make_token(key: uuid.UUID) -> str:
    secret = os.environ["ORDER_TOKEN_SECRET"].encode()
    digest = hmac.new(secret, str(key).encode(), hashlib.sha256).digest()
    return urlsafe_b64encode(digest).rstrip(b"=").decode()


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def new_order_number() -> str:
    return "BH-" + "".join(secrets.choice(CROCKFORD) for _ in range(5))


def request_hash(order: OrderIn) -> bytes:
    canonical = json.dumps(order.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).digest()


def load_order(conn, where: str, params: dict, token: str | None = None) -> dict | None:
    o = conn.execute(text(f"SELECT * FROM orders WHERE {where}"), params).mappings().first()
    if o is None:
        return None
    lines = (
        conn.execute(
            text(
                "SELECT title, author, unit_price_cents, qty FROM order_lines "
                "WHERE order_id = :id ORDER BY id"
            ),
            {"id": o["id"]},
        )
        .mappings()
        .all()
    )
    btc = f"{Decimal(o['amount_sats']) / 100_000_000:.8f}"
    return {
        **{
            k: o[k]
            for k in (
                "order_number",
                "status",
                "subtotal_cents",
                "shipping_cents",
                "total_cents",
                "rate_source",
                "rate_fetched_at",
                "amount_sats",
                "btc_address",
                "created_at",
                "customer_name",
                "email",
                "address_line",
                "address_line2",
                "postal_code",
                "city",
            )
        },
        "token": token,
        "lines": [dict(line) for line in lines],
        "eur_per_btc": o["rate_eur_per_btc"],
        "amount_btc": btc,
        "bip21_uri": f"bitcoin:{o['btc_address']}?amount={btc}&message={o['order_number']}",
    }


@router.get("/rates/btc-eur", response_model=RateOut)
def btc_eur():
    rate = rates.current_rate()
    if rate is None:
        return error(503, "rate_unavailable", "No fresh BTC/EUR rate.")
    with engine.connect() as conn:
        shipping = shipping_cents(conn)
    return {
        "eur_per_btc": rate.eur_per_btc,
        "source": rate.source,
        "fetched_at": rate.fetched_at,
        "shipping_cents": shipping,
    }


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=201,
    responses={200: {"description": "retry of an existing order"}},
)
def place_order(
    order: OrderIn,
    request: Request,
    response: Response,
    idempotency_key: Annotated[str | None, Header()] = None,
):
    if not request.headers.get("content-type", "").startswith("application/json"):
        return error(415, "unsupported_media_type", "Content-Type must be application/json.")
    try:
        key = uuid.UUID(idempotency_key or "")
    except ValueError:
        return error(400, "idempotency_key_missing", "Idempotency-Key must be a UUID.")
    body_hash = request_hash(order)
    token = make_token(key)

    def existing(conn):
        row = conn.execute(
            text("SELECT request_hash FROM orders WHERE idempotency_key = :k"), {"k": key}
        ).first()
        if row is None:
            return None
        if bytes(row.request_hash) != body_hash:
            return error(422, "idempotency_key_reused", "This key was used for another order.")
        response.status_code = 200
        return load_order(conn, "idempotency_key = :k", {"k": key}, token)

    with engine.begin() as conn:
        if (found := existing(conn)) is not None:
            return found

    rate = rates.current_rate()
    if rate is None:
        return error(503, "rate_unavailable", "No fresh BTC/EUR rate.")

    qty = {}
    for line in order.lines:
        qty[line.book_id] = qty.get(line.book_id, 0) + line.qty

    try:
        with engine.begin() as conn:
            books = {
                b.id: b
                for b in conn.execute(
                    text(
                        "SELECT id, isbn, title, author, price_eur, stock FROM books "
                        "WHERE id = ANY(:ids) ORDER BY id FOR UPDATE"
                    ),
                    {"ids": sorted(qty)},
                )
            }
            short = [
                {"book_id": bid, "available": books[bid].stock if bid in books else 0}
                for bid, n in qty.items()
                if bid not in books or books[bid].stock < n or n > 10
            ]
            if short:
                return error(
                    409, "stock_changed", "Some books are no longer available.", lines=short
                )

            subtotal = sum(int(books[b].price_eur * 100) * n for b, n in qty.items())
            ship = shipping_cents(conn)
            total = subtotal + ship
            s = order.shipping
            for _ in range(5):
                number = new_order_number()
                taken = conn.execute(
                    text("SELECT 1 FROM orders WHERE order_number = :n"), {"n": number}
                ).first()
                if not taken:
                    break
            order_id = conn.execute(
                text("""
                    INSERT INTO orders (order_number, token_hash, idempotency_key, request_hash,
                      customer_name, email, address_line, address_line2, postal_code, city,
                      subtotal_cents, shipping_cents, total_cents, rate_eur_per_btc,
                      rate_source, rate_fetched_at, amount_sats, btc_address)
                    VALUES (:number, :th, :key, :rh, :name, :email, :a1, :a2, :pc, :city,
                      :sub, :ship, :total, :rate, :src, :at, :sats, :addr)
                    RETURNING id
                """),
                {
                    "number": number,
                    "th": token_hash(token),
                    "key": key,
                    "rh": body_hash,
                    "name": s.name,
                    "email": s.email,
                    "a1": s.address_line,
                    "a2": s.address_line2,
                    "pc": s.postal_code,
                    "city": s.city,
                    "sub": subtotal,
                    "ship": ship,
                    "total": total,
                    "rate": rate.eur_per_btc,
                    "src": rate.source,
                    "at": rate.fetched_at,
                    "sats": amount_sats(total, rate.eur_per_btc),
                    "addr": os.environ["BTC_ADDRESS"],
                },
            ).scalar_one()
            for bid, n in qty.items():
                b = books[bid]
                conn.execute(
                    text("UPDATE books SET stock = stock - :n WHERE id = :id"), {"n": n, "id": bid}
                )
                conn.execute(
                    text(
                        "INSERT INTO order_lines (order_id, book_id, isbn, title, author, "
                        "unit_price_cents, qty) VALUES (:o, :b, :isbn, :t, :a, :p, :n)"
                    ),
                    {
                        "o": order_id,
                        "b": bid,
                        "isbn": b.isbn,
                        "t": b.title,
                        "a": b.author,
                        "p": int(b.price_eur * 100),
                        "n": n,
                    },
                )
            return load_order(conn, "id = :id", {"id": order_id}, token)
    except IntegrityError:
        # A concurrent retry with the same key won the race.
        with engine.begin() as conn:
            if (found := existing(conn)) is not None:
                return found
        raise


@router.get("/orders/{token}", response_model=OrderOut, responses={404: {}})
def get_order(token: str, response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    with engine.connect() as conn:
        found = load_order(conn, "token_hash = :h", {"h": token_hash(token)})
    if found is None:
        found = error(404, "not_found", "Order not found.")
        found.headers.update(response.headers)
    return found
