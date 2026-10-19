# Design: cart and bitcoin checkout

Feature: #18 · Task: #20 · Release 1 (walking skeleton) · Author: pro-designer

## 1. Purpose

Customers put books in a cart, enter name, email and a Danish address, see the total with flat shipping in EUR and BTC, place the order, and get the owner's bitcoin address and the order number to pay with. There is no payment processing in the shop: the customer sends BTC from their own wallet and the owner marks the order paid by hand. Placing the order reserves stock; the owner cancelling an unpaid order releases it. Denmark only. UI in Danish; shop name stays the placeholder "Boghandel".

Architecture: ADR 0001 (PR #44) states the bitcoin address is configuration (`BTC_ADDRESS`), no private keys are stored, and the backend calls a BTC/EUR rate API. No ADR yet covers rate locking, rounding, cart storage or the order API; these are open questions (section 10). Endpoints and data follow pro-architect's contract.

## 2. User flow

```mermaid
flowchart TD
    B[Bogside / liste] -->|Læg i kurv, kun hvis på lager| C[Kurv]
    C -->|Ændr antal / Fjern| C
    C -->|Kurven er tom| E[Tom kurv + Se alle bøger]
    C -->|Gå til kassen| F[Levering: navn, e-mail, adresse]
    F -->|Valideringsfejl| F
    F -->|Fortsæt| S[Oversigt: varer, fragt, total EUR + BTC]
    S -->|Ret oplysninger| F
    S -->|Kurs utilgængelig| SR[Besked + Prøv igen; bestilling blokeret]
    SR --> S
    S -->|Afgiv bestilling| P{Server}
    P -- lager ok --> PAY[Betaling: ordrenummer, BTC-beløb, adresse, QR]
    P -- vare udsolgt / for få --> C2[Tilbage til kurv med besked]
    C2 --> C
    P -- netværk/serverfejl --> SF[Fejl: bestillingen er ikke afgivet + Prøv igen]
    SF --> S
    PAY --> W[Kunden betaler fra egen wallet]
    W --> O[Ejer markerer betalt manuelt, feature 5]
```

The cart lives in the browser until the order is placed (storage per pro-architect). Stock is only reserved at "Afgiv bestilling", so the cart can go stale; the server rechecks on submit.

## 3. Wireframes

### 3.1 Cart (`/kurv`)

```
Desktop
+--------------------------------------------------------------------------+
| Boghandel            [ Søg …                       ][Søg]       Kurv (3) |
+--------------------------------------------------------------------------+
| Din kurv                                                                 |
|                                                                          |
| [!] "Ørkenens sønner" er nu udsolgt og er fjernet fra kurven.            |  <- if stale
|                                                                          |
| +------+ Titel på bogen                    Antal        Pris     I alt   |
| |cover | af Forfatter                      [-] [ 2 ] [+] 12,50 €  25,00 € |
| +------+ På lager · Højst 3 stk.            [Fjern]                      |
| +------+ En anden titel                    [-] [ 1 ] [+]  8,00 €   8,00 € |
| |cover | af Forfatter                       [Fjern]                      |
| +------+                                                                 |
|                                            Varer i alt          33,00 €  |
|                                            Fragt (Danmark)       5,00 €  |
|                                            Total                38,00 €  |
|                                            Pris i BTC vises ved næste trin |
|                                                                          |
| [‹ Fortsæt med at handle]                          [ Gå til kassen ]     |
+--------------------------------------------------------------------------+

Mobile
+------------------------------+
| Din kurv                     |
| +----+ Titel på bogen        |
| |cvr | af Forfatter          |
| +----+ 12,50 €               |
| Antal [-] [ 2 ] [+]  25,00 € |
| [Fjern]                      |
|------------------------------|
| Varer i alt        33,00 €   |
| Fragt               5,00 €   |
| Total              38,00 €   |
| [     Gå til kassen     ]    |
| ‹ Fortsæt med at handle      |
+------------------------------+
```

- `+` is disabled at the available stock, with the hint "Højst {n} stk." The number field clamps to 1…available.
- `-` at 1 is disabled; removal goes through "Fjern" so a book isn't removed by accident.
- The shipping amount comes from configuration (5,00 € shown is a placeholder).

### 3.2 Checkout form (`/kassen`, step 1 of 2)

```
+--------------------------------------------------------------+
| Kassen                                   Trin 1 af 2: Levering |
|                                                               |
| [!] Ret 2 fejl i formularen:                                  |  <- error summary, links to fields
|     • Indtast en gyldig e-mailadresse                         |
|     • Postnummeret skal være 4 cifre                          |
|                                                               |
| Fulde navn                                                    |
| [______________________________]                              |
|                                                               |
| E-mail                                                        |
| [______________________________]                              |
| Vi sender besked, når din bestilling er betalt og afsendt.    |
| ! Indtast en gyldig e-mailadresse                             |
|                                                               |
| Adresse                                                       |
| [______________________________]  (gade, nr., etage)          |
|                                                               |
| Postnummer        By                                          |
| [____]            [____________________]                      |
| ! Postnummeret skal være 4 cifre                              |
|                                                               |
| Land: Danmark  (vi sender kun til Danmark)                    |
|                                                               |
| [‹ Tilbage til kurven]                       [ Fortsæt ]      |
+--------------------------------------------------------------+
```

Mobile: one column, full-width fields and buttons. Validation runs on blur after a field has been edited and on Fortsæt; the server validates again.

### 3.3 Order summary (`/kassen/oversigt`, step 2 of 2)

```
+--------------------------------------------------------------+
| Kassen                                  Trin 2 af 2: Oversigt |
|                                                               |
| Levering til                                    [Ret]         |
| Mette Hansen, Nygårdsvej 41, 2100 København Ø                 |
| mette@example.dk                                              |
|                                                               |
| Varer                                           [Ret kurv]    |
| 2 × Titel på bogen                               25,00 €      |
| 1 × En anden titel                                8,00 €      |
| Fragt (Danmark, fast pris)                        5,00 €      |
| ------------------------------------------------------------- |
| Total                                            38,00 €      |
| Total i bitcoin                       0,00059375 BTC          |
| Kurs: 1 BTC = 64.000,00 € · hentet kl. 23:31                  |
|                                                               |
| Du betaler med bitcoin fra din egen wallet, når bestillingen  |
| er afgivet. Bøgerne er reserveret til dig, når du afgiver     |
| bestillingen.                                                 |
|                                                               |
| [ Afgiv bestilling ]                                          |
+--------------------------------------------------------------+
```

### 3.4 Payment screen (`/ordre/{ordrenummer}`)

```
Desktop
+--------------------------------------------------------------------------+
| [✓] Tak for din bestilling                                               |
|     Ordrenummer: BH-2026-00042   [Kopiér]                                |
|                                                                          |
| Sådan betaler du                                                         |
| 1. Send præcis dette beløb i bitcoin:                                    |
|      0,00059375 BTC   [Kopiér beløb]      (= 38,00 €)                    |
| 2. Til denne bitcoin-adresse:                                            |
|      bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh   [Kopiér adresse]       |
|    +-------------+                                                       |
|    |  QR-kode    |  Scan med din wallet.                                 |
|    |  (adresse + |  QR-koden indeholder adressen og beløbet.             |
|    |   beløb)    |                                                       |
|    +-------------+                                                       |
| 3. Skriv ordrenummeret BH-2026-00042 som note/reference, hvis din        |
|    wallet kan det.                                                       |
|                                                                          |
| Hvad sker der nu?                                                        |
| Butikkens ejer tjekker betalingen manuelt. Det kan tage op til et par    |
| dage. Du får en e-mail, når betalingen er bekræftet, og igen, når        |
| bøgerne er sendt. Dine bøger er reserveret til dig imens.                |
|                                                                          |
| Gem denne side eller skriv ordrenummeret ned. I udgave 1 sender vi ikke  |
| en e-mail med betalingsoplysningerne.                                    |
|                                                                          |
| Bestilling: 2 × Titel på bogen, 1 × En anden titel · Total 38,00 €       |
| Levering: Mette Hansen, Nygårdsvej 41, 2100 København Ø                  |
+--------------------------------------------------------------------------+
```

Mobile: same order, single column. The QR code sits under the address at about 200×200 px, and the copy buttons are full-width. The address wraps in groups of 4 characters, monospaced, for readability, but it copies without spaces.

The QR code is a BIP 21 URI (`bitcoin:{adresse}?amount={btc}`), generated in the browser, with a quiet zone and dark on white.

## 4. BTC amount: rounding and labelling

- EUR is the source price. BTC = total EUR ÷ BTC/EUR rate.
- Shown with 8 decimals (satoshi precision), Danish format: `0,00059375 BTC`. Round **up** to the next satoshi so the owner never receives less than the EUR total.
- Copy and the QR code use a dot decimal with no thousands separator (`0.00059375`), because wallets expect that. The screen says "Kopiér beløb" and copies the wallet format.
- The rate is always labelled with its time: "Kurs: 1 BTC = 64.000,00 € · hentet kl. 23:31".
- **Rate lock (open):** this spec assumes the BTC amount is fixed when the order is placed and stored with the order, so the payment screen and the owner's admin show the same amount. Release 2 (#2 "Expiring BTC quotes") adds an expiry. The summary step may refresh the rate. If the rate changes between summary and submit, the payment screen shows the new amount with the note "Beløbet er opdateret efter den aktuelle kurs."

## 5. States

| State | What the customer sees |
|---|---|
| Empty cart | "Din kurv er tom." [Se alle bøger]. Header shows "Kurv (0)". Going to `/kassen` with an empty cart redirects to the cart. |
| Added to cart | On the book page: "Lagt i kurven" + [Gå til kurven]; header count updates. |
| Out of stock on book page | No "Læg i kurv" button (rule from #14). |
| Quantity above stock | `+` disabled at the available count, with the hint "Højst {n} stk." A typed higher number is clamped, with the message "Der er kun {n} stk. på lager. Antallet er sat til {n}." |
| Item sold out or reserved meanwhile (cart load) | Banner "‘{titel}’ er nu udsolgt og er fjernet fra kurven." or "Der er nu kun {n} stk. af ‘{titel}’. Antallet er ændret." Totals update. |
| Item sold out or reserved meanwhile (on submit) | Back to the cart with the same banner; "Intet er bestilt endnu. Tjek kurven og prøv igen." |
| Validation errors | Error summary at the top (focus moves there) plus inline errors per field (section 7). |
| BTC rate loading | Summary: "Henter bitcoin-kurs …" in the BTC row; "Afgiv bestilling" disabled. |
| BTC rate unavailable | "Vi kan ikke hente bitcoin-kursen lige nu, så vi kan ikke beregne beløbet i BTC. Prøv igen om lidt." [Prøv igen]. "Afgiv bestilling" stays disabled, so no order is ever placed without a BTC amount. |
| Submitting | Button "Afgiver bestilling …", disabled; no double submit. |
| Submit failure | "Bestillingen blev ikke afgivet. Der er ikke trukket noget, og intet er reserveret. Prøv igen." [Prøv igen]. Entered details are kept. On a timeout where the outcome is unknown, see open question 6. |
| Order placed | Payment screen (3.4). The cart empties. |
| Payment page reloaded / revisited | Same content from the saved order (rate locked). |
| Copy success | "Kopieret" appears beside the button for 2 s and is announced. On failure: "Kunne ikke kopiere. Markér teksten og kopiér den selv." |
| Order cancelled by owner (revisit) | "Denne bestilling er annulleret. Bøgerne er ikke længere reserveret." (if the page shows status; open question 7). |

## 6. Edge cases

| Case | Handling |
|---|---|
| Two customers want the last copy | The first submit wins; the second gets the sold-out-on-submit state. |
| Cart kept for days | Revalidated against stock and price on cart load and on submit; price changes show "Prisen på ‘{titel}’ er ændret til {pris}." |
| Postnummer | Exactly 4 digits (`^[0-9]{4}$`), `inputmode="numeric"`. Leading zero is not valid in DK, but accept 1000–9999 and leave the full list to the backend. |
| By auto-filled from postnummer | Nice to have, not R1 (open question 3). |
| Foreign address | Only Denmark; the country is fixed text, not a field. |
| Name with æøå, hyphens, apostrophes | Allowed; no character restrictions beyond length 1–100. |
| Email typo | Format check only; the email is echoed on the summary and the payment screen so the customer can spot it. |
| Many copies of one book | Quantity max is the available stock (no other cap in R1). |
| Very long titles | 2 lines in the cart, ellipsis; full title in the accessible name. |
| BTC amount very small | Still 8 decimals; never show `0 BTC`. |
| Rate spikes between summary and submit | Order uses the rate at submit; note shown (section 4). |
| Customer closes payment page | Order number is in the URL; no email with instructions in R1 (R2 "Order received email"). |

## 7. Danish copy

| Key | Danish |
|---|---|
| Header cart | Kurv ({n}) |
| Add to cart / added | Læg i kurv / Lagt i kurven · Gå til kurven |
| Cart heading | Din kurv |
| Cart columns | Antal · Pris · I alt |
| Quantity buttons (accessible) | Færre af {titel} · Flere af {titel} · Antal af {titel} |
| Remove | Fjern ({titel} in accessible name) |
| Max hint | Højst {n} stk. |
| Clamped | Der er kun {n} stk. på lager. Antallet er sat til {n}. |
| Subtotal / shipping / total | Varer i alt · Fragt (Danmark) · Total |
| BTC later | Pris i BTC vises ved næste trin |
| Buttons | Fortsæt med at handle · Gå til kassen · Tilbage til kurven · Fortsæt · Ret · Ret kurv · Afgiv bestilling · Afgiver bestilling … · Prøv igen |
| Empty cart | Din kurv er tom. · Se alle bøger |
| Stale item | ‘{titel}’ er nu udsolgt og er fjernet fra kurven. · Der er nu kun {n} stk. af ‘{titel}’. Antallet er ændret. · Prisen på ‘{titel}’ er ændret til {pris}. |
| Stale on submit | Intet er bestilt endnu. Tjek kurven og prøv igen. |
| Checkout heading / steps | Kassen · Trin 1 af 2: Levering · Trin 2 af 2: Oversigt |
| Fields | Fulde navn · E-mail · Adresse · Postnummer · By |
| Address hint | Gade, nummer og evt. etage |
| Email hint | Vi sender besked, når din bestilling er betalt og afsendt. |
| Country | Land: Danmark (vi sender kun til Danmark) |
| Error summary | Ret {n} fejl i formularen: |
| Field errors | Indtast dit navn · Indtast din e-mail · Indtast en gyldig e-mailadresse · Indtast din adresse · Indtast dit postnummer · Postnummeret skal være 4 cifre · Indtast din by |
| Summary | Levering til · Varer · Fragt (Danmark, fast pris) · Total · Total i bitcoin · Kurs: 1 BTC = {kurs} € · hentet kl. {tid} |
| Summary note | Du betaler med bitcoin fra din egen wallet, når bestillingen er afgivet. Bøgerne er reserveret til dig, når du afgiver bestillingen. |
| Rate loading / unavailable | Henter bitcoin-kurs … · Vi kan ikke hente bitcoin-kursen lige nu, så vi kan ikke beregne beløbet i BTC. Prøv igen om lidt. |
| Rate updated | Beløbet er opdateret efter den aktuelle kurs. |
| Submit failure | Bestillingen blev ikke afgivet. Der er ikke trukket noget, og intet er reserveret. Prøv igen. |
| Payment heading | Tak for din bestilling |
| Order number | Ordrenummer: {nr} |
| Steps | Sådan betaler du · 1. Send præcis dette beløb i bitcoin: · 2. Til denne bitcoin-adresse: · 3. Skriv ordrenummeret {nr} som note/reference, hvis din wallet kan det. |
| QR | Scan med din wallet. QR-koden indeholder adressen og beløbet. |
| Copy buttons | Kopiér · Kopiér beløb · Kopiér adresse |
| Copy result | Kopieret · Kunne ikke kopiere. Markér teksten og kopiér den selv. |
| What next | Hvad sker der nu? · Butikkens ejer tjekker betalingen manuelt. Det kan tage op til et par dage. Du får en e-mail, når betalingen er bekræftet, og igen, når bøgerne er sendt. Dine bøger er reserveret til dig imens. |
| Save notice | Gem denne side eller skriv ordrenummeret ned. |
| Cancelled | Denne bestilling er annulleret. Bøgerne er ikke længere reserveret. |

Numbers: `38,00 €`, `0,00059375 BTC`, `1 BTC = 64.000,00 €`, time `kl. 23:31`.

## 8. Accessibility (WCAG 2.1 AA)

- `lang="da"`. Each step has its own `<h1>` and page title ("Kassen – Levering – Boghandel"); the step indicator is text ("Trin 1 af 2"), not just a graphic.
- **Form:** visible `<label for>` on every field; `autocomplete` = `name`, `email`, `street-address`, `postal-code`, `address-level2`; `type="email"`, postnummer `inputmode="numeric"` `maxlength="4"`. Required fields are marked "(skal udfyldes)" in the label or all fields are required and the form says so.
- **Errors:** on submit, an error summary with `role="alert"` and `tabindex="-1"` gets focus; each item links to its field. Fields get `aria-invalid="true"` and `aria-describedby` pointing to the inline error. Errors use text and an icon, not only red.
- **Cart:** quantity controls are buttons with accessible names including the title; the quantity input is `type="number"` with `min`/`max`. Totals and stale-item banners update in an `aria-live="polite"` region ("Total opdateret: 38,00 €"). After "Fjern", focus moves to the next item or the cart heading.
- **Copy buttons:** a `<button>` with a specific name ("Kopiér bitcoin-adresse"); success "Kopieret" in an `aria-live="polite"` region next to it; failure in the same region. The copied text stays visible and selectable.
- **QR code:** `<img alt="QR-kode med bitcoin-adressen {adresse} og beløbet {beløb} BTC">` (or `role="img"` with the same label). It is never the only way: the address and amount are shown as text with copy buttons.
- **Rate unavailable / submit failure:** `role="alert"`; the disabled "Afgiv bestilling" explains why via `aria-describedby`.
- **Payment screen:** focus moves to the "Tak for din bestilling" heading. The BTC address is in a monospaced font at ≥ 16 px; the visual 4-character spacing uses CSS, not real spaces, so screen readers and copy get the plain address.
- Contrast: text ≥ 4.5:1, controls and focus ≥ 3:1; QR dark on white. Targets ≥ 24×24 px (44 px on mobile). Reflow at 320 px and 200 % zoom.
- No time limits in R1. If R2 adds quote expiry, it must warn and allow a refresh (WCAG 2.2.1).

## 9. Acceptance criteria mapping (#18)

| Acceptance criterion | Spec sections |
|---|---|
| Customers can add, change and remove cart items. | 2, 3.1, 5 (empty cart, added), 7, 8 (cart) |
| Customers cannot put more of a book in the cart or order than is in stock. | 3.1 (+ disabled, max hint), 5 (quantity above stock, sold out meanwhile on load and submit), 6 (last copy) |
| Checkout asks for name, email and a Danish address. | 3.2, 5 (validation), 6 (postnummer, foreign address), 7, 8 (form, errors) |
| A flat shipping fee is added. | 3.1, 3.3 (Fragt (Danmark, fast pris)) |
| The summary shows the total in EUR and BTC at the current rate. | 3.3, 4, 5 (rate loading/unavailable) |
| The confirmation shows the owner's bitcoin address and the order number to use as reference. | 3.4, 4, 5 (copy), 8 (copy, QR) |
| Placing the order reserves the stock (stock goes down at once). | 2, 3.3 note, 3.4 "reserveret", 5 (sold out on submit), 6 (last copy) |
| The order is saved as awaiting payment. No private keys are stored. | 1 (ADR 0001), 3.4 (what happens next), 5 (payment page revisited) |

## 10. Open questions (not blockers)

1. **Rate lock (pro-architect, pro-product-owner):** is the BTC amount fixed and stored when the order is placed? The spec assumes yes, with no expiry in R1. Which rate source, and how often is it refreshed?
2. **Rounding (pro-architect):** round up to the next satoshi, as proposed? Is the BTC amount stored, or recomputed?
3. Should "By" auto-fill from the postnummer? Not proposed for R1.
4. **Order number format:** `BH-2026-00042` is illustrative. Is it short enough to type as a wallet note? Should it be hard to guess, since the payment URL contains it?
5. **Flat shipping amount:** the fee itself (5,00 € is a placeholder), and whether it's configuration.
6. **Submit timeout with unknown outcome:** an idempotency key so "Prøv igen" can't create two orders (pro-architect)?
7. Does the payment page show the order's live status (awaiting / paid / cancelled), or only the instructions?
8. Since there's no instructions email in R1, is a "Print / gem" button worth adding?
9. Do phone number and address line 2 (c/o) fields matter for shipping? Not in the AC, so they're left out.
