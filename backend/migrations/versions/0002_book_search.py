"""book search: search_text, trigram and list indexes (ADR 0006)

Revision ID: 0002
"""

import sqlalchemy as sa
from alembic import op

from app.search import fold

revision = "0002"
down_revision = "0001"


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("ALTER TABLE books ADD COLUMN search_text text NOT NULL DEFAULT ''")
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, title, author FROM books")).all()
    for r in rows:
        conn.execute(
            sa.text("UPDATE books SET search_text = :s WHERE id = :id"),
            {"s": fold(f"{r.title} {r.author}"), "id": r.id},
        )
    op.execute("CREATE INDEX books_search_trgm ON books USING gin (search_text gin_trgm_ops)")
    op.execute("CREATE INDEX books_genre ON books (genre)")
    op.execute(
        'CREATE INDEX books_list_order ON books ((stock = 0), title COLLATE "da-DK-x-icu", id)'
    )


def downgrade():
    op.execute("DROP INDEX books_list_order, books_genre, books_search_trgm")
    op.execute("ALTER TABLE books DROP COLUMN search_text")
