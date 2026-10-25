# ADR 0003: Admin auth and CSV import

Status: Proposed · Author: pro-architect · Task: #7 (feature #6)

## Context

One owner manages the shop. They log in and upload the stock CSV (#6). AC3 on #6: rows that can't be imported are listed with the reason, and the rest are still imported. AC4: thousands of rows import without timing out. App shape from ADR 0001: one FastAPI container, same origin as the SPA, Postgres.

## Options

**Auth**
- **Single owner from env vars, signed session cookie** (chosen): no user table, no extra service.
- Users table with roles: not needed for one owner.
- JWT in localStorage: open to XSS token theft, and harder to revoke. Rejected.
- External identity provider: more setup and cost for one user. Rejected.

**Import**
- **One synchronous request, partial import** (chosen): a few thousand rows parse and upsert in seconds.
- Background job and queue: needs a worker and polling UI. Not needed in R1.
- All-or-nothing import: conflicts with AC3. Rejected. This replaces decision 7 in the design spec (PR #45, section 9).

## Decision

### Auth

- Credentials: `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` (argon2, via `argon2-cffi`) as env vars per env. A small CLI prints the hash for a given password.
- Endpoints:
  - `POST /api/admin/login` takes `{username, password}` as JSON. Success returns 200 and sets the cookie.
  - `POST /api/admin/logout` clears the cookie.
  - `GET /api/admin/me` returns `{username}`, or 401 with no valid session.
- Session: signed cookie (`itsdangerous`, key from `SESSION_SECRET`) with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 7-day expiry. Expiry is stored in the signed payload and checked on the server. Rotating `SESSION_SECRET` logs everyone out.
- All `/api/admin/*` routes except `login` use a `require_admin` dependency that returns 401 without a valid session. The SPA sends unauthenticated users to the login page.
- Lockout: table `login_attempts(username PK, failed_count int, locked_until timestamptz null)`.
  - Each failure increments `failed_count`. The 5th failure sets `locked_until = now() + 15 min`.
  - While locked, login returns 429 with the same generic message, whether or not the password is right.
  - A successful login deletes the row.
  - Unknown usernames are counted the same way and still run an argon2 verify, so neither the response nor its timing reveals whether a user exists.
  - Wrong credentials return 401 with the same generic message. The UI shows the same generic text for 401 and 429 (design decision 9).
- CSRF: `SameSite=Lax` blocks cross-site cookies on POST. Mutating admin endpoints also require `Content-Type: application/json`, which a cross-site form cannot send without a CORS preflight that we never allow. The import endpoint is multipart, so it requires a custom header `X-Requested-With: bookshop` instead.

### Import

- `POST /api/admin/import` takes multipart with one field, `file`, admin only.
- File-level checks reject the whole file and import nothing:
  - Over 5 MB: 413.
  - Not valid UTF-8 (a UTF-8 BOM is allowed): 422.
  - Missing required headers: 422, listing the missing ones.
  - Headers are matched case-insensitively, after trimming spaces.
  - The separator (comma or semicolon) is detected from the header line.
- Each row is validated by a plain function that collects all of the row's errors (see Amendment 2026-10-21):
  - ISBN: digits, with hyphens and spaces stripped; ISBN-10 or ISBN-13 with a valid checksum.
  - Title is required. Author is required.
  - Genre may be empty and is shown as "Other".
  - Price: `12.50` (dot, as in the real file) or `12,50`, more than 0, at most 2 decimals, stored as `Decimal`/`numeric(10,2)`.
  - Stock (`count`): a whole number of 0 or more; `3` and `3.0` are accepted, `3.5` is rejected.
- Duplicate ISBNs in one file: every row with that ISBN is skipped and listed (design decision 3).
- Valid rows are upserted by ISBN (`INSERT ... ON CONFLICT (isbn) DO UPDATE`) in one DB transaction. Invalid rows are skipped. Because of the upsert, re-importing the same file is safe.
- Response (Pydantic `ImportResult`), 200:
  ```json
  {"created": 120, "updated": 25, "skipped": 5,
   "errors": [{"row_number": 14, "isbn": "978...", "errors": ["Price is missing"]}]}
  ```
  - `row_number` is the line number in the file, with the header as line 1.
  - The error texts are in English, since the shop is English only, so they can be shown directly.
- No queue in R1. The UI shows a spinner (design decision 8). If imports grow past roughly 30 s, revisit with a background job.

### CSV columns

Confirmed by the user on 2026-10-20: columns `price` and `count`, both numbers with a dot as decimal separator.

| Field | Header (proposed) | Required | Format |
|---|---|---|---|
| title | `title` | yes | text |
| author | `author` | yes | text |
| isbn | `ISBN` | yes | ISBN-10/13 |
| genre | `genre` | no | text, empty → "Other" |
| price_eur | `price` | yes | `12.50` (also `12,50`) |
| stock | `count` | yes | whole number ≥ 0 (`3` or `3.0`) |

## Consequences

- No user management: changing the password means updating an env var and redeploying.
- A stateless cookie can't be revoked one session at a time. Rotating `SESSION_SECRET` logs everyone out. That is acceptable for one owner.
- One table and one migration are added for lockout.
- An attacker can lock the owner out for 15 minutes by guessing their username. That is accepted for R1.
- Synchronous import holds one request and one transaction for a few seconds. That is fine at this size, and AC4 is to be confirmed by a test importing 5,000 rows.
- The column table is provisional until the user confirms headers. Changing it later only touches the row-check function.

> ARCHITECTURE.md and the ADR index are added in PR #44. Links to this ADR will be reconciled there or in a follow-up once #44 is merged.

## Amendment 2026-10-21

Recorded by pro-architect during the review of #65 (task #9). The rest of this ADR stays as is.

**Row checks are done by a plain function, not a Pydantic `BookRow` model.** The function checks every field and collects all of a row's problems at once, so the owner sees every problem on a row in one pass and can fix them together. The rules are unchanged: ISBN checksum, required title and author, `price` > 0 with at most 2 decimals (`12.50` or `12,50`), and `count` a whole number ≥ 0 (`3` and `3.0` accepted, fractions rejected, 0 valid and shown as sold out). Pydantic is still used for request bodies and responses.

## Amendment 2026-10-25: import keeps copies held by open orders

Recorded by pro-architect. Decided for Release 1 by pro-product-owner. Implementation is a task under #6.

**Context.** ADR 0004 takes stock when an order is placed (`stock = stock - qty`) and gives it back when an unpaid order is cancelled. The import set `books.stock` to the file's `count`, so re-importing while orders were open made their copies sellable again. The owner will re-import their real stock while orders are open, so this could sell the same copy twice.

**Options.**
- **The file's `count` is the copies on the shelf. The import subtracts the copies held by open orders** (chosen). The owner counts what they physically have, which is what they know.
- The file's `count` means copies free to sell. Nothing changes in code, but the owner would have to subtract open orders by hand. That is easy to get wrong. Rejected.
- Block the import while any order is open. That is simple, but it stops the owner from updating stock during normal trading. Rejected.

**Decision.**
- `held(book) = SUM(order_lines.qty)` over orders with status `awaiting_payment` or `paid`. Shipped copies have left the shelf, and cancelled orders already gave their copies back.
- On import, `stock = GREATEST(count - held, 0)` for every upserted book. A new book has `held = 0`.
- Concurrency: the import runs at Postgres's default READ COMMITTED level, in one transaction with three separate statements, in this order:
  1. Lock the rows of the books in the file: `SELECT id FROM books WHERE isbn = ANY(:isbns) ORDER BY id FOR UPDATE`.
  2. Sum the held copies per book in its own statement, so it reads every order committed before step 1 got its locks.
  3. Upsert each book with `stock = GREATEST(count - held, 0)`.
  Placement and cancel both hold the book row locks until they commit. An order or cancel that ran first is therefore counted in step 2, and one that comes later waits for the import and works from the new stock. No new table and no migration.
- Lock order: everything that changes `books.stock` locks book rows in ascending `id` order, so two writers can't deadlock. Placement already does this (`ORDER BY id FOR UPDATE`). Cancel has to lock its books with `SELECT ... WHERE id = ANY(:ids) ORDER BY id FOR UPDATE` before its restock `UPDATE`. That change is part of #109.
- Only the books upserted from valid rows change. Books missing from the file and books on skipped rows keep their stock, and they add nothing to `held_back`.
- `ImportResult` gains `held_back`, the copies actually held back: the sum of `count - stock` over the upserted books, which equals `min(held, count)` for each book. When the count is below the held copies, the import holds back only the count. Example: `{"created": 0, "updated": 150, "skipped": 0, "held_back": 4, "errors": []}`. The import page shows it next to the other counts.
- Re-importing the same file is still safe: it gives the same stock for the same open orders.

**Consequences.**
- If the file's count is below what open orders hold, the stock is set to 0 and those orders still stand. The owner has fewer copies than they promised and must cancel or restock by hand. R1 doesn't flag which books this hits. A per-book warning can come in a later release if it happens.
- One extra grouped query per import. That's negligible at a few thousand rows.
- Tests:
  - An order is open, and a re-import sets stock to count minus held.
  - A cancel after the import gives the copies back correctly.
  - When the count is below held, stock is 0 and `held_back` equals the count.
  - Shipped and cancelled orders are not held.
  - Books missing from the file and books on skipped rows keep their stock.
  - A cancel of an order with several books locks them in id order.
  - `held_back` is reported.
  - Re-importing the same file twice gives the same stock and `held_back` both times.
  - A new ISBN gets its full count, with `held_back` 0.
  - Held copies add up across several Awaiting payment and Paid orders for the same book.
  - Concurrency, over two DB connections: an order placed during an import ends with the correct stock.
  - Concurrency, over two DB connections: a cancel of an order with several books during an import finishes with no deadlock and the correct stock.
  - The import page shows `held_back`.

## Amendment 2026-10-25 (2): stock may go below 0

Recorded by pro-architect for #113. It replaces the floor at 0 from the amendment above. Everything else in that amendment stays.

**Context.** The import set `stock = GREATEST(count - held, 0)`. When the count is below the held copies, the floor forgets the shortfall. A later cancel does `stock = stock + qty` and gives back copies the shelf never had, so the shop can sell copies that don't exist (#113).

**Options.**
- **Store `stock = count - held` with no floor, so it can be negative** (chosen). Placement and cancel stay `stock - qty` and `stock + qty`, and those are correct from any starting value. A negative stock means the shop is short that many copies for orders it already took.
- Store the shelf count in a new column and have cancel recompute `max(0, shelf - held)`. That needs a new column and makes cancel depend on the import's rule. Rejected.
- Document it and have the owner re-import after cancelling. That's easy to forget, and the bug is selling copies that don't exist. Rejected.

**Decision.**
- The import sets `stock = count - held`, with no floor.
- Migration: drop the `CHECK (stock >= 0)` on `books`. Placement still refuses an order when `stock < qty`, so a customer can never push stock below 0. Only an import can.
- Read side: a book is for sale only when `stock > 0`. Every place that shows or sorts by stock uses `GREATEST(stock, 0)`. That covers the catalogue's `in_stock`, the book's `stock` field, the cart cap, the sold-out-last ordering (`stock = 0` becomes `stock <= 0`, and its index changes too) and the `available` count in a 409 `stock_changed`. The API never returns a negative number.
- `held_back` is unchanged: `min(count, held)` per book, summed, which now equals `count - GREATEST(stock, 0)`.

**Consequences.**
- Cancel needs no change. With count 1 and 3 held (#113), the import gives stock −2. Cancelling the 2-copy order gives 0, which is correct.
- One small migration. Every read of `stock` has to be clamped, and a test should pin each one.
- Tests:
  - The #113 repro ends with stock 0.
  - A count below held stores a negative stock, the book reads as sold out with `stock` 0, and placement refuses it.
  - Cancels that bring stock back above 0 make the book sellable again with the right count.
