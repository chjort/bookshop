# ADR 0007: Order handling

Status: Proposed · Author: pro-architect · Task: #25 (feature #24) · Design: `docs/design/order-handling.md` (PR #53, D7–D11)

## Context

The owner sees orders and moves them from awaiting payment to paid to shipped, or cancels unpaid ones, which releases their reserved stock (#24). Paid and shipped don't change stock. Order, status and stock reservation come from ADR 0004. Emails on paid and shipped come from ADR 0005. Admin auth (signed cookie, 401 without a valid session, JSON-only mutations against CSRF) comes from ADR 0003. The design (PR #53) needs a server-side list with counts, a 409 that tells the UI what happened, and a detail payload with everything needed to match a wallet payment.

## Options

- **Conditional `UPDATE ... WHERE status = :expected` per action** (chosen): one statement decides the race; no explicit locks, no version column.
- `SELECT ... FOR UPDATE` then check then update: same safety, more code.
- Optimistic `version` column sent by the client: more client state for no gain with one owner.
- Generic `PATCH {status}`: lets the client ask for any transition and moves the rules into validation. Rejected for one endpoint per action, as in ADR 0004.

## Decision

### Transitions

| From | Action | To | Side effects |
|---|---|---|---|
| awaiting_payment | `POST /api/admin/orders/{order_number}/paid` | paid | `paid_at`, paid email (ADR 0005) |
| awaiting_payment | `POST /api/admin/orders/{order_number}/cancel` | cancelled | `cancelled_at`, stock restored |
| paid | `POST /api/admin/orders/{order_number}/ship` | shipped | `shipped_at`, shipped email (ADR 0005) |

Any other combination returns **409**. The paths keep ADR 0004's `/paid`, `/ship`, `/cancel`, which the design already uses.

### Data model

```sql
ALTER TABLE orders ADD COLUMN status_changed_at timestamptz;
UPDATE orders SET status_changed_at = created_at;
ALTER TABLE orders ALTER COLUMN status_changed_at SET NOT NULL,
                   ALTER COLUMN status_changed_at SET DEFAULT now();
CREATE INDEX orders_status_created ON orders (status, created_at DESC);
```

Email columns come from ADR 0005. A few hundred orders a year need no search index; `q` uses a plain scan.

### Race-safe actions

Each action is one transaction:

```sql
-- mark paid (ship is the same with 'paid' → 'shipped', shipped_at, shipped_email_status)
UPDATE orders
   SET status = 'paid', paid_at = now(), status_changed_at = now(),
       paid_email_status = 'pending'
 WHERE order_number = :n AND status = 'awaiting_payment'
RETURNING id;
```

- One row back: commit, return 200 with the order detail, then send the email after commit (ADR 0005).
- No row: roll back, then `SELECT status, status_changed_at FROM orders WHERE order_number = :n`. No order → **404** `{"code": "not_found"}`. Otherwise → **409**:

```json
{"code": "invalid_transition", "message": "Order is already paid.",
 "current_status": "paid", "status_changed_at": "2026-10-20T16:05:12Z"}
```

Two tabs clicking "Mark paid" at once: Postgres runs one `UPDATE`, the other re-checks the row after it commits, finds `status = 'paid'`, updates nothing, and gets the 409. One email goes out.

**Cancel** in the same transaction:

```sql
UPDATE orders SET status = 'cancelled', cancelled_at = now(), status_changed_at = now()
 WHERE order_number = :n AND status = 'awaiting_payment'
RETURNING id;
-- only if a row came back:
UPDATE books b SET stock = b.stock + l.qty
  FROM order_lines l WHERE l.order_id = :id AND b.id = l.book_id;
```

Stock goes back only when the status change won, so it can't be restored twice. Books are updated by `id` via the join; checkout locks books in `id` order too (ADR 0004), and a single join `UPDATE` touches each row once, so no deadlock in practice.

### Auth and expiry

- Every `/api/admin/orders*` route uses `require_admin` (ADR 0003). The session is checked **before** any database write. An expired or missing session returns **401** `{"code": "not_authenticated"}` and nothing is changed or sent.
- Mutations require `Content-Type: application/json` (empty `{}` body), as in ADR 0003.

### API contracts

```python
Status = Literal["awaiting_payment", "paid", "shipped", "cancelled"]
EmailStatus = Literal["pending", "sent", "failed"] | None   # None = not due yet

class OrderRow(BaseModel):
    order_number: str              # "BH-7K3Q9"
    created_at: datetime
    customer_name: str
    email: str
    total_cents: int
    amount_sats: int
    status: Status
    status_changed_at: datetime
    paid_email_status: EmailStatus
    shipped_email_status: EmailStatus

class OrderList(BaseModel):        # GET /api/admin/orders?status=&q=&page=
    items: list[OrderRow]
    page: int                      # 1-based
    page_size: int                 # 25
    total: int                     # matching status + q
    counts: dict[Status, int]      # awaiting_payment, paid, shipped, cancelled; with q applied, ignoring status

class OrderLine(BaseModel):
    book_id: int
    isbn: str
    title: str
    author: str
    unit_price_cents: int
    qty: int

class OrderDetail(OrderRow):       # GET /api/admin/orders/{order_number}; also the 200 body of every action
    lines: list[OrderLine]
    subtotal_cents: int
    shipping_cents: int
    address_line: str
    address_line2: str | None      # optional; nullable, shown only when set (ADR 0004 amendment, #56)
    postal_code: str
    city: str
    country: str                   # "DK"
    btc_address: str               # snapshot from placement
    rate_eur_per_btc: Decimal      # locked rate
    rate_source: str               # "kraken" | "coingecko"
    rate_at: datetime              # orders.rate_fetched_at
    paid_at: datetime | None
    shipped_at: datetime | None
    cancelled_at: datetime | None
    paid_email_sent_at: datetime | None
    shipped_email_sent_at: datetime | None
```

List rules:

- `status`: one of the four, or omitted for all. Any other value → 422. The SPA defaults to `awaiting_payment` (D4).
- `q`: trimmed. If it looks like an order number (case-insensitive, `BH-` optional, spaces ignored, 5 Crockford characters) it matches `order_number` exactly. Otherwise case-insensitive substring of `customer_name` or `email` (`ILIKE`, `%` and `_` escaped). Max 100 characters.
- Sort: `created_at DESC, id DESC`.
- Paging: 25 per page, `LIMIT/OFFSET`. `counts` comes from one `SELECT status, count(*) ... GROUP BY status` with the same `q` filter; statuses with no orders are 0. The "All" count is the sum.
- `Cache-Control: no-store` on all admin responses.

Errors: 401 `not_authenticated`, 404 `not_found`, 409 `invalid_transition`, 422 validation.

## Consequences

- One `UPDATE` per action is both the rule check and the race guard. There's no lock code to get wrong.
- The 409 body lets the UI show "already paid (at 18:05)" without another request.
- `status_changed_at` is a new column; old rows get `created_at`.
- No audit log beyond the `*_at` timestamps. One owner doesn't need one in R1.
- Cancelling restores stock even if the book was re-imported since. The re-import (R2) sets counts from the CSV, and the owner reconciles.

## Amendment (2026-10-25): request edge cases for R1

Answers from pro-qa's #28 test plan.

- **CSRF.** Order actions need only `Content-Type: application/json` (ADR 0003). They don't need `X-Requested-With`, which only the multipart import requires. Without JSON the response is 415 `{"code": "unsupported_media_type"}`.
- **Check order.** `require_admin` runs first. Without a session the response is 401 `{"code": "not_authenticated"}` whatever the Content-Type, and nothing changes. Every `/api/admin/orders*` error body uses `{"code": ...}`, never FastAPI's `{"detail": ...}`. The shared `require_admin` (401) and `require_json` (415) checks do too. Login and import still return their own errors as `{"detail": ...}` in R1, and those move to `{"code": ...}` in R2.
- **Order number in the URL.** It's upper-cased before lookup, so lower case matches. An unknown order number is 404 `{"code": "not_found"}`.
- **Paging.** `page` is 1 or more, so 0 or below is 422. A page past the end is 200 with empty `items` and the real `total` and `counts`.
- **Search length.** If `q` is longer than 100 characters the response is 422. It isn't cut to 100 like the shop search, so the owner can see their search was wrong.
- **Emails are R2 (#30).** R1 has no `paid_email_status`, `shipped_email_status`, `paid_email_sent_at` or `shipped_email_sent_at` columns or fields, and no `EmailStatus` type. Mark paid and ship only set `status` and `paid_at` / `shipped_at`, and nothing is sent after commit. There's no "emails not set up" flag, email status, or "Email not sent" banner. R2 adds the columns in a migration together with ADR 0005. Everything else in this ADR stays as it is.
