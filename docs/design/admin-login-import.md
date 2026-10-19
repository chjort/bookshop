# Design: admin login and catalogue import

Feature: #6 · Task: #8 · Release 1 (walking skeleton) · Author: pro-designer

## 1. Purpose

The owner logs in to a private admin area and uploads the stock CSV. Books are created or updated by ISBN. Valid rows are imported; invalid rows are skipped and listed with their reason (AC3). Only file-level problems (not UTF-8, missing headers, over 5 MB) reject the whole file. The UI is in Danish.

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
    H -->|Log ud| L
```

## 3. Wireframes

### 3.1 Login (`/admin/login`)

```
+--------------------------------------------------+
|  Boghandel · Administration                      |
+--------------------------------------------------+
|                                                  |
|   Log ind                                        |
|                                                  |
|   [!] Forkert brugernavn eller adgangskode.      |  <- error banner, role=alert
|                                                  |
|   Brugernavn                                     |
|   [______________________________]               |
|                                                  |
|   Adgangskode                                    |
|   [______________________________] [Vis]         |
|                                                  |
|   [ Log ind ]                                    |
|                                                  |
+--------------------------------------------------+
```

### 3.2 Admin home and nav (`/admin`)

```
+--------------------------------------------------------------+
| Boghandel · Administration   Import | Ordrer      [Log ud]   |
+--------------------------------------------------------------+
|  Velkommen                                                    |
|                                                               |
|  +----------------------+   +----------------------+         |
|  | Katalog              |   | Ordrer               |         |
|  | 1.243 bøger          |   | (kommer i feature 5) |         |
|  | Sidste import:       |   |                      |         |
|  | 19.10.2026 kl. 21:14 |   |                      |         |
|  | [Importer CSV]       |   | [Se ordrer]          |         |
|  +----------------------+   +----------------------+         |
+--------------------------------------------------------------+
```

The nav is shared by all admin pages. "Ordrer" links to the order list from feature 5; hide it until that exists.

### 3.3 Import upload (`/admin/import`)

```
+--------------------------------------------------------------+
| Boghandel · Administration   Import | Ordrer      [Log ud]   |
+--------------------------------------------------------------+
|  Importer katalog                                             |
|                                                               |
|  Upload din CSV-fil. Bøger opdateres ud fra ISBN: findes      |
|  ISBN, opdateres bogen; ellers oprettes den.                  |
|                                                               |
|  Påkrævede kolonner: title, author, ISBN, genre, price,       |
|  count. Store/små bogstaver er ligegyldige.                  |
|  Komma eller semikolon som skilletegn.                        |
|                                                               |
|  CSV-fil                                                      |
|  +--------------------------------------------------------+  |
|  | [Vælg fil]  boeger.csv (412 KB)                        |  |
|  |  eller træk filen hertil                               |  |
|  +--------------------------------------------------------+  |
|  Kun .csv, UTF-8, højst 5 MB.                                 |
|                                                               |
|  [ Importer ]                                                 |
+--------------------------------------------------------------+
```

The drop zone is optional sugar. The real control is a native `<input type="file" accept=".csv,text/csv">` with a visible label.

### 3.4 In progress

```
|  (spinner)  Importerer boeger.csv …                          |
|  Det tager et par sekunder. Luk ikke vinduet.                 |
|  [ Importerer … ] (disabled)                                  |
```

Spinner only, no progress bar: the import is one synchronous request of a few seconds (pro-architect, #7).

### 3.5 Import result

```
+--------------------------------------------------------------+
|  Import færdig: boeger.csv                                    |
|  [!] 27 rækker blev ikke importeret. Resten er importeret.    |
|                                                               |
|  +-----------+  +-----------+  +-----------+                 |
|  | 3.912     |  | 61        |  | 27        |                 |
|  | oprettet  |  | opdateret |  | afvist    |                 |
|  +-----------+  +-----------+  +-----------+                 |
|                                                               |
|  Afviste rækker (27)                                          |
|  +-------+---------------+---------------------------------+ |
|  | Række | ISBN          | Årsag                           | |
|  +-------+---------------+---------------------------------+ |
|  | 14    | 978-87-1234   | Ugyldigt ISBN                   | |
|  | 230   | 9788702011111 | Pris mangler                    | |
|  | 231   | 9788702022222 | Antal kan ikke være negativt    | |
|  | 232   | 9788702044444 | Antal skal være et helt tal     | |
|  | 410   | 9788702033333 | ISBN står flere gange (række 410 og 977) | |
|  | 977   | 9788702033333 | ISBN står flere gange (række 410 og 977) | |
|  +-------+---------------+---------------------------------+ |
|  Viser 1–27 af 27  [Forrige] [Næste]                          |
|  [ Importer en ny fil ]                                       |
+--------------------------------------------------------------+
```

With no skipped rows, the banner is green ("Alle rækker blev importeret.") and the table is hidden; "afvist" shows 0. Row numbers count the header as row 1, matching a spreadsheet. The table pages at 50 rows.

## 4. UI states

| State | What the user sees |
|---|---|
| Empty (no import yet) | Home: "Ingen bøger endnu. Importer din første CSV-fil." Import page: upload form only. |
| Loading (login) | Button shows "Logger ind …", disabled. |
| Loading (import) | Spinner and "Importerer {filnavn} … Det tager et par sekunder." Form disabled; no double submit. No progress bar. |
| Success | Section 3.5 with afvist 0; green banner "Alle rækker blev importeret." |
| Partial success | Section 3.5: valid rows imported; amber banner "{n} rækker blev ikke importeret. Resten er importeret." plus the skipped rows table. |
| No valid rows | Section 3.5 with 0 oprettet, 0 opdateret; red banner "Ingen rækker blev importeret." plus the table. |
| File error (whole file rejected) | Red banner with the reason (over 5 MB, not UTF-8, missing headers; also wrong type or empty) and "Intet blev importeret." File cleared. |
| Auth error | "Forkert brugernavn eller adgangskode." Password cleared, username kept, focus to banner. |
| Lockout (5 failures, 15 min) | Exactly the same as auth error: same generic message, form stays enabled. No separate lockout message, so the lock isn't revealed (pro-architect, #7). |
| Session expired (after 7 days) | Redirect to login with info banner "Din session er udløbet. Log ind igen." After login, return to the requested page. If it expired during an upload: "Importen blev ikke gennemført. Upload filen igen." |
| Network / server error | "Noget gik galt. Prøv igen." with [Prøv igen]. |
| Not logged in on any /admin URL | Redirect to login; admin content never flashes. |

## 5. Edge cases

| Case | Handling | Danish message |
|---|---|---|
| Wrong file type (.xlsx, .txt) | Client blocks before upload; server checks too. | "Filen skal være en CSV-fil (.csv)." |
| Empty file / header only | Total failure. | "Filen er tom." / "Filen indeholder ingen bøger." |
| Large file (a few thousand rows, under 5 MB) | One synchronous request; must not time out (AC4). Show the spinner; keep the UI responsive; paginate the rejected table at 50 rows. | "Importerer … det kan tage op til et minut." |
| File over 5 MB | Client blocks before upload; server rejects too. | "Filen er for stor. Den må højst være 5 MB." |
| Missing required column | Total failure, name the missing columns. | "Kolonnen ‘{navn}’ mangler. Påkrævede kolonner: …" |
| Unknown extra columns | Ignored, no error. | — |
| Bad ISBN (wrong length or checksum) | Row rejected. | "Ugyldigt ISBN" |
| Missing ISBN | Row rejected. | "ISBN mangler" |
| ISBN already in shop | Update the book (counts as "opdateret"). | — |
| Same ISBN twice (or more) in one file | Reject every row with that ISBN; list each one. | "ISBN står flere gange (række {a} og {b})" |
| Price with dot (`12.50`, the owner's format) or comma (`12,50`) | Both accepted. Anything else unparseable is rejected. | "Ugyldig pris: ‘{værdi}’" |
| Missing / zero / negative price | Row rejected. 0 is invalid. | "Pris mangler" / "Pris skal være større end 0" |
| Empty genre | Allowed; shown as "Øvrige". | — |
| Header case (`ISBN`, `isbn`, `Isbn`) | Matched case-insensitively. | — |
| `count` written as `3` or `3.0` | Accepted as 3. | — |
| Fractional `count` (`3.5`) | Row rejected. | "Antal skal være et helt tal" |
| Negative `count` (`-1`, `-1.0`) | Row rejected. 0 is valid (shown as Udsolgt). | "Antal kan ikke være negativt" |
| Missing or unparseable `count` | Row rejected. | "Antal mangler" / "Ugyldigt antal: ‘{værdi}’" |
| Missing title | Row rejected. | "Titel mangler" |
| Not UTF-8 (e.g. Windows-1252 from Excel) | File rejected; nothing imported. Never import garbled characters (Ã¦ for æ). | "Filen er ikke gemt som UTF-8. Gem den som ‘CSV UTF-8’ i Excel, og prøv igen." |
| Comma or semicolon separator | Both accepted. | — |
| One or more rows invalid | Those rows skipped and listed; valid rows imported. | "{n} rækker blev ikke importeret. Resten er importeret." |
| Every row invalid | Nothing imported; all rows listed. | "Ingen rækker blev importeret." |

## 6. Danish UI copy

| Key | Danish |
|---|---|
| App title | Boghandel · Administration |
| Login heading | Log ind |
| Username label | Brugernavn |
| Password label | Adgangskode |
| Show/hide password | Vis / Skjul |
| Login button / busy | Log ind / Logger ind … |
| Login error | Forkert brugernavn eller adgangskode. |
| Required field | Udfyld {felt}. |
| Session expired | Din session er udløbet. Log ind igen. |
| Lockout | (same as login error) |
| Empty genre | Øvrige |
| Duplicate ISBN | ISBN står flere gange (række {a} og {b}) |
| Count not whole | Antal skal være et helt tal |
| Count negative | Antal kan ikke være negativt |
| Count missing / invalid | Antal mangler / Ugyldigt antal: ‘{værdi}’ |
| Import busy | Importerer {filnavn} … Det tager et par sekunder. |
| Nav | Import · Ordrer · Log ud |
| Home heading | Velkommen |
| Catalogue card | Katalog · {n} bøger · Sidste import: {dato} kl. {tid} |
| Empty catalogue | Ingen bøger endnu. Importer din første CSV-fil. |
| Import heading | Importer katalog |
| Import intro | Upload din CSV-fil. Bøger opdateres ud fra ISBN: findes ISBN, opdateres bogen; ellers oprettes den. |
| File label / hint | CSV-fil / Kun .csv, UTF-8, højst 5 MB. |
| Too big | Filen er for stor. Den må højst være 5 MB. |
| Not UTF-8 | Filen er ikke gemt som UTF-8. Gem den som ‘CSV UTF-8’ i Excel, og prøv igen. |
| Choose file / drop | Vælg fil / eller træk filen hertil |
| Import button / busy | Importer / Importerer … |
| Result heading | Import færdig: {filnavn} |
| Counters | oprettet · opdateret · afvist |
| All ok | Alle rækker blev importeret. |
| Partial | {n} rækker blev ikke importeret. Resten er importeret. |
| No valid rows | Ingen rækker blev importeret. |
| Total failure | Intet blev importeret. |
| Skipped table | Afviste rækker · Række · ISBN · Årsag |
| Pager | Viser {a}–{b} af {n} · Forrige · Næste |
| Again | Importer en ny fil |
| Generic error | Noget gik galt. Prøv igen. · Prøv igen |
| Logged out | Du er logget ud. |

Numbers use Danish formatting: `3.912`, `12,50 €`, dates `19.10.2026`.

## 7. Accessibility (WCAG 2.1 AA)

- `lang="da"` on the document.
- Every input has a visible `<label for>`; no placeholder-only labels. Username `autocomplete="username"`, password `autocomplete="current-password"`.
- Focus order follows reading order: nav → heading → form fields → button → results. Visible focus ring, at least 3:1 contrast.
- Errors: login and import banners use `role="alert"`; import status and result summary sit in an `aria-live="polite"` region. Field errors are linked with `aria-describedby` and set `aria-invalid="true"`. After a failed submit, focus moves to the error banner.
- File upload works by keyboard alone: native file input, reachable with Tab and opened with Enter/Space. Drag and drop is never the only way.
- The spinner has `role="status"` with the text "Importerer …", so screen readers announce it; the animation respects `prefers-reduced-motion`.
- Disabled buttons during loading keep `aria-busy="true"` on the form; the button text change is announced.
- Result counters are text, not colour only; banners pair colour with an icon and words. Text contrast at least 4.5:1, UI components 3:1.
- Rejected rows table is a real `<table>` with `<th scope="col">` and a `<caption>`.
- Page `<title>` changes per page: "Log ind – Administration", "Importer katalog – Administration", "Import færdig – Administration".
- Show password toggle is a `<button>` with `aria-pressed`.
- Layout reflows at 320 px width and 200 % zoom without horizontal scroll (table may scroll in its own container).

## 8. Acceptance criteria mapping (#6)

| Acceptance criterion | Spec sections |
|---|---|
| Only the owner can reach admin pages, after logging in. | 2 (auth gate), 3.1, 3.2, 4 (auth error, lockout, session expired, not logged in), 7, 9.5, 9.9–9.10 |
| Uploading the CSV creates or updates books by ISBN. | 3.3, 3.5 (oprettet / opdateret), 5 (ISBN already in shop, header case, separators, price format, count format), 9.1–9.2, 9.11 |
| Rows that can't be imported are listed with the reason, and the rest are still imported. | 3.5, 4 (partial success, no valid rows), 5 (row-level errors), 6, 9.3, 9.6, 9.7. **Fully met.** |
| A file with thousands of rows imports without timing out. | 3.4, 4 (loading), 5 (large file, over 5 MB), 9.4, 9.8 |

## 9. Resolved decisions

Answered by pro-product-owner.

1. **Headers and separators:** headers matched case-insensitively; comma or semicolon accepted. Required columns are `title,author,ISBN,genre,price,count` (confirmed by the user). Stock is `count`, not `quantity`.
2. **Price format:** the owner writes `12.50` (dot). `12,50` (comma) is still accepted.
3. **Duplicate ISBN in one file:** all rows with that ISBN are rejected and each is listed in the error table.
4. **Large files:** a few thousand rows import without timing out, with clear progress and a result summary. pro-architect decides how.
5. **Login:** username (Brugernavn). Lockout after repeated failures, with a Danish lockout message (section 4).
6. **Row rules:** price 0 is invalid. Empty genre is allowed and shown as "Øvrige".

From pro-architect (#7):

7. **Partial import (AC3 stands, ruled by pro-product-owner):** one synchronous request with a spinner. Valid rows are imported; invalid rows are skipped and listed with reasons. Only file-level problems reject the whole file: not UTF-8, missing headers, or over 5 MB. This replaces pro-architect's all-or-nothing proposal.
8. **File limits:** at most 5 MB, UTF-8 only. Spinner during the import of a few seconds, no progress bar (this replaces decision 4's progress requirement).
9. **Lockout:** 5 failed logins lock login for 15 minutes. While locked, the same generic login error is shown (this replaces the separate lockout message).
10. **Session:** lasts 7 days, then the session-expired state applies.

From the user and pro-product-owner:

11. **Count format:** `count` values may be decimals. `3` and `3.0` are both 3. Any fractional value (`3.5`) rejects the row with "Antal skal være et helt tal". Negative values reject the row.

Nothing is open.

## 10. Example CSV

```csv
title,author,ISBN,genre,price,count
Kongens Fald,Johannes V. Jensen,9788702011111,Klassikere,12.50,3
Hærværk,Tom Kristensen,9788702022222,Klassikere,9.95,1.0
Ternet Ninja,Anders Matthesen,9788702033333,Børn,15.00,0
Halv bog,Ukendt,9788702044444,,8.00,3.5
```

Rows 2–4 import (row 4 shows as Udsolgt; empty genre would show as Øvrige). Row 5 is rejected: "Antal skal være et helt tal".
