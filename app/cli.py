"""Command-line interface for Ledgerly."""
from __future__ import annotations

import argparse
import os
from typing import NoReturn, Sequence

from ledgerly import accounts
from ledgerly.db import init_db
from ledgerly.models import Account


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


def _format_row(values: list[str], widths: list[int]) -> str:
    return "  ".join(value.ljust(widths[index]) for index, value in enumerate(values))


def _cli_error(parser: argparse.ArgumentParser, message: str) -> NoReturn:
    parser.error(message)


if __name__ == "__main__":
    main()
