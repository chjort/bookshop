# Design: admin login and catalogue import

Feature: #6 · Task: #8 · Release 1 (walking skeleton) · Author: pro-designer

## 1. Purpose

The owner logs in to a private admin area and uploads the stock CSV. Books are created or updated by ISBN. Rows that can't be imported are listed with a reason; the rest are still imported. The UI is in Danish.

Scope for Release 1: one owner account, login, logout, admin home with nav, CSV upload, import result. No password reset, no user management. Headers are matched case-insensitively; comma and semicolon separators are both accepted. Known headers: `title,author,ISBN,genre`; price and stock header names are pending the user. How a few thousand rows import without timing out is pro-architect's call; the UI always shows progress and a result summary. Login is by username, with lockout after repeated failures (thresholds per pro-architect).

## 2. User flow

```mermaid
flowchart TD
    A[/admin/*] --> B{Logged in?}
    B -- no --> L[Login page]
    B -- yes --> H[Admin home]
    L -->|submit| V{Credentials ok?}
    V -- no --> LE[Login error, stay on page]
    LE --> L
    V -- too many failures --> RL[Lockout message]
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
|  Påkrævede kolonner: title, author, ISBN, genre, + pris og    |
|  lager (navne afventer). Store/små bogstaver er ligegyldige.  |
|  Komma eller semikolon som skilletegn.                        |
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
|  [■■■■■■■■■□□□□□□□]  2.400 af 4.000 rækker                    |
|  Du kan blive på siden. Luk ikke vinduet.                     |
|  [ Importer ] (disabled)                                      |
```

Progress is required. Show rows processed of total when the backend reports it. If it can only report phases, show the phase ("Læser fil …", "Gemmer bøger …") with an indeterminate bar. pro-architect chooses the mechanism.

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
|  | 410   | 9788702033333 | ISBN står flere gange (række 410 og 977) | |
|  | 977   | 9788702033333 | ISBN står flere gange (række 410 og 977) | |
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
| Lockout | After repeated failed logins: red banner "For mange mislykkede forsøg. Login er spærret i {n} minutter." Fields and button disabled until then. Same message whether or not the username exists. |
| Network / server error | "Noget gik galt. Prøv igen." with [Prøv igen]. |
| Not logged in on any /admin URL | Redirect to login; never flash admin content. |

## 5. Edge cases

| Case | Handling | Danish message |
|---|---|---|
| Wrong file type (.xlsx, .txt) | Client blocks before upload; server checks too. | "Filen skal være en CSV-fil (.csv)." |
| Empty file / header only | Total failure. | "Filen er tom." / "Filen indeholder ingen bøger." |
| Large file (a few thousand rows) | Must not time out (AC4). Show progress; keep the UI responsive; paginate the rejected table at 50 rows. | "Importerer … det kan tage op til et minut." |
| Too big over server limit | Total failure. | "Filen er for stor. Maks {størrelse}." |
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
| Non-UTF-8 encoding (e.g. Windows-1252 from Excel) | Total failure unless backend detects it. Never import mojibake (Ã¦ for æ). | "Filen er ikke i UTF-8. Gem den som ‘CSV UTF-8’ og prøv igen." |
| Comma or semicolon separator | Both accepted. | — |
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
| Lockout | For mange mislykkede forsøg. Login er spærret i {n} minutter. |
| Empty genre | Øvrige |
| Duplicate ISBN | ISBN står flere gange (række {a} og {b}) |
| Progress | {a} af {n} rækker · Læser fil … · Gemmer bøger … |
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
| Only the owner can reach admin pages, after logging in. | 2 (auth gate), 3.1, 3.2, 4 (auth error, session expired, not logged in, lockout), 7, 9.5 |
| Uploading the CSV creates or updates books by ISBN. | 3.3, 3.5 (oprettet / opdateret), 5 (ISBN already in shop, header case, separators, price format), 9.1–9.2 |
| Rows that can't be imported are listed with the reason, and the rest are still imported. | 3.5 (rejected table incl. duplicates), 4 (partial failure), 5 (row-level errors), 6, 9.3, 9.6 |
| A file with thousands of rows imports without timing out. | 3.4, 4 (loading), 5 (large file), 9.4 |

## 9. Resolved decisions

Answered by pro-product-owner.

1. **Headers and separators:** headers matched case-insensitively; comma or semicolon accepted. Sample file is comma-separated with `title,author,ISBN,genre`. Price and stock header names are pending the user.
2. **Price format:** `12,50` and `12.50` are both accepted.
3. **Duplicate ISBN in one file:** all rows with that ISBN are rejected and each is listed in the error table.
4. **Large files:** a few thousand rows import without timing out, with clear progress and a result summary. pro-architect decides how.
5. **Login:** username (Brugernavn). Lockout after repeated failures, with a Danish lockout message (section 4).
6. **Row rules:** price 0 is invalid. Empty genre is allowed and shown as "Øvrige".

Still open: price and stock header names (waiting on the user); lockout threshold and duration (pro-architect).
