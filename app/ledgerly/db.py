"""SQLite storage and schema migrations."""
import os
import sqlite3
from pathlib import Path
from typing import Optional


def get_connection(path: Optional[str] = None) -> sqlite3.Connection:
    """Open a configured SQLite connection."""
    database = path if path is not None else os.environ.get("LEDGERLY_DB", "app/data/ledgerly.db")
    conn = sqlite3.connect(database)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    """Apply all schema migrations in order, safely on every invocation."""
    with conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
        version = int(row[0]) if row is not None and row[0] is not None else 0

        if version < 1:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    kind TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    opening_balance_cents INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )"""
            )
            conn.execute(
                """CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount_cents INTEGER NOT NULL,
                    category_id INTEGER,
                    is_transfer INTEGER NOT NULL DEFAULT 0,
                    external_id TEXT,
                    created_at TEXT NOT NULL
                )"""
            )
            conn.execute(
                """CREATE TABLE IF NOT EXISTS categories (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    parent_id INTEGER REFERENCES categories(id),
                    kind TEXT NOT NULL
                )"""
            )
            conn.execute("DELETE FROM schema_version")
            conn.execute("INSERT INTO schema_version(version) VALUES (1)")
            version = 1

        if version < 2:
            conn.execute("ALTER TABLE accounts ADD COLUMN archived_at TEXT")
            conn.execute("UPDATE schema_version SET version = 2")
            version = 2

        if version < 3:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS rules (
                    id INTEGER PRIMARY KEY,
                    pattern TEXT NOT NULL,
                    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    priority INTEGER NOT NULL,
                    is_regex INTEGER NOT NULL DEFAULT 0
                )"""
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority DESC, id ASC)"
            )
            conn.execute("UPDATE schema_version SET version = 3")
            version = 3

        if version < 4:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS budgets (
                    id INTEGER PRIMARY KEY,
                    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                    period TEXT NOT NULL,
                    limit_cents INTEGER NOT NULL,
                    UNIQUE (category_id, period)
                )"""
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period)")
            conn.execute("UPDATE schema_version SET version = 4")
            version = 4

        if version < 5:
            conn.execute("ALTER TABLE transactions ADD COLUMN reconciled_at TEXT")
            conn.execute("UPDATE schema_version SET version = 5")


def init_db(path: Optional[str] = None) -> sqlite3.Connection:
    """Open, migrate, and seed the configured database."""
    database = path if path is not None else os.environ.get("LEDGERLY_DB", "app/data/ledgerly.db")
    if database != ":memory:":
        Path(database).parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection(database)
    migrate(conn)
    # Import after migrations to avoid a module-level storage dependency cycle.
    from ledgerly.categories import seed_defaults

    seed_defaults(conn)
    return conn
