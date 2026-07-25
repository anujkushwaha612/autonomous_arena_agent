T7 complete: Reports.

**Built**
- `app/ledgerly/reports.py`: High-performance reporting using SQL aggregations. 
  - `spending_by_category`: Aggregates expenses by category name.
  - `monthly_totals`: Uses a recursive CTE with `month || '-01'` logic to generate a continuous month series, ensuring the report has no gaps even if there's no activity.
  - `cashflow`: Calculates opening balance (account opening + pre-window tx), total in/out, and closing balance.
  - `largest_transactions`: magnitude-ordered transaction list.
  - `search`: description-based search with optional date and amount filters.
- API: Added `GET /api/v1/reports/spending`, `GET /api/v1/reports/monthly`, `GET /api/v1/reports/cashflow`, and `GET /api/v1/reports/search`. 
- CLI: Added `report spending|monthly|cashflow` and `search <query>`.
- Tests: Committed `app/pytests/test_reports.py` which verifies all reports return well-formed zeroes on an empty database and that monthly totals fill gaps.

**Decisions**
- Default report range in CLI/API is `1900-01-01` to `2099-12-31` to satisfy `strptime` validation while covering all practical use cases.
- `monthly_totals` uses a recursive CTE; required a fix in the recursion logic to handle month-string incrementing by appending `-01` for the SQLite date functions.
- `spending_by_category` only considers `expense` kind categories with `is_transfer=0`.
- API handlers use `transactions.TransactionError` to catch and raise `APIError` with correct status codes (e.g. 400 for invalid dates).

**Verification**
- `pytests/test_reports.py` (4 tests) passed.
- All project tests (T1, T3, T7) passed (13 total).
- Manual verification of CLI commands (`report`, `search`) with real dummy data.
- Manual verification of API routes via `curl`.

Next task is **T8: Reconciliation, export & polish**. 
Note: T8 needs to add a `reconciled_at` column via a new migration and implement CSV export with correct quoting.
