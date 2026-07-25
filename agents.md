# AgentChain — Ledgerly, a personal finance CLI + API

The **task brain**. Each agent completes exactly **one** task, then hands off.

> Protocol lives in `AGENT_PROMPT.md` (the worker pastes it into Arena each round).
> Summary: clone → read this file + `NEXT.md` → do the first unfinished task →
> flip it to `DONE` → upload the patch via curl → print the receipt marker.

**Never paste a diff or base64 into chat.** The patch is uploaded out-of-band.

---

## Repository layout — READ THIS BEFORE TOUCHING ANYTHING

This repository is **not** the product. It is an autonomous build pipeline that
*contains* the product:

```
<repo root>
├── worker.js, config.js, fastcapture/, scripts/   ← PIPELINE. Never edit.
├── package.json         ← PIPELINE's package.json. NOT the product's.
├── agents.md            ← this file (you flip your task's STATUS)
├── NEXT.md              ← handoff notes (you rewrite this)
└── app/                 ← THE PRODUCT. Everything you build goes here.
```

**All product code lives under `app/`.** The only files you may modify outside
`app/` are `agents.md` and `NEXT.md`. Never create or overwrite `package.json`
at the repository root — it belongs to the worker, and replacing it breaks the
pipeline that is running you.

### If you are the first agent

`app/` will not exist yet. That is expected:

```bash
mkdir -p app
```

Build your task inside it. Do not scaffold later tasks, do not create empty
placeholder folders, and do not "tidy" the pipeline files.

### The task list is complete as written

Every task that will ever exist is listed below. A missing higher number means
the plan ends there — it is not an invitation to invent, renumber, split or
merge tasks. Unfamiliar files in the repository root are pipeline machinery.

**Do exactly one task. Change nothing else.**

---

## Product direction

**Ledgerly** — a personal finance tracker you can actually trust with your
money: a fast CLI for daily use, plus a small HTTP API so other tools can read
your data.

By the end it will import bank CSVs, categorise transactions with learned
rules, track budgets, reconcile accounts, and answer questions like *"what did
I actually spend on groceries last quarter, excluding refunds?"*

### Stack — deliberately minimal

| Layer | Choice |
|---|---|
| Language | **Python 3.11+**, type-hinted throughout |
| Dependencies | **Standard library only** |
| Storage | **SQLite** via `sqlite3` (stdlib) |
| HTTP | `http.server` (stdlib) |
| CLI | `argparse` (stdlib) |
| Money | `decimal.Decimal` — never `float` |
| Tests | `pytest`/`unittest` — committed only where a contract needs protecting |

**Why stdlib only:** every dependency is an install that can fail on a
different machine and silently break every later task. Python's standard
library already has an embedded database, an HTTP server and a test runner.
`app/requirements.txt` must stay empty (or absent).

### Project shape

```
app/
├── main.py              # HTTP server entry point
├── cli.py               # argparse CLI entry point
├── ledgerly/
│   ├── __init__.py
│   ├── db.py            # sqlite3 connection + schema/migrations
│   ├── models.py        # dataclasses for the domain
│   ├── accounts.py      # account operations
│   ├── transactions.py  # transaction operations
│   ├── importer.py      # CSV import
│   ├── categories.py    # categorisation rules
│   ├── budgets.py       # budget tracking
│   ├── reports.py       # aggregation queries
│   └── api.py           # HTTP routing
└── pytests/             # committed tests — only where agents.md asks for one
```

### The two commands that must always work

```bash
python3 main.py          # HTTP API on PORT (default 3000)
python3 cli.py --help    # CLI
```

`main.py` **must** read `int(os.environ.get("PORT", 3000))` and bind
`127.0.0.1`. The pipeline boots exactly this command and waits on that port.

### Database rules

1. **Path from `os.environ.get("LEDGERLY_DB", "app/data/ledgerly.db")`.**
   Create parent directories if missing.
2. **The app must start with no database file present** — create the schema on
   first run. Never crash because data is absent.
3. Use `LEDGERLY_DB=":memory:"` in tests for isolation.
4. Every schema change goes through the migration function in `db.py`, keyed by
   a `schema_version` table. Migrations are append-only and idempotent.
5. **Money is `Decimal`, stored as integer minor units** (cents) in SQLite.
   Never store or compare money as `float`.
6. Use a transaction (`with conn:`) whenever two tables must change together.

### Non-negotiable engineering rules

1. **Type hints on every function signature.** Run
   `python3 -m compileall app` before handing off — it must be clean.
2. **No secrets in code.** Read anything sensitive from `os.environ` and
   document it in `app/.env.example`.
3. **Validate at the boundary.** Reject bad input before touching the database
   and return a clear error, never a traceback.
4. **Stable error envelope** for the API, always:
   `{"error": {"code": "...", "message": "..."}}` with a correct HTTP status.
5. **All API routes are under `/api/v1`.** Once a route or JSON field ships in
   a completed task it is frozen — add fields, never rename or remove.
6. **Every function you call must exist.** If you write
   `transactions.summarise()` in `api.py`, define it in `transactions.py` in
   the same patch. Python only fails at call time, so an undefined name passes
   a syntax check and crashes a user.
7. **No business logic in `api.py` or `cli.py`.** They parse input, call a
   module, and format output. Logic lives in `ledgerly/` and is unit-testable.
8. **Dates are ISO `YYYY-MM-DD`.** Timestamps are UTC ISO-8601.
9. **Never break an earlier task.** Run the full test suite before handing off.

### Core domain

```python
Account     = (id, name, kind, currency, opening_balance_cents, created_at)
              # kind: checking | savings | credit | cash | investment
Transaction = (id, account_id, date, description, amount_cents,
               category_id | None, is_transfer, external_id | None, created_at)
              # amount_cents: negative = money out, positive = money in
Category    = (id, name, parent_id | None, kind)
              # kind: expense | income | transfer
Rule        = (id, pattern, category_id, priority, is_regex)
Budget      = (id, category_id, period, limit_cents)
              # period: 'YYYY-MM' or 'monthly' for a recurring budget
```

---

## Verification — prove it works, don't ship test files

**You must run your code before handing off.** Start the server, call the
function, exercise the CLI. Write whatever scratch scripts help you prove it —
then **delete them**. Scratch verification is not committed.

Before handing off, run the project's check command:

```bash
cd app && python3 -m compileall -q . && python3 -m pytest pytests -q
```

(pytest must run with `app/` as the working directory, or `import ledgerly`
fails with `ModuleNotFoundError` even though the code is correct.)

### When to commit a test — the exception, not the rule

Commit a test **only** when your task defines a contract a later task could
silently break. Those tasks say so explicitly, and there are only three:

| Task | Committed test | Why |
|---|---|---|
| T1 | `pytests/test_db.py` | schema/migration contract every task depends on |
| T3 | `pytests/test_transactions.py` | money maths — a silent regression here is a wrong balance |
| T7 | `pytests/test_reports.py` | aggregation must stay correct as data shapes change |

Every other task verifies in the sandbox and commits **no test file**.

Rationale: a throwaway test written by task N proves task N works. Only a
*committed* test from task 3 catches task 7 breaking it. So we pay for
persistence exactly where cross-task regression is likely, and nowhere else.

Committed tests must be deterministic and independent: use
`LEDGERLY_DB=":memory:"`, create your own fixtures, and never depend on another
test having run first.

## Task list

### T1: Database, schema & HTTP skeleton
**STATUS: DONE**

The foundation. Deliberately the largest task because nothing else can start.

**Requirements**

- `app/ledgerly/db.py`:
  - `get_connection(path=None)` — opens SQLite, enables
    `PRAGMA foreign_keys=ON`, sets `row_factory = sqlite3.Row`
  - `migrate(conn)` — creates a `schema_version` table plus the `accounts`,
    `transactions`, `categories` tables from Core domain. Idempotent.
  - `init_db(path=None)` — connect + migrate, creating parent dirs as needed
- `app/ledgerly/models.py` — frozen `@dataclass` types for `Account`,
  `Transaction`, `Category`, plus `to_dict()` on each (money exposed as a
  decimal string like `"-12.34"`, never a float).
- `app/ledgerly/api.py` — a tiny router: `add_route(method, pattern, handler)`
  supporting `:param` segments, JSON body parsing (reject >1 MB with 413),
  the standard error envelope, and 404 for unmatched paths.
- `app/main.py` — builds the server, calls `init_db()`, listens on
  `int(os.environ.get("PORT", 3000))`, and serves
  `GET /api/v1/health` → `200 {"status":"ok","version":"1","db":"ready"}`.
- `app/cli.py` — argparse skeleton with a `--version` flag and a `health`
  subcommand that prints the DB path and table count.
- `app/.env.example` documenting `PORT` and `LEDGERLY_DB`.
- `app/.gitignore` for `__pycache__/`, `*.py[cod]`, `*.db`, `data/`, `.env`.
  The SQLite file must never be committed — the gate rejects database files.

**COMMIT this test** — `app/pytests/test_db.py`: `migrate` is idempotent
(running twice leaves one `schema_version` row) and all three tables exist.
Also verify by hand (no committed file): health returns 200 with
`status: "ok"`, and an unknown path returns 404 with an `error.code`.

---

### T2: Accounts
**STATUS: DONE**

**Requirements**

- `app/ledgerly/accounts.py`: `create`, `get`, `list_all`, `update`, `archive`.
  - `kind` must be one of the enum in Core domain — reject anything else
  - name is unique case-insensitively; a duplicate raises a clear error
  - `opening_balance_cents` is an int; accept `"123.45"` at the boundary and
    convert with `Decimal`, never `float`
- API: `GET/POST /api/v1/accounts`, `GET/PATCH /api/v1/accounts/:id`,
  `POST /api/v1/accounts/:id/archive`. `404` unknown, `409` duplicate name,
  `400` invalid kind.
- CLI: `account add|list|show|archive`, with a readable table for `list`.

**Verify (do not commit a test file)** — start the API and prove with `curl`:
creating an account works, a duplicate name returns `409`, an invalid kind
returns `400`, and `"123.45"` is stored as `12345`. Delete your scratch script
before uploading.

---

### T3: Transactions
**STATUS: DONE**

**Requirements**

- `app/ledgerly/transactions.py`: `add`, `get`, `update`, `delete`,
  `list_for_account(account_id, *, start=None, end=None, limit=100, offset=0)`.
  - validate the account exists, the date parses as `YYYY-MM-DD`, and the
    amount is a non-zero integer number of cents
  - `balance(account_id)` = opening balance + sum of transactions
- API: `GET/POST /api/v1/accounts/:id/transactions`,
  `GET/PATCH/DELETE /api/v1/transactions/:id`,
  `GET /api/v1/accounts/:id/balance`.
  List responses are `{"data": [...], "total": n, "limit": l, "offset": o}`.
- CLI: `tx add|list|delete`, and `balance <account>`.

**COMMIT this test** — `pytests/test_transactions.py`: balance after +100.00
and −30.50 is exactly `6950` cents; a zero amount is rejected; date validation
works. Money maths is the one thing a later task must never silently break.

---

### T4: CSV import
**STATUS: DONE**

**Requirements**

- `app/ledgerly/importer.py`:
  - `sniff(path_or_text)` → detected delimiter, header names, and a suggested
    column mapping (date / description / amount, or debit+credit pair)
  - `parse(text, mapping)` → list of candidate transactions plus a list of
    row-level errors — one bad row must never abort the file
  - `import_rows(conn, account_id, rows, *, dedupe=True)` — dedupe on
    `external_id` when present, otherwise on
    `(date, description, amount_cents)`. Returns `{"imported": n, "skipped": n}`
  - handle at least: `1,234.56`, `(45.00)` as negative, `1.234,56` European
    style, and a trailing `CR`/`DR` marker
- API: `POST /api/v1/accounts/:id/import` accepting raw CSV text.
- CLI: `import <account> <file.csv> [--dry-run]`, printing a summary table.

**Verify (do not commit a test file)** — in a scratch script confirm
`(45.00)` parses to `-4500`, `1.234,56` parses to `123456`, and re-importing
the same CSV imports 0 and skips all. Delete the script before uploading.

---

### T5: Categories & auto-categorisation rules
**STATUS: DONE**

**Requirements**

- `app/ledgerly/categories.py`: CRUD for categories with an optional parent
  (one level of nesting only — reject deeper), plus a default seed set
  (Groceries, Rent, Transport, Utilities, Dining, Salary, Transfers…),
  seeded idempotently.
- Rules: `add_rule(pattern, category_id, priority, is_regex=False)`,
  `match(description)` → the highest-priority matching category or `None`.
  Substring matches are case-insensitive; invalid regex is rejected at
  creation, never at match time.
- `apply_rules(conn, *, only_uncategorised=True)` → number recategorised.
- API: `GET/POST /api/v1/categories`, `GET/POST /api/v1/rules`,
  `POST /api/v1/rules/apply`.
- CLI: `category list|add`, `rule add|list|apply`.

**Verify (do not commit a test file)** — prove a higher-priority rule wins,
an invalid regex is rejected at creation time (not at match time), and nesting
beyond one level is rejected. Delete your scratch script before uploading.

---

### T6: Budgets
**STATUS: TODO**

**Requirements**

- `app/ledgerly/budgets.py`: `set_budget(category_id, period, limit_cents)`
  (upsert), `get_status(period)` → per-category
  `{"limit", "spent", "remaining", "pct"}` plus a total row.
  - `period` accepts `YYYY-MM` or the literal `monthly` (a recurring default
    used when no month-specific budget exists)
  - spending counts **expense** categories only, excludes transfers, and
    treats refunds (positive amounts in an expense category) as reducing spend
- API: `GET/PUT /api/v1/budgets`, `GET /api/v1/budgets/status?period=YYYY-MM`.
- CLI: `budget set|status`, with a simple text bar per category.

**Verify (do not commit a test file)** — prove a refund reduces spend, a
month-specific budget overrides the recurring one, and a category with no
budget reports `None` rather than zero. Delete your scratch script.

---

### T7: Reports
**STATUS: TODO**

**Requirements**

- `app/ledgerly/reports.py`, all implemented as **SQL aggregations**, not
  Python loops over full result sets:
  - `spending_by_category(start, end, *, top=None)`
  - `monthly_totals(months=12)` → income, expense, net per month, **including
    months with no activity** so a chart has no gaps
  - `cashflow(start, end)` → opening balance, total in, total out, closing
  - `largest_transactions(start, end, limit=10)`
  - `search(query, *, start=None, end=None, min_cents=None, max_cents=None)`
- API: `GET /api/v1/reports/{spending,monthly,cashflow,search}`.
- CLI: `report spending|monthly|cashflow`, and `search <query>`.
- On an empty database every report returns well-formed zeroes — no exception,
  no `None` where a number is promised.

**COMMIT this test** — `pytests/test_reports.py`: on an empty DB every report
returns zeroes (no exception, no `None` where a number is promised), and
`monthly_totals` includes months with no activity.

---

### T8: Reconciliation, export & polish
**STATUS: TODO**

Final task.

**Requirements**

- `app/ledgerly/accounts.py` gains `reconcile(account_id, statement_cents,
  as_of)` → `{"expected", "actual", "difference", "unreconciled": [...]}`, and
  transactions gain a `reconciled_at` column via a **new migration**.
- Export: `GET /api/v1/export?format=json|csv` (correct CSV quoting for fields
  containing commas, quotes or newlines) and `Content-Disposition: attachment`.
- `GET /api/v1/health` extends to include `{"counts": {"accounts",
  "transactions", "categories"}}` — **keep `status` and `version`** so T1's
  test still passes.
- CLI: `reconcile` and `export`, plus a top-level `--json` flag that makes any
  command emit machine-readable output.
- `app/README.md`: install-free setup, every CLI command with an example, the
  environment variables, and how to run both test layers.

**Verify (do not commit a test file)** — prove a matching statement reports a
difference of 0 with an empty unreconciled list, `/api/v1/export?format=csv`
starts with the expected header row, and health still reports `status: "ok"`.
Re-run the T1/T3/T7 committed tests — they must still pass.

---

## Activity Log

<!-- Agents append one line here per completed task -->
- T1 completed: SQLite schema, models, router, health API, CLI skeleton, and migration test.
- T2 completed: account CRUD/archive services, v2 archive migration, account API routes, and CLI commands.
- T3 completed: transaction service (add/get/update/delete/list/balance) with non-zero cents math, ISO YYYY-MM-DD date validation, account existence checks, and paged listing; API routes for `accounts/:id/transactions` (GET/POST), `transactions/:id` (GET/PATCH/DELETE), and `accounts/:id/balance` (GET); CLI commands `tx add|list|delete` and `balance <account>`; committed `pytests/test_transactions.py` covering the 6950-cent balance invariant, zero-amount rejection, and date validation.
- T4 completed: CSV sniff/parse/import service with row-level errors, bank amount parsing for parentheses/US/EU/CR-DR formats, dedupe by external id or transaction tuple, raw CSV import API, and CLI import/dry-run summary.
- T5 completed: category CRUD with one-level parent validation and idempotent default seeds; migration v3 rules storage; priority-ordered, case-insensitive substring/validated-regex rule matching and application; category/rule API endpoints; and category/rule CLI commands.
