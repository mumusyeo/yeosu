"""Local preview with an exclusive socket, automatic free port and absolute paths."""
import argparse
import json
import os
import socket
import sys
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO_CONFIG = b"window.TRIP_CONFIG={supabaseUrl:'',supabaseKey:'',tripId:'a0000000-0000-4000-8000-000000000001'};"


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/config.js' and not self.server.live:
            return self.send_bytes(DEMO_CONFIG, 'text/javascript; charset=utf-8')
        if path == '/__preview_health':
            return self.send_bytes(json.dumps({'ok': True, 'mode': 'live' if self.server.live else 'demo'}).encode(), 'application/json')
        super().do_GET()

    def send_bytes(self, data, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        # A detached console can close stderr. Logging must not interrupt HTTP responses.
        try:
            print(f'{self.address_string()} {fmt % args}', file=sys.stderr, flush=True)
        except (OSError, ValueError):
            pass


class PreviewServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.port <= 65515:
        parser.error('port must be between 1 and 65515')
    if not (ROOT / 'docs' / 'index.html').is_file():
        parser.error(f'Invitation files missing: {ROOT / "docs"}')
    server = None
    for port in range(args.port, args.port + 21):
        try:
            server = PreviewServer(('127.0.0.1', port), partial(PreviewHandler, directory=str(ROOT / 'docs')))
            break
        except OSError as error:
            if error.errno not in (48, 98, 10048, 10013):
                raise
    if server is None:
        parser.error('No available local port. Close an old server or choose another --port.')
    server.live = args.live
    url = f'http://127.0.0.1:{server.server_port}/'
    if server.server_port != args.port:
        print(f'Port {args.port} is occupied. Using {server.server_port}; existing processes are unchanged.', flush=True)
    print(f'OPEN THIS ADDRESS: {url}', flush=True)
    print('Mode: ' + ('shared Supabase (requires one-time setup and a friend invite)' if args.live else 'local demo; stored in this browser only'), flush=True)
    print('Stop with Ctrl+C.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nPreview stopped.', flush=True)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
