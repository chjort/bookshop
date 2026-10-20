"""settings, orders and order_lines (ADR 0004, incl. address_line2 amendment)

Revision ID: 0003
"""

from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute(
        """
        CREATE TABLE settings (
          key   text PRIMARY KEY,
          value jsonb NOT NULL
        );
        INSERT INTO settings (key, value) VALUES ('shipping_cents', '300');

        CREATE TYPE order_status AS ENUM ('awaiting_payment', 'paid', 'shipped', 'cancelled');

        CREATE TABLE orders (
          id               bigserial PRIMARY KEY,
          order_number     text         NOT NULL UNIQUE,
          token_hash       bytea        NOT NULL UNIQUE,
          idempotency_key  uuid         NOT NULL UNIQUE,
          request_hash     bytea        NOT NULL,
          status           order_status NOT NULL DEFAULT 'awaiting_payment',
          customer_name    text         NOT NULL,
          email            text         NOT NULL,
          address_line     text         NOT NULL,
          address_line2    text,
          postal_code      text         NOT NULL,
          city             text         NOT NULL,
          country          text         NOT NULL DEFAULT 'DK',
          subtotal_cents   bigint       NOT NULL CHECK (subtotal_cents >= 0),
          shipping_cents   bigint       NOT NULL CHECK (shipping_cents >= 0),
          total_cents      bigint       NOT NULL CHECK (total_cents > 0),
          rate_eur_per_btc numeric(18,2) NOT NULL CHECK (rate_eur_per_btc > 0),
          rate_source      text         NOT NULL,
          rate_fetched_at  timestamptz  NOT NULL,
          amount_sats      bigint       NOT NULL CHECK (amount_sats > 0),
          btc_address      text         NOT NULL,
          created_at       timestamptz  NOT NULL DEFAULT now(),
          paid_at          timestamptz,
          shipped_at       timestamptz,
          cancelled_at     timestamptz
        );

        CREATE TABLE order_lines (
          id               bigserial PRIMARY KEY,
          order_id         bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          book_id          bigint NOT NULL REFERENCES books(id),
          isbn             text   NOT NULL,
          title            text   NOT NULL,
          author           text   NOT NULL,
          unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
          qty              int    NOT NULL CHECK (qty BETWEEN 1 AND 10),
          UNIQUE (order_id, book_id)
        );
        """
    )


def downgrade():
    op.execute("DROP TABLE order_lines, orders, settings; DROP TYPE order_status;")
