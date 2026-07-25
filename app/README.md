# Ledgerly

Ledgerly is an install-free personal-finance tracker: a local SQLite ledger, a
command-line interface for daily work, and a small read/write HTTP API. It uses
only Python's standard library; no package installation or database server is
needed.

## Quick start

Use Python 3.11 or newer. From this directory:

```sh
# Start the API at http://127.0.0.1:3000
python3 main.py

# In another terminal, create and inspect a local ledger
python3 cli.py account add "Main checking" --kind checking --opening-balance 250.00
python3 cli.py balance 1
```

The server automatically creates and migrates its SQLite file. It is safe to
start with no data file at all.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port; the server always binds `127.0.0.1`. |
| `LEDGERLY_DB` | `app/data/ledgerly.db` | SQLite database path. Use `:memory:` for isolated experiments/tests. |

For a database directly below this `app/` directory, run commands with
`LEDGERLY_DB=./data/ledgerly.db`. See `.env.example` for the same settings.
Never commit the generated database or a `.env` file.

## CLI

Run `python3 cli.py --help` for argument details. Amounts entered by the CLI
are decimal major units (for example, `-24.95`); Ledgerly stores them as integer
cents. Dates use `YYYY-MM-DD`.

Use the top-level `--json` flag before a command to wrap any command's normal
output in a JSON object, which is useful to programs that need a stable,
machine-readable response:

```sh
python3 cli.py --json balance 1
python3 cli.py --json reconcile 1 1225.05 --as-of 2026-07-31
```

### Health and version

```sh
python3 cli.py health
python3 cli.py --version
```

### Accounts

```sh
python3 cli.py account add "Emergency savings" --kind savings --currency USD --opening-balance 500.00
python3 cli.py account list
python3 cli.py account show 1
python3 cli.py account archive 1
```

### Transactions and balances

```sh
python3 cli.py tx add 1 2026-07-01 "Salary" 3000.00
python3 cli.py tx add 1 2026-07-02 "Corner shop" -24.95 --category-id 1
python3 cli.py tx list 1 --start 2026-07-01 --end 2026-07-31 --limit 50
python3 cli.py tx delete 2
python3 cli.py balance 1
```

### CSV import

```sh
python3 cli.py import 1 statement.csv --dry-run
python3 cli.py import 1 statement.csv
```

### Categories and categorisation rules

```sh
python3 cli.py category list
python3 cli.py category add "Coffee" --kind expense
python3 cli.py rule add "coffee" 1 --priority 50
python3 cli.py rule list
python3 cli.py rule apply
python3 cli.py rule apply --all
```

### Budgets

```sh
python3 cli.py budget set 1 monthly 400.00
python3 cli.py budget set 1 2026-07 450.00
python3 cli.py budget list
python3 cli.py budget status --period 2026-07
```

### Reports and search

```sh
python3 cli.py report spending --start 2026-07-01 --end 2026-07-31 --top 5
python3 cli.py report monthly --months 6
python3 cli.py report cashflow --start 2026-07-01 --end 2026-07-31
python3 cli.py search coffee --start 2026-07-01 --min-cents -5000
```

### Reconciliation

Reconcile compares the ledger closing balance with a statement closing balance
on the given date. When the difference is zero, all currently pending
transactions dated on or before `--as-of` are marked with a UTC
`reconciled_at` timestamp. A mismatch does not change data and lists the
pending transactions that need investigation.

```sh
python3 cli.py reconcile 1 1225.05 --as-of 2026-07-31
```

### Export

Export includes all accounts and transactions. JSON exports use a top-level
`accounts` and `transactions` object. The CSV export begins with this header:

```text
id,account_id,date,description,amount,amount_cents,category_id,category_name,is_transfer,external_id,created_at,reconciled_at
```

Fields containing commas, quotes, or newlines are quoted correctly by the
standard CSV writer.

```sh
python3 cli.py export --format json --output ledgerly.json
python3 cli.py export --format csv --output ledgerly.csv
python3 cli.py export --format csv
```

## HTTP API

Start the server with `python3 main.py`. All routes are under `/api/v1`.

```sh
curl http://127.0.0.1:3000/api/v1/health
curl -i 'http://127.0.0.1:3000/api/v1/export?format=json'
curl -i 'http://127.0.0.1:3000/api/v1/export?format=csv'
```

The export responses set `Content-Disposition: attachment` and select a
`.json` or `.csv` filename. The health response retains `status` and `version`
and also includes counts for accounts, transactions, and categories.

## Verification

There are two automated layers: compilation catches import/syntax failures and
the committed contract suite protects database, transaction-math, and report
behaviour. Run both from this directory:

```sh
python3 -m compileall -q .
python3 -m pytest pytests -q
```

For a small end-to-end API smoke test, start `python3 main.py` and run:

```sh
curl http://127.0.0.1:3000/api/v1/health
curl -D - 'http://127.0.0.1:3000/api/v1/export?format=csv' | head
```
