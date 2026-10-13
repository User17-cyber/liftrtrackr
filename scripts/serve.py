"""Static file server that disables caching, for previewing the app locally (a service worker plus normal browser caching makes edits hard to see otherwise).
Usage: python3 -I scripts/serve.py <port> <directory>
"""
import functools, http.server, sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port, directory = int(sys.argv[1]), sys.argv[2]
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=directory)).serve_forever()
