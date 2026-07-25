"""Portable JSON and CSV exports for Ledgerly data."""
from __future__ import annotations

import csv
import io
import json
import sqlite3
from typing import Any

from ledgerly import accounts
from ledgerly.transactions import _from_row

CSV_FIELDS = (
    "id",
    "account_id",
    "date",
    "description",
    "amount",
    "amount_cents",
    "category_id",
    "category_name",
    "is_transfer",
    "external_id",
    "created_at",
    "reconciled_at",
)


def export_data(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    """Return every account and transaction in a portable, JSON-ready shape."""
    transaction_rows = conn.execute(
        """SELECT t.*, a.name AS account_name, c.name AS category_name
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.category_id
           ORDER BY t.account_id ASC, t.date ASC, t.id ASC"""
    ).fetchall()
    exported_transactions: list[dict[str, Any]] = []
    for row in transaction_rows:
        transaction = _from_row(row).to_dict()
        transaction["amount_cents"] = int(row["amount_cents"])
        transaction["account_name"] = str(row["account_name"])
        transaction["category_name"] = (
            str(row["category_name"]) if row["category_name"] is not None else None
        )
        exported_transactions.append(transaction)
    return {
        "accounts": [account.to_dict() for account in accounts.list_all(conn)],
        "transactions": exported_transactions,
    }


def to_json(conn: sqlite3.Connection) -> str:
    """Serialize the full ledger export as UTF-8-safe, indented JSON text."""
    return json.dumps(export_data(conn), ensure_ascii=False, indent=2) + "\n"


def to_csv(conn: sqlite3.Connection) -> str:
    """Serialize transactions as RFC 4180-style CSV using the standard writer."""
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for transaction in export_data(conn)["transactions"]:
        writer.writerow(
            {
                "id": transaction["id"],
                "account_id": transaction["account_id"],
                "date": transaction["date"],
                "description": transaction["description"],
                "amount": transaction["amount"],
                "amount_cents": transaction["amount_cents"],
                "category_id": transaction["category_id"],
                "category_name": transaction["category_name"],
                "is_transfer": "true" if transaction["is_transfer"] else "false",
                "external_id": transaction["external_id"],
                "created_at": transaction["created_at"],
                "reconciled_at": transaction["reconciled_at"],
            }
        )
    return output.getvalue()
