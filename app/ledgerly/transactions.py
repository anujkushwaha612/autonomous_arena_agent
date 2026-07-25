"""Transaction creation, retrieval, updates, deletion, and balance math."""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, TypeAlias

from ledgerly import accounts
from ledgerly.models import Transaction

MoneyInput: TypeAlias = int | str | Decimal
ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SQLITE_INTEGER_MIN = -(2**63)
SQLITE_INTEGER_MAX = 2**63 - 1
DEFAULT_LIST_LIMIT = 100
MAX_LIST_LIMIT = 1000


class TransactionError(ValueError):
    """Base class for transaction-domain errors safe to show to a user."""


class TransactionNotFoundError(TransactionError):
    """Raised when a transaction id does not exist."""


class AccountMissingError(TransactionError):
    """Raised when the referenced account does not exist."""


class InvalidDateError(TransactionError):
    """Raised when a date string is not a valid ISO YYYY-MM-DD calendar date."""


class InvalidAmountError(TransactionError):
    """Raised when an amount is zero, non-numeric, or outside the supported range."""


def money_to_cents(value: MoneyInput) -> int:
    """Convert a decimal major-unit value to integer minor units.

    Integer input is already minor units. Strings and ``Decimal`` values are
    interpreted as major units, so ``"-30.50"`` becomes ``-3050``. Floats are
    deliberately rejected to prevent binary rounding from entering the
    ledger.
    """
    if isinstance(value, bool):
        raise InvalidAmountError("amount must be an integer number of cents or a decimal string")
    if isinstance(value, int):
        return _validate_cents_range(value)
    if not isinstance(value, (str, Decimal)):
        raise InvalidAmountError("amount must be an integer number of cents or a decimal string")

    text = value.strip() if isinstance(value, str) else value
    if text == "":
        raise InvalidAmountError("amount cannot be empty")
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise InvalidAmountError("amount must be a valid decimal amount") from exc
    if not amount.is_finite():
        raise InvalidAmountError("amount must be a finite decimal amount")
    cents = amount * Decimal(100)
    if cents != cents.to_integral_value():
        raise InvalidAmountError("amount cannot have more than two decimal places")
    return _validate_cents_range(int(cents))


def _validate_cents_range(cents: int) -> int:
    if cents < SQLITE_INTEGER_MIN or cents > SQLITE_INTEGER_MAX:
        raise InvalidAmountError("amount is outside the supported range")
    return cents


def validate_date(date: str) -> str:
    """Validate an ISO YYYY-MM-DD calendar date and return it unchanged."""
    if not isinstance(date, str) or not ISO_DATE_PATTERN.match(date):
        raise InvalidDateError("date must be in YYYY-MM-DD format")
    try:
        parsed = datetime.strptime(date, "%Y-%m-%d")
    except ValueError as exc:
        raise InvalidDateError("date must be a real calendar date") from exc
    # Defensive: regex already enforces the format, but a calendar like
    # 2024-02-30 must still be rejected.
    reformatted = parsed.strftime("%Y-%m-%d")
    if reformatted != date:
        raise InvalidDateError("date must be a real calendar date")
    return date


def add(
    conn: sqlite3.Connection,
    account_id: int,
    date: str,
    description: str,
    amount: MoneyInput,
    *,
    category_id: int | None = None,
    is_transfer: bool = False,
    external_id: str | None = None,
) -> Transaction:
    """Create a transaction on the given account and return it."""
    clean_account_id = _validate_account_id(account_id)
    if accounts.get(conn, clean_account_id) is None:
        raise AccountMissingError(f"account {clean_account_id} was not found")
    clean_date = validate_date(date)
    clean_description = _validate_description(description)
    cents = money_to_cents(amount)
    if cents == 0:
        raise InvalidAmountError("amount must be non-zero")
    clean_category_id = _validate_category_id(category_id)
    clean_is_transfer = _validate_is_transfer(is_transfer)
    clean_external_id = _validate_external_id(external_id)
    created_at = _utc_now()
    with conn:
        cursor = conn.execute(
            """INSERT INTO transactions
               (account_id, date, description, amount_cents,
                category_id, is_transfer, external_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                clean_account_id,
                clean_date,
                clean_description,
                cents,
                clean_category_id,
                1 if clean_is_transfer else 0,
                clean_external_id,
                created_at,
            ),
        )
    transaction = get(conn, int(cursor.lastrowid))
    if transaction is None:  # Defensive: the INSERT above must make this impossible.
        raise TransactionError("transaction could not be loaded after creation")
    return transaction


def get(conn: sqlite3.Connection, transaction_id: int) -> Transaction | None:
    """Return a transaction by id, or ``None`` if it does not exist."""
    clean_id = _validate_transaction_id(transaction_id)
    row = conn.execute(
        """SELECT id, account_id, date, description, amount_cents,
                  category_id, is_transfer, external_id, created_at
           FROM transactions WHERE id = ?""",
        (clean_id,),
    ).fetchone()
    return _from_row(row) if row is not None else None


def list_for_account(
    conn: sqlite3.Connection,
    account_id: int,
    *,
    start: str | None = None,
    end: str | None = None,
    limit: int = DEFAULT_LIST_LIMIT,
    offset: int = 0,
) -> tuple[list[Transaction], int]:
    """Return (rows, total) for the given account and date window.

    Results are ordered by date ascending, then id ascending, so paging is
    stable. ``start`` and ``end`` are inclusive ISO YYYY-MM-DD dates; both
    default to no bound.
    """
    clean_account_id = _validate_account_id(account_id)
    if accounts.get(conn, clean_account_id) is None:
        raise AccountMissingError(f"account {clean_account_id} was not found")
    if start is not None:
        start = validate_date(start)
    if end is not None:
        end = validate_date(end)
    if start is not None and end is not None and start > end:
        raise TransactionError("start date must be on or before end date")
    clean_limit = _validate_limit(limit)
    clean_offset = _validate_offset(offset)

    where = ["account_id = ?"]
    params: list[Any] = [clean_account_id]
    if start is not None:
        where.append("date >= ?")
        params.append(start)
    if end is not None:
        where.append("date <= ?")
        params.append(end)
    where_clause = " AND ".join(where)

    total_row = conn.execute(
        f"SELECT COUNT(*) FROM transactions WHERE {where_clause}",
        params,
    ).fetchone()
    total = int(total_row[0]) if total_row is not None else 0

    rows = conn.execute(
        f"""SELECT id, account_id, date, description, amount_cents,
                   category_id, is_transfer, external_id, created_at
            FROM transactions
            WHERE {where_clause}
            ORDER BY date ASC, id ASC
            LIMIT ? OFFSET ?""",
        [*params, clean_limit, clean_offset],
    ).fetchall()
    return [_from_row(row) for row in rows], total


def update(
    conn: sqlite3.Connection,
    transaction_id: int,
    *,
    date: str | None = None,
    description: str | None = None,
    amount: MoneyInput | None = None,
    category_id: int | None = None,
    is_transfer: bool | None = None,
    external_id: str | None = None,
) -> Transaction:
    """Apply supplied fields to a transaction and return the updated record."""
    clean_id = _validate_transaction_id(transaction_id)
    if get(conn, clean_id) is None:
        raise TransactionNotFoundError(f"transaction {clean_id} was not found")

    fields: list[str] = []
    values: list[Any] = []
    if date is not None:
        fields.append("date = ?")
        values.append(validate_date(date))
    if description is not None:
        fields.append("description = ?")
        values.append(_validate_description(description))
    if amount is not None:
        cents = money_to_cents(amount)
        if cents == 0:
            raise InvalidAmountError("amount must be non-zero")
        fields.append("amount_cents = ?")
        values.append(cents)
    if category_id is not None:
        fields.append("category_id = ?")
        values.append(_validate_category_id(category_id))
    if is_transfer is not None:
        fields.append("is_transfer = ?")
        values.append(1 if _validate_is_transfer(is_transfer) else 0)
    if external_id is not None:
        fields.append("external_id = ?")
        values.append(_validate_external_id(external_id))

    if fields:
        values.append(clean_id)
        with conn:
            conn.execute(
                f"UPDATE transactions SET {', '.join(fields)} WHERE id = ?",
                values,
            )

    transaction = get(conn, clean_id)
    if transaction is None:  # Defensive against unexpected concurrent deletion.
        raise TransactionNotFoundError(f"transaction {clean_id} was not found")
    return transaction


def delete(conn: sqlite3.Connection, transaction_id: int) -> None:
    """Remove a transaction by id; missing transactions raise."""
    clean_id = _validate_transaction_id(transaction_id)
    if get(conn, clean_id) is None:
        raise TransactionNotFoundError(f"transaction {clean_id} was not found")
    with conn:
        conn.execute("DELETE FROM transactions WHERE id = ?", (clean_id,))


def balance(conn: sqlite3.Connection, account_id: int) -> int:
    """Return ``opening_balance_cents + sum(amount_cents)`` for the account."""
    clean_account_id = _validate_account_id(account_id)
    account = accounts.get(conn, clean_account_id)
    if account is None:
        raise AccountMissingError(f"account {clean_account_id} was not found")
    total_row = conn.execute(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions WHERE account_id = ?",
        (clean_account_id,),
    ).fetchone()
    total = int(total_row[0]) if total_row is not None else 0
    return account.opening_balance_cents + total


def _validate_account_id(account_id: int) -> int:
    if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id <= 0:
        raise AccountMissingError("account was not found")
    return account_id


def _validate_transaction_id(transaction_id: int) -> int:
    if isinstance(transaction_id, bool) or not isinstance(transaction_id, int) or transaction_id <= 0:
        raise TransactionNotFoundError("transaction was not found")
    return transaction_id


def _validate_description(description: str) -> str:
    if not isinstance(description, str):
        raise TransactionError("description is required")
    cleaned = description.strip()
    if not cleaned:
        raise TransactionError("description is required")
    return cleaned


def _validate_category_id(category_id: int | None) -> int | None:
    if category_id is None:
        return None
    if isinstance(category_id, bool) or not isinstance(category_id, int) or category_id <= 0:
        raise TransactionError("category id must be a positive integer")
    return category_id


def _validate_is_transfer(is_transfer: bool) -> bool:
    if not isinstance(is_transfer, bool):
        raise TransactionError("is_transfer must be a boolean")
    return is_transfer


def _validate_external_id(external_id: str | None) -> str | None:
    if external_id is None:
        return None
    if not isinstance(external_id, str):
        raise TransactionError("external_id must be a string")
    cleaned = external_id.strip()
    if not cleaned:
        return None
    return cleaned


def _validate_limit(limit: int) -> int:
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        raise TransactionError("limit must be a positive integer")
    if limit > MAX_LIST_LIMIT:
        raise TransactionError(f"limit cannot exceed {MAX_LIST_LIMIT}")
    return limit


def _validate_offset(offset: int) -> int:
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise TransactionError("offset must be a non-negative integer")
    return offset


def _from_row(row: sqlite3.Row) -> Transaction:
    return Transaction(
        id=int(row["id"]),
        account_id=int(row["account_id"]),
        date=str(row["date"]),
        description=str(row["description"]),
        amount_cents=int(row["amount_cents"]),
        category_id=int(row["category_id"]) if row["category_id"] is not None else None,
        is_transfer=bool(int(row["is_transfer"])),
        external_id=str(row["external_id"]) if row["external_id"] is not None else None,
        created_at=str(row["created_at"]),
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
