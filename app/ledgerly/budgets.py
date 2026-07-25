"""Budget limits per category and period, plus spend/remaining status.

A budget is stored against either a concrete month (``YYYY-MM``) or the
literal ``monthly``, which acts as a recurring default used whenever a month
has no budget of its own. Limits are integer minor units; spend is derived
from expense-category transactions, excluding transfers, with refunds
(positive amounts inside an expense category) reducing the spend.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Final, TypeAlias

from ledgerly import categories
from ledgerly.models import Budget

MoneyInput: TypeAlias = int | str | Decimal

RECURRING_PERIOD: Final[str] = "monthly"
MONTH_PATTERN: Final[re.Pattern[str]] = re.compile(r"^\d{4}-\d{2}$")
SQLITE_INTEGER_MIN: Final[int] = -(2**63)
SQLITE_INTEGER_MAX: Final[int] = 2**63 - 1


class BudgetError(ValueError):
    """Base class for budget-domain errors safe to show to a user."""


class BudgetNotFoundError(BudgetError):
    """Raised when a budget row does not exist."""


class InvalidPeriodError(BudgetError):
    """Raised when a period is neither ``YYYY-MM`` nor ``monthly``."""


class InvalidLimitError(BudgetError):
    """Raised when a limit is negative, non-numeric or out of range."""


def limit_to_cents(value: MoneyInput) -> int:
    """Convert a limit to non-negative integer minor units.

    Integers are already minor units. Strings and ``Decimal`` values are read
    as major units, so ``"250.00"`` becomes ``25000``. Floats are rejected so
    binary rounding never enters the ledger.
    """
    if isinstance(value, bool):
        raise InvalidLimitError("limit must be an integer number of cents or a decimal string")
    if isinstance(value, int):
        return _validate_limit_range(value)
    if not isinstance(value, (str, Decimal)):
        raise InvalidLimitError("limit must be an integer number of cents or a decimal string")

    text = value.strip() if isinstance(value, str) else value
    if text == "":
        raise InvalidLimitError("limit cannot be empty")
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise InvalidLimitError("limit must be a valid decimal amount") from exc
    if not amount.is_finite():
        raise InvalidLimitError("limit must be a finite decimal amount")
    cents = amount * Decimal(100)
    if cents != cents.to_integral_value():
        raise InvalidLimitError("limit cannot have more than two decimal places")
    return _validate_limit_range(int(cents))


def validate_period(period: str) -> str:
    """Validate ``YYYY-MM`` or the literal ``monthly`` and return it cleaned."""
    if not isinstance(period, str):
        raise InvalidPeriodError("period must be 'monthly' or a YYYY-MM month")
    cleaned = period.strip()
    if cleaned.lower() == RECURRING_PERIOD:
        return RECURRING_PERIOD
    if not MONTH_PATTERN.match(cleaned):
        raise InvalidPeriodError("period must be 'monthly' or a YYYY-MM month")
    month = int(cleaned[5:7])
    if month < 1 or month > 12:
        raise InvalidPeriodError("period month must be between 01 and 12")
    return cleaned


def current_month() -> str:
    """Return the current UTC month as ``YYYY-MM``."""
    return datetime.now(timezone.utc).strftime("%Y-%m")


def set_budget(
    conn: sqlite3.Connection,
    category_id: int,
    period: str,
    limit_cents: MoneyInput,
) -> Budget:
    """Create or replace the budget for ``(category_id, period)``."""
    category = categories.get(conn, _validate_category_id(category_id))
    if category is None:
        raise categories.CategoryNotFoundError(f"category {category_id} was not found")
    clean_period = validate_period(period)
    cents = limit_to_cents(limit_cents)

    with conn:
        conn.execute(
            """INSERT INTO budgets (category_id, period, limit_cents)
               VALUES (?, ?, ?)
               ON CONFLICT(category_id, period)
               DO UPDATE SET limit_cents = excluded.limit_cents""",
            (category.id, clean_period, cents),
        )
    budget = get_budget(conn, category.id, clean_period)
    if budget is None:  # Defensive: the upsert above must make this impossible.
        raise BudgetError("budget could not be loaded after saving")
    return budget


def get_budget(conn: sqlite3.Connection, category_id: int, period: str) -> Budget | None:
    """Return the exact budget row for a category and period, if any."""
    clean_category_id = _validate_category_id(category_id)
    clean_period = validate_period(period)
    row = conn.execute(
        """SELECT id, category_id, period, limit_cents
           FROM budgets WHERE category_id = ? AND period = ?""",
        (clean_category_id, clean_period),
    ).fetchone()
    return _budget_from_row(row) if row is not None else None


def list_budgets(conn: sqlite3.Connection, *, period: str | None = None) -> list[Budget]:
    """Return budgets, optionally restricted to one period, in stable order."""
    query = """SELECT id, category_id, period, limit_cents FROM budgets"""
    params: list[Any] = []
    if period is not None:
        query += " WHERE period = ?"
        params.append(validate_period(period))
    query += " ORDER BY period ASC, category_id ASC"
    return [_budget_from_row(row) for row in conn.execute(query, params).fetchall()]


def delete_budget(conn: sqlite3.Connection, category_id: int, period: str) -> None:
    """Delete a budget row; a missing row raises ``BudgetNotFoundError``."""
    clean_category_id = _validate_category_id(category_id)
    clean_period = validate_period(period)
    if get_budget(conn, clean_category_id, clean_period) is None:
        raise BudgetNotFoundError(
            f"no budget for category {clean_category_id} in period {clean_period}"
        )
    with conn:
        conn.execute(
            "DELETE FROM budgets WHERE category_id = ? AND period = ?",
            (clean_category_id, clean_period),
        )


def effective_limits(conn: sqlite3.Connection, period: str) -> dict[int, tuple[int, str]]:
    """Return ``{category_id: (limit_cents, source)}`` for a concrete month.

    A month-specific budget always overrides the recurring ``monthly`` one.
    ``source`` is the period the limit came from.
    """
    clean_period = validate_period(period)
    limits: dict[int, tuple[int, str]] = {}
    for budget in list_budgets(conn, period=RECURRING_PERIOD):
        limits[budget.category_id] = (budget.limit_cents, RECURRING_PERIOD)
    if clean_period != RECURRING_PERIOD:
        for budget in list_budgets(conn, period=clean_period):
            limits[budget.category_id] = (budget.limit_cents, clean_period)
    return limits


def spending_by_category(conn: sqlite3.Connection, period: str) -> dict[int, int]:
    """Return ``{category_id: spent_cents}`` for expense categories in a month.

    Transfers are excluded outright, and refunds (positive amounts inside an
    expense category) reduce the spend because spend is the negated sum.
    """
    month = validate_period(period)
    if month == RECURRING_PERIOD:
        month = current_month()
    rows = conn.execute(
        """SELECT t.category_id AS category_id,
                  -COALESCE(SUM(t.amount_cents), 0) AS spent_cents
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
           WHERE c.kind = 'expense'
             AND t.is_transfer = 0
             AND substr(t.date, 1, 7) = ?
           GROUP BY t.category_id""",
        (month,),
    ).fetchall()
    return {int(row["category_id"]): int(row["spent_cents"]) for row in rows}


def get_status(conn: sqlite3.Connection, period: str) -> dict[str, Any]:
    """Return per-category limit/spent/remaining/pct plus a total row.

    Categories without a budget report ``None`` for limit, remaining and pct
    (never zero) so an unbudgeted category is visibly different from one
    budgeted at nothing.
    """
    clean_period = validate_period(period)
    month = current_month() if clean_period == RECURRING_PERIOD else clean_period
    limits = effective_limits(conn, clean_period)
    spend = spending_by_category(conn, clean_period)

    names: dict[int, str] = {}
    kinds: dict[int, str] = {}
    for category in categories.list_all(conn):
        names[category.id] = category.name
        kinds[category.id] = category.kind

    rows: list[dict[str, Any]] = []
    for category_id in sorted(set(limits) | set(spend)):
        limit_entry = limits.get(category_id)
        limit_cents = limit_entry[0] if limit_entry is not None else None
        source = limit_entry[1] if limit_entry is not None else None
        spent_cents = spend.get(category_id, 0)
        rows.append(
            _status_row(
                category_id=category_id,
                category=names.get(category_id, f"category {category_id}"),
                kind=kinds.get(category_id),
                limit_cents=limit_cents,
                spent_cents=spent_cents,
                source=source,
            )
        )

    budgeted = [row for row in rows if row["limit_cents"] is not None]
    total_limit = sum(int(row["limit_cents"]) for row in budgeted) if budgeted else None
    total_spent = sum(int(row["spent_cents"]) for row in rows)
    total = _status_row(
        category_id=None,
        category="TOTAL",
        kind=None,
        limit_cents=total_limit,
        spent_cents=total_spent,
        source=None,
    )
    return {"period": clean_period, "month": month, "categories": rows, "total": total}


def format_cents(cents: int) -> str:
    """Format integer minor units as a decimal string like ``"-12.34"``."""
    return format(Decimal(cents) / Decimal(100), ".2f")


def _status_row(
    *,
    category_id: int | None,
    category: str,
    kind: str | None,
    limit_cents: int | None,
    spent_cents: int,
    source: str | None,
) -> dict[str, Any]:
    remaining_cents = None if limit_cents is None else limit_cents - spent_cents
    pct: float | None = None
    if limit_cents is not None:
        pct = 0.0 if limit_cents == 0 else round(spent_cents * 100 / limit_cents, 1)
    return {
        "category_id": category_id,
        "category": category,
        "kind": kind,
        "limit_cents": limit_cents,
        "spent_cents": spent_cents,
        "remaining_cents": remaining_cents,
        "limit": None if limit_cents is None else format_cents(limit_cents),
        "spent": format_cents(spent_cents),
        "remaining": None if remaining_cents is None else format_cents(remaining_cents),
        "pct": pct,
        "source": source,
    }


def _validate_limit_range(cents: int) -> int:
    if cents < 0:
        raise InvalidLimitError("limit cannot be negative")
    if cents > SQLITE_INTEGER_MAX or cents < SQLITE_INTEGER_MIN:
        raise InvalidLimitError("limit is outside the supported range")
    return cents


def _validate_category_id(category_id: int) -> int:
    if isinstance(category_id, bool) or not isinstance(category_id, int) or category_id <= 0:
        raise categories.CategoryNotFoundError("category was not found")
    return category_id


def _budget_from_row(row: sqlite3.Row) -> Budget:
    return Budget(
        id=int(row["id"]),
        category_id=int(row["category_id"]),
        period=str(row["period"]),
        limit_cents=int(row["limit_cents"]),
    )
