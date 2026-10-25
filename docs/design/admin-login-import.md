# Design: admin login and catalogue import

Feature: #6 · Task: #8 · Release 1 (walking skeleton) · Author: pro-designer

## 1. Purpose

The owner logs in to a private admin area of probooks and uploads the stock CSV. Books are created or updated by ISBN. Valid rows are imported; invalid rows are skipped and listed with their reason (AC3). Only file-level problems (not UTF-8, missing headers, over 5 MB) reject the whole file. The UI is in English only.

Scope for Release 1: one owner account, login, logout, admin home with nav, CSV upload, import result. No password reset, no user management. Headers are matched case-insensitively; comma and semicolon separators are both accepted. Required headers: `title,author,ISBN,genre,price,count` (`count` is the stock count; there is no `quantity` column). Prices use a dot (`12.50`); a comma (`12,50`) is also accepted. `count` may be written as a decimal (`3` or `3.0`) but must be a whole number. The import is one synchronous request taking a few seconds; the UI shows a spinner (no progress bar) and then a result summary. Max file size 5 MB, UTF-8 only. Login is by username; 5 failed logins lock login for 15 minutes, shown with the same generic error. Sessions last 7 days.

## 2. User flow

```mermaid
flowchart TD
    A[/admin/*] --> B{Logged in?}
    B -- no --> L[Login page]
    B -- yes --> H[Admin home]
    L -->|submit| V{Credentials ok?}
    V -- no --> LE[Login error, stay on page]
    LE --> L
    V -- locked: 5 failures, 15 min --> LE
    V -- yes --> R[Return to requested page or admin home]
    R --> H
    H --> U[Import page]
    U -->|choose file| F{Client check: .csv, not empty}
    F -- fails --> FE[Inline file error]
    FE --> U
    F -- ok --> S[Upload + import in progress]
    S --> X{Server result}
    X -- file rejected: not UTF-8, missing headers, over 5 MB --> TF[File error: nothing imported]
    X -- all rows ok --> OK[Success summary]
    X -- some rows invalid --> PF[Partial success: valid rows imported + skipped rows table]
    PF --> U
    X -- session expired --> SE[Login page with notice, then back to import]
    TF --> U
    OK --> U
    PF --> U
    H -->|Log out| L
```

## 3. Wireframes

### 3.1 Login (`/admin/login`)

```
+--------------------------------------------------+
|  probooks · Admin                                |
+--------------------------------------------------+
|                                                  |
|   Log in                                         |
|                                                  |
|   [!] Wrong username or password.                |  <- error banner, role=alert
|                                                  |
|   Username                                       |
|   [______________________________]               |
|                                                  |
|   Password                                       |
|   [______________________________] [Show]        |
|                                                  |
|   [ Log in ]                                     |
|                                                  |
+--------------------------------------------------+
```

### 3.2 Admin home and nav (`/admin`)

```
+--------------------------------------------------------------+
| probooks · Admin             Import | Orders     [Log out]   |
+--------------------------------------------------------------+
|  Welcome                                                      |
|                                                               |
|  +----------------------+   +----------------------+         |
|  | Catalogue            |   | Orders               |         |
|  | 1,243 books          |   | (coming in feature 5)|         |
|  | Last import:         |   |                      |         |
|  | 19 Oct 2026, 21:14   |   |                      |         |
|  | [Import CSV]         |   | [View orders]        |         |
|  +----------------------+   +----------------------+         |
+--------------------------------------------------------------+
```

The nav is shared by all admin pages. "Orders" links to the order list from feature 5; hide it until that exists.

### 3.3 Import upload (`/admin/import`)

```
+--------------------------------------------------------------+
| probooks · Admin             Import | Orders     [Log out]   |
+--------------------------------------------------------------+
|  Import catalogue                                             |
|                                                               |
|  Upload your CSV file. Books are matched by ISBN: if the      |
|  ISBN exists, the book is updated; otherwise it is created.   |
|                                                               |
|  Required columns: title, author, ISBN, genre, price,         |
|  count. Upper/lower case doesn't matter.                      |
|  Comma or semicolon as separator.                             |
|                                                               |
|  `count` is the number of copies on your shelf. Copies in     |
|  unshipped orders are subtracted automatically.               |
|                                                               |
|  CSV file                                                     |
|  +--------------------------------------------------------+  |
|  | [Choose file]  books.csv (412 KB)                      |  |
|  |  or drag the file here                                 |  |
|  +--------------------------------------------------------+  |
|  .csv only, UTF-8, max 5 MB.                                  |
|                                                               |
|  [ Import ]                                                   |
+--------------------------------------------------------------+
```

The shelf-count help text sits directly above the file picker and is linked to the file input with `aria-describedby` (with the file hint). It explains the ADR 0003 amendment (#110): stock = `count` minus copies held by Awaiting payment and Paid orders, never below 0.

The drop zone is optional sugar. The real control is a native `<input type="file" accept=".csv,text/csv">` with a visible label.

### 3.4 In progress

```
|  (spinner)  Importing books.csv …                            |
|  This takes a few seconds. Don't close the window.            |
|  [ Importing … ] (disabled)                                   |
```

Spinner only, no progress bar: the import is one synchronous request of a few seconds (pro-architect, #7).

### 3.5 Import result

```
+--------------------------------------------------------------+
|  Import finished: books.csv                                   |
|  [!] 27 rows were not imported. The rest were imported.       |
|                                                               |
|  +-----------+  +-----------+  +-----------+                 |
|  | 3,912     |  | 61        |  | 27        |                 |
|  | created   |  | updated   |  | skipped   |                 |
|  +-----------+  +-----------+  +-----------+                 |
|  12 copies held back for open orders.                         |  <- only if held_back > 0
|                                                               |
|  Skipped rows (27)                                            |
|  +-------+---------------+---------------------------------+ |
|  | Row   | ISBN          | Reason                          | |
|  +-------+---------------+---------------------------------+ |
|  | 14    | 978-87-1234   | Invalid ISBN                    | |
|  | 230   | 9788702011111 | Price is missing                | |
|  | 231   | 9788702022222 | Count can't be negative         | |
|  | 232   | 9788702044444 | Count must be a whole number    | |
|  | 410   | 9788702033333 | ISBN appears more than once (rows 410 and 977) | |
|  | 977   | 9788702033333 | ISBN appears more than once (rows 410 and 977) | |
|  +-------+---------------+---------------------------------+ |
|  Showing 1–27 of 27  [Previous] [Next]                        |
|  [ Import another file ]                                      |
+--------------------------------------------------------------+
```

With no skipped rows, the banner is green ("All rows were imported.") and the table is hidden; "skipped" shows 0. Row numbers count the header as row 1, matching a spreadsheet. The table pages at 50 rows.

**Held-back line (R1 import fix #108 / #109):** when the import result's `held_back` > 0, show "{n} copies held back for open orders." ("1 copy held back for open orders." when n = 1) as plain text directly under the counters. When `held_back` is 0 or absent, the line is not rendered. It lives in the same result region as the counters (`role="status"`, `aria-live="polite"`), so it is announced with them; it is informational, not a warning, so no icon or colour. `n` uses English number formatting (`1,204`). What `held_back` counts (all held copies, or only those capped at the file's count) follows ADR 0003 as amended in #110; the UI copy just shows the API's value.

## 4. UI states

| State | What the user sees |
|---|---|
| Empty (no import yet) | Home: "No books yet. Import your first CSV file." Import page: upload form only. |
| Loading (login) | Button shows "Logging in …", disabled. |
| Loading (import) | Spinner and "Importing {filename} … This takes a few seconds." Form disabled; no double submit. No progress bar. |
| Success | Section 3.5 with skipped 0; green banner "All rows were imported." |
| Partial success | Section 3.5: valid rows imported; amber banner "{n} rows were not imported. The rest were imported." plus the skipped rows table. |
| Success with copies held back | Section 3.5 plus the line "{n} copies held back for open orders." under the counters (only when `held_back` > 0; singular for 1). Banner colour unchanged. |
| No valid rows | Section 3.5 with 0 created, 0 updated; red banner "No rows were imported." plus the table. |
| File error (whole file rejected) | Red banner with the reason (over 5 MB, not UTF-8, missing headers; also wrong type or empty) and "Nothing was imported." File cleared. |
| Auth error | "Wrong username or password." Password cleared, username kept, focus to banner. |
| Lockout (5 failures, 15 min) | Exactly the same as auth error: same generic message, form stays enabled. No separate lockout message, so the lock isn't revealed (pro-architect, #7). |
| Session expired (after 7 days) | Redirect to login with info banner "Your session has expired. Please log in again." After login, return to the requested page. If it expired during an upload: "The import didn't finish. Please upload the file again." |
| Network / server error | "Something went wrong. Please try again." with [Try again]. |
| Not logged in on any /admin URL | Redirect to login; admin content never flashes. |

## 5. Edge cases

| Case | Handling | Message |
|---|---|---|
| Wrong file type (.xlsx, .txt) | Client blocks before upload; server checks too. | "The file must be a CSV file (.csv)." |
| Empty file / header only | Total failure. | "The file is empty." / "The file contains no books." |
| Large file (a few thousand rows, under 5 MB) | One synchronous request; must not time out (AC4). Show the spinner; keep the UI responsive; paginate the skipped table at 50 rows. | "Importing … this can take up to a minute." |
| File over 5 MB | Client blocks before upload; server rejects too. | "The file is too large. The maximum is 5 MB." |
| Missing required column | Total failure, name the missing columns. | "The column ‘{name}’ is missing. Required columns: …" |
| Unknown extra columns | Ignored, no error. | — |
| Bad ISBN (wrong length or checksum) | Row rejected. | "Invalid ISBN" |
| Missing ISBN | Row rejected. | "ISBN is missing" |
| ISBN already in shop | Update the book (counts as "updated"). | — |
| Same ISBN twice (or more) in one file | Reject every row with that ISBN; list each one. | "ISBN appears more than once (rows {a} and {b})" |
| Price with dot (`12.50`, the owner's format) or comma (`12,50`) | Both accepted in the CSV. Anything else unparseable is rejected. | "Invalid price: ‘{value}’" |
| Missing / zero / negative price | Row rejected. 0 is invalid. | "Price is missing" / "Price must be greater than 0" |
| Empty genre | Allowed; shown as "Other". | — |
| Header case (`ISBN`, `isbn`, `Isbn`) | Matched case-insensitively. | — |
| `count` written as `3` or `3.0` | Accepted as 3. | — |
| Fractional `count` (`3.5`) | Row rejected. | "Count must be a whole number" |
| Negative `count` (`-1`, `-1.0`) | Row rejected. 0 is valid (shown as Sold out). | "Count can't be negative" |
| Missing or unparseable `count` | Row rejected. | "Count is missing" / "Invalid count: ‘{value}’" |
| Missing title | Row rejected. | "Title is missing" |
| Not UTF-8 (e.g. Windows-1252 from Excel) | File rejected; nothing imported. Never import garbled characters (Ã¦ for æ). | "The file isn't saved as UTF-8. Save it as ‘CSV UTF-8’ in Excel and try again." |
| Comma or semicolon separator | Both accepted. | — |
| One or more rows invalid | Those rows skipped and listed; valid rows imported. | "{n} rows were not imported. The rest were imported." |
| Held copies exceed the shelf count (e.g. `count` 2, 3 copies in Awaiting payment / Paid orders) | Stock is set to 0 (floor 0); the row is imported, not skipped. No extra error or warning; the held copies are covered by the held-back line. | "{n} copies held back for open orders." |
| Every row invalid | Nothing imported; all rows listed. | "No rows were imported." |

## 6. UI copy

| Key | English |
|---|---|
| App title | probooks · Admin |
| Login heading | Log in |
| Username label | Username |
| Password label | Password |
| Show/hide password | Show / Hide |
| Login button / busy | Log in / Logging in … |
| Login error | Wrong username or password. |
| Required field | Please fill in {field}. |
| Session expired | Your session has expired. Please log in again. |
| Lockout | (same as login error) |
| Empty genre | Other |
| Duplicate ISBN | ISBN appears more than once (rows {a} and {b}) |
| Count not whole | Count must be a whole number |
| Count negative | Count can't be negative |
| Count missing / invalid | Count is missing / Invalid count: ‘{value}’ |
| Import busy | Importing {filename} … This takes a few seconds. |
| Nav | Import · Orders · Log out |
| Home heading | Welcome |
| Catalogue card | Catalogue · {n} books · Last import: {date}, {time} |
| Empty catalogue | No books yet. Import your first CSV file. |
| Import heading | Import catalogue |
| Import intro | Upload your CSV file. Books are matched by ISBN: if the ISBN exists, the book is updated; otherwise it is created. |
| File label / hint | CSV file / .csv only, UTF-8, max 5 MB. |
| Too big | The file is too large. The maximum is 5 MB. |
| Not UTF-8 | The file isn't saved as UTF-8. Save it as ‘CSV UTF-8’ in Excel and try again. |
| Choose file / drop | Choose file / or drag the file here |
| Import button / busy | Import / Importing … |
| Result heading | Import finished: {filename} |
| Counters | created · updated · skipped |
| Held back (n > 1) | {n} copies held back for open orders. |
| Held back (n = 1) | 1 copy held back for open orders. |
| Shelf-count help | `count` is the number of copies on your shelf. Copies in unshipped orders are subtracted automatically. |
| All ok | All rows were imported. |
| Partial | {n} rows were not imported. The rest were imported. |
| No valid rows | No rows were imported. |
| Total failure | Nothing was imported. |
| Skipped table | Skipped rows · Row · ISBN · Reason |
| Pager | Showing {a}–{b} of {n} · Previous · Next |
| Again | Import another file |
| Generic error | Something went wrong. Please try again. · Try again |
| Logged out | You're logged out. |

Numbers use English formatting: `3,912`, prices `€12.50`, dates `19 Oct 2026`, times 24-hour `21:14`.

## 7. Accessibility (WCAG 2.1 AA)

- `lang="en"` on the document.
- Every input has a visible `<label for>`; no placeholder-only labels. Username `autocomplete="username"`, password `autocomplete="current-password"`.
- Focus order follows reading order: nav → heading → form fields → button → results. Visible focus ring, at least 3:1 contrast.
- Errors: login and import banners use `role="alert"`; import status and result summary sit in an `aria-live="polite"` region. Field errors are linked with `aria-describedby` and set `aria-invalid="true"`. After a failed submit, focus moves to the error banner.
- File upload works by keyboard alone: native file input, reachable with Tab and opened with Enter/Space. Drag and drop is never the only way.
- The spinner has `role="status"` with the text "Importing …", so screen readers announce it; the animation respects `prefers-reduced-motion`.
- Disabled buttons during loading keep `aria-busy="true"` on the form; the button text change is announced.
- Result counters are text, not colour only; banners pair colour with an icon and words. Text contrast at least 4.5:1, UI components 3:1.
- Skipped rows table is a real `<table>` with `<th scope="col">` and a `<caption>`.
- Page `<title>` changes per page: "Log in – Admin", "Import catalogue – Admin", "Import finished – Admin".
- Show password toggle is a `<button>` with `aria-pressed`.
- Layout reflows at 320 px width and 200 % zoom without horizontal scroll (table may scroll in its own container).

## 8. Acceptance criteria mapping (#6)

| Acceptance criterion | Spec sections |
|---|---|
| Only the owner can reach admin pages, after logging in. | 2 (auth gate), 3.1, 3.2, 4 (auth error, lockout, session expired, not logged in), 7, 9.5, 9.9–9.10 |
| Uploading the CSV creates or updates books by ISBN. | 3.3, 3.5 (created / updated), 5 (ISBN already in shop, header case, separators, price format, count format), 9.1–9.2, 9.11 |
| Rows that can't be imported are listed with the reason, and the rest are still imported. | 3.5, 4 (partial success, no valid rows), 5 (row-level errors), 6, 9.3, 9.6, 9.7. **Fully met.** |
| A file with thousands of rows imports without timing out. | 3.4, 4 (loading), 5 (large file, over 5 MB), 9.4, 9.8 |

| Import result says how many copies were held back for open orders (R1 import fix #108 / #109). | 3.3 (shelf-count help), 3.5 (held-back line), 4 (success with copies held back), 5 (held copies exceed count), 6, 9.15 |
| Re-importing stock never frees copies held by unshipped orders (R1 import fix #108 / #109, ADR 0003 amendment #110). | 3.3, 5 (held copies exceed count), 9.15 |

## 9. Resolved decisions

Answered by pro-product-owner.

1. **Headers and separators:** headers matched case-insensitively; comma or semicolon accepted. Required columns are `title,author,ISBN,genre,price,count` (confirmed by the user). Stock is `count`, not `quantity`.
2. **Price format in the CSV:** the owner writes `12.50` (dot). `12,50` (comma) is still accepted.
3. **Duplicate ISBN in one file:** all rows with that ISBN are rejected and each is listed in the error table.
4. **Large files:** a few thousand rows import without timing out, with clear progress and a result summary. pro-architect decides how.
5. **Login:** by username. Lockout after repeated failures (section 4).
6. **Row rules:** price 0 is invalid. Empty genre is allowed and shown as "Other".

From pro-architect (#7):

7. **Partial import (AC3 stands, ruled by pro-product-owner):** one synchronous request with a spinner. Valid rows are imported; invalid rows are skipped and listed with reasons. Only file-level problems reject the whole file: not UTF-8, missing headers, or over 5 MB. This replaces pro-architect's all-or-nothing proposal.
8. **File limits:** at most 5 MB, UTF-8 only. Spinner during the import of a few seconds, no progress bar (this replaces decision 4's progress requirement).
9. **Lockout:** 5 failed logins lock login for 15 minutes. While locked, the same generic login error is shown (this replaces the separate lockout message).
10. **Session:** lasts 7 days, then the session-expired state applies.

From the user and pro-product-owner:

11. **Count format:** `count` values may be decimals. `3` and `3.0` are both 3. Any fractional value (`3.5`) rejects the row with "Count must be a whole number". Negative values reject the row.
12. **UI language: English only (user decision 2026-10-20).** All copy in this spec is English; `lang="en"`.
13. **Shop name:** probooks (replaces the placeholder "Boghandel").
14. **Display formats:** English number and price format everywhere in the UI: `3,912`, `€12.50`. CSV input formats (decision 2) are unchanged.

From pro-product-owner and pro-architect (R1 import fix #108 / #109, ADR 0003 amendment #110):

15. **Shelf count and held-back copies:** `count` means copies on the shelf. Import sets stock to `count` minus copies held by Awaiting payment and Paid orders, never below 0. The result shows "{n} copies held back for open orders." only when `held_back` > 0, inside the existing result status region. A book whose held copies exceed its count gets stock 0 with no extra error.

Nothing is open.

## 10. Example CSV

```csv
title,author,ISBN,genre,price,count
Kongens Fald,Johannes V. Jensen,9788702011111,Klassikere,12.50,3
Hærværk,Tom Kristensen,9788702022222,Klassikere,9.95,1.0
Ternet Ninja,Anders Matthesen,9788702033333,Børn,15.00,0
Halv bog,Ukendt,9788702044444,,8.00,3.5
```

Book data stays as the owner writes it (Danish titles and genres are content, not UI copy). Rows 2–4 import (row 4 shows as Sold out; an empty genre would show as Other). Row 5 is rejected: "Count must be a whole number".
