import http.server
import socketserver
import urllib.request
import urllib.parse
import re
import html
import json
import sys
import os
import time
import threading

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

cache = {}
sse_clients = []
active_market = {"state": "gujarat", "city": "ahmedabad"}

def slugify(text):
    if not text:
        return ""
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')

def unwrap_astro(val):
    if isinstance(val, list):
        if len(val) == 2 and isinstance(val[0], int):
            return unwrap_astro(val[1])
        return [unwrap_astro(item) for item in val]
    elif isinstance(val, dict):
        return {k: unwrap_astro(v) for k, v in val.items()}
    return val

def fetch_live_rates(state="gujarat", city="ahmedabad"):
    state_slug = slugify(state)
    city_slug = slugify(city)
    cache_key = f"{state_slug}:{city_slug}"

    now = time.time()
    if cache_key in cache:
        cached_data, cached_time = cache[cache_key]
        if now - cached_time < 0.6:
            return cached_data

    urls_to_try = [
        f"https://allindiabullion.com/gold-rate/{state_slug}/{city_slug}",
        f"https://allindiabullion.com/gold-rate/{state_slug}",
        "https://allindiabullion.com/gold-rate/gujarat/ahmedabad"
    ]

    for url in urls_to_try:
        # Add random cache buster parameter to bypass Cloudflare edge cache
        cache_busting_url = f"{url}?_t={int(now * 1000)}"
        req = urllib.request.Request(
            cache_busting_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=3.5) as res:
                page_html = res.read().decode('utf-8')
                match = re.search(r'component-url="[^"]*RateBoard[^"]*"[^>]*props="([^"]+)"', page_html)
                if match:
                    raw_json = html.unescape(match.group(1))
                    parsed = json.loads(raw_json)
                    unwrapped = unwrap_astro(parsed)
                    initial = unwrapped.get('initial', {})
                    result = {
                        'success': True,
                        'state': state,
                        'city': city,
                        'top': initial.get('top', []),
                        'ref': initial.get('ref', []),
                        'ts': initial.get('ts', int(now * 1000))
                    }
                    cache[cache_key] = (result, now)
                    return result
        except Exception:
            continue

    if cache_key in cache:
        return cache[cache_key][0]

    return {'success': False, 'error': 'Live feed unreachable'}

class BullionServer(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        
        # 1. Real-Time Server-Sent Events (SSE) Stream - Like Zerodha / TradingView
        if parsed_url.path == '/api/stream':
            query = urllib.parse.parse_qs(parsed_url.query)
            state = query.get('state', ['gujarat'])[0]
            city = query.get('city', ['ahmedabad'])[0]

            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache, no-transform')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            last_ts = 0
            try:
                while True:
                    data = fetch_live_rates(state, city)
                    if data.get('success'):
                        current_ts = data.get('ts', 0)
                        msg = f"data: {json.dumps(data)}\n\n".encode('utf-8')
                        self.wfile.write(msg)
                        self.wfile.flush()
                        last_ts = current_ts
                    time.sleep(1.0)
            except (BrokenPipeError, ConnectionResetError, Exception):
                return

        # 2. REST API endpoint
        elif parsed_url.path == '/api/rates':
            query = urllib.parse.parse_qs(parsed_url.query)
            state = query.get('state', ['gujarat'])[0]
            city = query.get('city', ['ahmedabad'])[0]
            data = fetch_live_rates(state, city)

            resp_body = json.dumps(data).encode('utf-8')
            self.send_response(200 if data.get('success') else 500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(resp_body)
        else:
            super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), BullionServer) as httpd:
        print(f"Trading-Grade Bullion Stream Server started at http://localhost:{PORT}")
        sys.stdout.flush()
        httpd.serve_forever()
