"""Regression tests for financial reports."""
import sqlite3
from datetime import datetime, timezone

import pytest

from ledgerly import accounts, categories, reports, transactions
from ledgerly.db import init_db


@pytest.fixture
def conn() -> sqlite3.Connection:
    return init_db(":memory:")


def test_reports_empty_db(conn: sqlite3.Connection) -> None:
    """Verify all reports return well-formed zeroes on an empty database."""
    # spending_by_category
    spending = reports.spending_by_category(conn, "2000-01-01", "2099-12-31")
    assert spending == []

    # monthly_totals
    monthly = reports.monthly_totals(conn, 3)
    assert len(monthly) == 3
    for row in monthly:
        assert row["income_cents"] == 0
        assert row["expense_cents"] == 0
        assert row["net_cents"] == 0
        assert row["income"] == "0.00"
        assert row["expense"] == "0.00"
        assert row["net"] == "0.00"

    # cashflow
    flow = reports.cashflow(conn, "2000-01-01", "2099-12-31")
    assert flow["opening_cents"] == 0
    assert flow["total_in_cents"] == 0
    assert flow["total_out_cents"] == 0
    assert flow["closing_cents"] == 0

    # largest_transactions
    largest = reports.largest_transactions(conn, "2000-01-01", "2099-12-31")
    assert largest == []

    # search
    results = reports.search(conn, "anything")
    assert results == []


def test_monthly_totals_includes_months_with_no_activity(conn: sqlite3.Connection) -> None:
    """Verify monthly_totals returns exactly N months even with no activity."""
    # Create one transaction in the current month to verify it shows up.
    account = accounts.create(conn, name="Test", kind="checking")
    cat = categories.create(conn, name="Salary Category", kind="income")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    current_month = now[:7]

    transactions.add(conn, account.id, now, "Salary", "1000.00", category_id=cat.id)

    monthly = reports.monthly_totals(conn, 3)
    assert len(monthly) == 3
    # The last month should be the current month and have 1000.00 income.
    assert monthly[-1]["month"] == current_month
    assert monthly[-1]["income_cents"] == 100000
    # The previous two months should have zero activity but still exist.
    assert monthly[0]["income_cents"] == 0
    assert monthly[1]["income_cents"] == 0


def test_spending_by_category_aggregates_and_filters(conn: sqlite3.Connection) -> None:
    """Verify spending report sums expenses and ignores income/transfers."""
    account = accounts.create(conn, name="Test", kind="checking")
    exp_cat = categories.create(conn, name="Food Consumption", kind="expense")
    inc_cat = categories.create(conn, name="Salary Income", kind="income")

    # Expense
    transactions.add(conn, account.id, "2024-01-01", "Lunch", "-10.00", category_id=exp_cat.id)
    transactions.add(conn, account.id, "2024-01-02", "Dinner", "-20.00", category_id=exp_cat.id)

    # Income (should be ignored by spending report)
    transactions.add(conn, account.id, "2024-01-03", "Gift", "50.00", category_id=inc_cat.id)

    # Transfer (should be ignored)
    transactions.add(conn, account.id, "2024-01-04", "Transfer", "-100.00", category_id=exp_cat.id, is_transfer=True)

    spending = reports.spending_by_category(conn, "2024-01-01", "2024-01-31")
    assert len(spending) == 1
    assert spending[0]["category"] == "Food Consumption"
    assert spending[0]["total_cents"] == 3000
    assert spending[0]["total"] == "30.00"


def test_cashflow_calculation(conn: sqlite3.Connection) -> None:
    """Verify cashflow opening/in/out/closing logic."""
    account = accounts.create(conn, name="Test", kind="checking", opening_balance_cents=5000)

    # Before window
    transactions.add(conn, account.id, "2023-12-31", "Old", "10.00")

    # During window
    transactions.add(conn, account.id, "2024-01-15", "In", "100.00")
    transactions.add(conn, account.id, "2024-01-16", "Out", "-40.00")

    flow = reports.cashflow(conn, "2024-01-01", "2024-01-31")
    assert flow["opening_cents"] == 6000  # 50.00 + 10.00
    assert flow["total_in_cents"] == 10000
    assert flow["total_out_cents"] == 4000
    assert flow["closing_cents"] == 12000  # 60 + 100 - 40 = 120
