import os

from alembic import context
from sqlalchemy import create_engine, text

# Fixed key so concurrently starting containers serialize their migrations.
MIGRATION_LOCK_KEY = 4172025

engine = create_engine(os.environ["DATABASE_URL"])
with engine.connect() as conn:
    conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": MIGRATION_LOCK_KEY})
    conn.commit()
    try:
        context.configure(connection=conn, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()
        conn.commit()
    finally:
        conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": MIGRATION_LOCK_KEY})
        conn.commit()
