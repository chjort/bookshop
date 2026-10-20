import os

import pytest
from argon2 import PasswordHasher

# Test-only credentials; real ones come from env vars per environment.
TEST_PASSWORD = "test-password"
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ["ADMIN_PASSWORD_HASH"] = PasswordHasher().hash(TEST_PASSWORD)
os.environ.setdefault("SESSION_SECRET", "test-session-secret")
os.environ.setdefault("ORDER_TOKEN_SECRET", "test-order-token-secret")
os.environ.setdefault("BTC_ADDRESS", "bc1qtestaddress0000000000000000000000000")

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE books, login_attempts, orders, order_lines"))


@pytest.fixture
def client():
    # https so the Secure session cookie is sent back
    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def admin(client):
    r = client.post("/api/admin/login", json={"username": "admin", "password": TEST_PASSWORD})
    assert r.status_code == 200
    return client
