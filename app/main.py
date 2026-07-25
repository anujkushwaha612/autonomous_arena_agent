import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from ledgerly.db import init_db
from ledgerly.api import Router

conn = None
router = Router()
router.add_route("GET", "/api/v1/health", lambda _params, _body: {"status": "ok", "version": "1", "db": "ready"})

class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self._respond()
    def _respond(self) -> None:
        status, payload = router.dispatch(self.command, self.path.split("?", 1)[0])
        data = json.dumps(payload).encode()
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
