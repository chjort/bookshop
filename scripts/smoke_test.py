#!/usr/bin/env python3
"""Post-deploy smoke test. Stdlib only.

Usage: smoke_test.py <base-url> <expected-sha> [<expected-env>]

Checks: base URL is HTTPS, /healthz returns 200 with status "ok" (DB reachable)
and version == expected sha, and the SPA is served at /. If the health response
carries "env", it must equal <expected-env>. Retries for a Render cold start.
"""
import json
import sys
import time
import urllib.request


def fetch(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read().decode()


def check(base, sha, env=None, attempts=12, delay=10):
    errors = []
    if not base.startswith("https://"):
        return [f"{base} is not HTTPS"]
    last = None
    for _ in range(attempts):
        try:
            status, body = fetch(base.rstrip("/") + "/healthz")
            last = json.loads(body)
            if status == 200 and last.get("status") == "ok":
                break
        except Exception as e:  # cold start, 503, timeout
            last = repr(e)
        time.sleep(delay)
    if not isinstance(last, dict) or last.get("status") != "ok":
        return [f"healthz not ok: {last}"]
    if last.get("version") != sha:
        errors.append(f"version {last.get('version')} != expected {sha}")
    if env and "env" in last and last["env"] != env:
        errors.append(f"env {last['env']} != expected {env}")
    status, body = fetch(base.rstrip("/") + "/")
    if status != 200 or '<div id="root">' not in body:
        errors.append("SPA not served at /")
    return errors


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    errs = check(*sys.argv[1:4])
    for e in errs:
        print(f"FAIL: {e}", file=sys.stderr)
    print("Smoke test passed" if not errs else "Smoke test failed")
    sys.exit(1 if errs else 0)
