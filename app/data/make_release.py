#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собрать то, что можно отдать человеку целиком: папку и архив.

Запуск:  python3 app/data/make_release.py

Зачем. Репозиторий — это рабочая папка: исходники карты на пять мегабайт,
стенды, снимки истории, кэш Python. Отдавать её нельзя: получатель не поймёт,
что здесь запускать, а половина веса ему вообще не нужна.

Собирается папка, в корне которой лежит ровно одно, на что надо нажать.
Запуск один и тот же на Windows, macOS и Linux: файл открывается двойным
щелчком в браузере по умолчанию. Ни установки, ни прав администратора,
ни интернета — приложение и задумано так, что живёт файлом.

Пусковой файл — HTML, а не .bat и не .command: скрипты пришлось бы писать
под каждую систему, на macOS они ещё и попадают в карантин после скачивания,
а на Linux им нужен бит запуска, который архив не сохраняет. HTML открывается
везде одинаково и ничего не просит.

Что не попадает в сборку:
  · исходники карты (osm-*.json, 5,6 МБ) — из них карта уже собрана;
  · стенды и сборочные скрипты, кроме server.py: он нужен для сохранения
    в Safari и Firefox;
  · снимки истории, __pycache__, *.bak, .DS_Store.
"""
import io, os, shutil, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(APP)
OUT = os.path.join(ROOT, "release")
NAME = "Соловки-карта"
LAUNCHER = "ОТКРЫТЬ КАРТУ.html"

KEEP_PY = {"server.py"}
SKIP_DIRS = {"history", "__pycache__"}
SKIP_EXT = {".bak", ".pyc"}
SKIP_FILES = {".DS_Store"}


def wanted(path):
    """path — относительный путь внутри app/."""
    parts = path.split(os.sep)
    if any(p in SKIP_DIRS for p in parts):
        return False
    name = parts[-1]
    if name in SKIP_FILES or os.path.splitext(name)[1] in SKIP_EXT:
        return False
    if name.endswith(".py") and name not in KEEP_PY:
        return False
    # Исходники карты нужны только чтобы её пересобрать, а она уже собрана
    if name.startswith("osm-") and name.endswith(".json"):
        return False
    return True


LAUNCH_HTML = """<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<title>Соловки. Испытание веры. Век ХХ — открыть карту</title>
<!-- Этот файл ничего не делает сам: он только уводит в приложение.
     Нужен затем, чтобы в распакованной папке было очевидно, на что нажать. -->
<meta http-equiv="refresh" content="0; url=app/index.html">
<style>
  body{font:16px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;
       background:#f7f5f1; color:#2b2b2b; margin:0;
       display:flex; min-height:100vh; align-items:center; justify-content:center}
  main{max-width:34em; padding:2em; text-align:center}
  a{color:#c8481e}
</style>
<main>
  <h1>Интерактивная карта мест заключения священнослужителей СЛОН</h1>
  <p>Карта открывается сама. Если этого не произошло —
     <a href="app/index.html">откройте её вручную</a>.</p>
  <p><small>Если и ссылка не работает, значит архив открыт «изнутри»,
     без распаковки. Распакуйте папку целиком и откройте этот файл снова.</small></p>
</main>
</html>
"""

READ_ME = """СОЛОВКИ. ИСПЫТАНИЕ ВЕРЫ. ВЕК ХХ
Интерактивная карта мест заключения священнослужителей СЛОН

КАК ОТКРЫТЬ

1. Распакуйте архив ЦЕЛИКОМ. Это важно: если открыть файл прямо
   из архива, не распаковывая, карта и фотографии не загрузятся.
   Windows: правой кнопкой по архиву -> «Извлечь все».
   macOS: двойной щелчок по архиву.
   Linux: «Распаковать сюда» в файловом менеджере.

2. В распакованной папке откройте файл

       {launcher}

   двойным щелчком. Он откроется в браузере и уведёт в приложение.

Интернет не нужен ни при открытии, ни во время работы.
Ничего не устанавливается, права администратора не нужны.

БРАУЗЕР

Смотреть можно в любом: Chrome, Edge, Safari, Firefox.
Правка данных с сохранением в файлы работает в Chrome и Edge —
в остальных браузерах такой возможности у страницы просто нет.
Приложение предупредит об этом само.

ПОКАЗ В ЗАЛЕ

Полноэкранный киоск в Chrome (Windows), одной строкой:

    chrome.exe --kiosk "ПОЛНЫЙ\\ПУТЬ\\app\\index.html"

Через 90 секунд без касаний включается заставка.

ПРАВКА ДАННЫХ

Служебный режим — дописать #edit в адрес:

    .../app/index.html#edit

Подробности — в файле «Инструкция для музея.md».

О ДАННЫХ И ПРАВАХ

В приложении — материалы Соловецкого музея-заповедника: имена
репрессированных священнослужителей и фотографии из фондов.
Код приложения — под лицензией MIT (файл LICENSE), на содержимое
она не распространяется: сведения и снимки принадлежат музею
и правообладателям, перечисленным в app/data/photo-credits.csv.

Собрано {stamp}
"""


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    dst_root = os.path.join(OUT, NAME)
    os.makedirs(dst_root)

    n = 0
    for base, dirs, files in os.walk(APP):
        rel = os.path.relpath(base, APP)
        rel = "" if rel == "." else rel
        dirs[:] = [d for d in dirs if wanted(os.path.join(rel, d))]
        for f in files:
            r = os.path.join(rel, f) if rel else f
            if not wanted(r):
                continue
            d = os.path.join(dst_root, "app", r)
            if not os.path.isdir(os.path.dirname(d)):
                os.makedirs(os.path.dirname(d))
            shutil.copy2(os.path.join(base, f), d)
            n += 1

    io.open(os.path.join(dst_root, LAUNCHER), "w", encoding="utf-8").write(LAUNCH_HTML)

    stamp = ""
    idx = os.path.join(APP, "index.html")
    src = io.open(idx, encoding="utf-8").read()
    for mark in ("?v=", "data-build=\""):
        at = src.find(mark)
        if at > 0:
            stamp = src[at + len(mark):at + len(mark) + 16].split('"')[0].split("&")[0]
            break

    # Метка сборки в index.html — числом вида 20260829000853. Получателю
    # нужна дата, а не отпечаток времени сборки.
    if len(stamp) >= 8 and stamp[:8].isdigit():
        stamp = "%s.%s.%s" % (stamp[6:8], stamp[4:6], stamp[:4])
    io.open(os.path.join(dst_root, "ЧИТАТЬ ПЕРВЫМ.txt"), "w",
            encoding="utf-8", newline="\r\n").write(
        READ_ME.format(launcher=LAUNCHER, stamp=stamp or "из текущей сборки"))

    doc = os.path.join(ROOT, "ДЛЯ_МУЗЕЯ.md")
    if os.path.exists(doc):
        shutil.copy2(doc, os.path.join(dst_root, "Инструкция для музея.md"))

    # Лицензия на код. На содержимое она не распространяется — об этом сказано
    # и в README, и в «ЧИТАТЬ ПЕРВЫМ.txt».
    lic = os.path.join(ROOT, "LICENSE")
    if os.path.exists(lic):
        shutil.copy2(lic, os.path.join(dst_root, "LICENSE"))

    zip_path = os.path.join(OUT, NAME + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(dst_root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in sorted(files):
                if f in SKIP_FILES:
                    continue
                full = os.path.join(base, f)
                z.write(full, os.path.join(NAME, os.path.relpath(full, dst_root)))

    size = os.path.getsize(zip_path) / 1024.0 / 1024.0
    files = [os.path.join(b, f) for b, _, fs in os.walk(dst_root) for f in fs]
    folder = sum(os.path.getsize(f) for f in files) / 1024.0 / 1024.0
    root = sorted(x for x in os.listdir(dst_root) if x != "app")
    print("Папка:  %s" % dst_root)
    print("Архив:  %s" % zip_path)
    print("Файлов: %d, папка %.1f МБ, архив %.1f МБ" % (len(files), folder, size))
    print("В корне: %s, app/" % ", ".join(root))


main()
