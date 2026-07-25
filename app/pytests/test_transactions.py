"""Money-math regression tests for the transactions module.

These tests protect the balance, validation, and date rules so a later task
cannot silently corrupt the ledger.
"""
import os
import sqlite3

os.environ.setdefault("LEDGERLY_DB", ":memory:")

import pytest

from ledgerly import accounts, transactions
from ledgerly.db import init_db


@pytest.fixture
def conn() -> sqlite3.Connection:
    return init_db(":memory:")


def test_balance_after_deposits_and_withdrawals(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    transactions.add(conn, account.id, "2024-01-15", "Salary", "100.00")
    transactions.add(conn, account.id, "2024-01-16", "Groceries", "-30.50")
    assert transactions.balance(conn, account.id) == 6950


def test_zero_amount_is_rejected(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    with pytest.raises(transactions.InvalidAmountError):
        transactions.add(conn, account.id, "2024-01-15", "Free", "0")
    with pytest.raises(transactions.InvalidAmountError):
        transactions.add(conn, account.id, "2024-01-15", "Free", "0.00")


def test_invalid_date_is_rejected(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    for bad in ("2024/01/15", "15-01-2024", "2024-13-01", "2024-02-30", ""):
        with pytest.raises(transactions.InvalidDateError):
            transactions.add(conn, account.id, bad, "Anything", "1.00")


def test_valid_date_is_accepted(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    transaction = transactions.add(conn, account.id, "2024-01-15", "Anything", "1.00")
    assert transaction.date == "2024-01-15"


def test_missing_account_is_rejected(conn: sqlite3.Connection) -> None:
    with pytest.raises(transactions.AccountMissingError):
        transactions.add(conn, 999, "2024-01-15", "Anything", "1.00")


def test_list_for_account_pagination(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    for index in range(5):
        transactions.add(
            conn, account.id, f"2024-01-1{index + 1}", f"Item {index}", f"{index + 1}.00"
        )
    page, total = transactions.list_for_account(conn, account.id, limit=2, offset=0)
    assert total == 5
    assert len(page) == 2
    assert page[0].amount_cents == 100
    assert page[1].amount_cents == 200
    page2, _ = transactions.list_for_account(conn, account.id, limit=2, offset=2)
    assert page2[0].amount_cents == 300
    assert page2[1].amount_cents == 400


def test_list_for_account_date_window(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    transactions.add(conn, account.id, "2024-01-15", "In", "10.00")
    transactions.add(conn, account.id, "2024-02-15", "In", "20.00")
    transactions.add(conn, account.id, "2024-03-15", "In", "30.00")
    rows, total = transactions.list_for_account(
        conn, account.id, start="2024-02-01", end="2024-02-28"
    )
    assert total == 1
    assert rows[0].amount_cents == 2000


def test_delete_removes_transaction(conn: sqlite3.Connection) -> None:
    account = accounts.create(conn, name="Main", kind="checking")
    transaction = transactions.add(conn, account.id, "2024-01-15", "Anything", "5.00")
    transactions.delete(conn, transaction.id)
    assert transactions.get(conn, transaction.id) is None
