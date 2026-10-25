from sqlalchemy import text

from app.db import engine

HEADER = "title,author,ISBN,genre,price,count\n"


def upload(client, content, name="books.csv", header=True):
    data = content.encode() if isinstance(content, str) else content
    headers = {"X-Requested-With": "bookshop"} if header else {}
    return client.post(
        "/api/admin/import", files={"file": (name, data, "text/csv")}, headers=headers
    )


def books():
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT isbn, title, genre, price_eur, stock FROM books ORDER BY isbn")
        ).all()
    return [(r.isbn, r.title, r.genre, str(r.price_eur), r.stock) for r in rows]


def test_design_example_imports_valid_rows_and_lists_the_rest(admin):
    csv = HEADER + (
        "Kongens Fald,Johannes V. Jensen,9798570901650,Klassikere,12.50,3\n"
        'Hærværk,Tom Kristensen,978-1-5028-0919-3,Klassikere,"9,95",1.0\n'
        "Ternet Ninja,Anders Matthesen,9798528548340,,15.00,0\n"
        "Halv bog,Ukendt,9781981618675,,8.00,3.5\n"
    )
    r = upload(admin, csv)
    assert r.status_code == 200
    assert r.json() == {
        "created": 3,
        "updated": 0,
        "skipped": 1,
        "held_back": 0,
        "errors": [
            {"row_number": 5, "isbn": "9781981618675", "errors": ["Count must be a whole number"]}
        ],
    }
    assert books() == [
        ("9781502809193", "Hærværk", "Klassikere", "9.95", 1),
        ("9798528548340", "Ternet Ninja", "Other", "15.00", 0),
        ("9798570901650", "Kongens Fald", "Klassikere", "12.50", 3),
    ]


def test_reimport_updates_by_isbn(admin):
    upload(admin, HEADER + "Old title,A,9798570901650,G,10.00,1\n")
    r = upload(admin, HEADER + "New title,A,9798570901650,G,11.00,5\n")
    assert r.json()["created"] == 0 and r.json()["updated"] == 1
    assert books() == [("9798570901650", "New title", "G", "11.00", 5)]


def test_semicolon_separator_bom_and_header_case(admin):
    csv = "\ufeffTITLE;Author;isbn;Genre;PRICE;Count;extra\nT;A;0-306-40615-2;G;12,50;2;x\n"
    r = upload(admin, csv)
    assert r.json()["created"] == 1
    assert books() == [("0306406152", "T", "G", "12.50", 2)]


def test_windows_line_endings_and_quoted_commas(admin):
    csv = HEADER.replace("\n", "\r\n") + '"Title, with comma",A,9798570901650,G,12.50,1\r\n'
    assert upload(admin, csv).json()["created"] == 1
    assert books()[0][1] == "Title, with comma"


def test_row_errors_are_listed_with_reasons(admin):
    csv = HEADER + (
        ",A,9798570901650,G,1.00,1\n"
        "T,A,9798570901651,G,1.00,1\n"
        "T,A,,G,0,-1\n"
        "T,A,9798570901650,G,abc,x\n"
        "T,A,9798528548340,G,1.00,1\n"
        "T,A,9798528548340,G,2.00,1\n"
    )
    errors = {e["row_number"]: e["errors"] for e in upload(admin, csv).json()["errors"]}
    assert errors == {
        2: ["Title is missing"],
        3: ["Invalid ISBN"],
        4: ["ISBN is missing", "Price must be greater than 0", "Count can't be negative"],
        5: ["Invalid price: ‘abc’", "Invalid count: ‘x’"],
        6: ["ISBN appears more than once (rows 6 and 7)"],
        7: ["ISBN appears more than once (rows 6 and 7)"],
    }
    assert books() == []


def test_file_level_errors_import_nothing(admin):
    r = upload(admin, "title,author,price\nT,A,1\n")
    assert r.status_code == 422
    assert "‘ISBN’, ‘genre’, ‘count’" in r.json()["detail"]
    r = upload(admin, (HEADER + "Hærværk,A,9798570901650,G,1.00,1\n").encode("cp1252"))
    assert r.status_code == 422 and "UTF-8" in r.json()["detail"]
    assert upload(admin, "").json()["detail"] == "The file is empty."
    assert upload(admin, HEADER).json()["detail"] == "The file contains no books."
    assert upload(admin, b"a" * (5 * 1024 * 1024 + 1)).status_code == 413
    assert books() == []


def test_import_requires_custom_header(admin):
    assert upload(admin, HEADER, header=False).status_code == 403


def isbn13(n):
    s = f"978{n:09d}"
    check = (10 - sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s)) % 10) % 10
    return s + str(check)


def test_five_thousand_rows_import(admin):
    csv = HEADER + "".join(f"Book {i},Author,{isbn13(i)},G,12.50,3.0\n" for i in range(5000))
    r = upload(admin, csv)
    assert r.status_code == 200
    assert r.json()["created"] == 5000
    assert admin.get("/api/admin/catalogue").json()["books"] == 5000
