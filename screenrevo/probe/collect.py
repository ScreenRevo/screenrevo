#!/usr/bin/env python3
"""Receives the ScreenRevo probe's results on this computer, on the same Wi-Fi as the TV.

    python3 screenrevo/probe/collect.py                         # port 8765, files in ./logs
    python3 screenrevo/probe/collect.py --out DIR --port 8765 --host 127.0.0.1

Each report lands in probe-<date>-<time>.json, and the events (keys, voice, the app going to the background) in
probe-events-<date>.jsonl as they come. On Windows, allow Python on private networks when the firewall asks.
"""
import datetime
import http.server
import json
import os
import sys

MAX_BODY = 4 * 1024 * 1024


class Handler(http.server.BaseHTTPRequestHandler):
    out = 'logs'

    def answer(self, code, body=b''):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.answer(204)

    def do_GET(self):
        self.answer(200, b'ScreenRevo collector: ok\n')

    def do_POST(self):
        size = int(self.headers.get('Content-Length') or 0)
        if size <= 0 or size > MAX_BODY:
            self.answer(413)
            return
        try:
            data = json.loads(self.rfile.read(size).decode('utf-8'))
        except ValueError:
            self.answer(400)
            return
        now = datetime.datetime.now()
        os.makedirs(self.out, exist_ok=True)
        if self.path == '/results':
            path = os.path.join(self.out, 'probe-%s.json' % now.strftime('%Y%m%d-%H%M%S'))
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print('Report saved: ' + path, flush=True)
            for name, test in (data.get('tests') or {}).items():
                print('  %-12s %-8s %s' % (name, test.get('status'), test.get('summary')), flush=True)
        elif self.path == '/event':
            path = os.path.join(self.out, 'probe-events-%s.jsonl' % now.strftime('%Y%m%d'))
            with open(path, 'a', encoding='utf-8') as f:
                for event in data.get('events') or []:
                    f.write(json.dumps(event, ensure_ascii=False) + '\n')
                    print('  %s  %s  %s' % (event.get('t', '')[11:19], event.get('type'), event.get('detail')), flush=True)
        else:
            self.answer(404)
            return
        self.answer(200, b'ok\n')

    def log_message(self, fmt, *args):
        pass   # one line per report or event above is enough


def main():
    args = sys.argv[1:]

    def value(flag, default):
        i = args.index(flag) + 1 if flag in args else 0
        return args[i] if 0 < i < len(args) else default

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')   # accents on a Windows console
    Handler.out = os.path.abspath(value('--out', 'logs'))
    host, port = value('--host', '0.0.0.0'), int(value('--port', '8765'))
    server = http.server.ThreadingHTTPServer((host, port), Handler)
    print('ScreenRevo collector on %s:%d, saving to %s (Ctrl+C stops it)' % (host, port, Handler.out), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
