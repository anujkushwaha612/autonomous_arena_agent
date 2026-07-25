"""Account creation, retrieval, updates, and archival."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import TypeAlias

from ledgerly.models import Account

ACCOUNT_KINDS = frozenset({"checking", "savings", "credit", "cash", "investment"})
SQLITE_INTEGER_MIN = -(2**63)
SQLITE_INTEGER_MAX = 2**63 - 1
MoneyInput: TypeAlias = int | str | Decimal


class AccountError(ValueError):
    """Base class for account-domain errors safe to show to a user."""


class AccountNotFoundError(AccountError):
    """Raised when an account id does not exist."""


class DuplicateAccountError(AccountError):
    """Raised when an account name is already in use."""


class InvalidAccountKindError(AccountError):
    """Raised when an account kind is outside the supported enum."""


def money_to_cents(value: MoneyInput) -> int:
    """Convert a decimal major-unit value to integer minor units.

    Integer input is already minor units. Strings and ``Decimal`` values are
    interpreted as major units, so ``"123.45"`` becomes ``12345``. Floats are
    deliberately rejected to prevent binary rounding from entering the
    ledger.
    """
    if isinstance(value, bool):
        raise AccountError("opening balance must be an integer number of cents or a decimal string")
    if isinstance(value, int):
        return _validate_cents_range(value)
    if not isinstance(value, (str, Decimal)):
        raise AccountError("opening balance must be an integer number of cents or a decimal string")

    text = value.strip() if isinstance(value, str) else value
    if text == "":
        raise AccountError("opening balance cannot be empty")
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise AccountError("opening balance must be a valid decimal amount") from exc
    if not amount.is_finite():
        raise AccountError("opening balance must be a finite decimal amount")
    cents = amount * Decimal(100)
    if cents != cents.to_integral_value():
        raise AccountError("opening balance cannot have more than two decimal places")
    return _validate_cents_range(int(cents))


def _validate_cents_range(cents: int) -> int:
    if cents < SQLITE_INTEGER_MIN or cents > SQLITE_INTEGER_MAX:
        raise AccountError("opening balance is outside the supported range")
    return cents


def create(
    conn: sqlite3.Connection,
    name: str,
    kind: str,
    currency: str = "USD",
    opening_balance_cents: MoneyInput = 0,
) -> Account:
    """Create and return an account."""
    clean_name = _validate_name(name)
    clean_kind = _validate_kind(kind)
    clean_currency = _validate_currency(currency)
    cents = money_to_cents(opening_balance_cents)
    created_at = _utc_now()
    try:
        with conn:
            cursor = conn.execute(
                """INSERT INTO accounts
                   (name, kind, currency, opening_balance_cents, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (clean_name, clean_kind, clean_currency, cents, created_at),
            )
    except sqlite3.IntegrityError as exc:
        if _name_exists(conn, clean_name):
            raise DuplicateAccountError(f'an account named "{clean_name}" already exists') from exc
        raise AccountError("account could not be created") from exc
    account = get(conn, int(cursor.lastrowid))
    if account is None:  # Defensive: the INSERT above must make this impossible.
        raise AccountError("account could not be loaded after creation")
    return account


def get(conn: sqlite3.Connection, account_id: int) -> Account | None:
    """Return an account by id, including archived accounts, or ``None``."""
    clean_id = _validate_account_id(account_id)
    row = conn.execute(
        """SELECT id, name, kind, currency, opening_balance_cents,
                  created_at, archived_at
           FROM accounts WHERE id = ?""",
        (clean_id,),
    ).fetchone()
    return _from_row(row) if row is not None else None


def list_all(conn: sqlite3.Connection) -> list[Account]:
    """Return all accounts in creation order, including archived accounts."""
    rows = conn.execute(
        """SELECT id, name, kind, currency, opening_balance_cents,
                  created_at, archived_at
           FROM accounts ORDER BY id"""
    ).fetchall()
    return [_from_row(row) for row in rows]


def update(
    conn: sqlite3.Connection,
    account_id: int,
    *,
    name: str | None = None,
    kind: str | None = None,
    currency: str | None = None,
    opening_balance_cents: MoneyInput | None = None,
) -> Account:
    """Apply supplied account fields and return the updated account."""
    clean_id = _validate_account_id(account_id)
    if get(conn, clean_id) is None:
        raise AccountNotFoundError(f"account {clean_id} was not found")

    fields: list[str] = []
    values: list[object] = []
    if name is not None:
        fields.append("name = ?")
        values.append(_validate_name(name))
    if kind is not None:
        fields.append("kind = ?")
        values.append(_validate_kind(kind))
    if currency is not None:
        fields.append("currency = ?")
        values.append(_validate_currency(currency))
    if opening_balance_cents is not None:
        fields.append("opening_balance_cents = ?")
        values.append(money_to_cents(opening_balance_cents))

    if fields:
        values.append(clean_id)
        try:
            with conn:
                conn.execute(
                    f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?",
                    values,
                )
        except sqlite3.IntegrityError as exc:
            requested_name = next(
                (value for field, value in zip(fields, values) if field == "name = ?"),
                None,
            )
            if isinstance(requested_name, str) and _name_exists(conn, requested_name, exclude_id=clean_id):
                raise DuplicateAccountError(
                    f'an account named "{requested_name}" already exists'
                ) from exc
            raise AccountError("account could not be updated") from exc

    account = get(conn, clean_id)
    if account is None:  # Defensive against unexpected concurrent deletion.
        raise AccountNotFoundError(f"account {clean_id} was not found")
    return account


def archive(conn: sqlite3.Connection, account_id: int) -> Account:
    """Mark an account archived without deleting its transaction history."""
    clean_id = _validate_account_id(account_id)
    if get(conn, clean_id) is None:
        raise AccountNotFoundError(f"account {clean_id} was not found")
    with conn:
        conn.execute(
            "UPDATE accounts SET archived_at = COALESCE(archived_at, ?) WHERE id = ?",
            (_utc_now(), clean_id),
        )
    account = get(conn, clean_id)
    if account is None:  # Defensive against unexpected concurrent deletion.
        raise AccountNotFoundError(f"account {clean_id} was not found")
    return account


def _validate_account_id(account_id: int) -> int:
    if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id <= 0:
        raise AccountNotFoundError("account was not found")
    return account_id


def _validate_name(name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise AccountError("account name is required")
    return name.strip()


def _validate_kind(kind: str) -> str:
    if not isinstance(kind, str) or kind not in ACCOUNT_KINDS:
        allowed = ", ".join(sorted(ACCOUNT_KINDS))
        raise InvalidAccountKindError(f"account kind must be one of: {allowed}")
    return kind


def _validate_currency(currency: str) -> str:
    if not isinstance(currency, str) or len(currency.strip()) != 3 or not currency.strip().isalpha():
        raise AccountError("currency must be a three-letter code")
    return currency.strip().upper()


def _name_exists(conn: sqlite3.Connection, name: str, exclude_id: int | None = None) -> bool:
    if exclude_id is None:
        row = conn.execute(
            "SELECT 1 FROM accounts WHERE name = ? COLLATE NOCASE LIMIT 1", (name,)
        ).fetchone()
    else:
        row = conn.execute(
            """SELECT 1 FROM accounts
               WHERE name = ? COLLATE NOCASE AND id != ? LIMIT 1""",
            (name, exclude_id),
        ).fetchone()
    return row is not None


def _from_row(row: sqlite3.Row) -> Account:
    return Account(
        id=int(row["id"]),
        name=str(row["name"]),
        kind=str(row["kind"]),
        currency=str(row["currency"]),
        opening_balance_cents=int(row["opening_balance_cents"]),
        created_at=str(row["created_at"]),
        archived_at=str(row["archived_at"]) if row["archived_at"] is not None else None,
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
