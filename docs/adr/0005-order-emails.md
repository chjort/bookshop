# ADR 0005: Order emails

Status: Proposed (provider choice needs the user's confirmation via pro-product-owner) · Amends: ADR 0004 (`address_line2`) · Author: pro-architect · Task: #31 (feature #30) · Design: #32 (emails), PR #53 (order handling)

## Context

The customer gets an email when the owner marks an order **paid** and again when it is marked **shipped** (RELEASE_PLAN.md, R1 feature 6). An "order received" email with payment instructions is Release 2, not R1. No email on cancel in R1 (PR #53, D3). Emails are in English (UI language changed on 2026-10-20; the "Danish" line on #30 is outdated) and include the order number.

Volume is tiny: a few orders a day, at most two emails per order. Constraints: EU data residency (Danish customers, GDPR), free or near-free, a plain HTTPS API (no SMTP connection from Render), and DKIM/SPF/DMARC on a subdomain of `nygaardsvej41.dk`, whose DNS is at one.com. No email provider has been picked yet.

## Options

Prices and limits checked on the providers' public pages on 2026-10-20.

| Provider | Free tier | First paid tier | Data location | API | Notes |
|---|---|---|---|---|---|
| **Brevo** (FR) | 300 emails/day, forever, no card | Starter from €7/month | EU (France, Germany) | `POST https://api.brevo.com/v3/smtp/email`, `api-key` header | Guided SPF/DKIM/DMARC setup; logs kept; EU company |
| Mailjet (Sinch, FR) | 6,000/month, 200/day, no card | $9/month, 8,000 | EU (6 data centres in Europe) | `POST /v3.1/send`, basic auth | Also fine; free emails carry a Mailjet logo in marketing, and API is a little clunkier |
| Postmark (US) | 100/month | $15/month, 10,000 | US only | Simple JSON API | Best deliverability, but no EU hosting and the free tier is too small for prd |
| Resend (US) | 3,000/month, 100/day | $20/month, 50,000 | Sends from EU region, account data stored in the US | Simplest API | Data not EU-resident |
| Amazon SES | No lasting free tier; about $0.10 per 1,000 | Pay per use | EU region (eu-central-1 Frankfurt) | AWS SigV4 API | Cheapest at scale, but needs an AWS account, IAM setup and a manual request to leave the sandbox. Too much setup for this shop |

## Decision

### Provider (proposal)

**Brevo, free plan.** It's an EU company with data in France and Germany, free forever at 300 emails/day (about 150 orders a day, far above expected volume), and sending is one JSON POST with an API key. Cost: **€0/month**. If the shop outgrows it, Starter is from €7/month. Mailjet is the fallback with the same design; only the sender adapter changes.

This needs the user's go-ahead, through pro-product-owner, before anyone creates the account. Creating the Brevo account and adding the DNS records at one.com both need the user's own sign-in.

### Sending domain

- Sender subdomain `mail.nygaardsvej41.dk`, so the main domain's mail setup is untouched.
- From: `probooks <orders@mail.nygaardsvej41.dk>` (`EMAIL_FROM`). Reply-To: the same address, `orders@mail.nygaardsvej41.dk` (`EMAIL_REPLY_TO`). The user decided this on 2026-10-20.

### Receiving mail at `mail.nygaardsvej41.dk`

Brevo only sends. Without an MX record on `mail.`, customer replies bounce. Checked one.com's help pages on 2026-10-20:

- one.com DNS supports MX records on a subdomain (enter the subdomain as hostname): https://help.one.com/hc/en-us/articles/360000825218-How-do-I-create-an-MX-record and https://help.one.com/hc/en-us/articles/115005595925-Manage-your-DNS-settings
- one.com forwarding is set per mail account in Mail administration, and the target must verify it: https://help.one.com/hc/en-us/articles/360000934598-How-do-I-automatically-forward-email-to-another-account
- No one.com help page says you can create a mailbox or forward on a subdomain. Accounts are created for the domain, and on the new platform the MX value is a per-domain cluster you have to get from support: https://help.one.com/hc/en-us/articles/17038200070545-Why-do-my-emails-end-up-in-spam-when-using-external-name-servers

**Decision: forward with ImprovMX (free plan).** Put an MX record on `mail.` at one.com pointing to ImprovMX, and add one alias, `orders@mail.nygaardsvej41.dk`, that forwards to the owner's existing inbox. Free: 1 domain, 25 aliases, 500 forwards/day, no card (https://improvmx.com/pricing/). Mail is handled on servers in France, run by ImprovMX SAS; the company's head office is in New York. Replies stay in the owner's normal inbox, and there's no new mailbox to check. Cost: €0.

Fallback: if one.com support confirms that a mail account or forward on `mail.nygaardsvej41.dk` works on the owner's plan, use that instead with one.com's MX value and `include:_spf.one.com`. Same table below, different MX and SPF values. Migadu (CH, paid, from about $19/year) is the option if the user wants a fully EU company.

Setting up ImprovMX and the one.com records both need the user's own sign-in.

### DNS records at one.com

Hostnames are relative to `nygaardsvej41.dk`, as one.com expects. Brevo shows the exact values on its domain page.

| Type | Host | Value | Purpose |
|---|---|---|---|
| TXT | `mail` | `brevo-code:<from Brevo>` | Brevo domain verification |
| TXT or CNAME | `<selector from Brevo>._domainkey.mail` | `<DKIM value from Brevo>` | DKIM signing for Brevo (add every DKIM record Brevo lists) |
| TXT | `mail` | `v=spf1 include:spf.brevo.com include:spf.improvmx.com ~all` | SPF: Brevo sends, ImprovMX forwards |
| TXT | `_dmarc.mail` | `v=DMARC1; p=none; rua=mailto:<owner address>` | DMARC reports; move to `p=quarantine` after a few clean weeks |
| MX | `mail` | `mx1.improvmx.com`, priority 10 | Inbound replies to ImprovMX |
| MX | `mail` | `mx2.improvmx.com`, priority 20 | Inbound backup |

There must be only one SPF record on `mail`. It has to include both Brevo and the inbound provider. If the fallback is used, swap `include:spf.improvmx.com` for one.com's include. The root domain's records stay as they are.

### When and how emails are sent

```mermaid
sequenceDiagram
  participant A as Admin SPA
  participant API as FastAPI
  participant DB as Postgres
  participant B as Brevo
  A->>API: POST /api/admin/orders/{n}/paid
  API->>DB: UPDATE status, paid_email_status='pending' (commit)
  API-->>A: 200 order (email pending)
  API->>B: send (background task, after commit)
  B-->>API: 201 / error
  API->>DB: paid_email_status='sent'|'failed', paid_email_sent_at
```

- The status change commits first, in its own transaction, with `<step>_email_status = 'pending'`. The email is sent **after** the commit, in a FastAPI `BackgroundTask` (runs after the response, same process; no queue or worker).
- One attempt with a 10 s timeout and one retry after 2 s on a network error or 5xx. A 4xx is not retried.
- Then a second short transaction sets `<step>_email_status` to `sent` (and `<step>_email_sent_at = now()`) or `failed`. A failed email never rolls back the status change.
- If the process dies between commit and send, the status stays `pending`. The admin UI shows `pending` older than 5 minutes the same way as `failed`.
- Logs record order number, step, result and the provider message id. No email bodies or addresses in logs.

### Data model

New columns on `orders` (migration in this feature):

```sql
CREATE TYPE email_status AS ENUM ('pending', 'sent', 'failed');
ALTER TABLE orders
  ADD COLUMN paid_email_status     email_status,   -- NULL until the order is marked paid
  ADD COLUMN paid_email_sent_at    timestamptz,
  ADD COLUMN shipped_email_status  email_status,   -- NULL until the order is marked shipped
  ADD COLUMN shipped_email_sent_at timestamptz;
```

`NULL` means "no email due yet", shown as "not yet" in the UI (PR #53, 3.4).

### Resend

- `POST /api/admin/orders/{order_number}/emails/{step}/resend`, `step` is `paid` or `shipped`. Admin only (401 without a session, nothing sent).
- Allowed when the order has reached that step and its email status is `failed` or `pending`. Sets `pending`, commits, and sends as above. Returns 409 `{"code": "email_already_sent"}` if it's `sent`, 409 `{"code": "email_not_due"}` if the step wasn't reached.
- The UI has no resend button in R1 (PR #53, D1). The endpoint exists for later and for QA.

### dev and val

- `APP_ENV` decides. In `prd` every customer gets their email.
- In `dev` and `val`, mail goes only to addresses in `EMAIL_ALLOWLIST` (comma-separated; an entry starting with `@` allows a whole domain, e.g. `@example.dk`). Other recipients are **not sent**. The log notes "suppressed: not in allowlist" and the status is set to `sent`, so the UI behaves as in prd.
- If `EMAIL_API_KEY` is empty (local and CI), a log-only sender is used. Tests use a fake sender and never call Brevo.
- One Brevo account and key for all environments. The subject gets a prefix in dev and val (`[dev]`, `[val]`).

### Configuration

| Env var | Example | Notes |
|---|---|---|
| `EMAIL_API_KEY` | Brevo v3 key | Secret, per Render service (already listed in ADR 0001) |
| `EMAIL_FROM` | `probooks <orders@mail.nygaardsvej41.dk>` | |
| `EMAIL_REPLY_TO` | `orders@mail.nygaardsvej41.dk` | Same as the sender; forwarded to the owner by ImprovMX |
| `EMAIL_ALLOWLIST` | `chjort@…,@example.dk` | dev and val only |

### Templates

- Jinja2 templates in `backend/app/emails/`: `paid.txt`, `paid.html`, `shipped.txt`, `shipped.html`. Every email is sent as multipart with both a plain-text and an HTML part.
- The HTML is simple: one column, system fonts, no images, no tracking pixels, no external CSS. Brevo open and click tracking is turned off.
- English. Each email includes the shop name, the order number, the items with quantities, the total in EUR, the delivery address (with `address_line2` on its own line when set, see the ADR 0004 amendment) and the Reply-To contact. The exact text comes from the design task #32.
- Subjects: `Payment received for order BH-7K3Q9` and `Your order BH-7K3Q9 has shipped`.

### Sender interface

```python
class EmailSender(Protocol):
    def send(self, to: str, subject: str, text: str, html: str) -> str: ...  # returns provider message id, raises EmailError
```

Implementations: `BrevoSender` (httpx), `LogSender`, `FakeSender` (tests). Switching provider means adding one class.

## Consequences

- No queue or worker. A crash right after a status change can leave an email `pending`; the admin sees that and can resend.
- The email can be a few seconds behind the status change. The admin UI shows `pending` until it's done.
- €0/month at this volume; the 300/day cap is far above need. If it's ever hit, Brevo holds up to 1,000 extra transactional emails for the next day.
- Customer email addresses and names pass to Brevo (EU). The privacy policy page (R2) must list Brevo as a processor; Brevo's standard DPA covers it.
- The user must create the Brevo and ImprovMX accounts and add the one.com DNS records with their own sign-in.
- ImprovMX is a second processor for reply emails. The privacy policy (R2) must list it.
