# -*- coding: utf-8 -*-
"""
Пополнение набора значков:  assets/icons.js

    python3 make_icons.py            # добавить недостающие из списка WANT
    python3 make_icons.py tabler:anchor tabler:fish     # добавить конкретные

НУЖНА СЕТЬ. На Соловках API Iconify недоступен — качайте заранее.
Источник: Iconify, набор Tabler Icons, лицензия MIT (https://tabler.io/icons).
Уже скачанные значки не перекачиваются.
"""
import io, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.realpath(__file__))
DST = os.path.join(os.path.dirname(HERE), "assets", "icons.js")

WANT = {
    "castle": "tabler:building-castle", "church": "tabler:building-church",
    "home": "tabler:home", "barracks": "tabler:building-warehouse",
    "factory": "tabler:building-factory", "wall": "tabler:wall",
    "tent": "tabler:tent", "lighthouse": "tabler:building-lighthouse",
    "tree": "tabler:trees", "fish": "tabler:fish", "wheat": "tabler:wheat",
    "flame": "tabler:flame", "pick": "tabler:pick", "tools": "tabler:tools",
    "hammer": "tabler:hammer", "paw": "tabler:paw",
    "cross": "tabler:cross", "medical": "tabler:medical-cross",
    "grave": "tabler:grave", "lock": "tabler:lock", "bed": "tabler:bed",
    "book": "tabler:book", "bell": "tabler:bell", "candle": "tabler:candle",
    "ship": "tabler:ship", "anchor": "tabler:anchor", "mountain": "tabler:mountain",
    "droplet": "tabler:droplet", "pin": "tabler:map-pin", "flag": "tabler:flag",
    "compass": "tabler:compass", "help": "tabler:help-circle", "star": "tabler:star",
}


def load():
    if not os.path.exists(DST):
        return {}
    m = re.search(r"window\.ICONS = (\{.*\});", io.open(DST, encoding="utf-8").read(), re.S)
    return json.loads(m.group(1)) if m else {}


def fetch(ident):
    for _ in range(2):
        try:
            svg = subprocess.check_output(
                ["curl", "-sS", "--max-time", "30",
                 "https://api.iconify.design/%s.svg" % ident.replace(":", "/")]).decode("utf-8")
            if svg.startswith("<svg"):
                return re.sub(r"\s+", " ", re.sub(r"^<svg[^>]*>|</svg>\s*$", "", svg).strip())
        except Exception:
            pass
    return None


def main():
    want = dict(WANT)
    for a in sys.argv[1:]:
        want[a.split(":")[-1].replace("-", "_")] = a
    icons, added, bad = load(), 0, []
    for name, ident in sorted(want.items()):
        if name in icons:
            continue
        body = fetch(ident)
        if body:
            icons[name] = body
            added += 1
        else:
            bad.append(name)
    with io.open(DST, "w", encoding="utf-8") as f:
        f.write(u"// Иконки Tabler Icons, лицензия MIT — https://tabler.io/icons\n")
        f.write(u"// Скачаны заранее: на Соловках API Iconify недоступен.\n")
        f.write(u"// Добавить новые: data/make_icons.py (нужна сеть).\n")
        f.write(u"window.ICONS = " + json.dumps(icons, ensure_ascii=False, indent=1,
                                                sort_keys=True) + ";\n")
    print(u"добавлено %d, всего %d, вес %.1f КБ" % (added, len(icons),
                                                    os.path.getsize(DST) / 1024.0))
    if bad:
        print(u"не скачались: %s" % ", ".join(bad))


if __name__ == "__main__":
    main()
