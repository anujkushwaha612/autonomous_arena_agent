T6 complete: budgets.

**Built**
- Migration **v4**: `budgets (id, category_id -> categories ON DELETE CASCADE, period, limit_cents)` with `UNIQUE (category_id, period)` and an index on `period`. Append-only and idempotent; verified an existing v3 database upgrades in place and re-running `migrate` leaves one `schema_version` row.
- `app/ledgerly/budgets.py`: `set_budget` (upsert via `ON CONFLICT(category_id, period) DO UPDATE`), `get_budget`, `list_budgets`, `delete_budget`, `effective_limits`, `spending_by_category`, `get_status`, plus helpers `validate_period`, `limit_to_cents`, `current_month`, `format_cents`. Errors: `BudgetError` / `BudgetNotFoundError` / `InvalidPeriodError` / `InvalidLimitError`.
- `Budget` dataclass added to `models.py` with `to_dict()` exposing `limit` as a decimal string plus `limit_cents`.
- API: `GET /api/v1/budgets` (optional `?period=`), `PUT /api/v1/budgets` (upsert), `GET /api/v1/budgets/status?period=YYYY-MM` (defaults to the current UTC month). `Handler` gained `do_PUT` — no PUT route existed before.
- CLI: `budget set <category> <period> <limit>`, `budget status [--period YYYY-MM]` with a `#`/`.` usage bar, and `budget list`.

**Decisions**
- Spend is the **negated sum** of `amount_cents` over expense-kind categories with `is_transfer = 0`, so a refund (positive amount in an expense category) naturally reduces spend. Income and transfer categories never appear in status.
- Month resolution is `substr(date, 1, 7)` in SQL, so filtering stays in the database.
- A month-specific budget overrides the recurring `monthly` one; each status row carries `source` naming the period the limit came from.
- Unbudgeted categories report `limit`/`remaining`/`pct` as `None` (never 0) but still report real `spent`, so overspend outside a budget is visible.
- The `total` row sums only budgeted limits (`None` when nothing is budgeted) but sums spend across every category shown.
- Limits must be **non-negative**; `"250.00"` is parsed with `Decimal`, ints are treated as cents, floats are rejected.
- `pct` is a rounded float **percentage of the limit** — it is a display ratio only, never money. All money stays integer cents / `Decimal`.

**Surprises**
- `get_status("monthly")` is legal and resolves spend against the current month; the response returns both `period` (what you asked for) and `month` (what was measured), so a caller can tell them apart.
- Money handling is duplicated per module (`accounts.money_to_cents`, `transactions.money_to_cents`, now `budgets.limit_to_cents`) because each raises its own error type. T8 may want to unify these, but the error taxonomy is what the API status codes key off.

**Verification** — service-level script covering refund/override/`None` behaviour, live `curl` against every budget route (including 400 bad period, 404 missing category, 400 negative limit), all CLI budget commands, a v3→v4 upgrade test, `python3 -m compileall -q .` clean, and `python3 -m pytest pytests -q` → 9 passed. Scratch files deleted.

Next task is **T7: Reports** — it must COMMIT `pytests/test_reports.py`. Note `reports.py` must use SQL aggregations, and `monthly_totals` has to emit months with no activity.
