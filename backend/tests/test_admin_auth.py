from tests.conftest import TEST_PASSWORD


def login(client, username="admin", password=TEST_PASSWORD):
    return client.post("/api/admin/login", json={"username": username, "password": password})


def test_admin_pages_need_login(client):
    assert client.get("/api/admin/me").status_code == 401
    assert client.get("/api/admin/catalogue").status_code == 401
    r = client.post(
        "/api/admin/import",
        files={"file": ("b.csv", b"x")},
        headers={"X-Requested-With": "bookshop"},
    )
    assert r.status_code == 401


def test_owner_logs_in_and_out(client):
    r = login(client)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
    assert client.get("/api/admin/me").json() == {"username": "admin"}

    client.post("/api/admin/logout", json={})
    assert client.get("/api/admin/me").status_code == 401


def test_wrong_password_and_unknown_user_get_same_generic_error(client):
    a = login(client, password="nope")
    b = login(client, username="someone", password="nope")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"detail": "Wrong username or password."}


def test_tampered_cookie_is_rejected(client):
    client.cookies.set("admin_session", "forged.value", domain="testserver")
    assert client.get("/api/admin/me").status_code == 401


def test_five_failures_lock_login_even_with_right_password(client):
    for _ in range(5):
        assert login(client, password="nope").status_code == 401
    r = login(client)
    assert r.status_code == 429
    assert r.json() == {"detail": "Wrong username or password."}


def test_success_resets_failure_count(client):
    for _ in range(4):
        login(client, password="nope")
    assert login(client).status_code == 200
    for _ in range(4):
        login(client, password="nope")
    assert login(client).status_code == 200


def test_login_requires_json(client):
    r = client.post("/api/admin/login", data={"username": "admin", "password": TEST_PASSWORD})
    assert r.status_code == 415
