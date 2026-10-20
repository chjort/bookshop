"""Single-owner admin auth (ADR 0003): env credentials, signed session cookie, lockout."""

import os
import sys
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException, Request
from itsdangerous import BadSignature, URLSafeSerializer
from sqlalchemy import text

from app.db import engine

COOKIE = "admin_session"
SESSION_SECONDS = 7 * 24 * 3600
MAX_FAILURES = 5
LOCK_MINUTES = 15

_hasher = PasswordHasher()
# Verified against unknown usernames so timing doesn't reveal which username exists.
_DUMMY_HASH = _hasher.hash("not-the-password")


def _serializer() -> URLSafeSerializer:
    return URLSafeSerializer(os.environ["SESSION_SECRET"], salt="admin-session")


def make_session(username: str) -> str:
    return _serializer().dumps({"u": username, "exp": int(time.time()) + SESSION_SECONDS})


def read_session(token: str | None) -> str | None:
    if not token:
        return None
    try:
        data = _serializer().loads(token)
    except BadSignature:
        return None
    if data.get("exp", 0) < time.time() or data.get("u") != os.environ["ADMIN_USERNAME"]:
        return None
    return data["u"]


def require_admin(request: Request) -> str:
    username = read_session(request.cookies.get(COOKIE))
    if username is None:
        raise HTTPException(401, "Not logged in")
    return username


def check_credentials(username: str, password: str) -> str:
    """Return 'ok', 'wrong' or 'locked'. Updates the lockout table."""
    is_owner = username == os.environ["ADMIN_USERNAME"]
    stored = os.environ["ADMIN_PASSWORD_HASH"] if is_owner else _DUMMY_HASH
    try:
        password_ok = _hasher.verify(stored, password) and is_owner
    except (VerificationError, InvalidHashError):
        password_ok = False

    with engine.begin() as conn:
        locked = conn.execute(
            text("SELECT 1 FROM login_attempts WHERE username = :u AND locked_until > now()"),
            {"u": username},
        ).first()
        if locked:
            return "locked"
        if password_ok:
            conn.execute(text("DELETE FROM login_attempts WHERE username = :u"), {"u": username})
            return "ok"
        conn.execute(
            text(
                """
                INSERT INTO login_attempts (username, failed_count) VALUES (:u, 1)
                ON CONFLICT (username) DO UPDATE SET
                  failed_count = CASE WHEN login_attempts.locked_until IS NOT NULL
                                      THEN 1 ELSE login_attempts.failed_count + 1 END,
                  locked_until = NULL
                """
            ),
            {"u": username},
        )
        conn.execute(
            text(
                "UPDATE login_attempts SET locked_until = now() + make_interval(mins => :m) "
                "WHERE username = :u AND failed_count >= :n"
            ),
            {"u": username, "m": LOCK_MINUTES, "n": MAX_FAILURES},
        )
    return "wrong"


if __name__ == "__main__":
    # python -m app.auth  -> prompts for a password and prints its argon2 hash
    import getpass

    sys.stdout.write(_hasher.hash(getpass.getpass("Password: ")) + "\n")
