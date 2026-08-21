# -*- coding: utf-8 -*-
"""
Береговая линия Соловецкого архипелага -> assets/map-base.svg
и пересчёт x/y меток в places.csv из широт/долгот.

    python3 make_map.py

Исходник — osm-coastline.json, выгрузка OpenStreetMap (ODbL), лежит рядом.
Интернет не нужен: файл уже скачан. Перевыгрузить (нужна сеть):

    curl -G https://overpass-api.de/api/interpreter --data-urlencode \
      'data=[out:json][timeout:180];way["natural"="coastline"](64.88,35.30,65.28,36.40);out geom;' \
      -o osm-coastline.json

При публикации обязательна подпись: © участники OpenStreetMap.
"""
import csv, io, json, math, os, sys

HERE = os.path.dirname(os.path.realpath(__file__))
APP = os.path.dirname(HERE)
# Цвета зашиваются внутрь SVG: картинка подключается как <img>, и CSS до неё не достаёт.
# Поэтому собираем два файла — под тёмную и под светлую тему.
THEMES = {
    "map-base.svg":       {"sea": "#10161a", "land": "#232a2d",
                           "line": "#3d484c", "lake": "#1a2226"},
    "map-base-light.svg": {"sea": "#d3dcdd", "land": "#fbf8f1",
                           "line": "#a9b4b3", "lake": "#c2ced0"},
}

# Допуск упрощения задан мелким: на зуме 20x грубый контур разваливается
# в многоугольник. Единицы viewBox, вся карта — 100 единиц.
SIMPLIFY = 0.008
MIN_AREA = 0.0012     # мельче — не рисуем (луды и камни)
MIN_LAKE = 0.0008     # озёра мельче не рисуем: их сотни, и они не читаются
PAD = 0.0    # данные занимают лист целиком: иначе у материка виден обрубленный край

# Границы листа заданы явно, а не по тому, что вернул Overpass: линии берега
# приходят целиком и уходят далеко за запрошенную рамку. Западная кромка — чтобы
# уместился материковый берег у Кеми, восточная — сразу за Анзером.
BBOX = {"s": 64.80, "w": 34.40, "n": 65.30, "e": 36.40}

# Карта охватывает и архипелаг, и материковый берег у Кеми: пересыльный пункт
# должен стоять на земле, а не висеть в море. Заодно виден морской путь,
# которым заключённых везли на острова. Пропорции листа считаются по данным,
# квадрат тут не нужен.

sys.setrecursionlimit(20000)


def merc(lat, lon):
    """Меркатор. Точки за границами листа прижимаются к краю: то, что снаружи,
    всё равно не рисуется, а контур остаётся замкнутым."""
    lat = min(max(lat, BBOX["s"]), BBOX["n"])
    lon = min(max(lon, BBOX["w"]), BBOX["e"])
    return lon, math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def stitch(ways):
    """Отрезки берега -> замкнутые кольца, по совпадающим id узлов."""
    segs = [(w["nodes"], w["geometry"]) for w in ways if len(w.get("nodes", [])) > 1]
    start = {}
    for i, (nd, _) in enumerate(segs):
        start.setdefault(nd[0], []).append(i)
    used = [False] * len(segs)
    rings = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        cn, cg = list(segs[i][0]), list(segs[i][1])
        while True:
            nxt = None
            for j in start.get(cn[-1], []):
                if not used[j]:
                    nxt = j
                    break
            if nxt is None:
                break
            used[nxt] = True
            cn += segs[nxt][0][1:]
            cg += segs[nxt][1][1:]
            if cn[-1] == cn[0]:
                break
        rings.append((cn[0] == cn[-1], cn, cg))

    # Второй проход: сшиваем сами цепи. За один проход куски берега соединяются
    # не всегда: если продолжение уже израсходовано в другую цепь, она остаётся
    # оборванной посреди карты, и её край потом дорисовывается прямой линией.
    #
    # Обход начинаем только с НАСТОЯЩИХ начал — цепей, чьё первое звено не является
    # ничьим концом. Иначе всё решает порядок в файле: цепь, обработанная первой,
    # занимает место, и присоединиться к ней уже нельзя.
    closed = [r for r in rings if r[0]]
    opened = [(cn, cg) for cl, cn, cg in rings if not cl]
    start = {}
    tails = set()
    for i, (cn, _) in enumerate(opened):
        start.setdefault(cn[0], []).append(i)
        tails.add(cn[-1])
    used = [False] * len(opened)
    out = []

    def grow(i):
        used[i] = True
        cn, cg = list(opened[i][0]), list(opened[i][1])
        while cn[0] != cn[-1]:
            nxt = None
            for j in start.get(cn[-1], []):
                if not used[j]:
                    nxt = j
                    break
            if nxt is None:
                break
            used[nxt] = True
            cn += opened[nxt][0][1:]
            cg += opened[nxt][1][1:]
        out.append((cn[0] == cn[-1], cn, cg))

    for i, (cn, _) in enumerate(opened):      # сначала настоящие начала
        if not used[i] and cn[0] not in tails:
            grow(i)
    for i in range(len(opened)):              # затем всё, что осталось (кольца)
        if not used[i]:
            grow(i)
    rings = closed + out

    return [(cl, cg) for cl, cn, cg in rings]


def dp(p, tol):
    """Упрощение контура, Дуглас–Пекер."""
    if len(p) < 3:
        return p
    ax, ay = p[0]
    bx, by = p[-1]
    dx, dy = bx - ax, by - ay
    n = math.hypot(dx, dy)
    best, bi = -1.0, 0
    for i in range(1, len(p) - 1):
        px, py = p[i]
        d = abs(dx * (ay - py) - (ax - px) * dy) / n if n else math.hypot(px - ax, py - ay)
        if d > best:
            best, bi = d, i
    if best > tol:
        return dp(p[: bi + 1], tol)[:-1] + dp(p[bi:], tol)
    return [p[0], p[-1]]


def area(p):
    s = 0.0
    for i in range(len(p) - 1):
        s += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]
    return abs(s) / 2


def load(name):
    p = os.path.join(HERE, name)
    if not os.path.exists(p):
        return []
    return json.load(io.open(p, encoding="utf-8"))["elements"]


def main():
    ways = load("osm-coastline.json")
    rings = stitch(ways)

    # Озёра приходят замкнутыми контурами, сшивать не нужно
    lakes_raw = [w["geometry"] for w in load("osm-water.json")
                 if len(w.get("geometry", [])) > 3]

    x0, _ = merc(BBOX["s"], BBOX["w"])
    x1, _ = merc(BBOX["s"], BBOX["e"])
    _, y0 = merc(BBOX["s"], BBOX["w"])
    _, y1 = merc(BBOX["n"], BBOX["w"])
    W = 100.0
    scale = (W - 2 * PAD) / (x1 - x0)
    H = (y1 - y0) * scale + 2 * PAD

    def to_xy(lat, lon):
        """Координаты внутри viewBox 0..100 по ширине и 0..H по высоте."""
        mx, my = merc(lat, lon)
        return PAD + (mx - x0) * scale, PAD + (y1 - my) * scale

    def to_pct(lat, lon):
        """Проценты от габаритов картинки — в этом виде метки живут в places.csv."""
        x, y = to_xy(lat, lon)
        return x / W * 100.0, y / H * 100.0

    lands = []
    for is_closed, g in rings:
        p = dp([to_xy(q["lat"], q["lon"]) for q in g], SIMPLIFY)
        if not is_closed:
            # Береговая линия материка уходит за рамку выборки и остаётся разомкнутой.
            # Замыкаем её по краю листа: концы такой линии упираются в границу выборки,
            # значит суша продолжается за ней. Если оба конца у одного края — уводим
            # контур на сам край листа, тогда материк заливается до обреза, без
            # диагонального среза поперёк карты.
            # Короткие обрывки берега замыкать бессмысленно: получаются
            # прямоугольные заплаты у края листа. Оставляем только длинные линии —
            # то есть собственно материк.
            if len(p) < 60:
                continue
            # Страховка: если конец обрывка не на кромке листа, значит это не берег,
            # уходящий за рамку, а обрубок посреди карты. Дорисовывать его до края
            # нельзя — получится прямая линия поперёк суши.
            def to_edge(q):
                return min(q[0], W - q[0], q[1], H - q[1])
            if max(to_edge(p[0]), to_edge(p[-1])) > 1.0:
                continue
            # Уводим контур на боковой обрез листа с той стороны, где лежит суша,
            # и возвращаемся вдоль него: материк заливается до края, а не срезается
            # диагональю от одного конца линии к другому.
            # Замыкаем ЗА пределами листа: SVG обрежет лишнее по viewBox, и суша
            # уйдёт за обрез естественно, без прямых линий поперёк карты.
            # Из каждого конца сначала выходим перпендикулярно ближней кромке,
            # иначе получается диагональный клин через полкарты.
            M = 50.0
            def outside(q):
                d = min((q[1], "n"), (H - q[1], "s"), (q[0], "w"), (W - q[0], "e"))[1]
                return {"n": (q[0], -M), "s": (q[0], H + M),
                        "w": (-M, q[1]), "e": (W + M, q[1])}[d]
            mx = sum(q[0] for q in p) / len(p)
            side = -M if mx < W / 2 else W + M
            corners = [(side, H + M), (side, -M)]
            o_last, o_first = outside(p[-1]), outside(p[0])
            # ближний угол первым, чтобы обход шёл в одну сторону
            corners.sort(key=lambda c: (c[0] - o_last[0]) ** 2 + (c[1] - o_last[1]) ** 2)
            p = p + [o_last] + corners + [o_first, p[0]]
        a = area(p)
        if a >= MIN_AREA:
            lands.append((a, p))
    lands.sort(reverse=True, key=lambda t: t[0])

    lakes = []
    for g in lakes_raw:
        p = dp([to_xy(q["lat"], q["lon"]) for q in g], SIMPLIFY)
        if area(p) >= MIN_LAKE:
            lakes.append(p)

    def d_of(p):
        return "M%.2f %.2f " % p[0] + " ".join("L%.2f %.2f" % q for q in p[1:]) + " Z"

    # Одним элементом, а не по контуру на каждый: у соседних заливок одного цвета
    # на стыке остаётся волосяной шов от сглаживания. Внутри одного path его нет.
    paths = ['  <path class="land" d="%s"/>' % " ".join(d_of(p) for _, p in lands)]
    if lakes:
        paths.append('  <path class="lake" d="%s"/>' % " ".join(d_of(p) for p in lakes))
    out = None
    for fname, col in THEMES.items():
        svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 %.2f" preserveAspectRatio="xMidYMid meet">' % H,
            "  <!-- Береговая линия Соловецкого архипелага и материкового берега у Кеми.",
            "       Данные: OpenStreetMap, лицензия ODbL. Подпись обязательна.",
            "       Собрано make_map.py. Руками не править — правьте скрипт и пересоберите.",
            "       Пропорции листа считаются по данным. Метки в places.csv хранятся",
            "       в процентах от габаритов картинки, поэтому от пропорций не зависят. -->",
            "  <style>.sea{fill:%(sea)s}.land{fill:%(land)s}"
            ".lake{fill:%(lake)s}</style>" % col,
            '  <rect class="sea" width="100" height="%.2f"/>' % H,
        ] + paths + ["</svg>"]
        out = os.path.join(APP, "assets", fname)
        io.open(out, "w", encoding="utf-8").write(u"\n".join(svg) + u"\n")

    pc = os.path.join(HERE, "places.csv")
    rows = list(csv.DictReader(io.open(pc, encoding="utf-8")))
    fields = list(rows[0].keys())
    moved = 0
    for r in rows:
        if not (r.get("lat_approx") or "").strip():
            continue
        try:
            x, y = to_pct(float(r["lat_approx"]), float(r["lon_approx"]))
        except ValueError:
            continue
        r["x"], r["y"] = "%.1f" % x, "%.1f" % y
        moved += 1
    with io.open(pc, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    # Зоны с настоящими координатами проецируются тем же меркатором, что и берег:
    # тогда они привязаны к местности, а не к картинке, и переживают замену подложки.
    zpath = os.path.join(HERE, "zones.csv")
    zdone = 0
    if os.path.exists(zpath):
        zrows = list(csv.DictReader(io.open(zpath, encoding="utf-8")))
        if zrows:
            zf = list(zrows[0].keys())
            for r in zrows:
                geo = (r.get("geo") or "").strip()
                if not geo:
                    continue
                pts = []
                for pair in geo.split(";"):
                    pair = pair.strip()
                    if not pair:
                        continue
                    try:
                        la, lo = [float(v) for v in pair.split(",")]
                    except ValueError:
                        continue
                    x, y = to_pct(la, lo)
                    pts.append("%.2f,%.2f" % (x, y))
                if pts:
                    r["points"] = ";".join(pts)
                    r["shape"] = "poly"
                    zdone += 1
            with io.open(zpath, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=zf)
                w.writeheader()
                w.writerows(zrows)

    print(u"Контуров суши: %d, озёр: %d, лист 100x%.0f" % (len(lands), len(lakes), H))
    if zdone:
        print(u"Зон пересчитано из координат: %d" % zdone)
    print(u"SVG: %d файла по %.0f КБ (тёмный и светлый)" % (len(THEMES), os.path.getsize(out) / 1024.0))
    print(u"places.csv: пересчитано меток — %d" % moved)
    print(u"Дальше: cd .. && python3 build.py")


if __name__ == "__main__":
    main()
