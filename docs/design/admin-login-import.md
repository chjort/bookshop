# Design: admin login and catalogue import

Feature: #6 · Task: #8 · Release 1 (walking skeleton) · Author: pro-designer

## 1. Purpose

The owner logs in to a private admin area and uploads the stock CSV. Books are created or updated by ISBN. Rows that can't be imported are listed with a reason; the rest are still imported. The UI is in Danish.

Scope for Release 1: one owner account, login, logout, admin home with nav, CSV upload, import result. No password reset, no user management. Exact CSV headers, size limits, rate limiting and sync vs. background import follow pro-architect's contract (no ADR exists yet); this spec covers both a quick and a long-running import.

## 2. User flow

```mermaid
flowchart TD
    A[/admin/*] --> B{Logged in?}
    B -- no --> L[Login page]
    B -- yes --> H[Admin home]
    L -->|submit| V{Credentials ok?}
    V -- no --> LE[Login error, stay on page]
    LE --> L
    V -- too many tries --> RL[Rate limit message]
    V -- yes --> R[Return to requested page or admin home]
    R --> H
    H --> U[Import page]
    U -->|choose file| F{Client check: .csv, not empty}
    F -- fails --> FE[Inline file error]
    FE --> U
    F -- ok --> S[Upload + import in progress]
    S --> X{Server result}
    X -- file rejected: encoding, headers, too big --> TF[Total failure: nothing imported]
    X -- all rows ok --> OK[Success summary]
    X -- some rows rejected --> PF[Partial result + row error table]
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
|  Påkrævede kolonner: titel, forfatter, ISBN, genre,           |
|  pris (EUR), lager.  (exact headers: see architect contract)  |
|                                                               |
|  CSV-fil                                                      |
|  +--------------------------------------------------------+  |
|  | [Vælg fil]  boeger.csv (412 KB)                        |  |
|  |  eller træk filen hertil                               |  |
|  +--------------------------------------------------------+  |
|  Kun .csv, UTF-8.                                             |
|                                                               |
|  [ Importer ]                                                 |
+--------------------------------------------------------------+
```

The drop zone is optional sugar. The real control is a native `<input type="file" accept=".csv,text/csv">` with a visible label.

### 3.4 In progress

```
|  Importerer boeger.csv …                                      |
|  [■■■■■■■■■□□□□□□□]  2.400 af 4.000 rækker                    |  <- if progress known
|  Du kan blive på siden. Luk ikke vinduet.                     |
|  [ Importer ] (disabled)                                      |
```

If the backend gives no progress, show an indeterminate spinner and "Importerer … det kan tage op til et minut."

### 3.5 Import result

```
+--------------------------------------------------------------+
|  Import færdig: boeger.csv                                    |
|                                                               |
|  +-----------+  +-----------+  +-----------+                 |
|  | 3.912     |  | 61        |  | 27        |                 |
|  | oprettet  |  | opdateret |  | afvist    |                 |
|  +-----------+  +-----------+  +-----------+                 |
|                                                               |
|  Afviste rækker (27)                      [Download som CSV]  |
|  +-------+---------------+---------------------------------+ |
|  | Række | ISBN          | Årsag                           | |
|  +-------+---------------+---------------------------------+ |
|  | 14    | 978-87-1234   | Ugyldigt ISBN                   | |
|  | 230   | 9788702011111 | Pris mangler                    | |
|  | 231   | 9788702022222 | Lager kan ikke være negativt    | |
|  | …     |               |                                 | |
|  +-------+---------------+---------------------------------+ |
|  Viser 1–50 af 27  [Forrige] [Næste]                          |
|                                                               |
|  [ Importer en ny fil ]                                       |
+--------------------------------------------------------------+
```

Row numbers count the header as row 1, so they match what the owner sees in a spreadsheet. "Download som CSV" is nice to have; drop it if the contract doesn't support it.

## 4. UI states

| State | What the user sees |
|---|---|
| Empty (no import yet) | Home: "Ingen bøger endnu. Importer din første CSV-fil." Import page: upload form only. |
| Loading (login) | Button shows "Logger ind …", disabled. |
| Loading (import) | Section 3.4. Form disabled; double submit not possible. |
| Success | Section 3.5 with 0 rejected; green banner "Alle rækker blev importeret." |
| Partial failure | Section 3.5 with rejected table; amber banner "X rækker blev ikke importeret. Resten er importeret." |
| Total failure | Red banner with reason (see 5); "Intet blev importeret." Form stays with file cleared. |
| Auth error | Login banner "Forkert brugernavn eller adgangskode." Password cleared, username kept, focus to banner. |
| Session expired | Redirect to login with info banner "Du er blevet logget ud. Log ind igen." After login, return to the page. If it expired mid-upload, say "Importen blev ikke gennemført. Upload filen igen." |
| Rate limit / lockout (if the architect adds it) | "For mange forsøg. Prøv igen om {n} minutter." Button disabled until then. |
| Network / server error | "Noget gik galt. Prøv igen." with [Prøv igen]. |
| Not logged in on any /admin URL | Redirect to login; never flash admin content. |

## 5. Edge cases

| Case | Handling | Danish message |
|---|---|---|
| Wrong file type (.xlsx, .txt) | Client blocks before upload; server checks too. | "Filen skal være en CSV-fil (.csv)." |
| Empty file / header only | Total failure. | "Filen er tom." / "Filen indeholder ingen bøger." |
| Huge file (thousands of rows) | Must not time out (AC4). Show progress/spinner; keep the UI responsive; paginate the rejected table at 50 rows. | "Importerer … det kan tage op til et minut." |
| Too big over server limit | Total failure. | "Filen er for stor. Maks {størrelse}." |
| Missing required column | Total failure, name the missing columns. | "Kolonnen ‘{navn}’ mangler. Påkrævede kolonner: …" |
| Unknown extra columns | Ignored, no error. | — |
| Bad ISBN (wrong length or checksum) | Row rejected. | "Ugyldigt ISBN" |
| Missing ISBN | Row rejected. | "ISBN mangler" |
| ISBN already in shop | Update the book (counts as "opdateret"). | — |
| Same ISBN twice in one file | Follow architect; suggested: last row wins and the earlier one is listed. | "ISBN optræder flere gange i filen; række {n} blev brugt" |
| Price with comma (`12,50`) or dot (`12.50`) | Accept both if the contract allows; else reject the row. | "Ugyldig pris: ‘{værdi}’" |
| Missing / zero / negative price | Row rejected (zero: architect decides). | "Pris mangler" / "Pris skal være større end 0" |
| Negative or non-integer stock | Row rejected. | "Lager kan ikke være negativt" / "Lager skal være et helt tal" |
| Missing title | Row rejected. | "Titel mangler" |
| Non-UTF-8 encoding (e.g. Windows-1252 from Excel) | Total failure unless backend detects it. Never import mojibake (Ã¦ for æ). | "Filen er ikke i UTF-8. Gem den som ‘CSV UTF-8’ og prøv igen." |
| Semicolon delimiter (Danish Excel default) | Follow architect; if unsupported, total failure. | "Filen bruger semikolon. Brug komma som skilletegn." |
| Every row rejected | Partial result screen with 0/0/N and red banner. | "Ingen rækker blev importeret." |

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
| Session expired | Du er blevet logget ud. Log ind igen. |
| Rate limit | For mange forsøg. Prøv igen om {n} minutter. |
| Nav | Import · Ordrer · Log ud |
| Home heading | Velkommen |
| Catalogue card | Katalog · {n} bøger · Sidste import: {dato} kl. {tid} |
| Empty catalogue | Ingen bøger endnu. Importer din første CSV-fil. |
| Import heading | Importer katalog |
| Import intro | Upload din CSV-fil. Bøger opdateres ud fra ISBN: findes ISBN, opdateres bogen; ellers oprettes den. |
| File label / hint | CSV-fil / Kun .csv, UTF-8. |
| Choose file / drop | Vælg fil / eller træk filen hertil |
| Import button / busy | Importer / Importerer … |
| Result heading | Import færdig: {filnavn} |
| Counters | oprettet · opdateret · afvist |
| All ok | Alle rækker blev importeret. |
| Partial | {n} rækker blev ikke importeret. Resten er importeret. |
| Total failure | Intet blev importeret. |
| Rejected table | Afviste rækker · Række · ISBN · Årsag |
| Pager | Viser {a}–{b} af {n} · Forrige · Næste |
| Again | Importer en ny fil |
| Generic error | Noget gik galt. Prøv igen. · Prøv igen |
| Logged out | Du er logget ud. |

Numbers use Danish formatting: `3.912`, `12,50 €`, dates `19.10.2026`.

## 7. Accessibility (WCAG 2.1 AA)

- `lang="da"` on the document.
- Every input has a visible `<label for>`; no placeholder-only labels. Username `autocomplete="username"`, password `autocomplete="current-password"`.
- Focus order follows reading order: nav → heading → form fields → button → results. Visible focus ring, at least 3:1 contrast.
- Errors: login and import banners use `role="alert"`; progress and result summary sit in an `aria-live="polite"` region. Field errors are linked with `aria-describedby` and set `aria-invalid="true"`. After a failed submit, focus moves to the error banner.
- File upload works by keyboard alone: native file input, reachable with Tab and opened with Enter/Space. Drag and drop is never the only way.
- Disabled buttons during loading keep `aria-busy="true"` on the form; the button text change is announced.
- Progress bar uses `<progress>` or `role="progressbar"` with `aria-valuenow`/`aria-valuemax`.
- Result counters are text, not colour only; banners pair colour with an icon and words. Text contrast at least 4.5:1, UI components 3:1.
- Rejected rows table is a real `<table>` with `<th scope="col">` and a `<caption>`.
- Page `<title>` changes per page: "Log ind – Administration", "Importer katalog – Administration", "Import færdig – Administration".
- Show password toggle is a `<button>` with `aria-pressed`.
- Layout reflows at 320 px width and 200 % zoom without horizontal scroll (table may scroll in its own container).

## 8. Acceptance criteria mapping (#6)

| Acceptance criterion | Spec sections |
|---|---|
| Only the owner can reach admin pages, after logging in. | 2 (auth gate), 3.1, 3.2, 4 (auth error, session expired, not logged in, rate limit), 7 |
| Uploading the CSV creates or updates books by ISBN. | 3.3, 3.5 (oprettet / opdateret), 5 (ISBN already in shop, duplicate ISBN) |
| Rows that can't be imported are listed with the reason, and the rest are still imported. | 3.5 (rejected table), 4 (partial failure), 5 (row-level errors), 6 |
| A file with thousands of rows imports without timing out. | 3.4, 4 (loading), 5 (huge file) |

## 9. Open questions

1. Exact CSV headers and delimiter (comma vs semicolon). The example CSV has only title, author, ISBN, genre: no price or stock columns (pro-qa asked the user).
2. Price format: accept both `12,50` and `12.50`?
3. Duplicate ISBN within one file: last row wins, or reject both?
4. Sync import or background job with progress? Max file size?
5. Login rate limit/lockout in Release 1?
6. Is a price of 0 valid? Is a missing genre allowed?
7. Is the login a username or an email?
