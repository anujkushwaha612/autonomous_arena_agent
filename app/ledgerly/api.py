"""Minimal HTTP routing and JSON response helpers."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable

Handler = Callable[[dict[str, str], Any], Any]
MAX_BODY_BYTES = 1024 * 1024


class APIError(Exception):
    """An expected HTTP error with a stable public code and message."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class PayloadTooLargeError(ValueError):
    """Raised before an oversized request body is parsed."""


@dataclass(frozen=True)
class APIResponse:
    """Allow a route handler to select a non-200 success status."""

    status: int
    payload: Any


@dataclass(frozen=True)
class DownloadResponse:
    """A non-JSON success response, such as a generated file download."""

    status: int
    body: bytes
    content_type: str
    headers: dict[str, str]


class Router:
    def __init__(self) -> None:
        self.routes: list[tuple[str, re.Pattern[str], Handler]] = []

    def add_route(self, method: str, pattern: str, handler: Handler) -> None:
        parts = pattern.strip("/").split("/") if pattern.strip("/") else []
        regex = "^/" + "/".join(
            "(?P<%s>[^/]+)" % part[1:] if part.startswith(":") else re.escape(part)
            for part in parts
        ) + "/?$"
        self.routes.append((method.upper(), re.compile(regex), handler))

    def dispatch(
        self, method: str, path: str, body: Any = None
    ) -> tuple[int, dict[str, Any] | DownloadResponse]:
        for verb, regex, handler in self.routes:
            match = regex.match(path)
            if verb == method.upper() and match:
                try:
                    result = handler(match.groupdict(), body)
                    if isinstance(result, DownloadResponse):
                        return (result.status, result)
                    if isinstance(result, APIResponse):
                        payload = result.payload
                        return (
                            result.status,
                            payload if isinstance(payload, dict) else {"data": payload},
                        )
                    return (200, result if isinstance(result, dict) else {"data": result})
                except APIError as exc:
                    return (exc.status, error(exc.code, exc.message))
                except ValueError as exc:
                    return (400, error("invalid_request", str(exc)))
        return (404, error("not_found", "Route not found"))

    @staticmethod
    def parse_json(raw: bytes) -> Any:
        if len(raw) > MAX_BODY_BYTES:
            raise PayloadTooLargeError("request body exceeds 1 MB")
        try:
            return json.loads(raw.decode("utf-8")) if raw else None
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid JSON body") from exc


def add_route(router: Router, method: str, pattern: str, handler: Handler) -> None:
    router.add_route(method, pattern, handler)


def error(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}
