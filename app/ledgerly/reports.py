"""Aggregation queries for financial reporting."""
from __future__ import annotations

import sqlite3
from typing import Any, Optional

from ledgerly.models import _money
from ledgerly.transactions import _from_row, validate_date


def spending_by_category(
    conn: sqlite3.Connection, start: str, end: str, *, top: Optional[int] = None
) -> list[dict[str, Any]]:
    """Return total spent per category between start and end dates."""
    validate_date(start)
    validate_date(end)
    query = """
        SELECT c.name as category, SUM(ABS(t.amount_cents)) as total_cents
        FROM transactions t
        JOIN categories c ON t.category_id = c.id
        WHERE t.date >= ? AND t.date <= ?
          AND t.amount_cents < 0
          AND t.is_transfer = 0
          AND c.kind = 'expense'
        GROUP BY c.id
        ORDER BY total_cents DESC
    """
    params: list[Any] = [start, end]
    if top is not None:
        query += " LIMIT ?"
        params.append(top)

    rows = conn.execute(query, params).fetchall()
    return [
        {"category": row["category"], "total": _money(row["total_cents"]), "total_cents": row["total_cents"]}
        for row in rows
    ]


def monthly_totals(conn: sqlite3.Connection, months: int = 12) -> list[dict[str, Any]]:
    """Return income, expense, and net per month for the last N months."""
    if months < 1:
        months = 1
    # Generate months using a recursive CTE to ensure no gaps.
    # Uses UTC 'now' to match transaction timestamps/dates if they were UTC-based.
    # Ledgerly dates are YYYY-MM-DD.
    query = """
    WITH RECURSIVE
      month_series(month) AS (
        SELECT strftime('%Y-%m', 'now', 'start of month', '-' || (? - 1) || ' months')
        UNION ALL
        SELECT strftime('%Y-%m', month || '-01', '+1 month')
        FROM month_series
        WHERE month < strftime('%Y-%m', 'now')
      )
    SELECT
        m.month,
        COALESCE(SUM(CASE WHEN t.amount_cents > 0 AND c.kind = 'income' AND t.is_transfer = 0 THEN t.amount_cents ELSE 0 END), 0) as income_cents,
        COALESCE(SUM(CASE WHEN t.amount_cents < 0 AND c.kind = 'expense' AND t.is_transfer = 0 THEN ABS(t.amount_cents) ELSE 0 END), 0) as expense_cents
    FROM month_series m
    LEFT JOIN transactions t ON strftime('%Y-%m', t.date) = m.month
    LEFT JOIN categories c ON t.category_id = c.id
    GROUP BY m.month
    ORDER BY m.month ASC
    """
    rows = conn.execute(query, (months,)).fetchall()
    result = []
    for row in rows:
        income = int(row["income_cents"])
        expense = int(row["expense_cents"])
        result.append({
            "month": row["month"],
            "income": _money(income),
            "expense": _money(expense),
            "net": _money(income - expense),
            "income_cents": income,
            "expense_cents": expense,
            "net_cents": income - expense,
        })
    return result


def cashflow(conn: sqlite3.Connection, start: str, end: str) -> dict[str, Any]:
    """Return opening balance, total in/out, and closing balance for a window."""
    validate_date(start)
    validate_date(end)

    # Opening balance: sum of all opening_balances + transactions before start
    opening_bal_cents = conn.execute("SELECT COALESCE(SUM(opening_balance_cents), 0) FROM accounts").fetchone()[0]
    tx_before_cents = conn.execute("SELECT COALESCE(SUM(amount_cents), 0) FROM transactions WHERE date < ?", (start,)).fetchone()[0]
    opening_cents = int(opening_bal_cents) + int(tx_before_cents)

    # total_in: transactions between start and end where amount > 0
    in_cents = conn.execute(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions WHERE date >= ? AND date <= ? AND amount_cents > 0",
        (start, end)
    ).fetchone()[0]

    # total_out: transactions between start and end where amount < 0 (absolute)
    out_cents = conn.execute(
        "SELECT ABS(COALESCE(SUM(amount_cents), 0)) FROM transactions WHERE date >= ? AND date <= ? AND amount_cents < 0",
        (start, end)
    ).fetchone()[0]

    in_cents = int(in_cents)
    out_cents = int(out_cents)
    closing_cents = opening_cents + in_cents - out_cents

    return {
        "opening": _money(opening_cents),
        "total_in": _money(in_cents),
        "total_out": _money(out_cents),
        "closing": _money(closing_cents),
        "opening_cents": opening_cents,
        "total_in_cents": in_cents,
        "total_out_cents": out_cents,
        "closing_cents": closing_cents,
    }


def largest_transactions(conn: sqlite3.Connection, start: str, end: str, limit: int = 10) -> list[dict[str, Any]]:
    """Return the N transactions with the largest absolute magnitude."""
    validate_date(start)
    validate_date(end)
    query = """
        SELECT t.*, c.name as category_name
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.date >= ? AND t.date <= ?
        ORDER BY ABS(t.amount_cents) DESC
        LIMIT ?
    """
    rows = conn.execute(query, (start, end, limit)).fetchall()
    return [{**_from_row(row).to_dict(), "category_name": row["category_name"]} for row in rows]


def search(
    conn: sqlite3.Connection,
    query_text: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    min_cents: Optional[int] = None,
    max_cents: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Search transactions by description and optional filters."""
    where = ["t.description LIKE ?"]
    params: list[Any] = [f"%{query_text}%"]

    if start:
        where.append("t.date >= ?")
        params.append(validate_date(start))
    if end:
        where.append("t.date <= ?")
        params.append(validate_date(end))
    if min_cents is not None:
        where.append("t.amount_cents >= ?")
        params.append(min_cents)
    if max_cents is not None:
        where.append("t.amount_cents <= ?")
        params.append(max_cents)

    sql = f"""
        SELECT t.*, c.name as category_name
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        WHERE {" AND ".join(where)}
        ORDER BY t.date DESC, t.id DESC
    """
    rows = conn.execute(sql, params).fetchall()
    return [{**_from_row(row).to_dict(), "category_name": row["category_name"]} for row in rows]
