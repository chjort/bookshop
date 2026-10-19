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
- Each row is validated with a Pydantic `BookRow` model:
  - ISBN: digits, with hyphens and spaces stripped; ISBN-10 or ISBN-13 with a valid checksum.
  - Title is required. Author is required.
  - Genre may be empty and is shown as "Øvrige".
  - Price: dot decimal only (`12.50`; a comma is rejected), more than 0, at most 2 decimals, stored as `Decimal`/`numeric(10,2)`.
  - Stock (`count`): a whole number of 0 or more; `3` and `3.0` are accepted, `3.5` is rejected.
- Duplicate ISBNs in one file: every row with that ISBN is skipped and listed (design decision 3).
- Valid rows are upserted by ISBN (`INSERT ... ON CONFLICT (isbn) DO UPDATE`) in one DB transaction. Invalid rows are skipped. Because of the upsert, re-importing the same file is safe.
- Response (Pydantic `ImportResult`), 200:
  ```json
  {"created": 120, "updated": 25, "skipped": 5,
   "errors": [{"row_number": 14, "isbn": "978...", "errors": ["Pris mangler"]}]}
  ```
  - `row_number` is the line number in the file, with the header as line 1.
  - The error texts are in Danish so they can be shown directly.
- No queue in R1. The UI shows a spinner (design decision 8). If imports grow past roughly 30 s, revisit with a background job.

### CSV columns

Confirmed by the user on 2026-10-20: columns `price` and `count`, both numbers with a dot as decimal separator.

| Field | Header (proposed) | Required | Format |
|---|---|---|---|
| title | `title` | yes | text |
| author | `author` | yes | text |
| isbn | `ISBN` | yes | ISBN-10/13 |
| genre | `genre` | no | text, empty → "Øvrige" |
| price_eur | `price` | yes | `12.50` |
| stock | `count` | yes | whole number ≥ 0 (`3` or `3.0`) |

## Consequences

- No user management: changing the password means updating an env var and redeploying.
- A stateless cookie can't be revoked one session at a time. Rotating `SESSION_SECRET` logs everyone out. That is acceptable for one owner.
- One table and one migration are added for lockout.
- An attacker can lock the owner out for 15 minutes by guessing their username. That is accepted for R1.
- Synchronous import holds one request and one transaction for a few seconds. That is fine at this size, and AC4 is to be confirmed by a test importing 5,000 rows.
- The column table is provisional until the user confirms headers. Changing it later only touches the `BookRow` mapping.

> ARCHITECTURE.md and the ADR index are added in PR #44. Links to this ADR will be reconciled there or in a follow-up once #44 is merged.
