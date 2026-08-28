#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Разговор с браузером по его отладочному протоколу.

Зачем он, если test_edit.py обходится подменённым index.html. Затем, что
здесь проверяется ВРЕМЯ: пересобрался ли слой меток посреди жеста, ехала ли
высота снимка или прыгнула. Такое нужно замерять по ходу дела, десятками
кадров, — а страница с вшитым скриптом умеет только отчитаться в конце.

Ничего лишнего: сокет, рукопожатие и Runtime.evaluate. Стандартная
библиотека, никаких пакетов — как и во всём остальном проекте.
"""
import base64, json, os, socket, struct, subprocess, tempfile, time, urllib.request

CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

class WS(object):
    def __init__(self, url):
        u = url.split("://", 1)[1]
        host_port, path = u.split("/", 1)
        host, port = host_port.split(":")
        self.s = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n") % (path, host_port, key)
        self.s.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(1)
        self.buf = b""
        self.id = 0
    def send(self, method, params=None):
        self.id += 1
        msg = json.dumps({"id": self.id, "method": method, "params": params or {}}).encode()
        n = len(msg); mask = os.urandom(4); head = b"\x81"
        if n < 126: head += bytes([0x80 | n])
        elif n < 65536: head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else: head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        head += mask
        self.s.sendall(head + bytes(b ^ mask[i % 4] for i, b in enumerate(msg)))
        while True:
            r = self.recv()
            if r.get("id") == self.id:
                return r
    def recv(self):
        def rd(n):
            while len(self.buf) < n:
                self.buf += self.s.recv(65536)
            out, self.buf = self.buf[:n], self.buf[n:]
            return out
        b1, b2 = rd(2)
        n = b2 & 0x7f
        if n == 126: n = struct.unpack(">H", rd(2))[0]
        elif n == 127: n = struct.unpack(">Q", rd(8))[0]
        return json.loads(rd(n).decode())

def open_app(url_path="app/index.html", w=1400, h=900, port=9334, touch=False):
    prof = tempfile.mkdtemp()
    url = "file://" + os.path.abspath(url_path)
    args = [CH, "--headless=new", "--remote-debugging-port=%d" % port,
            "--user-data-dir=" + prof, "--window-size=%d,%d" % (w, h),
            "--hide-scrollbars", url]
    p = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t = None
    for _ in range(120):
        try:
            t = [x for x in json.load(urllib.request.urlopen(
                "http://127.0.0.1:%d/json" % port)) if x["type"] == "page"][0]
            break
        except Exception:
            time.sleep(.25)
    ws = WS(t["webSocketDebuggerUrl"])
    ws.send("Runtime.enable")
    ws.send("Page.enable")
    if touch:
        ws.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        ws.send("Emulation.setEmitTouchEventsForMouse", {"enabled": True})
    time.sleep(1.6)
    return p, ws

def ev(ws, expr):
    r = ws.send("Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                     "awaitPromise": True})
    res = r["result"]["result"]
    if res.get("subtype") == "error" or "exceptionDetails" in r["result"]:
        return "ОШИБКА: " + json.dumps(r["result"], ensure_ascii=False)[:400]
    return res.get("value")

OK = [0, 0]
def check(name, cond, note=""):
    OK[0 if cond else 1] += 1
    print(("PASS " if cond else "FAIL ") + name + ("   [" + str(note) + "]" if note else ""))

def total():
    print("ИТОГ: успешно %d, провалено %d" % (OK[0], OK[1]))
    return 0 if OK[1] == 0 else 1
