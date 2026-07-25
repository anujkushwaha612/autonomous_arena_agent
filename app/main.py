"""Ledgerly HTTP server entry point."""
from __future__ import annotations

import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, NoReturn

from ledgerly import accounts
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


def _connection() -> sqlite3.Connection:
    if conn is None:
        raise APIError(503, "database_unavailable", "Database is not ready")
    return conn


def _body_object(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise APIError(400, "invalid_request", "JSON body must be an object")
    return body


def _account_id(params: dict[str, str]) -> int:
    try:
        account_id = int(params["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise APIError(404, "account_not_found", "Account was not found") from exc
    if account_id <= 0:
        raise APIError(404, "account_not_found", "Account was not found")
    return account_id


def _raise_account_error(exc: accounts.AccountError) -> NoReturn:
    if isinstance(exc, accounts.AccountNotFoundError):
        raise APIError(404, "account_not_found", str(exc)) from exc
    if isinstance(exc, accounts.DuplicateAccountError):
        raise APIError(409, "duplicate_account", str(exc)) from exc
    if isinstance(exc, accounts.InvalidAccountKindError):
        raise APIError(400, "invalid_kind", str(exc)) from exc
    raise APIError(400, "invalid_account", str(exc)) from exc


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


def _reject_unknown_fields(payload: dict[str, Any], allowed: set[str]) -> None:
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise APIError(400, "invalid_request", f"unknown field(s): {', '.join(unknown)}")


router.add_route("GET", "/api/v1/health", _health)
router.add_route("GET", "/api/v1/accounts", _list_accounts)
router.add_route("POST", "/api/v1/accounts", _create_account)
router.add_route("GET", "/api/v1/accounts/:id", _get_account)
router.add_route("PATCH", "/api/v1/accounts/:id", _update_account)
router.add_route("POST", "/api/v1/accounts/:id/archive", _archive_account)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self._respond()

    def do_POST(self) -> None:
        self._respond()

    def do_PATCH(self) -> None:
        self._respond()

    def _respond(self) -> None:
        body: Any = None
        if self.command in {"POST", "PATCH", "PUT"}:
            try:
                body = self._read_json_body()
            except PayloadTooLargeError as exc:
                self._send_json(413, error("payload_too_large", str(exc)))
                return
            except ValueError as exc:
                self._send_json(400, error("invalid_json", str(exc)))
                return
        status, payload = router.dispatch(
            self.command,
            self.path.split("?", 1)[0],
            body,
        )
        self._send_json(status, payload)

    def _read_json_body(self) -> Any:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("invalid Content-Length") from exc
        if length < 0:
            raise ValueError("invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise PayloadTooLargeError("request body exceeds 1 MB")
        return router.parse_json(self.rfile.read(length))

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        return


def run() -> None:
    global conn
    conn = init_db()
    port = int(os.environ.get("PORT", 3000))
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    run()
