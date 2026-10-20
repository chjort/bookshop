"""Public browse and search API (ADR 0006)."""

from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from app.db import engine
from app.search import fold, isbn_forms

PAGE_SIZE = 24
CACHE = "public, max-age=60"
ORDER = 'ORDER BY (stock = 0), title COLLATE "da-DK-x-icu", id'
COLUMNS = "id, isbn, title, author, genre, price_eur, stock"

router = APIRouter(prefix="/api")


class BookCard(BaseModel):
    id: int
    title: str
    author: str
    genre: str
    price_cents: int
    in_stock: bool
    cover_url: str | None


class BookPage(BaseModel):
    items: list[BookCard]
    page: int
    page_size: int
    total: int
    isbn_match: int | None


class Genre(BaseModel):
    name: str
    count: int


class BookDetail(BookCard):
    isbn: str
    stock: int


def cover_url(isbn: str, size: str = "M") -> str:
    return f"https://covers.openlibrary.org/b/isbn/{isbn}-{size}.jpg?default=false"


def card(row) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "author": row.author,
        "genre": row.genre,
        "price_cents": int(row.price_eur * 100),
        "in_stock": row.stock > 0,
        "cover_url": cover_url(row.isbn),
    }


def _escape(word: str) -> str:
    return word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/books", response_model=BookPage)
def list_books(
    response: Response,
    q: str = Query("", max_length=100),
    genre: str = Query("", max_length=100),
    page: int = Query(1, ge=1),
):
    response.headers["Cache-Control"] = CACHE
    q = q.strip()
    where, params = [], {}
    if genre:
        where.append("genre = :genre")
        params["genre"] = genre

    with engine.connect() as conn:
        isbn_match = None
        forms = isbn_forms(q) if q else []
        if forms:
            sql = f"SELECT id FROM books WHERE isbn = ANY(:forms) {'AND genre = :genre' * bool(genre)}"
            isbn_match = conn.execute(text(sql), {**params, "forms": forms}).scalar()
        if isbn_match is not None:
            where.append("id = :match")
            params["match"] = isbn_match
        else:
            for i, word in enumerate(fold(q).split()):
                cond = f"search_text LIKE '%' || :w{i} || '%'"
                if word.isdigit():
                    cond = f"({cond} OR isbn LIKE :w{i} || '%')"
                where.append(cond)
                params[f"w{i}"] = _escape(word)

        sql = f"SELECT {COLUMNS}, count(*) OVER () AS total FROM books"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += f" {ORDER} LIMIT {PAGE_SIZE} OFFSET :offset"
        rows = conn.execute(text(sql), {**params, "offset": (page - 1) * PAGE_SIZE}).all()

        total = rows[0].total if rows else 0
        if not rows and page > 1:
            count_sql = "SELECT count(*) FROM books" + (
                " WHERE " + " AND ".join(where) if where else ""
            )
            total = conn.execute(text(count_sql), params).scalar()

    return {
        "items": [card(r) for r in rows],
        "page": page,
        "page_size": PAGE_SIZE,
        "total": total,
        "isbn_match": isbn_match,
    }


@router.get("/genres", response_model=list[Genre])
def genres(response: Response):
    response.headers["Cache-Control"] = CACHE
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT genre AS name, count(*) AS count FROM books GROUP BY genre "
                "ORDER BY genre = 'Other', genre COLLATE \"da-DK-x-icu\""
            )
        ).all()
    return [{"name": r.name, "count": r.count} for r in rows]


@router.get(
    "/books/{book_id}", response_model=BookDetail, responses={404: {"description": "not_found"}}
)
def book_detail(book_id: int):
    with engine.connect() as conn:
        row = conn.execute(
            text(f"SELECT {COLUMNS} FROM books WHERE id = :id"), {"id": book_id}
        ).first()
    if row is None:
        return JSONResponse({"code": "not_found"}, status_code=404)
    return {
        **card(row),
        "cover_url": cover_url(row.isbn, "L"),
        "isbn": row.isbn,
        "stock": row.stock,
    }
