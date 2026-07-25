"""Command-line interface for Ledgerly."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import NoReturn, Sequence

from ledgerly import accounts, budgets, categories, importer, reports, transactions
from ledgerly.db import init_db
from ledgerly.models import Account, Budget, Category, Rule, Transaction

_BALANCE_FIELD = "balance_cents"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ledgerly")
    parser.add_argument("--version", action="version", version="Ledgerly 1")
    subcommands = parser.add_subparsers(dest="command")
    subcommands.add_parser("health", help="show database health")

    account_parser = subcommands.add_parser("account", help="manage accounts")
    account_commands = account_parser.add_subparsers(dest="account_command", required=True)

    add_parser = account_commands.add_parser("add", help="create an account")
    add_parser.add_argument("name", help="unique account name")
    add_parser.add_argument("--kind", required=True, choices=sorted(accounts.ACCOUNT_KINDS))
    add_parser.add_argument("--currency", default="USD", help="three-letter currency (default: USD)")
    add_parser.add_argument(
        "--opening-balance",
        default="0.00",
        help="opening balance in major units (default: 0.00)",
    )

    account_commands.add_parser("list", help="list accounts")
    show_parser = account_commands.add_parser("show", help="show one account")
    show_parser.add_argument("id", type=int, help="account id")
    archive_parser = account_commands.add_parser("archive", help="archive an account")
    archive_parser.add_argument("id", type=int, help="account id")

    tx_parser = subcommands.add_parser("tx", help="manage transactions")
    tx_commands = tx_parser.add_subparsers(dest="tx_command", required=True)

    tx_add = tx_commands.add_parser("add", help="add a transaction")
    tx_add.add_argument("account_id", type=int, help="account id")
    tx_add.add_argument("date", help="transaction date in YYYY-MM-DD")
    tx_add.add_argument("description", help="transaction description")
    tx_add.add_argument(
        "amount",
        help="amount in major units (negative for money out)",
    )
    tx_add.add_argument(
        "--category-id",
        type=int,
        default=None,
        help="category id",
    )
    tx_add.add_argument(
        "--is-transfer",
        action="store_true",
        help="mark as a transfer between accounts",
    )
    tx_add.add_argument(
        "--external-id",
        default=None,
        help="external identifier for dedupe",
    )

    tx_list = tx_commands.add_parser("list", help="list transactions for an account")
    tx_list.add_argument("account_id", type=int, help="account id")
    tx_list.add_argument("--start", default=None, help="start date inclusive (YYYY-MM-DD)")
    tx_list.add_argument("--end", default=None, help="end date inclusive (YYYY-MM-DD)")
    tx_list.add_argument("--limit", type=int, default=transactions.DEFAULT_LIST_LIMIT)
    tx_list.add_argument("--offset", type=int, default=0)

    tx_delete = tx_commands.add_parser("delete", help="delete a transaction")
    tx_delete.add_argument("id", type=int, help="transaction id")

    balance_parser = subcommands.add_parser("balance", help="show account balance")
    balance_parser.add_argument("account", type=int, help="account id")

    import_parser = subcommands.add_parser("import", help="import transactions from CSV")
    import_parser.add_argument("account", type=int, help="account id")
    import_parser.add_argument("file", help="CSV file path")
    import_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="parse and report without inserting transactions",
    )

    category_parser = subcommands.add_parser("category", help="manage categories")
    category_commands = category_parser.add_subparsers(dest="category_command", required=True)
    category_commands.add_parser("list", help="list categories")
    category_add = category_commands.add_parser("add", help="create a category")
    category_add.add_argument("name", help="unique category name")
    category_add.add_argument("--kind", required=True, choices=sorted(categories.CATEGORY_KINDS))
    category_add.add_argument("--parent", type=int, default=None, help="parent category id")

    rule_parser = subcommands.add_parser("rule", help="manage categorisation rules")
    rule_commands = rule_parser.add_subparsers(dest="rule_command", required=True)
    rule_add = rule_commands.add_parser("add", help="create a categorisation rule")
    rule_add.add_argument("pattern", help="substring or regular-expression pattern")
    rule_add.add_argument("category", type=int, help="destination category id")
    rule_add.add_argument("--priority", type=int, required=True, help="higher values win")
    rule_add.add_argument("--regex", action="store_true", help="interpret pattern as a regular expression")
    rule_commands.add_parser("list", help="list rules by priority")
    rule_apply = rule_commands.add_parser("apply", help="apply rules to transactions")
    rule_apply.add_argument(
        "--all",
        action="store_true",
        help="also re-evaluate transactions that already have a category",
    )

    budget_parser = subcommands.add_parser("budget", help="manage budgets")
    budget_commands = budget_parser.add_subparsers(dest="budget_command", required=True)
    budget_set = budget_commands.add_parser("set", help="set or replace a budget")
    budget_set.add_argument("category", type=int, help="category id")
    budget_set.add_argument(
        "period",
        help="'monthly' for a recurring budget, or a specific YYYY-MM month",
    )
    budget_set.add_argument("limit", help="limit in major units, e.g. 250.00")
    budget_status = budget_commands.add_parser("status", help="show budget usage")
    budget_status.add_argument(
        "--period",
        default=None,
        help="YYYY-MM month (defaults to the current month)",
    )
    budget_commands.add_parser("list", help="list stored budgets")

    report_parser = subcommands.add_parser("report", help="show financial reports")
    report_commands = report_parser.add_subparsers(dest="report_command", required=True)

    spending_report = report_commands.add_parser("spending", help="spending by category")
    spending_report.add_argument("--start", default="1900-01-01", help="YYYY-MM-DD")
    spending_report.add_argument("--end", default="2099-12-31", help="YYYY-MM-DD")
    spending_report.add_argument("--top", type=int, default=None, help="limit to top N categories")

    monthly_report = report_commands.add_parser("monthly", help="monthly income/expense totals")
    monthly_report.add_argument("--months", type=int, default=12, help="last N months (default 12)")

    cashflow_report = report_commands.add_parser("cashflow", help="opening/closing balances and flow")
    cashflow_report.add_argument("--start", default="1900-01-01", help="YYYY-MM-DD")
    cashflow_report.add_argument("--end", default="2099-12-31", help="YYYY-MM-DD")

    search_parser = subcommands.add_parser("search", help="search transactions")
    search_parser.add_argument("query", help="description search text")
    search_parser.add_argument("--start", default=None, help="YYYY-MM-DD")
    search_parser.add_argument("--end", default=None, help="YYYY-MM-DD")
    search_parser.add_argument("--min-cents", type=int, default=None)
    search_parser.add_argument("--max-cents", type=int, default=None)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "health":
        _health()
        return
    if args.command == "account":
        _run_account(args, parser)
        return
    if args.command == "tx":
        _run_tx(args, parser)
        return
    if args.command == "balance":
        _run_balance(args, parser)
        return
    if args.command == "import":
        _run_import(args, parser)
        return
    if args.command == "category":
        _run_category(args, parser)
        return
    if args.command == "rule":
        _run_rule(args, parser)
        return
    if args.command == "budget":
        _run_budget(args, parser)
        return
    if args.command == "report":
        _run_report(args, parser)
        return
    if args.command == "search":
        _run_search(args, parser)
        return
    parser.print_help()


def _health() -> None:
    connection = init_db()
    try:
        count = connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ).fetchone()[0]
        print(
            f"database: {os.environ.get('LEDGERLY_DB', 'app/data/ledgerly.db')}\n"
            f"tables: {count}"
        )
    finally:
        connection.close()


def _run_report(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        if args.report_command == "spending":
            try:
                data = reports.spending_by_category(connection, args.start, args.end, top=args.top)
            except (transactions.TransactionError, ValueError) as exc:
                _cli_error(parser, str(exc))
            _print_spending_report(data)
        elif args.report_command == "monthly":
            data = reports.monthly_totals(connection, args.months)
            _print_monthly_report(data)
        elif args.report_command == "cashflow":
            try:
                data = reports.cashflow(connection, args.start, args.end)
            except (transactions.TransactionError, ValueError) as exc:
                _cli_error(parser, str(exc))
            _print_cashflow_report(data)
    finally:
        connection.close()


def _run_search(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        try:
            data = reports.search(
                connection,
                args.query,
                start=args.start,
                end=args.end,
                min_cents=args.min_cents,
                max_cents=args.max_cents,
            )
        except (transactions.TransactionError, ValueError) as exc:
            _cli_error(parser, str(exc))
        _print_search_results(data)
    finally:
        connection.close()


def _print_spending_report(data: list[dict[str, Any]]) -> None:
    if not data:
        print("No spending found.")
        return
    rows = [[row["category"], row["total"]] for row in data]
    headers = ["CATEGORY", "TOTAL"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_monthly_report(data: list[dict[str, Any]]) -> None:
    rows = [[row["month"], row["income"], row["expense"], row["net"]] for row in data]
    headers = ["MONTH", "INCOME", "EXPENSE", "NET"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_cashflow_report(data: dict[str, Any]) -> None:
    for label, key in (
        ("Opening balance", "opening"),
        ("Total in", "total_in"),
        ("Total out", "total_out"),
        ("Closing balance", "closing"),
    ):
        print(f"{label}: {data[key]}")


def _print_search_results(data: list[dict[str, Any]]) -> None:
    print(f"Total found: {len(data)}")
    if not data:
        return
    table: list[list[str]] = []
    for row in data:
        table.append(
            [
                str(row["id"]),
                str(row["date"]),
                str(row["description"]),
                str(row["amount"]),
                str(row["category_name"] or "-"),
            ]
        )
    headers = ["ID", "DATE", "DESCRIPTION", "AMOUNT", "CATEGORY"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in table))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in table:
        print(_format_row(row, widths))


def _run_account(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        if args.account_command == "add":
            account = accounts.create(
                connection,
                name=args.name,
                kind=args.kind,
                currency=args.currency,
                opening_balance_cents=args.opening_balance,
            )
            print(f"Created account {account.id}: {account.name}")
        elif args.account_command == "list":
            _print_account_table(accounts.list_all(connection))
        elif args.account_command == "show":
            account = accounts.get(connection, args.id)
            if account is None:
                _cli_error(parser, f"account {args.id} was not found")
            _print_account(account)
        elif args.account_command == "archive":
            account = accounts.archive(connection, args.id)
            print(f"Archived account {account.id}: {account.name}")
    except accounts.AccountError as exc:
        _cli_error(parser, str(exc))
    finally:
        connection.close()


def _run_tx(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        if args.tx_command == "add":
            try:
                transaction = transactions.add(
                    connection,
                    args.account_id,
                    args.date,
                    args.description,
                    args.amount,
                    category_id=args.category_id,
                    is_transfer=args.is_transfer,
                    external_id=args.external_id,
                )
            except transactions.TransactionError as exc:
                _cli_error(parser, str(exc))
            print(
                f"Created transaction {transaction.id} on account {transaction.account_id}: "
                f"{transaction.description} ({_format_cents(transaction.amount_cents)})"
            )
        elif args.tx_command == "list":
            try:
                rows, total = transactions.list_for_account(
                    connection,
                    args.account_id,
                    start=args.start,
                    end=args.end,
                    limit=args.limit,
                    offset=args.offset,
                )
            except transactions.TransactionError as exc:
                _cli_error(parser, str(exc))
            _print_transaction_list(rows, total, args.limit, args.offset)
        elif args.tx_command == "delete":
            try:
                transactions.delete(connection, args.id)
            except transactions.TransactionError as exc:
                _cli_error(parser, str(exc))
            print(f"Deleted transaction {args.id}")
    finally:
        connection.close()


def _run_balance(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        try:
            cents = transactions.balance(connection, args.account)
        except transactions.TransactionError as exc:
            _cli_error(parser, str(exc))
        account = accounts.get(connection, args.account)
        if account is None:
            _cli_error(parser, f"account {args.account} was not found")
        print(
            f"Account {account.id} ({account.name}) balance: {_format_cents(cents)} "
            f"({_BALANCE_FIELD}={cents})"
        )
    finally:
        connection.close()


def _run_import(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    try:
        csv_text = Path(args.file).read_text(encoding="utf-8-sig")
        detected = importer.sniff(csv_text)
        rows, errors = importer.parse(csv_text, detected["mapping"])
    except (OSError, importer.ImporterError) as exc:
        _cli_error(parser, str(exc))

    if args.dry_run:
        _print_import_summary(
            {"imported": 0, "skipped": 0}, len(rows), len(errors), dry_run=True
        )
        _print_import_errors(errors)
        return

    connection = init_db()
    try:
        try:
            summary = importer.import_rows(connection, args.account, rows)
        except importer.ImporterError as exc:
            _cli_error(parser, str(exc))
        _print_import_summary(summary, len(rows), len(errors), dry_run=False)
        _print_import_errors(errors)
    finally:
        connection.close()


def _run_category(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        if args.category_command == "list":
            _print_category_table(categories.list_all(connection))
        elif args.category_command == "add":
            try:
                category = categories.create(
                    connection,
                    name=args.name,
                    kind=args.kind,
                    parent_id=args.parent,
                )
            except categories.CategoryError as exc:
                _cli_error(parser, str(exc))
            print(f"Created category {category.id}: {category.name}")
    finally:
        connection.close()


def _run_rule(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        if args.rule_command == "add":
            try:
                rule = categories.add_rule(
                    connection,
                    args.pattern,
                    args.category,
                    args.priority,
                    args.regex,
                )
            except (categories.RuleError, categories.CategoryError) as exc:
                _cli_error(parser, str(exc))
            print(f"Created rule {rule.id}: {rule.pattern}")
        elif args.rule_command == "list":
            _print_rule_table(categories.list_rules(connection))
        elif args.rule_command == "apply":
            try:
                count = categories.apply_rules(
                    connection, only_uncategorised=not args.all
                )
            except categories.RuleError as exc:
                _cli_error(parser, str(exc))
            print(f"Recategorised {count} transaction(s).")
    finally:
        connection.close()


def _run_budget(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    connection = init_db()
    try:
        if args.budget_command == "set":
            try:
                budget = budgets.set_budget(
                    connection, args.category, args.period, args.limit
                )
            except (budgets.BudgetError, categories.CategoryError) as exc:
                _cli_error(parser, str(exc))
            print(
                f"Budget for category {budget.category_id} in {budget.period}: "
                f"{_format_cents(budget.limit_cents)}"
            )
        elif args.budget_command == "list":
            _print_budget_table(budgets.list_budgets(connection))
        elif args.budget_command == "status":
            period = args.period or budgets.current_month()
            try:
                status = budgets.get_status(connection, period)
            except (budgets.BudgetError, categories.CategoryError) as exc:
                _cli_error(parser, str(exc))
            _print_budget_status(status)
    finally:
        connection.close()


def _print_budget_table(budget_list: list[Budget]) -> None:
    if not budget_list:
        print("No budgets.")
        return
    rows = [
        [
            str(budget.id),
            str(budget.category_id),
            budget.period,
            _format_cents(budget.limit_cents),
        ]
        for budget in budget_list
    ]
    headers = ["ID", "CATEGORY", "PERIOD", "LIMIT"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _budget_bar(pct: float | None, width: int = 20) -> str:
    """Render a simple text usage bar; unbudgeted categories show no bar."""
    if pct is None:
        return "-" * width
    filled = int(round(min(max(pct, 0.0), 100.0) / 100 * width))
    return "#" * filled + "." * (width - filled)


def _print_budget_status(status: dict[str, object]) -> None:
    period = str(status["period"])
    month = str(status["month"])
    label = period if period == month else f"{period} (month {month})"
    print(f"Budget status for {label}")
    category_rows = list(status["categories"])  # type: ignore[arg-type]
    total = dict(status["total"])  # type: ignore[arg-type]
    rows: list[list[str]] = []
    for entry in [*category_rows, total]:
        row = dict(entry)  # type: ignore[arg-type]
        pct = row["pct"]
        rows.append(
            [
                str(row["category"]),
                "-" if row["limit"] is None else str(row["limit"]),
                str(row["spent"]),
                "-" if row["remaining"] is None else str(row["remaining"]),
                "-" if pct is None else f"{float(pct):.1f}%",
                _budget_bar(None if pct is None else float(pct)),
            ]
        )
    headers = ["CATEGORY", "LIMIT", "SPENT", "REMAINING", "PCT", "USAGE"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_account(account: Account) -> None:
    data = account.to_dict()
    for label, key in (
        ("ID", "id"),
        ("Name", "name"),
        ("Kind", "kind"),
        ("Currency", "currency"),
        ("Opening balance", "opening_balance"),
        ("Archived", "archived"),
        ("Created", "created_at"),
    ):
        print(f"{label}: {data[key]}")


def _print_account_table(account_list: list[Account]) -> None:
    if not account_list:
        print("No accounts.")
        return
    rows: list[list[str]] = []
    for account in account_list:
        data = account.to_dict()
        rows.append(
            [
                str(data["id"]),
                str(data["name"]),
                str(data["kind"]),
                str(data["currency"]),
                str(data["opening_balance"]),
                "yes" if data["archived"] else "no",
            ]
        )
    headers = ["ID", "NAME", "KIND", "CURRENCY", "OPENING", "ARCHIVED"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_category_table(category_list: list[Category]) -> None:
    if not category_list:
        print("No categories.")
        return
    rows = [
        [
            str(category.id),
            category.name,
            str(category.parent_id) if category.parent_id is not None else "-",
            category.kind,
        ]
        for category in category_list
    ]
    headers = ["ID", "NAME", "PARENT", "KIND"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_rule_table(rule_list: list[Rule]) -> None:
    if not rule_list:
        print("No rules.")
        return
    rows = [
        [
            str(rule.id),
            str(rule.priority),
            str(rule.category_id),
            "yes" if rule.is_regex else "no",
            rule.pattern,
        ]
        for rule in rule_list
    ]
    headers = ["ID", "PRIORITY", "CATEGORY", "REGEX", "PATTERN"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_transaction_list(
    rows: list[Transaction], total: int, limit: int, offset: int
) -> None:
    print(
        f"Total: {total} (limit={limit}, offset={offset})"
    )
    if not rows:
        print("No transactions.")
        return
    table: list[list[str]] = []
    for transaction in rows:
        data = transaction.to_dict()
        table.append(
            [
                str(data["id"]),
                str(data["date"]),
                str(data["description"]),
                str(data["amount"]),
                "yes" if data["is_transfer"] else "no",
            ]
        )
    headers = ["ID", "DATE", "DESCRIPTION", "AMOUNT", "TRANSFER"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in table))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in table:
        print(_format_row(row, widths))


def _print_import_summary(summary: dict[str, int], parsed: int, errors: int, *, dry_run: bool) -> None:
    rows = [["parsed", str(parsed)], ["errors", str(errors)]]
    if dry_run:
        rows.append(["would_import", str(parsed)])
    else:
        rows.append(["imported", str(summary["imported"])])
        rows.append(["skipped", str(summary["skipped"])])
    headers = ["METRIC", "COUNT"]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]
    print(_format_row(headers, widths))
    print(_format_row(["-" * width for width in widths], widths))
    for row in rows:
        print(_format_row(row, widths))


def _print_import_errors(errors: list[importer.RowError]) -> None:
    if not errors:
        return
    print("Errors:")
    for error in errors:
        print(f"row {error['row']}: {error['error']}")


def _format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    absolute = abs(cents)
    return f"{sign}{absolute // 100}.{absolute % 100:02d}"


def _format_row(values: list[str], widths: list[int]) -> str:
    return "  ".join(value.ljust(widths[index]) for index, value in enumerate(values))


def _cli_error(parser: argparse.ArgumentParser, message: str) -> NoReturn:
    parser.error(message)


if __name__ == "__main__":
    main()
