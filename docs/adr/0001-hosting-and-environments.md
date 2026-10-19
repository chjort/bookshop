# ADR 0001: Hosting and environments

Status: Proposed · Author: pro-architect · Task: #2 (feature #1)

## Context

Small Danish webshop: Python backend, React frontend, Postgres. Three environments (dev, val, prd), domain nygaardsvej41.dk at one.com, target about $13/month, EU hosting, low ops effort.

## Options

| Option | Notes | Verdict |
|---|---|---|
| **Render, Frankfurt, one account** | Managed web services and Postgres, free web tier, deploy hooks, managed TLS on custom domains | **Chosen** |
| Railway (Amsterdam) | Good DX, but only a $5 trial credit, then usage billing | Runner-up |
| Fly.io | Short trial, more ops (machines, volumes) | Rejected |
| Render, separate Postgres per env | Full isolation, but ~3x database cost | Rejected on cost |
| Render free Postgres | One per workspace, expires after 30 days, 1 GB, no backups | Rejected |

## Decision

- **Region**: Render Frankfurt, one Render account.
- **Database**: one paid Render Postgres (~$6/mo) with three databases `shop_dev`, `shop_val`, `shop_prd`. Each has its own login role that owns only its database; `CONNECT` is revoked from `PUBLIC` on all three, so no role can reach another env's data.
- **Web services**: one per env, one container each.
  - prd: Starter, always on (~$7/mo).
  - dev, val: free tier (sleeps after 15 min idle; first request after sleep is slow).
- **Total**: about $13/month.
- **App shape**: a single Docker image. FastAPI serves `/api/*` and `/healthz`, and serves the built React SPA as static files (SPA fallback to `index.html`). Same origin, so no CORS.
- **Domains**: prd on `nygaardsvej41.dk` and `www`; `dev.nygaardsvej41.dk` and `val.nygaardsvej41.dk` by CNAME to each service's `onrender.com` host. Apex uses the A record Render gives. TLS is issued and renewed by Render.
- **Config and secrets**: Render environment variables per service: `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `BTC_ADDRESS`, `EMAIL_API_KEY`, `APP_ENV`. Nothing secret in git. **No bitcoin private keys are stored anywhere**; the shop only knows the public receive address.

## Consequences

- One shared Postgres is a shared failure domain: a heavy dev query, runaway connections or a bad dev migration can slow or hurt prd.
  - Mitigations: per-env roles with no cross access; per-role `CONNECTION LIMIT` (e.g. dev 5, val 5, prd 20); migrations run through the pipeline only, dev first; Render's daily backups on the paid instance.
- dev/val cold starts (~30–60 s) are acceptable for testing, not for customers, hence prd on Starter.
- Moving to separate instances later is a `pg_dump`/restore plus a `DATABASE_URL` change.

## Manual setup (needs the user's own sign-in)

1. Create the Render account (Frankfurt) and add a payment method.
2. Create the paid Postgres instance. Then run the provisioning SQL (pro-developer/pro-architect will supply `infra/db/provision.sql`) to create the three databases and roles.
3. Create web services `bookshop-dev`, `bookshop-val`, `bookshop-prd` (Docker, auto-deploy **off**), set env vars per service.
4. Add custom domains in Render, then at one.com: CNAME `dev` and `val` to their `onrender.com` hosts, A record for apex and CNAME `www` for prd, as Render shows. Wait for Render to verify and issue TLS.

## Update 2026-10-20: domains and settings

The shop is called probooks. Each environment has its own subdomain of `nygaardsvej41.dk` (DNS at one.com):

| Env | Address | DNS record at one.com |
|-----|---------|------------------------|
| dev | `probooks.dev.nygaardsvej41.dk` | CNAME to the dev Render service's `onrender.com` host |
| val | `probooks.val.nygaardsvej41.dk` | CNAME to the val Render service's `onrender.com` host |
| prd | `probooks.nygaardsvej41.dk` | CNAME to the prd Render service's `onrender.com` host |

Render issues the TLS certificates. Each service also sets `PUBLIC_BASE_URL` to its address, used for links in emails. New secret env var `ORDER_TOKEN_SECRET` (ADR 0004). The flat shipping fee starts at 3,00 € (`shipping_cents = 300`).

The repo is public, so the GitHub environments `dev`, `val` and `prd` exist; `prd` requires approval from chjort and deploys only from main. By team rule only the user approves prd.
