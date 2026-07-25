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
    """Create the initial schema, safely on every invocation."""
    with conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        if conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 0:
            conn.execute("INSERT INTO schema_version(version) VALUES (1)")
        conn.execute("""CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            kind TEXT NOT NULL, currency TEXT NOT NULL,
            opening_balance_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)
        """)
        conn.execute("""CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            date TEXT NOT NULL, description TEXT NOT NULL, amount_cents INTEGER NOT NULL,
            category_id INTEGER, is_transfer INTEGER NOT NULL DEFAULT 0,
            external_id TEXT, created_at TEXT NOT NULL)
        """)
        conn.execute("""CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            parent_id INTEGER REFERENCES categories(id), kind TEXT NOT NULL)
        """)


def init_db(path: Optional[str] = None) -> sqlite3.Connection:
    """Open and migrate the configured database."""
    database = path if path is not None else os.environ.get("LEDGERLY_DB", "app/data/ledgerly.db")
    if database != ":memory:":
        Path(database).parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection(database)
    migrate(conn)
    return conn
