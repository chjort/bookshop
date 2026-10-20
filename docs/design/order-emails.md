# Design: Order emails (#32, feature #30)

## 1. Scope

The customer gets an email when the owner marks the order **paid** and again when it is marked **shipped**. Nothing else in R1.

- **No "order placed" email in R1.** The release plan puts it in R2 (#36, "Order received email"), and checkout says "Save this page. The payment details are not sent by email." (cart-checkout 3.4, 5). This spec reserves its layout slot only (section 9) so R2 reuses the same template.
- No cancellation email in R1 (not in the release plan; see open questions).
- English only, shop name **probooks**, prices like `€12.50`, shipping `€3.00`, BTC `0.00056250 BTC`.

Consistent with: cart-checkout.md (#49), order-handling.md (#53, sections 3.4–3.5), ADR 0001 (`EMAIL_API_KEY`, `PUBLIC_BASE_URL`), ADR 0004 (order number `BH-` + 5 Crockford base32, `amount_sats`, line snapshots), pro-architect's #25 answers (`paid_email_status` / `shipped_email_status` = `pending | sent | failed`, `*_email_sent_at`; status commits first, email after, no rollback).

## 2. Common rules for every email

| Item | Decision |
|---|---|
| From name | `probooks` |
| From address | a no-reply-style sender on the shop domain, e.g. `orders@nygaardsvej41.dk` (exact address per pro-architect / email provider) |
| Reply-To | the owner's real inbox (config, e.g. `SHOP_REPLY_TO`), so a customer pressing Reply reaches a person. The footer says so. |
| To | the order's `email` |
| Format | `multipart/alternative`: plain-text part first, HTML part second. Both carry the same information; the plain-text part is complete on its own. |
| Language | `<html lang="en">`; plain text in English |
| Order number | always in the subject and as the first fact in the body, e.g. `BH-7K3Q9` |
| Money | EUR from cents: `€12.50`; thousands `€1,250.00`. BTC from `amount_sats` ÷ 100,000,000, always 8 decimals: `0.00056250 BTC`. Same formatters as checkout and admin. |
| Dates | `20 Oct 2026` (Europe/Copenhagen) |
| Images | none required. No logo image, no tracking pixel, no cover images in R1. The shop name is text. |
| Links | one optional text link to the shop home (`PUBLIC_BASE_URL`). No link to the payment page: the token isn't stored (ADR 0004), and it's not needed after payment. |

### Footer (both parts)

```
--
probooks · Books shipped within Denmark
Questions? Reply to this email.
You get this email because you ordered from probooks ({shop URL}).
```

No marketing, no unsubscribe link: these are transactional emails about one order.

## 3. Shared blocks

**Items block** (from `order_lines` snapshots, not the live catalogue):

```
Items
  2 × Kongens Fald – Johannes V. Jensen        €25.00
  1 × Det forsømte forår – Hans Scherfig       €12.50
                                     Subtotal  €37.50
                     Shipping (Denmark, flat)   €3.00
                                        Total  €40.50
                               Paid in bitcoin  0.00063281 BTC
```

- Line: `{qty} × {title} – {author}` then line total (`unit_price_cents × qty`). Unit price shown only when qty > 1: `2 × … (€12.50 each)` in HTML; plain text keeps just the line total to fit.
- BTC row label: "Paid in bitcoin" in the paid and shipped emails.

**Delivery block:**

```
Delivery address
  Mette Hansen
  c/o Jensen
  Nygårdsvej 41
  2100 København Ø
  Denmark
```

Address line 2 (c/o) shows only when filled in. Country is always "Denmark".

## 4. Email A: Payment confirmed (paid)

- **Trigger:** `POST /api/admin/orders/{order_number}/paid` commits `status = paid`; then the backend sends this email and sets `paid_email_status`.
- **Subject:** `probooks: payment received for order BH-7K3Q9`
- **Preheader** (hidden HTML text, first line in plain text): `We've received your bitcoin payment. We'll pack your books next.`

Plain text:

```
Hi Mette,

Thank you. We've received your bitcoin payment for order BH-7K3Q9.

Order number: BH-7K3Q9
Paid: 20 Oct 2026

What happens next
We'll pack your books and send them to the address below.
You'll get one more email when they're on the way.

Items
  2 × Kongens Fald – Johannes V. Jensen        €25.00
  1 × Det forsømte forår – Hans Scherfig       €12.50
  Subtotal                                     €37.50
  Shipping (Denmark, flat rate)                 €3.00
  Total                                        €40.50
  Paid in bitcoin                     0.00063281 BTC

Delivery address
  Mette Hansen
  c/o Jensen
  Nygårdsvej 41
  2100 København Ø
  Denmark

Is the address wrong? Reply to this email as soon as you can.

--
probooks · Books shipped within Denmark
Questions? Reply to this email.
You get this email because you ordered from probooks (https://nygaardsvej41.dk).
```

HTML layout (single column, max 600 px, centred):

```
+------------------------------------------------------------+
| probooks                                  (text, 20px bold) |
+------------------------------------------------------------+
| Payment received                                    <h1>   |
| Hi Mette,                                                  |
| Thank you. We've received your bitcoin payment for         |
| order BH-7K3Q9.                                            |
|                                                            |
| +--------------------------------------------------------+ |
| | Order number   BH-7K3Q9          (monospace, bold)     | |
| | Paid           20 Oct 2026                             | |
| +--------------------------------------------------------+ |
|                                                            |
| What happens next                                   <h2>   |
| We'll pack your books and send them to the address below.  |
| You'll get one more email when they're on the way.         |
|                                                            |
| Items                                               <h2>   |
| <table> 2 × Kongens Fald           €25.00                  |
|         Johannes V. Jensen · €12.50 each                   |
|         1 × Det forsømte forår     €12.50                  |
|         Hans Scherfig                                      |
|         ---------------------------------                  |
|         Subtotal                   €37.50                  |
|         Shipping (Denmark, flat)    €3.00                  |
|         Total                      €40.50   (bold)         |
|         Paid in bitcoin   0.00063281 BTC                   |
|                                                            |
| Delivery address                                    <h2>   |
| Mette Hansen / c/o Jensen / Nygårdsvej 41 /                |
| 2100 København Ø / Denmark        (one line each)          |
| Is the address wrong? Reply to this email as soon as you   |
| can.                                                       |
+------------------------------------------------------------+
| footer (14px, muted but ≥ 4.5:1)                           |
+------------------------------------------------------------+
```

## 5. Email B: Order shipped

- **Trigger:** `POST /api/admin/orders/{order_number}/ship` commits `status = shipped`; then the backend sends this email and sets `shipped_email_status`.
- **Subject:** `probooks: your order BH-7K3Q9 is on the way`
- **Preheader:** `Your books have been sent to Mette Hansen, 2100 København Ø.`

Plain text (differences from A only; items, address and footer blocks are identical):

```
Hi Mette,

Good news: your order BH-7K3Q9 has been shipped.

Order number: BH-7K3Q9
Shipped: 21 Oct 2026

Your books are on their way to the address below. Delivery within
Denmark usually takes a few working days.

Items
  ... (same block, "Paid in bitcoin" row)

Delivery address
  ... (same block)

Haven't received your books after a week? Reply to this email.

--
(footer)
```

HTML: same frame as A with `<h1>Your order is on the way</h1>`, fact box "Order number / Shipped {date}", no "What happens next" section; the closing line is "Haven't received your books after a week? Reply to this email."

No tracking number in R1 (the admin has no field for it; see open questions).

## 6. HTML build rules

- Table-based layout, inline CSS, system font stack (`Arial, Helvetica, sans-serif`), body 16 px / 1.5, headings 22 px and 18 px.
- Colours: text `#1a1a1a` on `#ffffff`; muted footer `#555555` (7.4:1); fact box background `#f3f3f3` with text `#1a1a1a`. All text ≥ 4.5:1. No meaning carried by colour.
- Works with images off and in dark mode (no images, no text baked into images; let clients invert).
- Fits 320 px wide: amounts wrap under the title on narrow screens rather than shrinking.
- Real text everywhere, no buttons-as-images. Data tables use `<th scope>`; layout tables have `role="presentation"`.
- If an image is ever added (logo, covers in R2), it needs `alt` (decorative: `alt=""`) and the email must read fully without it.
- `<title>` = the subject. Headings in order (`h1` then `h2`).

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Missing cover image | Not applicable: no covers in R1 emails. |
| Long title or author | Wraps to the next line; never truncated (it's the customer's record). Plain text wraps at ~72 chars with the price kept on the first line's right or on its own line. |
| Many lines | All lines listed; no "and 3 more". |
| No c/o line | The line is omitted, no blank line. |
| Danish characters (æøå) in name, address, titles | UTF-8 in both parts and the subject (RFC 2047 encoded). Snapshot text used as stored. |
| Name with only one word / odd casing | Greeting uses `customer_name` as entered: "Hi {customer_name},". No first-name guessing. |
| Order shipped before paid email went out | Each email is independent; the shipped email is complete on its own. |
| Paid email failed | Order stays paid; shipped email is still sent later when marked shipped. |
| Email bounces later (after the provider accepted it) | Out of scope R1: `sent` means accepted by the provider, not delivered. |
| Customer replies | Goes to Reply-To (owner's inbox). |

## 8. Failure and status (ties to order-handling 3.4–3.5)

| `*_email_status` | Meaning | Owner sees (order-handling) |
|---|---|---|
| `pending` | Status committed, send not finished | "Customer email: sending …" |
| `sent` | Provider accepted the message; `*_email_sent_at` set | "Customer email sent {date}, {time}" |
| `failed` | Provider error or timeout | "⚠ Email not sent" banner + [Copy email]; list marker |

- The status change is never rolled back by an email failure.
- No resend in R1, no automatic retry visible to the owner. The owner emails the customer by hand; this spec's plain-text part is the template they can copy (see open question 3).
- The customer never sees an error; they simply don't get the email.

## 9. Reserved: Order received (R2, #36)

Not built in R1. Same frame, subject `probooks: order BH-7K3Q9 – how to pay`, with the payment block (amount in BTC, address in monospace, reference) from cart-checkout's payment screen and a "Not paid yet" BTC row label. Designed in R2.

## 10. Copy sheet

| Key | Text |
|---|---|
| From name | probooks |
| Paid subject | probooks: payment received for order {order_number} |
| Paid preheader | We've received your bitcoin payment. We'll pack your books next. |
| Paid h1 | Payment received |
| Paid intro | Thank you. We've received your bitcoin payment for order {order_number}. |
| Paid next | What happens next · We'll pack your books and send them to the address below. You'll get one more email when they're on the way. |
| Paid address note | Is the address wrong? Reply to this email as soon as you can. |
| Shipped subject | probooks: your order {order_number} is on the way |
| Shipped preheader | Your books have been sent to {customer_name}, {postal_code} {city}. |
| Shipped h1 | Your order is on the way |
| Shipped intro | Good news: your order {order_number} has been shipped. |
| Shipped body | Your books are on their way to the address below. Delivery within Denmark usually takes a few working days. |
| Shipped closing | Haven't received your books after a week? Reply to this email. |
| Greeting | Hi {customer_name}, |
| Facts | Order number · Paid {date} · Shipped {date} |
| Items | Items · {qty} × {title} – {author} · {price} each · Subtotal · Shipping (Denmark, flat rate) · Total · Paid in bitcoin |
| Address | Delivery address · Denmark |
| Footer | probooks · Books shipped within Denmark · Questions? Reply to this email. · You get this email because you ordered from probooks ({shop URL}). |

## 11. Acceptance criteria mapping (#30)

| AC | Where |
|---|---|
| When the order is marked paid, the customer gets an email. | 4 (trigger, content), 8 (status) |
| When the order is marked shipped, the customer gets an email. | 5, 8 |
| The emails are in ~~Danish~~ **English** and include the order number. | 2 (language, order number in subject and body), 10. The AC text on #30 still says Danish; the user switched to English on 2026-10-20 (RELEASE_PLAN.md). pro-product-owner to update the AC. |

## 12. Open questions

1. **AC wording (pro-product-owner):** update #30 from "Danish" to "English".
2. **Address line 2 (pro-architect):** checkout has "Address line 2 (optional)" for c/o, but the ADR 0004 `orders` table has only `address_line`. Is line 2 stored (separate column or joined)? The email shows it on its own line if available.
3. **Manual fallback (pro-product-owner):** should the "Email not sent" banner in admin offer [Copy email text] with the plain-text body, so the owner can paste it? Small, but it's UI scope beyond R1's D1.
4. **Sender and Reply-To (pro-architect / user):** exact From address on the shop domain and the owner's reply inbox; domain setup (SPF/DKIM) with the email provider.
5. **Cancellation email (pro-product-owner):** none in R1 per plan. Confirm, or add to R2.
6. **Tracking number (pro-product-owner):** none in R1. Add an optional field on "Mark shipped" in a later release?

_— pro-designer_
