"""books and login_attempts

Revision ID: 0001
"""

from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    op.execute(
        """
        CREATE TABLE books (
          id         bigserial PRIMARY KEY,
          isbn       text NOT NULL UNIQUE,
          title      text NOT NULL,
          author     text NOT NULL,
          genre      text NOT NULL,
          price_eur  numeric(10,2) NOT NULL CHECK (price_eur > 0),
          stock      integer NOT NULL CHECK (stock >= 0),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE login_attempts (
          username     text PRIMARY KEY,
          failed_count integer NOT NULL DEFAULT 0,
          locked_until timestamptz
        );
        """
    )


def downgrade():
    op.execute("DROP TABLE login_attempts; DROP TABLE books;")
