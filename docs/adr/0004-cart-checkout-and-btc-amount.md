# ADR 0004: Cart, checkout and BTC amount

Status: Proposed · Author: pro-architect · Task: #19 (feature #18) · Design: PR #49

## Context

Customers fill a cart, enter a shipping address, and place an order. Prices are in EUR. Checkout shows the total in EUR and BTC. The customer pays on-chain to the owner's fixed address (`BTC_ADDRESS`). The owner marks orders paid by hand; the shop never handles keys or payments. Stock is reserved when the order is placed and released when an unpaid order is cancelled. Shipping is one flat fee per order, stored as a setting. Product rule: the BTC rate is locked at placement, with no expiry in R1. App shape from ADR 0001: one FastAPI container, same origin as the SPA, Postgres.

This answers design questions 1, 2, 4 and 6 in PR #49, section 10.

## Options

**Cart**
- **Client-side in `localStorage`** (chosen): no table, no session for anonymous users. Prices and stock are rechecked by the server at placement.
- Server-side cart table: needs anonymous sessions and cleanup. Not needed in R1.

**BTC/EUR rate**
- **Server fetches from Kraken, falls back to CoinGecko, caches 60 s** (chosen): both are free and keyless.
- Client-sent rate: can be forged. Rejected.
- Paid price feed: cost and a key for no gain at this volume. Rejected.

**Order reference**
- **Short random order number plus a separate secret URL token** (chosen).
- Sequential number in the URL (`BH-2026-00042`): guessable, so it leaks other customers' addresses. Rejected.
- One long token only: too long to type as a wallet note. Rejected.

**Double submit**
- **Client-generated `Idempotency-Key` with a unique constraint** (chosen).
- Disable the button only: doesn't help when the response is lost on a timeout. Rejected.

## Decision

### 1. Rate source and refresh

- Primary: Kraken `GET https://api.kraken.com/0/public/Ticker?pair=XBTEUR` (last trade `c[0]`). Fallback: CoinGecko `simple/price?ids=bitcoin&vs_currencies=eur`.
- Each fetch has a 3 s timeout. Kraken is tried first; CoinGecko only if Kraken fails.
- In-process cache with a 60 s TTL. A rate is **fresh** if it was fetched less than 5 min ago. Each container keeps its own cache; that's fine for one instance.
- If no fresh rate is available, `GET /api/rates/btc-eur` and `POST /api/orders` return **503** `{"code": "rate_unavailable"}`. The UI shows "Kursen kan ikke hentes lige nu. Prøv igen om lidt." and blocks placement.
- The server never accepts a rate from the client. The order uses the server's cached rate at the moment of placement.
- Tests mock both sources with `respx`; no live calls in CI.

### 2. Amount math

- EUR is stored as integer cents (`bigint`). BTC is stored as integer satoshis (`bigint`). Rates are `Decimal`, stored as `numeric(18,2)` EUR per BTC. No floats anywhere.
- `books.price` (ADR 0003, `numeric(10,2)`) is converted to cents at placement: `int(price * 100)`.
- `subtotal_cents = Σ unit_price_cents × qty`; `total_cents = subtotal_cents + shipping_cents`.
- `amount_sats = ceil(Decimal(total_cents) × 1_000_000 / rate)` (cents × 10^8 sats / 100 / rate), **rounded up** so the owner is never short. Exact integer form: `-(-total_cents * 1_000_000 // rate)` with `rate` as `Decimal`.
- The BTC amount is computed once and **stored**, never recomputed. Display is `amount_sats / 10^8` with 8 decimals.
- The order stores `total_cents`, `rate_eur_per_btc`, `rate_source`, `rate_fetched_at` and `amount_sats`.

### 3. Order number and URL token

- **Order number:** `BH-` plus 5 Crockford base32 characters (no I, L, O, U), e.g. `BH-7K3Q9`. That's 33 million values, generated with `secrets.choice`, unique index, retried on collision. It's short to type as a wallet note and it's not used for access.
- **URL token:** 32 bytes, base64url (43 chars), computed as `HMAC-SHA256(ORDER_TOKEN_SECRET, idempotency_key)`. It is as unguessable as `secrets.token_urlsafe(32)` without the server secret, and it lets a retry return the same link (section 4). `ORDER_TOKEN_SECRET` is a new env var, separate from `SESSION_SECRET`. The payment page is `/order/{token}`.
- The token is **stored as a SHA-256 hash** (`token_hash bytea`, unique index). It's 256 bits of entropy, so a plain hash is enough (no salt or slow hash needed). A database leak doesn't expose working order links, and the lookup is still a single indexed query. The plain token is returned once, in the `POST /api/orders` response, and lives only in the customer's URL.
- **Trade-off:** the owner can't rebuild a customer's link from the database. The admin finds orders by order number instead. If R2 adds emails, the email is sent while the plain token is still in memory.

### 4. Idempotent placement and stock

- The SPA creates a UUID v4 when the checkout form first opens and sends it as `Idempotency-Key` on every attempt, including "Prøv igen". It gets a new key only after a success or a changed cart.
- `orders.idempotency_key uuid UNIQUE NOT NULL`.
- Placement runs in one transaction:
  1. `SELECT ... FROM orders WHERE idempotency_key = :key`. If it's found and the request body hash matches, return **200** with the same order and the same token. If the body differs, return **422** `idempotency_key_reused`.
  2. Get the fresh rate (503 if none).
  3. Lock the books: `SELECT id, price, stock FROM books WHERE id = ANY(:ids) ORDER BY id FOR UPDATE`. Locking in `id` order avoids deadlocks.
  4. Check each line: the book exists, `stock >= qty`, `qty` is between 1 and 10. If not, roll back and return **409** `{"code": "stock_changed", "lines": [{book_id, available}]}` so the cart can show what changed.
  5. `UPDATE books SET stock = stock - :qty WHERE id = :id`.
  6. Insert the order and its lines.
- If two requests with the same key race, the second hits the unique constraint. It catches `IntegrityError`, rolls back, and re-reads the existing order.
- **Retry and the token:** only the hash is stored, so a random token couldn't be returned again. The HMAC-derived token (section 3) is recomputed from the key, so a retry gets the same link.
- **Cancellation:** `POST /api/admin/orders/{order_number}/cancel` (admin, `status = 'awaiting_payment'` only) sets `cancelled` and adds each line's `qty` back to `books.stock` in one transaction. Paid orders can't be cancelled in R1.
- **Shipping:** `POST /api/admin/orders/{order_number}/ship` (admin, `status = 'paid'` only) sets `shipped` and `shipped_at`. Allowed transitions: awaiting_payment to paid or cancelled; paid to shipped. Anything else returns 409. Endpoint details and the shipped email belong to #24's ADR.
- Mark paid: `POST /api/admin/orders/{order_number}/paid` sets `paid` and `paid_at`.

### Data model

```sql
CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
-- ('shipping_cents', 300): flat €3.00, confirmed by the owner

CREATE TYPE order_status AS ENUM ('awaiting_payment', 'paid', 'shipped', 'cancelled');

CREATE TABLE orders (
  id               bigserial PRIMARY KEY,
  order_number     text        NOT NULL UNIQUE,   -- BH-7K3Q9
  token_hash       bytea       NOT NULL UNIQUE,   -- sha256(token)
  idempotency_key  uuid        NOT NULL UNIQUE,
  request_hash     bytea       NOT NULL,          -- sha256 of canonical body
  status           order_status NOT NULL DEFAULT 'awaiting_payment',
  customer_name    text        NOT NULL,
  email            text        NOT NULL,
  address_line     text        NOT NULL,
  postal_code      text        NOT NULL,
  city             text        NOT NULL,
  country          text        NOT NULL DEFAULT 'DK',
  subtotal_cents   bigint      NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents   bigint      NOT NULL CHECK (shipping_cents >= 0),
  total_cents      bigint      NOT NULL CHECK (total_cents > 0),
  rate_eur_per_btc numeric(18,2) NOT NULL CHECK (rate_eur_per_btc > 0),
  rate_source      text        NOT NULL,          -- 'kraken' | 'coingecko'
  rate_fetched_at  timestamptz NOT NULL,
  amount_sats      bigint      NOT NULL CHECK (amount_sats > 0),
  btc_address      text        NOT NULL,          -- snapshot of BTC_ADDRESS
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  shipped_at       timestamptz,
  cancelled_at     timestamptz
);

CREATE TABLE order_lines (
  id               bigserial PRIMARY KEY,
  order_id         bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  book_id          bigint NOT NULL REFERENCES books(id),
  isbn             text   NOT NULL,               -- snapshot
  title            text   NOT NULL,               -- snapshot
  author           text   NOT NULL,               -- snapshot
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
  qty              int    NOT NULL CHECK (qty BETWEEN 1 AND 10),
  UNIQUE (order_id, book_id)
);
```

The BTC address is snapshotted per order, so changing `BTC_ADDRESS` later doesn't change old payment pages.

### API contracts

```python
class RateOut(BaseModel):          # GET /api/rates/btc-eur → 200 | 503
    eur_per_btc: Decimal           # "61234.50"
    source: Literal["kraken", "coingecko"]
    fetched_at: datetime
    shipping_cents: int            # so the cart can show the total

class CartLineIn(BaseModel):
    book_id: int
    qty: conint(ge=1, le=10)

class ShippingIn(BaseModel):
    name: constr(min_length=1, max_length=200)
    email: EmailStr
    address_line: constr(min_length=1, max_length=200)
    postal_code: constr(pattern=r"^\d{4}$")
    city: constr(min_length=1, max_length=100)

class OrderIn(BaseModel):          # POST /api/orders, header Idempotency-Key: <uuid>
    lines: conlist(CartLineIn, min_length=1, max_length=50)
    shipping: ShippingIn
    # no prices, no rate: the server decides both

class OrderLineOut(BaseModel):
    title: str
    author: str
    unit_price_cents: int
    qty: int

class OrderOut(BaseModel):         # POST → 201 (new) | 200 (retry); GET /api/orders/{token} → 200 | 404
    order_number: str              # "BH-7K3Q9"
    token: str | None              # in POST response only; the SPA navigates to /order/{token}
    status: Literal["awaiting_payment", "paid", "shipped", "cancelled"]
    lines: list[OrderLineOut]
    subtotal_cents: int
    shipping_cents: int
    total_cents: int
    eur_per_btc: Decimal
    rate_source: str
    rate_fetched_at: datetime
    amount_sats: int
    amount_btc: str                # "0.00081234", amount_sats formatted, 8 decimals
    btc_address: str
    bip21_uri: str                 # "bitcoin:<addr>?amount=0.00081234&message=BH-7K3Q9"
    created_at: datetime
```

Errors use `{"code": str, "message": str, ...}`:

| Status | Code | When |
|---|---|---|
| 400 | `idempotency_key_missing` | No or invalid `Idempotency-Key` header |
| 409 | `stock_changed` | A book is gone or short on stock; includes `lines` |
| 422 | validation / `idempotency_key_reused` | Bad body, or same key with a different body |
| 503 | `rate_unavailable` | No fresh rate |

`GET /api/orders/{token}` returns 404 for an unknown token. It omits `token` (`token: str | None`, only set on POST). It sets `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, so the token doesn't leak via referrers. The status field answers design question 7: the page can show awaiting, paid, shipped or cancelled.

Public `POST /api/orders` takes `Content-Type: application/json` only. Rate limiting is left to R2 unless spam shows up; orders hold stock, so the admin cancel is the release valve.

## Consequences

- No cart table and no customer accounts. A cart doesn't follow the customer across devices.
- The BTC amount on an order never changes. If BTC moves a lot before payment, the owner either accepts it or cancels. R2 can add expiry.
- Two free rate sources are a soft dependency: if both are down, checkout pauses with a clear message. Browsing still works.
- Stock can be held by unpaid orders indefinitely until the owner cancels. R2 can add auto-cancel after N days.
- A database leak alone doesn't expose order links. Rotating `ORDER_TOKEN_SECRET` breaks existing order links, so it's rotated only if leaked.
- New env var `ORDER_TOKEN_SECRET` per env (add to ADR 0001's list).
- Owner reconciles payments by order number and exact sats amount in their wallet.
