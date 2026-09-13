#!/usr/bin/env python3
"""S3-compatible-enough mock for F-021. Does not log credentials."""
from __future__ import annotations

import hashlib
import hmac
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ACCESS = "AKIATEST"
SECRET = "super-secret-oss"
BUCKET = "art"
PROBE_MSG = b"art-stock-oss-probe"
EXPECTED = hmac.new(SECRET.encode(), PROBE_MSG, hashlib.sha256).hexdigest()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("oss-mock %s\n" % (fmt % args))

    def do_GET(self) -> None:
        key_id = self.headers.get("X-ArtStock-KeyId", "")
        sig = self.headers.get("X-ArtStock-Sig", "")
        if key_id != ACCESS or sig != EXPECTED:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"forbidden")
            return
        if self.path.rstrip("/") != f"/{BUCKET}/.artstock/v1/manifest.json":
            self.send_response(404)
            self.end_headers()
            return
        body = b'{"schemaVersion":1,"libraries":[]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("ETag", '"manifest-1"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self) -> None:
        self.do_GET()


if __name__ == "__main__":
    host = "0.0.0.0"
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 19000
    ThreadingHTTPServer((host, port), Handler).serve_forever()
