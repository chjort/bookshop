# Design: admin login and catalogue import

Feature: #6 · Task: #8 · Release 1 (walking skeleton) · Author: pro-designer

## 1. Purpose

The owner logs in to a private admin area and uploads the stock CSV. Books are created or updated by ISBN. Per pro-architect (#7) the import is all-or-nothing: if any row fails, nothing is imported and every failing row is listed with its reason. See 9.7 for the conflict with AC3. The UI is in Danish.

Scope for Release 1: one owner account, login, logout, admin home with nav, CSV upload, import result. No password reset, no user management. Headers are matched case-insensitively; comma and semicolon separators are both accepted. Known headers: `title,author,ISBN,genre`; price and stock header names are pending the user. The import is one synchronous request taking a few seconds; the UI shows a spinner (no progress bar) and then a result summary. Max file size 5 MB, UTF-8 only. Login is by username; 5 failed logins lock login for 15 minutes, shown with the same generic error. Sessions last 7 days.

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
    X -- file rejected: encoding, headers, over 5 MB --> TF[File error: nothing imported]
    X -- all rows ok --> OK[Success summary]
    X -- any row invalid --> RF[Row errors: nothing imported + row error table]
    RF --> U
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
|  Påkrævede kolonner: title, author, ISBN, genre, + pris og    |
|  lager (navne afventer). Store/små bogstaver er ligegyldige.  |
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

Success (every row valid):

```
+--------------------------------------------------------------+
|  [✓] Import færdig: boeger.csv                                |
|  +-----------+  +-----------+                                 |
|  | 3.912     |  | 61        |                                 |
|  | oprettet  |  | opdateret |                                 |
|  +-----------+  +-----------+                                 |
|  [ Importer en ny fil ]                                       |
+--------------------------------------------------------------+
```

Row errors (any row invalid, nothing imported):

```
+--------------------------------------------------------------+
|  [!] Intet blev importeret. 27 rækker har fejl.               |
|      Ret rækkerne i filen og upload den igen.                 |
|                                                               |
|  Rækker med fejl (27)                                         |
|  +-------+---------------+---------------------------------+ |
|  | Række | ISBN          | Årsag                           | |
|  +-------+---------------+---------------------------------+ |
|  | 14    | 978-87-1234   | Ugyldigt ISBN                   | |
|  | 230   | 9788702011111 | Pris mangler                    | |
|  | 231   | 9788702022222 | Lager kan ikke være negativt    | |
|  | 410   | 9788702033333 | ISBN står flere gange (række 410 og 977) | |
|  | 977   | 9788702033333 | ISBN står flere gange (række 410 og 977) | |
|  +-------+---------------+---------------------------------+ |
|  Viser 1–27 af 27  [Forrige] [Næste]                          |
|  [ Upload rettet fil ]                                        |
+--------------------------------------------------------------+
```

Row numbers count the header as row 1, matching a spreadsheet. The table pages at 50 rows.

## 4. UI states

| State | What the user sees |
|---|---|
| Empty (no import yet) | Home: "Ingen bøger endnu. Importer din første CSV-fil." Import page: upload form only. |
| Loading (login) | Button shows "Logger ind …", disabled. |
| Loading (import) | Spinner and "Importerer {filnavn} … Det tager et par sekunder." Form disabled; no double submit. No progress bar. |
| Success | Section 3.5 success: counts created and updated; green banner "Alle rækker blev importeret." |
| Row errors (all-or-nothing) | Section 3.5 row errors: red banner "Intet blev importeret. {n} rækker har fejl." plus the full list of failing rows. The catalogue is unchanged. |
| File error | Red banner with the reason (too big, not UTF-8, wrong type, empty, missing column) and "Intet blev importeret." File cleared. |
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
| Price with comma (`12,50`) or dot (`12.50`) | Both accepted. Anything else unparseable is rejected. | "Ugyldig pris: ‘{værdi}’" |
| Missing / zero / negative price | Row rejected. 0 is invalid. | "Pris mangler" / "Pris skal være større end 0" |
| Empty genre | Allowed; shown as "Øvrige". | — |
| Header case (`ISBN`, `isbn`, `Isbn`) | Matched case-insensitively. | — |
| Negative or non-integer stock | Row rejected. | "Lager kan ikke være negativt" / "Lager skal være et helt tal" |
| Missing title | Row rejected. | "Titel mangler" |
| Not UTF-8 (e.g. Windows-1252 from Excel) | File rejected; nothing imported. Never import garbled characters (Ã¦ for æ). | "Filen er ikke gemt som UTF-8. Gem den som ‘CSV UTF-8’ i Excel, og prøv igen." |
| Comma or semicolon separator | Both accepted. | — |
| One or more rows invalid | Whole file rejected (all-or-nothing); every failing row listed. | "Intet blev importeret. {n} rækker har fejl." |

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
| Counters | oprettet · opdateret |
| All ok | Alle rækker blev importeret. |
| Row errors | Intet blev importeret. {n} rækker har fejl. Ret rækkerne i filen og upload den igen. |
| Total failure | Intet blev importeret. |
| Error table | Rækker med fejl · Række · ISBN · Årsag |
| Retry | Upload rettet fil |
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
| Uploading the CSV creates or updates books by ISBN. | 3.3, 3.5 (oprettet / opdateret), 5 (ISBN already in shop, header case, separators, price format), 9.1–9.2 |
| Rows that can't be imported are listed with the reason, and the rest are still imported. | 3.5 (row errors), 4 (row errors), 5, 6. **Partly met:** rows are listed with reasons, but per #7 the rest are *not* imported (all-or-nothing). See 9.7. |
| A file with thousands of rows imports without timing out. | 3.4, 4 (loading), 5 (large file, over 5 MB), 9.4, 9.8 |

## 9. Resolved decisions

Answered by pro-product-owner.

1. **Headers and separators:** headers matched case-insensitively; comma or semicolon accepted. Sample file is comma-separated with `title,author,ISBN,genre`. Price and stock header names are pending the user.
2. **Price format:** `12,50` and `12.50` are both accepted.
3. **Duplicate ISBN in one file:** all rows with that ISBN are rejected and each is listed in the error table.
4. **Large files:** a few thousand rows import without timing out, with clear progress and a result summary. pro-architect decides how.
5. **Login:** username (Brugernavn). Lockout after repeated failures, with a Danish lockout message (section 4).
6. **Row rules:** price 0 is invalid. Empty genre is allowed and shown as "Øvrige".

From pro-architect (#7):

7. **All-or-nothing import:** one synchronous request. If any row fails, nothing is imported and every failing row is listed. **This conflicts with AC3 on #6 ("the rest are still imported") and with decision 3's wording.** pro-product-owner needs to update the AC or ask pro-architect to change the decision.
8. **File limits:** at most 5 MB, UTF-8 only. Spinner during the import of a few seconds, no progress bar (this replaces decision 4's progress requirement).
9. **Lockout:** 5 failed logins lock login for 15 minutes. While locked, the same generic login error is shown (this replaces the separate lockout message).
10. **Session:** lasts 7 days, then the session-expired state applies.

Still open: price and stock header names (waiting on the user); the AC3 conflict (decision 7).
