import argparse
import os
from ledgerly.db import init_db


def main() -> None:
    parser = argparse.ArgumentParser(prog="ledgerly")
    parser.add_argument("--version", action="version", version="Ledgerly 1")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("health")
    args = parser.parse_args()
    if args.command == "health":
        conn = init_db()
        count = conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
        print(f"database: {os.environ.get('LEDGERLY_DB', 'app/data/ledgerly.db')}\ntables: {count}")

if __name__ == "__main__":
    main()
