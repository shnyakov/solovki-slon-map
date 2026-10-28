#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Облегчённые копии снимков для сайта: assets/web/

    python3 app/data/make_web_photos.py

Зачем. Снимки музея — сканы в 1600 пикселей, по полмегабайта и больше.
С диска киоска они читаются мгновенно, а по сети карточка Кремля тянула
четырнадцать таких файлов разом: миниатюра в 56 пикселей грузилась
из того же полноразмерного снимка. Около девяти мегабайт на одно нажатие.

Поэтому для сайта у каждого снимка две копии:
    assets/web/places/L01.jpg        для карточки, 1000 px по длинной стороне
    assets/web/places/L01.thumb.jpg  для ленты миниатюр, 168 px по короткой
Во весь экран по-прежнему раскрывается оригинал.

Копии используются ТОЛЬКО на сайте. Локально (file:// и server.py) приложение
берёт оригиналы. Это осознанно: музей кладёт и заменяет файлы в папке без
пересборки, и устаревшая копия показала бы на киоске не тот снимок. На сайте
такого не бывает: его выкладываем мы, после пересборки.

Пересобираются только копии, которые старше оригинала; копии удалённых
снимков удаляются. Скрипт вызывается из build.py, отдельно запускать не нужно.
Пересчёт делается системным sips, как и в import_photos.py: зависимостей нет,
но и работает он только на macOS. На другой системе build.py его пропустит,
а сайт покажет оригиналы.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
OUT = os.path.join(ASSETS, "web")
DIRS = ("places", "photos")

CARD_SIDE = 1000      # карточка 560 px шириной, на ретине вдвое больше
THUMB_SIDE = 168      # миниатюра 56 px, обрезается квадратом: втрое
QUALITY = 75
# Один снимок Кремля пришёл в CMYK с профилем на 557 КБ. В копиях всё
# переводится в sRGB: профиль занимает 3 КБ, и браузеры показывают цвет верно.
SRGB = "/System/Library/ColorSync/Profiles/sRGB Profile.icc"


def available():
    return sys.platform == "darwin" and shutil.which("sips") is not None


def size_of(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                         capture_output=True, text=True).stdout
    vals = [int(l.split(":")[1]) for l in out.splitlines() if "pixel" in l]
    return vals if len(vals) == 2 else (0, 0)


def convert(src, dst, side_args):
    tmp = dst + ".tmp.jpg"
    args = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(QUALITY)]
    if os.path.exists(SRGB):
        args += ["-m", SRGB]
    r = subprocess.run(args + side_args + [src, "--out", tmp], capture_output=True)
    if r.returncode or not os.path.exists(tmp):
        if os.path.exists(tmp):
            os.remove(tmp)
        return False
    os.replace(tmp, dst)
    return True


def fresh(src, dst):
    return os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)


def run(verbose=True):
    if not available():
        if verbose:
            print("Копии для сайта: нет sips (не macOS) — пропущено")
        return
    made = removed = 0
    for d in DIRS:
        src_dir = os.path.join(ASSETS, d)
        dst_dir = os.path.join(OUT, d)
        os.makedirs(dst_dir, exist_ok=True)
        names = sorted(f[:-4] for f in os.listdir(src_dir) if f.endswith(".jpg"))
        for n in names:
            src = os.path.join(src_dir, n + ".jpg")
            card = os.path.join(dst_dir, n + ".jpg")
            thumb = os.path.join(dst_dir, n + ".thumb.jpg")
            if fresh(src, card) and fresh(src, thumb):
                continue
            w, h = size_of(src)
            # Меньше нужного не растягиваем: -Z только уменьшает длинную сторону
            if convert(src, card, ["-Z", str(CARD_SIDE)] if max(w, h) > CARD_SIDE else []):
                made += 1
            short = ["--resampleHeight" if w >= h else "--resampleWidth", str(THUMB_SIDE)]
            if min(w, h) <= THUMB_SIDE:
                short = []
            if convert(src, thumb, short):
                made += 1
        keep = {n + ".jpg" for n in names} | {n + ".thumb.jpg" for n in names}
        for f in os.listdir(dst_dir):
            if f not in keep:
                os.remove(os.path.join(dst_dir, f))
                removed += 1
    if verbose:
        total = sum(os.path.getsize(os.path.join(OUT, d, f))
                    for d in DIRS for f in os.listdir(os.path.join(OUT, d)))
        print("Копии для сайта: пересчитано %d, удалено %d, всего %.1f МБ"
              % (made, removed, total / 1048576.0))


if __name__ == "__main__":
    run()
