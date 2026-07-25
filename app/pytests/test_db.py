import sqlite3
from ledgerly.db import init_db, migrate

def test_migrate_idempotent() -> None:
    conn = init_db(":memory:")
    migrate(conn)
    assert conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 1
    names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"schema_version", "accounts", "transactions", "categories"} <= names
