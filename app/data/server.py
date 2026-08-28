#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальный сервер для правки данных из ЛЮБОГО браузера.

    python3 app/data/server.py

Зачем он нужен. Писать прямо в папку из страницы умеют только Chrome и Edge —
через File System Access API. В Safari и Firefox такого API нет вовсе, и там
сохранение откатывается на скачивание шести файлов с ручной раскладкой,
без истории версий. Это граница безопасности браузера, обойти её из страницы
нельзя никак.

Сервер снимает вопрос: страница отдаётся по http://, сохранение уходит
обычным POST, файлы пишет Python. Работает в любом браузере.

Что при этом НЕ меняется. Киоск в зале по-прежнему открывается двойным щелчком
по index.html, без сервера и без настройки. Сервер нужен только тому, кто
правит данные.

Только стандартная библиотека, никаких зависимостей.

Слушает 127.0.0.1 — то есть только эту машину. Наружу не выставляется намеренно:
в данных 411 имён репрессированных из неопубликованной таблицы музея, и отдавать
их в локальную сеть без ведома заказчика нельзя.
"""
import http.server
import io
import json
import os
import re
import shutil
import socketserver
import sys
import threading
import webbrowser
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DATA = HERE
HISTORY = os.path.join(DATA, "history")
KEEP = 30
PORT = 8765

# Пишем только эти шесть имён. Список закрытый: POST приходит из браузера,
# и принимать из него произвольные пути — значит позволить записать что угодно.
ALLOWED = {"data.js", "persons.csv", "places.csv",
           "types.csv", "settings.csv", "zones.csv"}

STAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{6}(-\d+)?$")


def stamp():
    return datetime.now().strftime("%Y-%m-%d_%H%M%S")


def fresh_dir():
    """Занятое имя не переиспользуется. Два сохранения в одну секунду иначе
    попадали бы в одну папку, и второе затирало бы снимок первого."""
    os.makedirs(HISTORY, exist_ok=True)
    base = stamp()
    name, n = base, 1
    while os.path.exists(os.path.join(HISTORY, name)):
        n += 1
        name = "%s-%d" % (base, n)
    path = os.path.join(HISTORY, name)
    os.makedirs(path)
    return name, path


def archive_current():
    """Складывает то, что сейчас на диске, в history/<метка>/ и возвращает метку.
    Ошибка здесь не должна мешать сохранению — история дело второе."""
    try:
        name, path = fresh_dir()
        for fn in sorted(ALLOWED):
            src = os.path.join(DATA, fn)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(path, fn))
        prune()
        return name
    except Exception:
        return None


def prune():
    try:
        dirs = sorted(d for d in os.listdir(HISTORY)
                      if os.path.isdir(os.path.join(HISTORY, d)))
        for d in dirs[:max(0, len(dirs) - KEEP)]:
            shutil.rmtree(os.path.join(HISTORY, d), ignore_errors=True)
    except Exception:
        pass


def list_history():
    if not os.path.isdir(HISTORY):
        return []
    return sorted((d for d in os.listdir(HISTORY)
                   if os.path.isdir(os.path.join(HISTORY, d))), reverse=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP, **kw)

    def log_message(self, fmt, *args):
        # Через этот же метод приходит log_error, а туда первым аргументом
        # летит HTTPStatus, а не строка. Проверка «"/api/" in args[0]»
        # на нём падала с TypeError и рушила обработку запроса целиком —
        # страница обрывалась на полуслове. Приводим к строке безопасно.
        try:
            line = fmt % args
        except Exception:
            line = str(fmt)
        if "/api/" in line:
            sys.stdout.write("  %s\n" % line)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_GET(self):
        if self.path.startswith("/api/ping"):
            return self._json({"okoyom": 1, "keep": KEEP})
        if self.path.startswith("/api/history"):
            return self._json({"versions": list_history()})
        return super().do_GET()

    def do_POST(self):
        try:
            if self.path.startswith("/api/save"):
                return self._save()
            if self.path.startswith("/api/restore"):
                return self._restore()
        except Exception as e:
            return self._json({"error": str(e)}, 500)
        self._json({"error": "неизвестный запрос"}, 404)

    def _save(self):
        files = (self._body() or {}).get("files") or {}
        bad = [k for k in files if k not in ALLOWED]
        if bad:
            return self._json({"error": "недопустимые имена: " + ", ".join(bad)}, 400)
        kept = archive_current()
        for name, text in files.items():
            # BOM обязателен: без него Excel открывает CSV кракозябрами
            with io.open(os.path.join(DATA, name), "w", encoding="utf-8-sig",
                         newline="") as f:
                f.write(text)
        print(u"  сохранено файлов: %d%s" % (len(files),
              (u", прежнее в history/" + kept) if kept else u""))
        self._json({"ok": True, "n": len(files), "kept": kept})

    def _restore(self):
        name = (self._body() or {}).get("name") or ""
        if not STAMP_RE.match(name):
            return self._json({"error": "плохое имя версии"}, 400)
        src = os.path.join(HISTORY, name)
        if not os.path.isdir(src):
            return self._json({"error": "версия не найдена"}, 404)
        kept = archive_current()          # чтобы можно было отменить сам возврат
        n = 0
        for fn in sorted(ALLOWED):
            p = os.path.join(src, fn)
            if os.path.exists(p):
                shutil.copy2(p, os.path.join(DATA, fn))
                n += 1
        print(u"  возврат к %s, файлов: %d" % (name, n))
        self._json({"ok": True, "n": n, "kept": kept})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = PORT
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)
    url = "http://127.0.0.1:%d/index.html#edit" % port
    try:
        srv = Server(("127.0.0.1", port), Handler)
    except OSError as e:
        sys.exit(u"Не удалось занять порт %d: %s\n"
                 u"Возможно, сервер уже запущен. Откройте %s" % (port, e, url))

    print(u"\n  Соловки — правка данных\n")
    print(u"  Откройте в любом браузере:")
    print(u"      %s\n" % url)
    print(u"  Сохранение будет писать прямо в app/data, история версий ведётся.")
    print(u"  Работает в Safari, Firefox, Chrome — где угодно.\n")
    print(u"  Остановить: Ctrl+C. Пока окно закрыто — правки не сохранятся.\n")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print(u"\n  Остановлено.\n")


main()
