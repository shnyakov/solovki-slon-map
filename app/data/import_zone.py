# -*- coding: utf-8 -*-
"""
Импорт зоны с настоящими координатами в zones.csv.

    python3 import_zone.py контур.geojson --label "Лесоразработки" --type лесоразработки
    python3 import_zone.py трек.gpx      --label "Торфоразработки" --type торфоразработки
    python3 import_zone.py 65.09,35.66 65.10,35.70 65.08,35.71 --label "Проба"

Принимает GeoJSON (Polygon, MultiPolygon, LineString или FeatureCollection),
GPX-трек либо пары «широта,долгота» прямо в аргументах.

Записывает вершины в колонку geo. Дальше:

    python3 make_map.py     # пересчитает geo в проценты тем же меркатором,
                            # каким проецируется береговая линия
    python3 build.py

Смысл колонки geo: зона привязана к местности, а не к картинке. Заменили
подложку — зона осталась на месте. Правка контура мышью колонку очищает:
руками подвинутая вершина к координатам уже не привязана.
"""
import csv, io, json, os, re, sys

HERE = os.path.dirname(os.path.realpath(__file__))
DST = os.path.join(HERE, "zones.csv")
FIELDS = ["id", "type", "label", "shape", "x", "y", "rx", "ry", "points", "geo", "note"]


def from_geojson(path):
    d = json.load(io.open(path, encoding="utf-8"))
    out = []

    def walk(g):
        t = g.get("type")
        if t == "FeatureCollection":
            for f in g["features"]:
                walk(f)
        elif t == "Feature":
            walk(g["geometry"])
        elif t == "Polygon":
            out.extend(g["coordinates"][0])
        elif t == "MultiPolygon":
            out.extend(g["coordinates"][0][0])
        elif t == "LineString":
            out.extend(g["coordinates"])
    walk(d)
    return [(c[1], c[0]) for c in out]        # GeoJSON хранит долготу первой


def from_gpx(path):
    t = io.open(path, encoding="utf-8").read()
    return [(float(a), float(b)) for a, b in
            re.findall(r'lat="([-\d.]+)"\s+lon="([-\d.]+)"', t)]


def from_args(args):
    out = []
    for a in args:
        try:
            la, lo = [float(v) for v in a.split(",")]
            out.append((la, lo))
        except ValueError:
            pass
    return out


def main():
    args = sys.argv[1:]
    opt = {}
    rest = []
    i = 0
    while i < len(args):
        if args[i].startswith("--") and i + 1 < len(args):
            opt[args[i][2:]] = args[i + 1]
            i += 2
        else:
            rest.append(args[i])
            i += 1

    pts = []
    if rest and os.path.exists(rest[0]):
        src = rest[0]
        pts = from_geojson(src) if src.lower().endswith((".json", ".geojson")) else from_gpx(src)
    else:
        pts = from_args(rest)

    if len(pts) < 3:
        sys.exit(u"Нужно не меньше трёх точек. Получено: %d" % len(pts))

    rows = []
    if os.path.exists(DST):
        rows = [dict(r) for r in csv.DictReader(io.open(DST, encoding="utf-8"))]
    n = 1
    used = {r["id"] for r in rows}
    while ("Z%d" % n) in used:
        n += 1

    rows.append({
        "id": opt.get("id", "Z%d" % n),
        "type": opt.get("type", ""),
        "label": opt.get("label", u"Импортированная зона"),
        "shape": "poly", "x": "50", "y": "50", "rx": "8", "ry": "6",
        "points": "",
        "geo": ";".join("%.6f,%.6f" % p for p in pts),
        "note": opt.get("note", u"импортировано из %s" % (rest[0] if rest else u"аргументов")),
    })
    with io.open(DST, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    print(u"Зона %s добавлена, вершин: %d" % (rows[-1]["id"], len(pts)))
    print(u"Дальше: python3 make_map.py && python3 build.py")


if __name__ == "__main__":
    main()
