#!/usr/bin/env python3
"""GiliranBox kiosk runtime for Raspberry Pi: ticket button, ESC/POS printer, TV display, counter page.

  python3 kiosk.py config.json
  TV display   : http://<pi>:8080/tv       (full-screen Chromium on the TV)
  Counter page : http://<pi>:8080/counter  (works offline on the shop LAN)
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from kiosk_core import ApiError, Kiosk, NoNumbers, OfflineError, Store

try:
    import segno  # optional: renders the pairing QR on the TV
except ImportError:
    segno = None

CFG = {}


def api(fn, params):
    req = urllib.request.Request(
        f"{CFG['supabase_url']}/rest/v1/rpc/{fn}", data=json.dumps(params).encode(), method="POST",
        headers={"apikey": CFG["anon_key"], "Authorization": f"Bearer {CFG['anon_key']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            body = r.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode()).get("message", str(e))
        except Exception:
            msg = str(e)
        raise ApiError(msg)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise OfflineError()


def print_ticket(t, shop, waiting):
    """Raw ESC/POS to a USB/serial thermal printer (e.g. /dev/usb/lp0). No printer configured -> just log."""
    dev = CFG.get("printer_device")
    ESC_INIT, CENTER, BIG, NORMAL, CUT = b"\x1b@", b"\x1ba\x01", b"\x1d!\x33", b"\x1d!\x00", b"\x1dV\x42\x00"
    text = (ESC_INIT + CENTER + (shop or "GiliranBox").encode("ascii", "replace") + b"\n\n" + BIG + f"#{t['number']}".encode() + NORMAL +
            f"\n\n{waiting} waiting\n{t['created_at'][:16].replace('T', ' ')}\n\nScan GiliranBox app to queue remotely\n\n\n".encode() + CUT)
    if not dev:
        print(f"[print] ticket #{t['number']}")
        return
    try:
        with open(dev, "wb", buffering=0) as f:
            f.write(text)
    except OSError as e:
        print("[print] failed:", e)


TV = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Queue</title>
<style>body{margin:0;background:#0b3d2e;color:#fff;font-family:system-ui,sans-serif;text-align:center}
#n{font-size:32vw;font-weight:900;line-height:1;margin-top:4vh}#l{font-size:4vw;opacity:.8}#r{font-size:5vw;opacity:.7;margin-top:3vh}
#q{background:#fff;display:inline-block;padding:2vw;margin-top:5vh;border-radius:2vw}#q svg{width:30vw;height:30vw}#off{position:fixed;top:1vw;right:2vw;font-size:2vw;color:#fc6}</style>
<div id=l>NOW SERVING</div><div id=n>-</div><div id=r></div><div id=pair></div><div id=off></div>
<script>
let last=null;function beep(){try{const a=new AudioContext(),o=a.createOscillator();o.connect(a.destination);o.frequency.value=880;o.start();o.stop(a.currentTime+.4)}catch(e){}}
async function tick(){try{const s=await (await fetch('/state')).json();
 document.getElementById('n').textContent=s.serving??'-';
 if(s.serving!==last&&last!==null&&s.serving!=null)beep();last=s.serving;
 document.getElementById('r').textContent=s.recent.length?'Previous: '+s.recent.join('  '):'';
 document.getElementById('off').textContent=s.online?'':'OFFLINE';
 const p=document.getElementById('pair');
 if(!s.paired&&s.pair_code){p.innerHTML='<div id=q><img src="/qr.svg" style="width:30vw"></div><div style="font-size:3vw">Pair code '+s.pair_code+'</div>'}else p.innerHTML='';
}catch(e){document.getElementById('off').textContent='NO LOCAL LINK'}}
tick();setInterval(tick,2000);
</script>"""

COUNTER = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Counter</title>
<style>body{font-family:system-ui;max-width:420px;margin:20px auto;text-align:center}button{display:block;width:100%;padding:18px;margin:10px 0;font-size:22px;border:0;border-radius:14px;background:#00b14f;color:#fff}
button.g{background:#555}h1{font-size:64px;margin:10px}</style>
<div>Now serving</div><h1 id=n>-</h1><div id=w></div>
<button onclick=a('next')>NEXT</button><button class=g onclick=a('recall')>RECALL</button><button class=g onclick=a('ticket')>+ Walk-in ticket</button>
<script>const pin=new URLSearchParams(location.search).get('pin')||'';
async function a(x){await fetch('/'+x+'?pin='+pin,{method:'POST'});t()}
async function t(){const s=await (await fetch('/state')).json();n.textContent=s.serving??'-';w.textContent=s.waiting+' waiting · '+s.numbers_left+' numbers left'+(s.online?'':' · OFFLINE (local mode)')}
t();setInterval(t,3000)</script>"""


class H(BaseHTTPRequestHandler):
    kiosk: Kiosk = None

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _pin_ok(self):
        want = CFG.get("counter_pin")
        return not want or parse_qs(urlparse(self.path).query).get("pin", [""])[0] == str(want)

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/state":
            return self._send(200, json.dumps(self.kiosk.state()))
        if p in ("/", "/tv"):
            return self._send(200, TV, "text/html")
        if p == "/counter":
            return self._send(200, COUNTER, "text/html") if self._pin_ok() else self._send(403, "pin required", "text/plain")
        if p == "/qr.svg":
            code = self.kiosk.s.get("pair_code")
            if not code or not segno:
                return self._send(404, "", "text/plain")
            import io
            buf = io.BytesIO()
            segno.make(f"giliranbox://pair?code={code}", error="m").save(buf, kind="svg", scale=8, border=1)
            return self._send(200, buf.getvalue(), "image/svg+xml")
        self._send(404, "not found", "text/plain")

    def do_POST(self):
        if not self._pin_ok():
            return self._send(403, "pin required", "text/plain")
        k, p = self.kiosk, urlparse(self.path).path
        try:
            if p == "/ticket":
                t = k.create_ticket()
                print_ticket(t, CFG.get("shop_name"), k.state()["waiting"])
                return self._send(200, json.dumps({"number": t["number"]}))
            if p == "/next":
                return self._send(200, json.dumps({"serving": k.call_next()}))
            if p == "/recall":
                return self._send(200, json.dumps({"serving": k.recall()}))
        except NoNumbers:
            return self._send(409, json.dumps({"error": "no_numbers_left_please_see_staff"}))
        except ApiError as e:
            return self._send(502, json.dumps({"error": e.message}))
        self._send(404, "not found", "text/plain")


def background(k):
    delay = 3
    while True:
        try:
            if not k.paired:
                k.pairing_step()
                delay = 3
            else:
                ok = k.sync()
                delay = 3 if ok else min(delay * 2, 60)   # steady 3 s while online; exponential backoff while offline
        except (OfflineError, ApiError):
            delay = min(delay * 2, 60)
        time.sleep(delay)


def main():
    global CFG
    CFG = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "config.json"))
    k = Kiosk(Store(CFG.get("state_db", os.path.expanduser("~/giliranbox-kiosk.db"))), api)
    H.kiosk = k
    threading.Thread(target=background, args=(k,), daemon=True).start()
    if CFG.get("button_gpio"):   # optional physical "take a ticket" button
        try:
            from gpiozero import Button
            Button(CFG["button_gpio"]).when_pressed = lambda: (print_ticket(t := k.create_ticket(), CFG.get("shop_name"), k.state()["waiting"]))
        except Exception as e:
            print("GPIO unavailable:", e)
    print(f"Kiosk on http://0.0.0.0:{CFG.get('port', 8080)}/tv")
    ThreadingHTTPServer(("0.0.0.0", CFG.get("port", 8080)), H).serve_forever()


if __name__ == "__main__":
    main()
