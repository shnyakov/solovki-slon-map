#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Перенос фотографий музея в приложение.

    python3 app/data/import_photos.py "<папка «фото к карте»>"
    python3 app/data/import_photos.py "<папка>" --dry      # только показать

Что делает и зачем.

Музей прислал 39 файлов на 319 МБ, разложенных по папкам с названиями мест.
28 из них в формате TIF — браузеры его не показывают вообще, а 319 МБ для
приложения на флешке чрезмерно. Скрипт пересчитывает всё в JPEG под экран
киоска и раскладывает по соглашению об именах: L01.jpg, L01-2.jpg и так далее.

Порядок внутри места — по имени файла. Музей их пронумеровал, и этот порядок
стоит сохранить: он, скорее всего, экспозиционный.

Прежние снимки с Викисклада не удаляются, а сдвигаются в конец очереди:
у музея свои фотографии, им и первое место, но чужие права терять нельзя.

Пересчёт делается системным sips — он есть в любой macOS, зависимостей не надо.
"""
import csv
import io
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DST = os.path.join(APP, "assets", "places")
CREDITS = os.path.join(HERE, "photo-credits.csv")

# Длинная сторона в пикселях. Киоск — 1920 по ширине, просмотр во весь экран,
# поэтому 1600 хватает с запасом, а вес держится в пределах 200–400 КБ.
LONG_SIDE = 1600
QUALITY = 82

FOLDER_TO_PLACE = {
    u"Кремль": "L01",
    u"Секирная": "L02",
    u"Кемь": "L03",
    u"Анзер": "L04",
    u"Савватиево": "L05",
    u"Филимонова тоня": "L07",
    u"Варварка": "L08",
    u"Заяцкий": "L10",
    u"Муксалма": "L11",
    u"Филиппова пустынь": "L15",
    u"Кирпзавод": "L19",
}

MUSEUM = u"Соловецкий музей-заповедник"
# Снимки взяты с постоянной выставки — на неё и ссылаемся в подписи.
EXPO = u"выставка «Соловки. Испытание веры. Век ХХ»"
EXPO_URL = ("https://www.solovky.ru/exhibitions/postoyannye-vystavki/"
            "solovki-ispytanie-very-vek-xx/")


def nfc(s):
    """macOS хранит имена файлов в разложенном виде: «й» — это «и» плюс кратка.
    Строка в исходнике собрана иначе, и «Заяцкий» не совпадал сам с собой.
    Приводим обе стороны к одной форме."""
    return unicodedata.normalize("NFC", s)


def natural(s):
    """Сортировка, при которой «2» идёт раньше «10»."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def slot(pid, n):
    return pid if n == 1 else "%s-%d" % (pid, n)


def convert(src, dst):
    r = subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(QUALITY),
         "-Z", str(LONG_SIDE), src, "--out", dst],
        capture_output=True)
    return r.returncode == 0 and os.path.exists(dst)


def read_credits():
    rows = []
    if os.path.exists(CREDITS):
        with io.open(CREDITS, encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    return rows


def write_credits(rows):
    # note — служебная колонка: имя исходного файла музея. В карточке
    # не показывается, нужна чтобы потом сверить с фондовыми номерами.
    fields = ["id", "author", "date", "license", "url", "note"]
    with io.open(CREDITS, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    if not args:
        sys.exit(u"Укажите папку «фото к карте»")
    root = args[0]
    if not os.path.isdir(root):
        sys.exit(u"Нет такой папки: " + root)

    credits = read_credits()
    by_id = {r["id"]: r for r in credits}
    log = []
    moved = []

    for folder in sorted(os.listdir(root)):
        path = os.path.join(root, folder)
        if not os.path.isdir(path):
            continue
        pid = FOLDER_TO_PLACE.get(nfc(folder).strip())
        if not pid:
            log.append((u"?", folder, u"папка не сопоставлена месту — пропущена"))
            continue
        files = sorted((f for f in os.listdir(path)
                        if not f.startswith(".") and
                        os.path.splitext(f)[1].lower() in (".tif", ".tiff", ".jpg", ".jpeg", ".png")),
                       key=natural)

        # Прежний снимок этого места (с Викисклада) уходит в конец очереди
        old = os.path.join(DST, pid + ".jpg")
        tail = len(files) + 1
        if os.path.exists(old) and not dry:
            os.rename(old, os.path.join(DST, slot(pid, tail) + ".jpg"))
            if pid in by_id:
                by_id[pid]["id"] = slot(pid, tail)
            moved.append((pid, slot(pid, tail)))

        for i, fn in enumerate(files, 1):
            key = slot(pid, i)
            out = os.path.join(DST, key + ".jpg")
            src = os.path.join(path, fn)
            size = os.path.getsize(src)
            if dry:
                log.append((key, fn, u"%.1f МБ -> будет пересчитан" % (size / 1048576.0)))
                continue
            if not convert(src, out):
                log.append((key, fn, u"ОШИБКА пересчёта"))
                continue
            log.append((key, fn, u"%.1f МБ -> %.0f КБ" %
                        (size / 1048576.0, os.path.getsize(out) / 1024.0)))
            if key not in by_id:
                row = {"id": key, "author": MUSEUM, "date": "",
                       "license": EXPO, "url": EXPO_URL,
                       "note": u"исходный файл: " + fn}
                credits.append(row)
                by_id[key] = row

    for key, fn, msg in log:
        print(u"  %-8s %-42s %s" % (key, fn[:42], msg))
    if moved:
        print(u"\n  прежние снимки сдвинуты: %s" %
              u", ".join(u"%s -> %s" % m for m in moved))
    if not dry:
        write_credits(credits)
        print(u"\n  photo-credits.csv обновлён, строк: %d" % len(credits))
        print(u"  ВНИМАНИЕ: у снимков музея не заполнены фондовые номера и даты —")
        print(u"            запросить и проставить в photo-credits.csv")


main()
