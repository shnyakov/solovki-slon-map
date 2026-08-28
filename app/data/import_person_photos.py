#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Портреты персоналий из базы «Новомученики и исповедники» (fond.ru).

    python3 app/data/import_person_photos.py --dry          # только показать
    python3 app/data/import_person_photos.py --limit 20     # взять первых 20
    python3 app/data/import_person_photos.py                # всех, у кого нет фото

НУЖНА СЕТЬ. На Соловках её нет — запускать заранее.

Зачем. На флешке музея портретов не оказалось, их пришлют позже. До тех пор
карточки стоят без лиц. База фонда «Память мучеников и исповедников Русской
Православной Церкви» — источник, на который ссылается и сам музей.

Как сверяется личность. Ошибиться тут нельзя: подписанное чужим лицом фото
в мемориальной экспозиции хуже, чем отсутствие фото. Поэтому берём снимок,
только если СОВПАЛИ и фамилия, и имя, и кандидат в базе ровно один.
Всё, что вызывает сомнение, пропускается и попадает в отчёт.

Монашествующие в базе записаны как «Иларион (Троицкий)»: церковное имя плюс
мирская фамилия в скобках. У нас в реестре ровно то же самое, в двух колонках.

Подпись под снимком берётся с сайта и кладётся в photo-credits.csv — она
часто ценнее самого файла: «Соловецкий концлагерь. Филимонова рыболовная
тоня. Архиепископ Иларион (крайний слева)».
"""
import csv
import io
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
PHOTOS = os.path.join(APP, "assets", "photos")
CREDITS = os.path.join(HERE, "photo-credits.csv")

SEARCH = "https://fond.ru/poisk/?menu_id=0&flag_search=1&search_word="
PAGE = "https://fond.ru/poisk/?module=module_person_page&flag=1&person_id=%s"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
AUTHOR = u"Фонд «Память мучеников и исповедников Русской Православной Церкви»"
PAUSE = 1.2          # вежливая пауза между запросами к чужому серверу
LONG_SIDE = 900


def norm(s):
    return re.sub(r"\s+", " ", (s or "")).replace(u"ё", u"е").strip().lower()


def first(s):
    p = norm(s).split()
    return p[0] if p else ""


def fetch(url, binary=False):
    """Через curl, а не urllib.

    В сети попадается подставной сертификат (гостевой вайфай, корпоративный
    прокси), и проверка цепочки в Python падает с CERTIFICATE_VERIFY_FAILED.
    curl берёт доверенные корни из системного хранилища и проходит.
    """
    r = subprocess.run(["curl", "-sSL", "--max-time", "45", "-A", UA, url],
                       capture_output=True)
    if r.returncode != 0:
        raise IOError((r.stderr or b"").decode("utf-8", "replace").strip()[:120] or "curl")
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def get(url):
    return fetch(url)


def candidates(surname):
    """Строки результата поиска: (person_id, есть ли фото, текст строки)."""
    html = get(SEARCH + urllib.parse.quote(surname))
    tbl = re.search(r"<table[^>]*table-striped.*?</table>", html, re.S)
    if not tbl:
        return []
    out = []
    for row in re.findall(r"<tr>(.*?)</tr>", tbl.group(0), re.S):
        pid = re.search(r"person_id=(\d+)", row)
        if not pid:
            continue
        txt = re.sub(r"<[^>]+>", " ", row)
        out.append((pid.group(1), "flag=1" in row, re.sub(r"\s+", " ", txt).strip()))
    return out


def page_info(pid):
    """Шапка карточки и снимки с подписями."""
    html = get(PAGE % pid)
    head = re.search(r"<b><font color=navy>(.*?)</font></b>\s*\(([^)]*)\)\s*<br>\s*([^<]*)",
                     html, re.S)
    name = surname = rank = ""
    if head:
        name = re.sub(r"<[^>]+>", "", head.group(1)).strip()
        surname = head.group(2).strip()
        rank = head.group(3).strip()
    shots = []
    for blk in re.findall(r'<div class="kartinka">(.*?)</div>', html, re.S):
        src = re.search(r"<a href='([^']+)'", blk)
        cap = re.search(r"<p[^>]*>(.*?)</p>", blk, re.S)
        if src:
            text = re.sub(r"<[^>]+>", " ", cap.group(1)) if cap else ""
            shots.append((src.group(1), re.sub(r"\s+", " ", text).strip()))
    return name, surname, rank, shots


def convert(data, dst):
    tmp = dst + ".src"
    with io.open(tmp, "wb") as f:
        f.write(data)
    r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85",
                        "-Z", str(LONG_SIDE), tmp, "--out", dst], capture_output=True)
    os.remove(tmp)
    return r.returncode == 0 and os.path.exists(dst)


def main():
    dry = "--dry" in sys.argv
    limit = 0
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    people = list(csv.DictReader(io.open(os.path.join(HERE, "persons.csv"), encoding="utf-8")))
    have = {f.split(".")[0].split("-")[0] for f in os.listdir(PHOTOS) if f.endswith(".jpg")}

    # Берём тех, кого посетитель встретит на карте: они привязаны к местам.
    targets = [p for p in people
               if p["places"] and p["surname"].strip() and p["id"] not in have]
    if limit:
        targets = targets[:limit]
    print(u"  кандидатов: %d (привязаны к месту, фамилия есть, фото нет)\n" % len(targets))

    rows = list(csv.DictReader(io.open(CREDITS, encoding="utf-8")))
    known = {r["id"] for r in rows}
    took = skipped = 0

    for p in targets:
        who = (p["name"] + " " + p["surname"]).strip()
        try:
            cand = candidates(p["surname"])
        except Exception as e:
            print(u"  %-30s сеть: %s" % (who[:30], e))
            continue
        time.sleep(PAUSE)

        hits = []
        for pid, has_photo, txt in cand:
            if not has_photo:
                continue
            t = norm(txt)
            if norm(p["surname"]) in t and first(p["name"]) and first(p["name"]) in t.split():
                hits.append(pid)
        if len(hits) != 1:
            print(u"  %-30s пропуск: подходящих %d" % (who[:30], len(hits)))
            skipped += 1
            continue

        try:
            nm, sn, rank, shots = page_info(hits[0])
        except Exception as e:
            print(u"  %-30s сеть: %s" % (who[:30], e))
            continue
        time.sleep(PAUSE)

        # Последняя сверка — уже по самой карточке, а не по строке поиска
        if norm(sn) != norm(p["surname"]) or first(nm) != first(p["name"]):
            print(u"  %-30s пропуск: в базе «%s (%s)»" % (who[:30], nm, sn))
            skipped += 1
            continue
        if not shots:
            print(u"  %-30s пропуск: снимков нет" % who[:30])
            skipped += 1
            continue

        url, cap = shots[0]
        dst = os.path.join(PHOTOS, p["id"] + ".jpg")
        if dry:
            print(u"  %-30s -> %s  «%s»" % (who[:30], p["id"], cap[:44]))
            took += 1
            continue
        try:
            data = fetch(url, binary=True)
        except Exception as e:
            print(u"  %-30s снимок не скачался: %s" % (who[:30], e))
            continue
        time.sleep(PAUSE)
        if not convert(data, dst):
            print(u"  %-30s пересчёт не удался" % who[:30])
            continue
        print(u"  %-30s -> %s.jpg  %.0f КБ  «%s»" %
              (who[:30], p["id"], os.path.getsize(dst) / 1024.0, cap[:36]))
        took += 1
        if p["id"] not in known:
            rows.append({"id": p["id"], "author": AUTHOR, "date": "",
                         "license": u"база «Новомученики и исповедники»",
                         "url": PAGE % hits[0], "note": cap})
            known.add(p["id"])

    if not dry:
        fields = ["id", "author", "date", "license", "url", "note"]
        with io.open(CREDITS, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in fields})
    print(u"\n  взято: %d, пропущено: %d" % (took, skipped))
    print(u"  ВАЖНО: права на снимки принадлежат фонду. До открытия экспозиции")
    print(u"         согласовать использование — источник записан в photo-credits.csv")


main()
