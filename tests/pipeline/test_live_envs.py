"""Live checks of dev, val and prd. Run with: LIVE=1 pytest tests/pipeline — pro-qa"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[2] / "scripts"))
import smoke_test  # noqa: E402

ENVS = {
    "dev": "https://probooks.dev.nygaardsvej41.dk",
    "val": "https://probooks.val.nygaardsvej41.dk",
    "prd": "https://probooks.nygaardsvej41.dk",
}
pytestmark = pytest.mark.skipif(not os.environ.get("LIVE"), reason="set LIVE=1 to hit live envs")


def health(base):
    for _ in range(6):
        try:
            return json.loads(smoke_test.fetch(base + "/healthz", timeout=90)[1])
        except Exception:
            pass
    pytest.fail(f"{base}/healthz unreachable")


@pytest.mark.parametrize("env", ENVS)
def test_env_healthy_over_https(env):
    h = health(ENVS[env])
    assert h["status"] == "ok", h
    assert len(h["version"]) == 40, f"version is not a commit sha: {h}"


@pytest.mark.parametrize("env", ENVS)
def test_env_reports_own_name_and_db(env):
    h = health(ENVS[env])
    assert h.get("env") == env, f"/healthz does not report env name: {h}"
    assert h.get("db"), f"/healthz does not report which database it uses: {h}"


def test_dbs_are_separate():
    dbs = {e: health(b).get("db") for e, b in ENVS.items()}
    if not all(dbs.values()):
        pytest.fail(f"/healthz does not report db names: {dbs}")
    assert len(set(dbs.values())) == 3, dbs
