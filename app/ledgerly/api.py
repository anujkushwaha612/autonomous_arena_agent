import json
import re
from http import HTTPStatus
from typing import Any, Callable, Optional

Handler = Callable[[dict[str, str], Any], Any]

class Router:
    def __init__(self) -> None:
        self.routes: list[tuple[str, re.Pattern[str], Handler]] = []
    def add_route(self, method: str, pattern: str, handler: Handler) -> None:
        parts = pattern.strip("/").split("/") if pattern.strip("/") else []
        regex = "^/" + "/".join("(?P<%s>[^/]+)" % p[1:] if p.startswith(":") else re.escape(p) for p in parts) + "/?$"
        self.routes.append((method.upper(), re.compile(regex), handler))
    def dispatch(self, method: str, path: str, body: Any = None) -> tuple[int, dict[str, Any]]:
        for verb, regex, handler in self.routes:
            match = regex.match(path)
            if verb == method.upper() and match:
                try:
                    result = handler(match.groupdict(), body)
                    return (200, result if isinstance(result, dict) else {"data": result})
                except ValueError as exc:
                    return (400, {"error": {"code": "invalid_request", "message": str(exc)}})
        return (404, {"error": {"code": "not_found", "message": "Route not found"}})
    @staticmethod
    def parse_json(raw: bytes) -> Any:
        if len(raw) > 1024 * 1024:
            raise ValueError("request body exceeds 1 MB")
        try:
            return json.loads(raw.decode("utf-8")) if raw else None
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid JSON body") from exc

def add_route(router: Router, method: str, pattern: str, handler: Handler) -> None:
    router.add_route(method, pattern, handler)

def error(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}
