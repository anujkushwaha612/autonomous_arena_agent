"""Ledgerly HTTP server entry point."""
from __future__ import annotations

import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, NoReturn
from urllib.parse import parse_qs

from ledgerly import accounts, budgets, categories, importer, reports, transactions
from ledgerly.api import (
    APIError,
    APIResponse,
    MAX_BODY_BYTES,
    PayloadTooLargeError,
    Router,
    error,
)
from ledgerly.db import init_db

conn: sqlite3.Connection | None = None
router = Router()

# Allowed filter / pagination parameters for list endpoints.
_TRANSACTION_LIST_QUERY = {"start", "end", "limit", "offset"}

# Maximum list page size enforced at the boundary; matches the service layer.
_MAX_LIST_LIMIT = transactions.MAX_LIST_LIMIT


def _connection() -> sqlite3.Connection:
    if conn is None:
        raise APIError(503, "database_unavailable", "Database is not ready")
    return conn


def _body_object(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise APIError(400, "invalid_request", "JSON body must be an object")
    return body


def _parse_path(path: str) -> tuple[str, dict[str, list[str]]]:
    """Split the request path into ``(route, query_params)``."""
    route, _, query = path.partition("?")
    return route, parse_qs(query, keep_blank_values=False)


def _account_id(params: dict[str, str]) -> int:
    try:
        account_id = int(params["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise APIError(404, "account_not_found", "Account was not found") from exc
    if account_id <= 0:
        raise APIError(404, "account_not_found", "Account was not found")
    return account_id


def _transaction_id(params: dict[str, str]) -> int:
    try:
        transaction_id = int(params["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise APIError(404, "transaction_not_found", "Transaction was not found") from exc
    if transaction_id <= 0:
        raise APIError(404, "transaction_not_found", "Transaction was not found")
    return transaction_id


def _raise_account_error(exc: accounts.AccountError) -> NoReturn:
    if isinstance(exc, accounts.AccountNotFoundError):
        raise APIError(404, "account_not_found", str(exc)) from exc
    if isinstance(exc, accounts.DuplicateAccountError):
        raise APIError(409, "duplicate_account", str(exc)) from exc
    if isinstance(exc, accounts.InvalidAccountKindError):
        raise APIError(400, "invalid_kind", str(exc)) from exc
    raise APIError(400, "invalid_account", str(exc)) from exc


def _raise_transaction_error(exc: transactions.TransactionError) -> NoReturn:
    if isinstance(exc, transactions.TransactionNotFoundError):
        raise APIError(404, "transaction_not_found", str(exc)) from exc
    if isinstance(exc, transactions.AccountMissingError):
        raise APIError(404, "account_not_found", str(exc)) from exc
    if isinstance(exc, transactions.InvalidDateError):
        raise APIError(400, "invalid_date", str(exc)) from exc
    if isinstance(exc, transactions.InvalidAmountError):
        raise APIError(400, "invalid_amount", str(exc)) from exc
    raise APIError(400, "invalid_transaction", str(exc)) from exc


def _raise_importer_error(exc: importer.ImporterError) -> NoReturn:
    if isinstance(exc, importer.ImportAccountError):
        raise APIError(404, "account_not_found", str(exc)) from exc
    if isinstance(exc, importer.MappingError):
        raise APIError(400, "invalid_import_mapping", str(exc)) from exc
    raise APIError(400, "invalid_import", str(exc)) from exc


def _raise_category_error(exc: categories.CategoryError) -> NoReturn:
    if isinstance(exc, categories.CategoryNotFoundError):
        raise APIError(404, "category_not_found", str(exc)) from exc
    if isinstance(exc, categories.DuplicateCategoryError):
        raise APIError(409, "duplicate_category", str(exc)) from exc
    raise APIError(400, "invalid_category", str(exc)) from exc


def _raise_rule_error(exc: categories.RuleError | categories.CategoryError) -> NoReturn:
    if isinstance(exc, categories.CategoryError):
        _raise_category_error(exc)
    if isinstance(exc, categories.RuleNotFoundError):
        raise APIError(404, "rule_not_found", str(exc)) from exc
    raise APIError(400, "invalid_rule", str(exc)) from exc


def _health(_params: dict[str, str], _body: Any) -> dict[str, str]:
    return {"status": "ok", "version": "1", "db": "ready"}


def _list_accounts(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    return [account.to_dict() for account in accounts.list_all(_connection())]


def _create_account(_params: dict[str, str], body: Any) -> APIResponse:
    payload = _body_object(body)
    allowed = {"name", "kind", "currency", "opening_balance", "opening_balance_cents"}
    _reject_unknown_fields(payload, allowed)
    if "opening_balance" in payload and "opening_balance_cents" in payload:
        raise APIError(
            400,
            "invalid_request",
            "provide only one of opening_balance or opening_balance_cents",
        )
    opening_balance = payload.get("opening_balance", payload.get("opening_balance_cents", 0))
    try:
        account = accounts.create(
            _connection(),
            name=payload.get("name"),
            kind=payload.get("kind"),
            currency=payload.get("currency", "USD"),
            opening_balance_cents=opening_balance,
        )
    except accounts.AccountError as exc:
        _raise_account_error(exc)
    return APIResponse(201, account.to_dict())


def _get_account(params: dict[str, str], _body: Any) -> dict[str, Any]:
    account = accounts.get(_connection(), _account_id(params))
    if account is None:
        raise APIError(404, "account_not_found", "Account was not found")
    return account.to_dict()


def _update_account(params: dict[str, str], body: Any) -> dict[str, Any]:
    payload = _body_object(body)
    allowed = {"name", "kind", "currency", "opening_balance", "opening_balance_cents"}
    _reject_unknown_fields(payload, allowed)
    if "opening_balance" in payload and "opening_balance_cents" in payload:
        raise APIError(
            400,
            "invalid_request",
            "provide only one of opening_balance or opening_balance_cents",
        )
    for field in payload:
        if payload[field] is None:
            raise APIError(400, "invalid_request", f"{field} cannot be null")

    opening_balance: Any = None
    if "opening_balance" in payload:
        opening_balance = payload["opening_balance"]
    elif "opening_balance_cents" in payload:
        opening_balance = payload["opening_balance_cents"]
    try:
        account = accounts.update(
            _connection(),
            _account_id(params),
            name=payload.get("name"),
            kind=payload.get("kind"),
            currency=payload.get("currency"),
            opening_balance_cents=opening_balance,
        )
    except accounts.AccountError as exc:
        _raise_account_error(exc)
    return account.to_dict()


def _archive_account(params: dict[str, str], _body: Any) -> dict[str, Any]:
    try:
        account = accounts.archive(_connection(), _account_id(params))
    except accounts.AccountError as exc:
        _raise_account_error(exc)
    return account.to_dict()


def _list_transactions(params: dict[str, str], _body: Any) -> dict[str, Any]:
    """GET /api/v1/accounts/:id/transactions with optional start/end/limit/offset."""
    full_path = _current_path[0] if _current_path else "/"
    _, query = _parse_path(full_path)
    account_id = _account_id(params)
    filters = _parse_transaction_list_query(query)
    try:
        rows, total = transactions.list_for_account(
            _connection(),
            account_id,
            start=filters.get("start"),
            end=filters.get("end"),
            limit=filters["limit"],
            offset=filters["offset"],
        )
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)
    return {
        "data": [transaction.to_dict() for transaction in rows],
        "total": total,
        "limit": filters["limit"],
        "offset": filters["offset"],
    }


def _create_transaction(params: dict[str, str], body: Any) -> APIResponse:
    """POST /api/v1/accounts/:id/transactions."""
    payload = _body_object(body)
    allowed = {
        "date",
        "description",
        "amount",
        "amount_cents",
        "category_id",
        "is_transfer",
        "external_id",
    }
    _reject_unknown_fields(payload, allowed)
    if "amount" in payload and "amount_cents" in payload:
        raise APIError(
            400,
            "invalid_request",
            "provide only one of amount or amount_cents",
        )
    for field in ("date", "description"):
        if field not in payload or payload[field] in (None, ""):
            raise APIError(400, "invalid_request", f"{field} is required")
    if "amount" not in payload and "amount_cents" not in payload:
        raise APIError(400, "invalid_request", "amount is required")

    amount: Any = payload.get("amount", payload.get("amount_cents"))
    category_id = payload.get("category_id")
    is_transfer = payload.get("is_transfer", False)

    try:
        transaction = transactions.add(
            _connection(),
            _account_id(params),
            date=payload["date"],
            description=payload["description"],
            amount=amount,
            category_id=category_id,
            is_transfer=bool(is_transfer) if is_transfer is not None else False,
            external_id=payload.get("external_id"),
        )
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)
    return APIResponse(201, transaction.to_dict())


def _get_transaction(params: dict[str, str], _body: Any) -> dict[str, Any]:
    transaction = transactions.get(_connection(), _transaction_id(params))
    if transaction is None:
        raise APIError(404, "transaction_not_found", "Transaction was not found")
    return transaction.to_dict()


def _update_transaction(params: dict[str, str], body: Any) -> dict[str, Any]:
    payload = _body_object(body)
    allowed = {
        "date",
        "description",
        "amount",
        "amount_cents",
        "category_id",
        "is_transfer",
        "external_id",
    }
    _reject_unknown_fields(payload, allowed)
    if "amount" in payload and "amount_cents" in payload:
        raise APIError(
            400,
            "invalid_request",
            "provide only one of amount or amount_cents",
        )
    if not payload:
        raise APIError(400, "invalid_request", "request body is empty")
    for field, value in payload.items():
        if value is None:
            raise APIError(400, "invalid_request", f"{field} cannot be null")

    amount: Any = None
    if "amount" in payload:
        amount = payload["amount"]
    elif "amount_cents" in payload:
        amount = payload["amount_cents"]

    is_transfer = payload.get("is_transfer")

    try:
        transaction = transactions.update(
            _connection(),
            _transaction_id(params),
            date=payload.get("date"),
            description=payload.get("description"),
            amount=amount,
            category_id=payload.get("category_id"),
            is_transfer=bool(is_transfer) if is_transfer is not None else None,
            external_id=payload.get("external_id"),
        )
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)
    return transaction.to_dict()


def _delete_transaction(params: dict[str, str], _body: Any) -> APIResponse:
    try:
        transactions.delete(_connection(), _transaction_id(params))
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)
    return APIResponse(204, {})


def _account_balance(params: dict[str, str], _body: Any) -> dict[str, Any]:
    try:
        cents = transactions.balance(_connection(), _account_id(params))
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)
    return {"account_id": _account_id(params), "balance_cents": cents}


def _import_transactions(params: dict[str, str], body: Any) -> dict[str, Any]:
    if not isinstance(body, str):
        raise APIError(400, "invalid_request", "CSV body must be text")
    account_id = _account_id(params)
    try:
        detected = importer.sniff(body)
        rows, errors = importer.parse(body, detected["mapping"])
        summary = importer.import_rows(_connection(), account_id, rows)
    except importer.ImporterError as exc:
        _raise_importer_error(exc)
    return {
        "account_id": account_id,
        "parsed": len(rows),
        "imported": summary["imported"],
        "skipped": summary["skipped"],
        "errors": errors,
    }


def _list_categories(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    return [category.to_dict() for category in categories.list_all(_connection())]


def _create_category(_params: dict[str, str], body: Any) -> APIResponse:
    payload = _body_object(body)
    _reject_unknown_fields(payload, {"name", "kind", "parent_id"})
    for field in ("name", "kind"):
        if field not in payload:
            raise APIError(400, "invalid_request", f"{field} is required")
    try:
        category = categories.create(
            _connection(),
            name=payload["name"],
            kind=payload["kind"],
            parent_id=payload.get("parent_id"),
        )
    except categories.CategoryError as exc:
        _raise_category_error(exc)
    return APIResponse(201, category.to_dict())


def _list_rules(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    return [rule.to_dict() for rule in categories.list_rules(_connection())]


def _create_rule(_params: dict[str, str], body: Any) -> APIResponse:
    payload = _body_object(body)
    _reject_unknown_fields(payload, {"pattern", "category_id", "priority", "is_regex"})
    for field in ("pattern", "category_id", "priority"):
        if field not in payload:
            raise APIError(400, "invalid_request", f"{field} is required")
    try:
        rule = categories.add_rule(
            _connection(),
            payload["pattern"],
            payload["category_id"],
            payload["priority"],
            payload.get("is_regex", False),
        )
    except (categories.RuleError, categories.CategoryError) as exc:
        _raise_rule_error(exc)
    return APIResponse(201, rule.to_dict())


def _apply_rules(_params: dict[str, str], body: Any) -> dict[str, int]:
    payload = _body_object(body) if body is not None else {}
    _reject_unknown_fields(payload, {"only_uncategorised"})
    only_uncategorised = payload.get("only_uncategorised", True)
    try:
        recategorised = categories.apply_rules(
            _connection(), only_uncategorised=only_uncategorised
        )
    except categories.RuleError as exc:
        _raise_rule_error(exc)
    return {"recategorised": recategorised}


def _raise_budget_error(exc: budgets.BudgetError | categories.CategoryError) -> NoReturn:
    if isinstance(exc, categories.CategoryError):
        _raise_category_error(exc)
    if isinstance(exc, budgets.BudgetNotFoundError):
        raise APIError(404, "budget_not_found", str(exc)) from exc
    if isinstance(exc, budgets.InvalidPeriodError):
        raise APIError(400, "invalid_period", str(exc)) from exc
    if isinstance(exc, budgets.InvalidLimitError):
        raise APIError(400, "invalid_limit", str(exc)) from exc
    raise APIError(400, "invalid_budget", str(exc)) from exc


def _budget_period_query(*, required: bool) -> str | None:
    """Read and validate an optional/required ``period`` query parameter."""
    full_path = _current_path[0] if _current_path else "/"
    _, query = _parse_path(full_path)
    unknown = sorted(set(query) - {"period"})
    if unknown:
        raise APIError(
            400,
            "invalid_request",
            f"unknown query parameter(s): {', '.join(unknown)}",
        )
    if "period" not in query:
        if required:
            raise APIError(400, "invalid_request", "period is required")
        return None
    try:
        return budgets.validate_period(_query_single(query, "period"))
    except budgets.BudgetError as exc:
        _raise_budget_error(exc)


def _list_budgets(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    """GET /api/v1/budgets with an optional ?period= filter."""
    period = _budget_period_query(required=False)
    try:
        rows = budgets.list_budgets(_connection(), period=period)
    except budgets.BudgetError as exc:
        _raise_budget_error(exc)
    return [budget.to_dict() for budget in rows]


def _put_budget(_params: dict[str, str], body: Any) -> dict[str, Any]:
    """PUT /api/v1/budgets — upsert one budget."""
    payload = _body_object(body)
    _reject_unknown_fields(payload, {"category_id", "period", "limit", "limit_cents"})
    if "limit" in payload and "limit_cents" in payload:
        raise APIError(400, "invalid_request", "provide only one of limit or limit_cents")
    for field in ("category_id", "period"):
        if field not in payload or payload[field] in (None, ""):
            raise APIError(400, "invalid_request", f"{field} is required")
    if "limit" not in payload and "limit_cents" not in payload:
        raise APIError(400, "invalid_request", "limit is required")

    limit_value: Any = payload.get("limit", payload.get("limit_cents"))
    try:
        budget = budgets.set_budget(
            _connection(),
            payload["category_id"],
            payload["period"],
            limit_value,
        )
    except (budgets.BudgetError, categories.CategoryError) as exc:
        _raise_budget_error(exc)
    return budget.to_dict()


def _budget_status(_params: dict[str, str], _body: Any) -> dict[str, Any]:
    """GET /api/v1/budgets/status?period=YYYY-MM (defaults to this month)."""
    period = _budget_period_query(required=False) or budgets.current_month()
    try:
        return budgets.get_status(_connection(), period)
    except (budgets.BudgetError, categories.CategoryError) as exc:
        _raise_budget_error(exc)


def _report_spending(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    full_path = _current_path[0] if _current_path else "/"
    _, query = _parse_path(full_path)
    start = _query_single(query, "start") if "start" in query else "1900-01-01"
    end = _query_single(query, "end") if "end" in query else "2099-12-31"
    top = _parse_int_param(query, "top", minimum=1) if "top" in query else None
    try:
        return reports.spending_by_category(_connection(), start, end, top=top)
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)


def _report_monthly(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    full_path = _current_path[0] if _current_path else "/"
    _, query = _parse_path(full_path)
    months = _parse_int_param(query, "months", minimum=1) if "months" in query else 12
    return reports.monthly_totals(_connection(), months)


def _report_cashflow(_params: dict[str, str], _body: Any) -> dict[str, Any]:
    full_path = _current_path[0] if _current_path else "/"
    _, query = _parse_path(full_path)
    start = _query_single(query, "start") if "start" in query else "1900-01-01"
    end = _query_single(query, "end") if "end" in query else "2099-12-31"
    try:
        return reports.cashflow(_connection(), start, end)
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)


def _report_search(_params: dict[str, str], _body: Any) -> list[dict[str, Any]]:
    full_path = _current_path[0] if _current_path else "/"
    _, query = _parse_path(full_path)
    q = _query_single(query, "q")
    start = _query_single(query, "start") if "start" in query else None
    end = _query_single(query, "end") if "end" in query else None
    # Use direct integer parsing for cents as they can be negative
    min_cents: int | None = None
    if "min_cents" in query:
        try:
            min_cents = int(_query_single(query, "min_cents"))
        except ValueError:
            raise APIError(400, "invalid_request", "min_cents must be an integer")
    max_cents: int | None = None
    if "max_cents" in query:
        try:
            max_cents = int(_query_single(query, "max_cents"))
        except ValueError:
            raise APIError(400, "invalid_request", "max_cents must be an integer")
    try:
        return reports.search(
            _connection(), q, start=start, end=end, min_cents=min_cents, max_cents=max_cents
        )
    except transactions.TransactionError as exc:
        _raise_transaction_error(exc)


def _reject_unknown_fields(payload: dict[str, Any], allowed: set[str]) -> None:
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise APIError(400, "invalid_request", f"unknown field(s): {', '.join(unknown)}")


def _parse_transaction_list_query(query: dict[str, list[str]]) -> dict[str, Any]:
    unknown = sorted(set(query) - _TRANSACTION_LIST_QUERY)
    if unknown:
        raise APIError(
            400,
            "invalid_request",
            f"unknown query parameter(s): {', '.join(unknown)}",
        )
    result: dict[str, Any] = {"limit": transactions.DEFAULT_LIST_LIMIT, "offset": 0}
    if "start" in query:
        result["start"] = _query_single(query, "start")
    if "end" in query:
        result["end"] = _query_single(query, "end")
    if "limit" in query:
        result["limit"] = _parse_int_param(query, "limit", minimum=1, maximum=_MAX_LIST_LIMIT)
    if "offset" in query:
        result["offset"] = _parse_int_param(query, "offset", minimum=0)
    return result


def _query_single(query: dict[str, list[str]], name: str) -> str:
    values = query.get(name) or []
    if not values:
        raise APIError(400, "invalid_request", f"{name} cannot be empty")
    return values[0]


def _parse_int_param(
    query: dict[str, list[str]], name: str, *, minimum: int, maximum: int | None = None
) -> int:
    text = _query_single(query, name)
    try:
        value = int(text)
    except ValueError as exc:
        raise APIError(400, "invalid_request", f"{name} must be an integer") from exc
    if value < minimum:
        raise APIError(400, "invalid_request", f"{name} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise APIError(400, "invalid_request", f"{name} must be <= {maximum}")
    return value


def _is_import_route(route: str) -> bool:
    parts = route.strip("/").split("/")
    return len(parts) == 5 and parts[:3] == ["api", "v1", "accounts"] and parts[4] == "import"


# Holds the current request's full path so query string parsing is available
# inside route handlers that take only ``(params, body)``. Set by Handler.
_current_path: list[str] = []


router.add_route("GET", "/api/v1/health", _health)
router.add_route("GET", "/api/v1/accounts", _list_accounts)
router.add_route("POST", "/api/v1/accounts", _create_account)
router.add_route("GET", "/api/v1/accounts/:id", _get_account)
router.add_route("PATCH", "/api/v1/accounts/:id", _update_account)
router.add_route("POST", "/api/v1/accounts/:id/archive", _archive_account)
router.add_route("GET", "/api/v1/accounts/:id/transactions", _list_transactions)
router.add_route("POST", "/api/v1/accounts/:id/transactions", _create_transaction)
router.add_route("GET", "/api/v1/accounts/:id/balance", _account_balance)
router.add_route("POST", "/api/v1/accounts/:id/import", _import_transactions)
router.add_route("GET", "/api/v1/budgets", _list_budgets)
router.add_route("PUT", "/api/v1/budgets", _put_budget)
router.add_route("GET", "/api/v1/budgets/status", _budget_status)
router.add_route("GET", "/api/v1/categories", _list_categories)
router.add_route("POST", "/api/v1/categories", _create_category)
router.add_route("GET", "/api/v1/rules", _list_rules)
router.add_route("POST", "/api/v1/rules", _create_rule)
router.add_route("POST", "/api/v1/rules/apply", _apply_rules)
router.add_route("GET", "/api/v1/reports/spending", _report_spending)
router.add_route("GET", "/api/v1/reports/monthly", _report_monthly)
router.add_route("GET", "/api/v1/reports/cashflow", _report_cashflow)
router.add_route("GET", "/api/v1/reports/search", _report_search)
router.add_route("GET", "/api/v1/transactions/:id", _get_transaction)
router.add_route("PATCH", "/api/v1/transactions/:id", _update_transaction)
router.add_route("DELETE", "/api/v1/transactions/:id", _delete_transaction)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self._respond()

    def do_POST(self) -> None:
        self._respond()

    def do_PATCH(self) -> None:
        self._respond()

    def do_PUT(self) -> None:
        self._respond()

    def do_DELETE(self) -> None:
        self._respond()

    def _respond(self) -> None:
        body: Any = None
        route = self.path.split("?", 1)[0]
        if self.command in {"POST", "PATCH", "PUT", "DELETE"}:
            try:
                if self.command == "POST" and _is_import_route(route):
                    body = self._read_text_body()
                else:
                    body = self._read_json_body()
            except PayloadTooLargeError as exc:
                self._send_json(413, error("payload_too_large", str(exc)))
                return
            except ValueError as exc:
                code = "invalid_request" if _is_import_route(route) else "invalid_json"
                self._send_json(400, error(code, str(exc)))
                return
        _current_path.clear()
        _current_path.append(self.path)
        try:
            status, payload = router.dispatch(self.command, route, body)
        finally:
            _current_path.clear()
        if status == 204:
            self._send_empty(status)
            return
        self._send_json(status, payload)

    def _read_json_body(self) -> Any:
        return router.parse_json(self._read_raw_body())

    def _read_text_body(self) -> str:
        try:
            return self._read_raw_body().decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("request body must be UTF-8 text") from exc

    def _read_raw_body(self) -> bytes:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length < 0:
            raise ValueError("invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise PayloadTooLargeError("request body exceeds 1 MB")
        return self.rfile.read(length)

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return


def run() -> None:
    global conn
    conn = init_db()
    port = int(os.environ.get("PORT", 3000))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    run()
