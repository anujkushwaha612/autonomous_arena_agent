"""Command-line interface for Ledgerly."""
from __future__ import annotations

import argparse
import os
from typing import NoReturn, Sequence

from ledgerly import accounts, transactions
from ledgerly.db import init_db
from ledgerly.models import Account, Transaction

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
