# ADR 0006: Browse and search

Status: Proposed · Author: pro-architect · Task: #13 (feature #12) · Design: `docs/design/browse-search.md` (PR #48)

## Context

Customers browse thousands of titles, filter by genre, search by title, author or ISBN, and open a book page with cover, EUR price and stock status (#12). The UI is English, but many titles and authors are Danish, so search must fold `å`/`aa`, `ø`/`oe`, `æ`/`ae`, and ignore case and accents (`Aarhus` finds `Århus`, `Moeller` finds `Møller`, `Jose` finds `José`). Sold-out books (stock 0) stay visible, listed last. Books come from the CSV import (ADR 0003): `isbn`, `title`, `author`, `genre`, `price`, `stock`. Postgres on Render; no extra services.

## Options

- **Python folding at write time into a stored column, plus a `pg_trgm` GIN index** (chosen). One function, used for both stored text and the query, so they always agree. Substring matches anywhere in title or author. Only needs the `pg_trgm` extension, which Render Postgres supports.
- `unaccent` plus a custom Postgres function for `aa`/`oe`/`ae`: two places to keep the folding rules in sync, and `unaccent` isn't immutable, so it needs a wrapper to be indexable. Rejected.
- Postgres full-text search (`tsvector`): word stemming doesn't help with names and ISBNs, and it doesn't match parts of words. Rejected.
- External search (Meilisearch, Algolia): another service and cost for a few thousand rows. Rejected.

## Decision

### Folding

```python
_DANISH = {"æ": "ae", "ø": "oe", "å": "aa"}

def fold(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    s = "".join(_DANISH.get(c, c) for c in s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))  # é→e, ü→u
    return " ".join(re.sub(r"[^\w]+", " ", s).split())
```

Everything folds to the two-letter form, so `Århus`, `Aarhus` and `aarhus` all become `aarhus`, and `Møller`/`Moeller` become `moeller`. Unit tests cover these pairs plus `José`, `Ærø`/`aeroe`, empty and whitespace input.

### Data model

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE books
  ADD COLUMN search_text text NOT NULL DEFAULT '';   -- fold(title + ' ' + author), set by the app on insert/update
CREATE INDEX books_search_trgm ON books USING gin (search_text gin_trgm_ops);
CREATE INDEX books_genre ON books (genre);
CREATE INDEX books_list_order ON books ((stock = 0), title COLLATE "da-DK-x-icu", id);
```

- `isbn` is already stored as digits only (ISBN-10 or ISBN-13, hyphens stripped, ADR 0003) with a unique index.
- The import and any book update set `search_text` in the same statement. A migration backfills existing rows.
- Empty genre is stored as `Other` at import (the English name replaces "Øvrige").

### Query

- `q` is trimmed. Empty or whitespace-only means no search.
- **ISBN:** if `q` with hyphens and spaces removed is 10 or 13 digits (ISBN-10's last char may be `X`), look for an exact match on `isbn`, trying both the ISBN-10 and ISBN-13 form of the input. If found, the response says so (`isbn_match`) and the SPA opens the book page. If not found, it falls through to text search.
- **Text:** `fold(q)` split into words; every word must be found: `search_text LIKE '%' || :w || '%'` for each word (AND), plus digits-only words also match `isbn LIKE :w || '%'`. The trigram index serves `LIKE` with 3+ characters; 1–2 character words still work, just without the index (fine at this size). `%` and `_` in the input are escaped.
- **Genre:** `genre = :genre` (exact, as returned by `/api/genres`). Combines with `q`.
- **Sort:** in-stock first, then title A–Z with Danish ICU collation (Æ, Ø, Å after Z), then `id` so pages are stable. One order for all lists; no sort control in R1.
- **Paging:** `LIMIT 24 OFFSET (page-1)*24` plus `count(*) OVER ()` for the total. 24 fills a 2-, 3- or 4-column grid. Offset paging is fine at a few thousand rows. A page past the end returns an empty `items` with the real `total`, and the SPA shows the last page.

### API contracts

All public, no auth. `Cache-Control: public, max-age=60` on list and genres.

```python
class BookCard(BaseModel):
    id: int
    title: str
    author: str
    genre: str
    price_cents: int          # EUR
    in_stock: bool            # stock > 0; sold-out books are listed, last
    cover_url: str | None     # Open Library URL or None → placeholder

class BookPage(BaseModel):    # GET /api/books?q=&genre=&page=  → 200
    items: list[BookCard]
    page: int                 # 1-based, default 1; < 1 → 422
    page_size: int            # 24
    total: int
    isbn_match: int | None    # book id when q was an exact ISBN hit

class Genre(BaseModel):       # GET /api/genres → 200 list[Genre]
    name: str                 # "Other" sorted last, others A–Z (Danish collation)
    count: int                # books in the genre, sold-out included

class BookDetail(BookCard):   # GET /api/books/{id} → 200 | 404 {"code": "not_found"}
    isbn: str                 # digits as stored; the SPA hyphenates for display if it wants
    stock: int                # exact count, for capping the cart (ADR 0004)
```

- `q` max 100 characters, `genre` max 100; longer → 422.
- `stock` is not exposed in the list, only `in_stock`.

### Covers

- `cover_url` is `https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg?default=false`, built from the ISBN with no server call. The browser loads it directly; on a 404 (`default=false`) the SPA shows the placeholder. `-L` on the book page.
- Nothing is cached or proxied in R1. If Open Library is slow, the page still renders and only the image is late.

## Consequences

- One Python function defines search folding; the query and the stored text can't drift. Changing the rules needs a backfill (one `UPDATE` from a small script run by the migration).
- Search finds substrings anywhere in title or author with no ranking: results use the normal list order. Good enough for R1; ranking could come later with `similarity()`.
- Requires the `pg_trgm` extension and the `da-DK-x-icu` collation in each database. Both are available on Render Postgres; the migration creates the extension.
- The browser talks to Open Library directly, so Open Library sees customer IPs. The privacy policy (R2) should mention it.
