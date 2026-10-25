"""orders.status_changed_at and list index (ADR 0007)

Revision ID: 0004
"""

from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.execute(
        """
        ALTER TABLE orders ADD COLUMN status_changed_at timestamptz;
        UPDATE orders SET status_changed_at = created_at;
        ALTER TABLE orders ALTER COLUMN status_changed_at SET NOT NULL,
                           ALTER COLUMN status_changed_at SET DEFAULT now();
        CREATE INDEX orders_status_created ON orders (status, created_at DESC);
        """
    )


def downgrade():
    op.execute(
        "DROP INDEX orders_status_created; ALTER TABLE orders DROP COLUMN status_changed_at;"
    )
