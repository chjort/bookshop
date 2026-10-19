#!/usr/bin/env bash
# Usage: deploy.sh <render-deploy-hook> <image> <base-url> <expected-sha>
# Triggers a Render deploy of <image>, then waits until /healthz reports that sha.
set -euo pipefail
hook=$1 image=$2 base=$3 sha=$4

curl -fsS -X POST "${hook}&imgURL=$(printf %s "$image" | jq -sRr @uri)" >/dev/null
echo "Deploy of $image triggered; waiting for $base/healthz to report $sha"

for _ in $(seq 1 60); do
  body=$(curl -fsS "$base/healthz" 2>/dev/null || true)
  if [ "$(printf %s "$body" | jq -r '.status + "/" + .version' 2>/dev/null)" = "ok/$sha" ]; then
    echo "Healthy: $body"; exit 0
  fi
  sleep 10
done
echo "Smoke test failed: last response '$body'" >&2
exit 1
