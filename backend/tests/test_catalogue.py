from app import catalogue, csv_import
from app.db import engine

HEADER = "title,author,ISBN,genre,price,count\n"


def seed(rows: str):
    books, errors = csv_import.parse((HEADER + rows).encode())
    assert errors == []
    with engine.begin() as conn:
        csv_import.save(conn, books)


def titles(r):
    return [b["title"] for b in r.json()["items"]]


SAMPLE = (
    "Århus by night,Peter Møller,9798570901650,Krimi,12.50,3\n"
    "Zebra,José Saramago,9781502809193,Romaner,8.00,0\n"
    "Alfa,Karen Blixen,9798528548340,Romaner,1250.00,1\n"
    "Ærø,Anna Ø,9781981618675,,9.95,2\n"
)


def test_list_sorts_in_stock_first_then_danish_title_order(client):
    seed(SAMPLE)
    r = client.get("/api/books")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=60"
    # Æ and Å sort after Z in Danish; the sold-out Zebra goes last
    assert titles(r) == ["Alfa", "Ærø", "Århus by night", "Zebra"]
    assert r.json()["total"] == 4 and r.json()["page_size"] == 24


def test_card_has_price_cents_stock_flag_and_cover(client):
    seed(SAMPLE)
    zebra = client.get("/api/books").json()["items"][-1]
    assert zebra["price_cents"] == 800 and zebra["in_stock"] is False
    assert zebra["cover_url"] == (
        "https://covers.openlibrary.org/b/isbn/9781502809193-M.jpg?default=false"
    )
    assert "stock" not in zebra


def test_search_folds_danish_letters_case_and_accents(client):
    seed(SAMPLE)
    assert titles(client.get("/api/books", params={"q": "aarhus"})) == ["Århus by night"]
    assert titles(client.get("/api/books", params={"q": "MOELLER"})) == ["Århus by night"]
    assert titles(client.get("/api/books", params={"q": "jose"})) == ["Zebra"]
    assert titles(client.get("/api/books", params={"q": "aeroe"})) == ["Ærø"]
    assert titles(client.get("/api/books", params={"q": "blixen alfa"})) == ["Alfa"]
    assert titles(client.get("/api/books", params={"q": "blixen zebra"})) == []
    assert len(titles(client.get("/api/books", params={"q": "   "}))) == 4


def test_like_wildcards_in_query_are_literal(client):
    seed(SAMPLE)
    # punctuation, including "_", folds away, so these are no search
    for q in ["%", "_", "%_-"]:
        assert len(titles(client.get("/api/books", params={"q": q}))) == 4
    # fold() strips them, and _escape is a second guard before LIKE
    assert catalogue._escape("a%b_c\\") == "a\\%b\\_c\\\\"


def test_exact_isbn_search_returns_the_match(client):
    seed(SAMPLE)
    r = client.get("/api/books", params={"q": "979-8-5285-4834-0"}).json()
    assert r["isbn_match"] == r["items"][0]["id"] and r["total"] == 1
    prefix = client.get("/api/books", params={"q": "97985"}).json()
    assert prefix["isbn_match"] is None and prefix["total"] == 2


def test_genre_filter_and_genre_list(client):
    seed(SAMPLE)
    assert titles(client.get("/api/books", params={"genre": "Romaner"})) == ["Alfa", "Zebra"]
    assert titles(client.get("/api/books", params={"genre": "Other"})) == ["Ærø"]
    assert client.get("/api/genres").json() == [
        {"name": "Krimi", "count": 1},
        {"name": "Romaner", "count": 2},
        {"name": "Other", "count": 1},
    ]


def test_paging(client):
    seed("".join(f"Book {i:03d},A,{_isbn(i)},G,1.00,1\n" for i in range(30)))
    p2 = client.get("/api/books", params={"page": 2}).json()
    assert [b["title"] for b in p2["items"]][:1] == ["Book 024"] and len(p2["items"]) == 6
    past = client.get("/api/books", params={"page": 9}).json()
    assert past["items"] == [] and past["total"] == 30
    assert client.get("/api/books", params={"page": 0}).status_code == 422
    assert client.get("/api/books", params={"q": "x" * 101}).status_code == 422


def test_book_detail(client):
    seed(SAMPLE)
    book_id = client.get("/api/books", params={"q": "zebra"}).json()["items"][0]["id"]
    d = client.get(f"/api/books/{book_id}").json()
    assert (
        d["isbn"] == "9781502809193"
        and d["stock"] == 0
        and d["cover_url"].endswith("-L.jpg?default=false")
    )
    r = client.get("/api/books/999999")
    assert r.status_code == 404 and r.json() == {"code": "not_found"}


def _isbn(n):
    s = f"978{n:09d}"
    return s + str((10 - sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s)) % 10) % 10)
