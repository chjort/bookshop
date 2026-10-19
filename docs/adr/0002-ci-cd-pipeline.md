# ADR 0002: CI/CD pipeline

Status: Proposed · Author: pro-architect · Task: #2 (feature #1)

## Context

Trunk-based on GitHub, only the user merges, every PR must be green. dev, val and prd on Render (ADR 0001). Versions are plain integers; the prd commit is tagged `vN`.

## Options

- **GitHub Actions + Render deploy hooks** (chosen): no extra tools, environments with approvals built in.
- Render auto-deploy from git: no promotion control, rejected.
- External CI (CircleCI etc.): extra account for no gain, rejected.

## Decision

**On pull request** (`.github/workflows/ci.yml`), required status checks on `main`:
1. Lint: `ruff` (backend), `eslint` (frontend).
2. Backend tests: `pytest` against a Postgres service container.
3. Frontend tests: `vitest`.
4. Docker image build (multi-stage: build SPA, then Python runtime).

Branch protection on `main`: PR required, all checks green, no direct pushes.

**On merge to main** (`.github/workflows/deploy.yml`):
1. Build the image once, tag it with the commit SHA, push to GHCR (`ghcr.io/chjort/bookshop:<sha>`).
2. Deploy to **dev**: call the dev deploy hook with `?imgURL=` for that SHA.
3. Migrations: the image runs `alembic upgrade head` as the Render pre-deploy command, so a failed migration stops the deploy.
4. Smoke test: poll `https://dev.nygaardsvej41.dk/healthz` until it returns 200 with the expected SHA.

**Promote to val**: `workflow_dispatch` with input `sha`, job on GitHub environment `val`. Deploys the same image, then smoke tests.

**Promote to prd**: `workflow_dispatch` with input `sha`, job on GitHub environment `prd` with required reviewer **chjort**. Deploys the same image, smoke tests, then tags the commit with the next `vN` (highest existing `v*` + 1) and creates a GitHub release.

Render services have auto-deploy off; only the pipeline deploys. Deploy hook URLs are GitHub environment secrets `RENDER_DEPLOY_HOOK` in `dev`, `val`, `prd`. `/healthz` returns `{"status":"ok","version":"<sha>"}` and checks the database connection.

```mermaid
flowchart LR
  PR[Pull request] --> CI[lint + pytest + vitest + docker build]
  CI -->|user merges| B[build image :sha → GHCR]
  B --> D[deploy dev + migrate + smoke]
  D -->|manual dispatch| V[deploy val + smoke]
  V -->|approval: chjort| P[deploy prd + smoke]
  P --> T[tag vN + GitHub release]
```

## Consequences

- One image goes through all envs, so val and prd run exactly what was tested.
- Migrations must be backward compatible with the previous release (expand, then contract), since the old version runs while the new one starts.
- Rollback: re-run the promote workflow with the previous SHA (schema changes need a forward fix).

## Manual setup (needs the user's own sign-in)

1. GitHub: create environments `dev`, `val`, `prd`; on `prd` add required reviewer chjort.
2. Copy each Render service's deploy hook URL into `RENDER_DEPLOY_HOOK` in the matching GitHub environment.
3. GitHub: enable branch protection on `main` with the CI checks required (once the CI workflow has run once).
4. If the GHCR package is private, add GHCR credentials as a registry credential in Render (or make the package public).
