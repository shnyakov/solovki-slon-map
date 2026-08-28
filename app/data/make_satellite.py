#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Спутниковая подложка: assets/map-satellite.jpg

    python3 app/data/make_satellite.py

НУЖНА СЕТЬ. На Соловках её нет — запускать заранее.

Что это. Мозаика Sentinel-2 cloudless от EOX: безоблачный композит, собранный
из снимков Copernicus Sentinel-2. Лицензия CC BY 4.0, указание источника
обязательно — оно стоит в подписи под картой.

Почему именно она. Пробовали GIBS от NASA: Landsat WELD на широте Соловков
данных не имеет вовсе (возвращает чёрный лист), MODIS и VIIRS дают 250 метров
на пиксель — весь Большой Соловецкий укладывается в сотню точек. Sentinel-2
даёт 10 метров, и это единственный источник такого качества, доступный
без регистрации и ключей.

Рамка и проекция берутся из make_map.py, поэтому снимок ложится на векторную
карту точка в точку: та же BBOX, тот же Меркатор.

Ширина 4096 — примерно 23 метра на пиксель. Больше нет смысла: на киоске
и при обычном зуме этого достаточно, а вес растёт быстро.
"""
import io
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
DST = os.path.join(APP, "assets", "map-satellite.jpg")

# Держим в согласии с make_map.py. Если рамку там поменяют, снимок пересобрать.
BBOX = {"s": 64.80, "w": 34.40, "n": 65.30, "e": 36.40}
WIDTH = 4096
LAYER = "s2cloudless-2020_3857"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def merc_m(lat):
    """Меркатор в метрах EPSG:3857 — то же, что merc() в make_map.py, но в метрах."""
    return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))) * 20037508.34 / 180.0


def main():
    x0 = BBOX["w"] * 20037508.34 / 180.0
    x1 = BBOX["e"] * 20037508.34 / 180.0
    y0, y1 = merc_m(BBOX["s"]), merc_m(BBOX["n"])
    h = int(round(WIDTH * (y1 - y0) / (x1 - x0)))
    url = ("https://tiles.maps.eox.at/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1"
           "&LAYERS=%s&SRS=EPSG:3857&FORMAT=image/jpeg&WIDTH=%d&HEIGHT=%d"
           "&BBOX=%.0f,%.0f,%.0f,%.0f" % (LAYER, WIDTH, h, x0, y0, x1, y1))

    print(u"  рамка: %.2f–%.2f с.ш., %.2f–%.2f в.д." %
          (BBOX["s"], BBOX["n"], BBOX["w"], BBOX["e"]))
    print(u"  размер: %d×%d, около %.0f м на пиксель" %
          (WIDTH, h, (x1 - x0) / WIDTH * math.cos(math.radians(65.05))))

    tmp = DST + ".part"
    r = subprocess.run(["curl", "-sSL", "--max-time", "300", "-A", UA, "-o", tmp, url],
                       capture_output=True)
    if r.returncode != 0 or not os.path.exists(tmp):
        sys.exit(u"не скачалось: " + (r.stderr or b"").decode("utf-8", "replace")[:200])

    head = io.open(tmp, "rb").read(400)
    if head[:2] != b"\xff\xd8":                    # не JPEG — значит пришла ошибка
        os.remove(tmp)
        sys.exit(u"сервер вернул не картинку:\n" + head.decode("utf-8", "replace")[:300])

    # Пережимаем: у WMS качество избыточное, а нам это класть на флешку
    ok = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "78",
                         tmp, "--out", DST], capture_output=True).returncode == 0
    os.remove(tmp)
    if not ok or not os.path.exists(DST):
        sys.exit(u"не удалось пережать")
    print(u"  готово: assets/map-satellite.jpg, %.1f МБ" % (os.path.getsize(DST) / 1048576.0))
    print(u"  источник: Sentinel-2 cloudless by EOX, CC BY 4.0 — подпись обязательна")


main()
