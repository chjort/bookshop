"""Catalogue CSV parsing and upsert (ADR 0003, design docs/design/admin-login-import.md)."""

import csv
import io
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from sqlalchemy import text

from app.search import fold

REQUIRED = ["title", "author", "isbn", "genre", "price", "count"]
EMPTY_GENRE = "Other"


class FileError(Exception):
    """The whole file is rejected; nothing is imported."""


def normalize_isbn(raw: str) -> str | None:
    """Digits only (ISBN-10 may end in X) with a valid checksum, else None."""
    s = raw.replace("-", "").replace(" ", "").upper()
    if len(s) == 13 and s.isdigit():
        total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s[:12]))
        return s if (10 - total % 10) % 10 == int(s[12]) else None
    if len(s) == 10 and s[:9].isdigit() and (s[9].isdigit() or s[9] == "X"):
        digits = [int(c) for c in s[:9]] + [10 if s[9] == "X" else int(s[9])]
        return s if sum((10 - i) * d for i, d in enumerate(digits)) % 11 == 0 else None
    return None


def _price(raw: str) -> tuple[Decimal | None, str | None]:
    if not raw:
        return None, "Price is missing"
    try:
        value = Decimal(raw.replace(",", "."))
    except InvalidOperation:
        return None, f"Invalid price: ‘{raw}’"
    if not value.is_finite() or value.as_tuple().exponent < -2:
        return None, f"Invalid price: ‘{raw}’"
    if value <= 0:
        return None, "Price must be greater than 0"
    return value, None


def _count(raw: str) -> tuple[int | None, str | None]:
    if not raw:
        return None, "Count is missing"
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return None, f"Invalid count: ‘{raw}’"
    if not value.is_finite():
        return None, f"Invalid count: ‘{raw}’"
    if value < 0:
        return None, "Count can't be negative"
    if value != value.to_integral_value():
        return None, "Count must be a whole number"
    return int(value), None


def parse(data: bytes) -> tuple[list[dict], list[dict]]:
    """Return (valid books, row errors). Raises FileError for file-level problems."""
    try:
        return _parse(data)
    except csv.Error:
        raise FileError("The file couldn't be read as CSV.") from None


def _parse(data: bytes) -> tuple[list[dict], list[dict]]:
    try:
        content = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise FileError(
            "The file isn't saved as UTF-8. Save it as ‘CSV UTF-8’ in Excel and try again."
        ) from None
    if not content.strip():
        raise FileError("The file is empty.")

    first_line = content.splitlines()[0]
    sep = ";" if first_line.count(";") > first_line.count(",") else ","
    reader = csv.reader(io.StringIO(content, newline=""), delimiter=sep)
    header = [h.strip().lower() for h in next(reader)]
    missing = [name for name in REQUIRED if name not in header]
    if missing:
        names = ", ".join(f"‘{'ISBN' if m == 'isbn' else m}’" for m in missing)
        raise FileError(
            f"The column {names} is missing. Required columns: title, author, ISBN, genre, "
            "price, count."
        )
    col = {name: header.index(name) for name in REQUIRED}

    books, errors = [], []
    for row_number, row in enumerate(reader, start=2):
        if not any(cell.strip() for cell in row):
            continue
        get = {name: (row[i].strip() if i < len(row) else "") for name, i in col.items()}
        problems = []
        isbn = normalize_isbn(get["isbn"]) if get["isbn"] else None
        if not get["isbn"]:
            problems.append("ISBN is missing")
        elif isbn is None:
            problems.append("Invalid ISBN")
        if not get["title"]:
            problems.append("Title is missing")
        if not get["author"]:
            problems.append("Author is missing")
        price, err = _price(get["price"])
        problems += [err] if err else []
        stock, err = _count(get["count"])
        problems += [err] if err else []

        if problems:
            errors.append({"row_number": row_number, "isbn": get["isbn"], "errors": problems})
        else:
            books.append(
                {
                    "row_number": row_number,
                    "isbn": isbn,
                    "title": get["title"],
                    "author": get["author"],
                    "genre": get["genre"] or EMPTY_GENRE,
                    "price_eur": price,
                    "stock": stock,
                }
            )

    if not books and not errors:
        raise FileError("The file contains no books.")

    rows_by_isbn = defaultdict(list)
    for book in books:
        rows_by_isbn[book["isbn"]].append(book["row_number"])
    dupes = {isbn: rows for isbn, rows in rows_by_isbn.items() if len(rows) > 1}
    for book in books:
        if book["isbn"] in dupes:
            rows = " and ".join(map(str, dupes[book["isbn"]]))
            msg = f"ISBN appears more than once (rows {rows})"
            errors.append({"row_number": book["row_number"], "isbn": book["isbn"], "errors": [msg]})
    books = [b for b in books if b["isbn"] not in dupes]
    errors.sort(key=lambda e: e["row_number"])
    return books, errors


UPSERT = text(
    """
    INSERT INTO books (isbn, title, author, genre, price_eur, stock, search_text)
    VALUES (:isbn, :title, :author, :genre, :price_eur, :stock, :search_text)
    ON CONFLICT (isbn) DO UPDATE SET
      title = EXCLUDED.title, author = EXCLUDED.author, genre = EXCLUDED.genre,
      price_eur = EXCLUDED.price_eur, stock = EXCLUDED.stock,
      search_text = EXCLUDED.search_text, updated_at = now()
    RETURNING (xmax = 0) AS inserted
    """
)


def save(conn, books: list[dict]) -> tuple[int, int]:
    """Upsert books by ISBN. Returns (created, updated)."""
    created = 0
    for book in books:
        params = {**book, "search_text": fold(f"{book['title']} {book['author']}")}
        created += conn.execute(UPSERT, params).scalar_one()
    return created, len(books) - created
