"""CSV import helpers for Ledgerly transactions."""
from __future__ import annotations

import csv
import io
import os
import re
import sqlite3
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping, TypeAlias

from ledgerly import accounts, transactions

ColumnMapping: TypeAlias = Mapping[str, Any]
CandidateRow: TypeAlias = dict[str, Any]
RowError: TypeAlias = dict[str, Any]

DELIMITERS = ",;\t|"
REQUIRED_AMOUNT_KEYS = ("amount", "debit", "credit")
SQLITE_INTEGER_MIN = -(2**63)
SQLITE_INTEGER_MAX = 2**63 - 1

_DATE_HEADERS = {
    "date",
    "posteddate",
    "postingdate",
    "transactiondate",
    "transdate",
    "bookingdate",
    "valuedate",
}
_DESCRIPTION_HEADERS = {
    "description",
    "transactiondescription",
    "merchant",
    "payee",
    "memo",
    "details",
    "narrative",
    "particulars",
    "name",
}
_AMOUNT_HEADERS = {"amount", "amt", "transactionamount", "value", "netamount"}
_DEBIT_HEADERS = {
    "debit",
    "debits",
    "withdrawal",
    "withdrawals",
    "moneyout",
    "paidout",
    "outflow",
    "charge",
    "charges",
}
_CREDIT_HEADERS = {
    "credit",
    "credits",
    "deposit",
    "deposits",
    "moneyin",
    "paidin",
    "inflow",
    "payment",
}
_EXTERNAL_ID_HEADERS = {
    "externalid",
    "external_id",
    "transactionid",
    "transaction_id",
    "reference",
    "ref",
    "fitid",
    "id",
}
_DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y")
_MARKER_RE = re.compile(r"\s*(CR|DR)\.?\s*$", re.IGNORECASE)


class ImporterError(ValueError):
    """Base class for CSV import errors safe to show to a user."""


class MappingError(ImporterError):
    """Raised when a CSV mapping cannot produce Ledgerly transactions."""


class ImportAccountError(ImporterError):
    """Raised when the requested import account does not exist."""


def sniff(path_or_text: str | os.PathLike[str]) -> dict[str, Any]:
    """Detect CSV delimiter, headers, and a likely column mapping.

    ``path_or_text`` may be either raw CSV text or a path to a CSV file. The
    return value is intentionally plain JSON-friendly data so the API and CLI
    can display it without extra conversion.
    """
    text = _read_path_or_text(path_or_text)
    delimiter = _detect_delimiter(text)
    headers = _read_headers(text, delimiter)
    return {
        "delimiter": delimiter,
        "headers": headers,
        "mapping": _suggest_mapping(headers),
    }


def parse(text: str, mapping: ColumnMapping) -> tuple[list[CandidateRow], list[RowError]]:
    """Parse CSV text into candidate transactions and row-level errors.

    Bad data in one row is captured in the returned ``errors`` list and never
    stops later rows from being parsed. Structural problems with the whole CSV
    (for example, a missing date column) raise ``MappingError`` because no row
    can be interpreted safely.
    """
    if not isinstance(text, str):
        raise MappingError("CSV text must be a string")
    prepared = _prepare_mapping(mapping)
    delimiter = prepared["delimiter"] if isinstance(prepared.get("delimiter"), str) else _detect_delimiter(text)
    headers = _read_headers(text, delimiter)
    if not headers:
        raise MappingError("CSV must include a header row")

    columns = _resolve_columns(prepared, headers)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    rows: list[CandidateRow] = []
    errors: list[RowError] = []
    for row_number, row in enumerate(reader, start=2):
        if _is_blank_row(row):
            continue
        try:
            candidate = _parse_row(row, columns)
        except ImporterError as exc:
            message = str(exc)
            errors.append({"row": row_number, "error": message, "message": message})
            continue
        rows.append(candidate)
    return rows, errors


def import_rows(
    conn: sqlite3.Connection,
    account_id: int,
    rows: list[CandidateRow],
    *,
    dedupe: bool = True,
) -> dict[str, int]:
    """Import parsed rows into an account, optionally skipping duplicates."""
    clean_account_id = _validate_account_id(account_id)
    if accounts.get(conn, clean_account_id) is None:
        raise ImportAccountError(f"account {clean_account_id} was not found")

    imported = 0
    skipped = 0
    for row in rows:
        prepared = _normalise_candidate(row)
        if dedupe and _row_exists(conn, clean_account_id, prepared):
            skipped += 1
            continue
        try:
            transactions.add(
                conn,
                clean_account_id,
                prepared["date"],
                prepared["description"],
                prepared["amount_cents"],
                category_id=prepared.get("category_id"),
                is_transfer=bool(prepared.get("is_transfer", False)),
                external_id=prepared.get("external_id"),
            )
        except transactions.TransactionError as exc:
            raise ImporterError(str(exc)) from exc
        imported += 1
    return {"imported": imported, "skipped": skipped}


def parse_amount_to_cents(value: str) -> int:
    """Parse a bank-style amount string into integer cents.

    Handles thousands separators in US and European styles, parentheses for
    negatives, and trailing CR/DR markers. Floats are deliberately not accepted
    at the boundary.
    """
    if not isinstance(value, str):
        raise ImporterError("amount must be a string")
    text = value.strip()
    if not text:
        raise ImporterError("amount is required")

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1].strip()

    marker_match = _MARKER_RE.search(text)
    marker = marker_match.group(1).upper() if marker_match is not None else None
    if marker_match is not None:
        text = text[: marker_match.start()].strip()

    if text.endswith("-"):
        negative = True
        text = text[:-1].strip()
    elif text.endswith("+"):
        text = text[:-1].strip()

    if text.startswith("-"):
        negative = True
        text = text[1:].strip()
    elif text.startswith("+"):
        text = text[1:].strip()

    if marker == "DR":
        negative = True

    numeric_text = _normalise_numeric_text(text)
    try:
        amount = Decimal(numeric_text)
    except (InvalidOperation, ValueError) as exc:
        raise ImporterError("amount must be a valid decimal amount") from exc
    if not amount.is_finite():
        raise ImporterError("amount must be a finite decimal amount")
    cents = amount * Decimal(100)
    if cents != cents.to_integral_value():
        raise ImporterError("amount cannot have more than two decimal places")
    cents_int = int(cents)
    if negative:
        cents_int = -abs(cents_int)
    else:
        cents_int = abs(cents_int)
    return _validate_cents_range(cents_int)


def _read_path_or_text(path_or_text: str | os.PathLike[str]) -> str:
    if isinstance(path_or_text, os.PathLike):
        return Path(path_or_text).read_text(encoding="utf-8-sig")
    if not isinstance(path_or_text, str):
        raise ImporterError("CSV input must be a path or text")
    if "\n" in path_or_text or "\r" in path_or_text:
        return path_or_text
    try:
        candidate = Path(path_or_text)
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8-sig")
    except OSError:
        pass
    return path_or_text


def _detect_delimiter(text: str) -> str:
    sample = text[:8192]
    if sample.strip():
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=DELIMITERS)
            return str(dialect.delimiter)
        except csv.Error:
            pass
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    counts = {delimiter: first_line.count(delimiter) for delimiter in DELIMITERS}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","


def _read_headers(text: str, delimiter: str) -> list[str]:
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    for row in reader:
        if any(cell.strip() for cell in row):
            return [cell.strip().lstrip("\ufeff") for cell in row]
    return []


def _suggest_mapping(headers: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    date = _find_header(headers, _DATE_HEADERS, ("date",))
    description = _find_header(
        headers,
        _DESCRIPTION_HEADERS,
        ("description", "merchant", "payee", "memo", "detail", "narrative"),
    )
    debit = _find_header(headers, _DEBIT_HEADERS, ("debit", "withdraw", "paidout", "moneyout"))
    credit = _find_header(headers, _CREDIT_HEADERS, ("credit", "deposit", "paidin", "moneyin"))
    amount_headers = [header for header in headers if header not in {debit, credit}]
    amount = _find_header(amount_headers, _AMOUNT_HEADERS, ("amount",))
    external_id = _find_header(headers, _EXTERNAL_ID_HEADERS, ("reference", "transactionid", "fitid"))

    if date is not None:
        mapping["date"] = date
    if description is not None:
        mapping["description"] = description
    if amount is not None:
        mapping["amount"] = amount
    else:
        if debit is not None:
            mapping["debit"] = debit
        if credit is not None:
            mapping["credit"] = credit
    if external_id is not None:
        mapping["external_id"] = external_id
    return mapping


def _find_header(headers: list[str], exact_names: set[str], contains: tuple[str, ...]) -> str | None:
    normalised = [(header, _normalise_header(header)) for header in headers]
    for header, clean in normalised:
        if clean in exact_names:
            return header
    for header, clean in normalised:
        if any(fragment in clean for fragment in contains):
            return header
    return None


def _normalise_header(header: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", header.strip().lower().replace(" ", ""))


def _prepare_mapping(mapping: ColumnMapping) -> dict[str, Any]:
    if not isinstance(mapping, Mapping):
        raise MappingError("mapping must be an object")
    source: Mapping[str, Any] = mapping
    delimiter = mapping.get("delimiter")
    if "mapping" in mapping:
        nested = mapping["mapping"]
        if not isinstance(nested, Mapping):
            raise MappingError("mapping must be an object")
        source = nested
    prepared = {str(key).lower(): value for key, value in source.items()}
    if isinstance(delimiter, str) and delimiter:
        prepared["delimiter"] = delimiter
    return prepared


def _resolve_columns(mapping: dict[str, Any], headers: list[str]) -> dict[str, str]:
    date = _resolve_column(mapping, headers, ("date",))
    description = _resolve_column(mapping, headers, ("description", "memo", "payee"))
    amount = _resolve_column(mapping, headers, ("amount",))
    debit = _resolve_column(mapping, headers, ("debit",))
    credit = _resolve_column(mapping, headers, ("credit",))
    external_id = _resolve_column(mapping, headers, ("external_id", "external", "id", "reference"), required=False)

    if date is None:
        raise MappingError("mapping must include a date column")
    if description is None:
        raise MappingError("mapping must include a description column")
    if amount is None and (debit is None or credit is None):
        raise MappingError("mapping must include amount or both debit and credit columns")

    columns = {"date": date, "description": description}
    if amount is not None:
        columns["amount"] = amount
    else:
        columns["debit"] = debit if debit is not None else ""
        columns["credit"] = credit if credit is not None else ""
    if external_id is not None:
        columns["external_id"] = external_id
    return columns


def _resolve_column(
    mapping: dict[str, Any],
    headers: list[str],
    aliases: tuple[str, ...],
    *,
    required: bool = True,
) -> str | None:
    value = next((mapping[alias] for alias in aliases if alias in mapping), None)
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise MappingError("column indexes must be integers")
    if isinstance(value, int):
        if value < 0 or value >= len(headers):
            raise MappingError(f"column index {value} is out of range")
        return headers[value]
    if not isinstance(value, str):
        raise MappingError("column names must be strings")

    header_by_normalised = {_normalise_header(header): header for header in headers}
    if value in headers:
        return value
    clean = _normalise_header(value)
    if clean in header_by_normalised:
        return header_by_normalised[clean]
    if required:
        raise MappingError(f'column "{value}" was not found in the CSV header')
    return None


def _is_blank_row(row: dict[str, Any]) -> bool:
    return all(str(value).strip() == "" for value in row.values() if value is not None)


def _parse_row(row: dict[str, Any], columns: dict[str, str]) -> CandidateRow:
    date = _normalise_date(_cell(row, columns["date"]), "date")
    description = _cell(row, columns["description"]).strip()
    if not description:
        raise ImporterError("description is required")
    amount_cents = _amount_from_row(row, columns)
    if amount_cents == 0:
        raise ImporterError("amount must be non-zero")
    external_id = None
    if "external_id" in columns:
        raw_external_id = _cell(row, columns["external_id"]).strip()
        external_id = raw_external_id if raw_external_id else None
    return {
        "date": date,
        "description": description,
        "amount_cents": amount_cents,
        "external_id": external_id,
    }


def _cell(row: dict[str, Any], column: str) -> str:
    value = row.get(column)
    return "" if value is None else str(value)


def _normalise_date(value: str, field: str) -> str:
    text = value.strip()
    if not text:
        raise ImporterError(f"{field} is required")
    try:
        return transactions.validate_date(text)
    except transactions.InvalidDateError:
        pass
    for date_format in _DATE_FORMATS:
        try:
            return datetime.strptime(text, date_format).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ImporterError("date must be in YYYY-MM-DD format")


def _amount_from_row(row: dict[str, Any], columns: dict[str, str]) -> int:
    if "amount" in columns:
        return parse_amount_to_cents(_cell(row, columns["amount"]))

    debit_text = _cell(row, columns["debit"]).strip()
    credit_text = _cell(row, columns["credit"]).strip()
    if not debit_text and not credit_text:
        raise ImporterError("amount is required")

    amount = 0
    if debit_text:
        amount -= abs(parse_amount_to_cents(debit_text))
    if credit_text:
        amount += abs(parse_amount_to_cents(credit_text))
    return _validate_cents_range(amount)


def _normalise_numeric_text(text: str) -> str:
    cleaned = (
        text.replace("\u00a0", "")
        .replace(" ", "")
        .replace("'", "")
        .replace("_", "")
    )
    cleaned = re.sub(r"[^0-9,.]", "", cleaned)
    if not cleaned or not any(character.isdigit() for character in cleaned):
        raise ImporterError("amount is required")

    comma = cleaned.rfind(",")
    dot = cleaned.rfind(".")
    if comma >= 0 and dot >= 0:
        decimal_separator = "," if comma > dot else "."
        thousands_separator = "." if decimal_separator == "," else ","
        return cleaned.replace(thousands_separator, "").replace(decimal_separator, ".")
    if comma >= 0:
        return _normalise_single_separator(cleaned, ",")
    if dot >= 0:
        return _normalise_single_separator(cleaned, ".")
    return cleaned


def _normalise_single_separator(text: str, separator: str) -> str:
    last = text.rfind(separator)
    decimal_digits = len(text) - last - 1
    if decimal_digits in {1, 2}:
        whole = text[:last].replace(separator, "")
        fraction = text[last + 1 :]
        return f"{whole or '0'}.{fraction}"
    return text.replace(separator, "")


def _validate_cents_range(cents: int) -> int:
    if cents < SQLITE_INTEGER_MIN or cents > SQLITE_INTEGER_MAX:
        raise ImporterError("amount is outside the supported range")
    return cents


def _validate_account_id(account_id: int) -> int:
    if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id <= 0:
        raise ImportAccountError("account was not found")
    return account_id


def _normalise_candidate(row: CandidateRow) -> CandidateRow:
    if not isinstance(row, Mapping):
        raise ImporterError("import row must be an object")
    try:
        date = _normalise_date(str(row["date"]), "date")
        description = str(row["description"]).strip()
    except KeyError as exc:
        raise ImporterError(f"missing required field: {exc.args[0]}") from exc
    if not description:
        raise ImporterError("description is required")

    amount_cents = _candidate_amount_cents(row)
    if amount_cents == 0:
        raise ImporterError("amount must be non-zero")

    external_id = row.get("external_id")
    if external_id is not None:
        external_text = str(external_id).strip()
        external_id = external_text if external_text else None
    return {
        "date": date,
        "description": description,
        "amount_cents": amount_cents,
        "external_id": external_id,
        "category_id": row.get("category_id"),
        "is_transfer": row.get("is_transfer", False),
    }


def _candidate_amount_cents(row: CandidateRow) -> int:
    if "amount_cents" in row:
        value = row["amount_cents"]
        if isinstance(value, bool):
            raise ImporterError("amount_cents must be an integer")
        try:
            cents = int(value)
        except (TypeError, ValueError) as exc:
            raise ImporterError("amount_cents must be an integer") from exc
        return _validate_cents_range(cents)
    if "amount" in row:
        return parse_amount_to_cents(str(row["amount"]))
    raise ImporterError("missing required field: amount_cents")


def _row_exists(conn: sqlite3.Connection, account_id: int, row: CandidateRow) -> bool:
    external_id = row.get("external_id")
    if isinstance(external_id, str) and external_id:
        found = conn.execute(
            """SELECT 1 FROM transactions
               WHERE account_id = ? AND external_id = ? LIMIT 1""",
            (account_id, external_id),
        ).fetchone()
        return found is not None
    found = conn.execute(
        """SELECT 1 FROM transactions
           WHERE account_id = ? AND date = ? AND description = ? AND amount_cents = ?
           LIMIT 1""",
        (account_id, row["date"], row["description"], row["amount_cents"]),
    ).fetchone()
    return found is not None
