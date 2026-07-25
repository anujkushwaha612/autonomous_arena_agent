T8 complete: reconciliation, export, and final polish.

**Built**
- Migration v5 adds nullable `transactions.reconciled_at`, exposed on transaction JSON data.
- `accounts.reconcile(conn, account_id, statement_cents, as_of)` calculates the ledger closing balance through the date. A match marks pending in-window transactions with a UTC timestamp and returns an empty unreconciled list; a mismatch is non-mutating and returns candidates.
- `ledgerly/exporter.py` produces a full accounts/transactions JSON export and a standard-library CSV export with correct quoting. `GET /api/v1/export?format=json|csv` returns it as an attachment.
- Health retains `status`, `version`, and `db`, and adds account/transaction/category counts.
- CLI has `reconcile`, `export`, and root `--json` output wrapping; `app/README.md` documents setup, environment, all commands, API export, and checks.

**Decisions**
- Reconciliation treats the supplied statement balance as `expected`, ledger balance through `as_of` as `actual`, and reports `actual - expected` as `difference`, all in cents.
- CLI money inputs remain decimal major units, consistent with the rest of the CLI; the service API accepts integer cents.
- CSV columns and quoting behavior are documented in the README; export includes reconciliation timestamps and category/account names in JSON where available.

**Verification**
- `cd app && python3 -m compileall -q . && python3 -m pytest pytests -q` passed: 13 tests.
- Manual CLI reconciliation matched a 102.50 statement with difference 0 and no unreconciled transactions; a scratch in-memory mismatch verified it leaves transactions unmarked.
- Manual CSV export preserved a description containing commas, quotes, and a newline.
- Started `main.py`, then verified health contains `status: ok` and counts; `/api/v1/export?format=csv` returned the documented header plus `Content-Disposition: attachment`.
