# -*- coding: utf-8 -*-
"""
Сборка данных для интерактивной карты.

    persons.csv + places.csv + types.csv + photo-credits.csv  ->  data.js

ИСТОЧНИК ПРАВДЫ — persons.csv. Он правится в панели музея прямо в приложении,
поэтому пересборка его не трогает.

    python3 build.py              # обычная пересборка
    python3 build.py --import     # заново вычитать Excel музея в persons.csv

Ключ --import перезаписывает persons.csv данными из Spisok_po_mestam_3.xlsx.
Старый файл сохраняется рядом как persons.csv.bak. Пользоваться им нужно только
когда музей прислал обновлённую таблицу: все правки, сделанные в панели, пропадут.

Результат — data.js вида `window.DATA = {...}`. Именно .js, а не .json: страница
открывается с флешки по file://, а fetch() оттуда блокируется браузером (CORS).
"""
import csv
import hashlib
import io
import json
import os
import re
import sys
from collections import defaultdict

import openpyxl

HERE = os.path.dirname(os.path.realpath(__file__))
XLSX_NAME = "Spisok_po_mestam_3.xlsx"

# Листы Excel -> id места из places.csv
SHEET_TO_PLACE = {
    "1 отделение": "L01",
    "Кемь": "L03",
    "Анзер": "L04",
    "Савватьево": "L05",
    "Раб.городок": "L06",
    "Филимонова тоня": "L07",
    "Варварка": "L08",
    "Ник.лазарет ": "L09",
    "Заяцкий": "L10",
    "Муксолма ": "L11",
    "Белужье ": "L12",
    "пос.Филимоново": "L13",
    "Сельд.тоня": "L14",
    "Филип.пустынь": "L15",
}

# Признак строки с человеком: в ней упомянут сан
RE_SAN = re.compile(
    r"свящ|епископ|еп\.|архиеп|архепис|иеромон|игумен|архимандрит|протоир|протоиер"
    r"|протопресв|диакон|мон\.|монахин|митропол|архиер|сщмч|прмч|прп\.|псалом|иерей",
    re.I,
)


def norm(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip()


def key(surname):
    """Ключ сопоставления фамилий: регистр, ё/е, скобочные варианты."""
    s = surname.lower().replace(u"ё", u"е")
    s = re.sub(r"\s*\(.*?\)\s*", "", s)
    return s.strip()


def find_xlsx():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        return args[0]
    d = HERE
    for _ in range(5):
        p = os.path.join(d, XLSX_NAME)
        if os.path.exists(p):
            return p
        d = os.path.dirname(d)
    sys.exit(u"Не найден %s. Укажите путь: python3 build.py /путь/к/файлу.xlsx" % XLSX_NAME)


def read_settings():
    """Настройки киоска: пока только тема оформления. Правится в панели музея."""
    path = os.path.join(HERE, "settings.csv")
    out = {"theme": "light"}
    if not os.path.exists(path):
        return out
    with io.open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("key"):
                out[r["key"]] = r.get("value", "")
    return out


def read_types():
    """Вид метки по типу места: цвет и значок. Правится в types.csv или в панели музея."""
    path = os.path.join(HERE, "types.csv")
    if not os.path.exists(path):
        return []
    with io.open(path, encoding="utf-8") as f:
        return [dict(r) for r in csv.DictReader(f) if r.get("type")]


def read_credits():
    """Авторство и лицензии иллюстраций. Файла нет — подписей просто не будет."""
    path = os.path.join(HERE, "photo-credits.csv")
    if not os.path.exists(path):
        return {}
    out = {}
    with io.open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("id"):
                out[r["id"]] = {"author": r.get("author", ""),
                                "date": r.get("date", ""),
                                "license": r.get("license", ""),
                                "url": r.get("url", "")}
    return out


def read_places():
    path = os.path.join(HERE, "places.csv")
    with io.open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fields = list(reader.fieldnames or [])
    places = []
    for r in rows:
        places.append({
            "id": r["id"],
            "name": r["name_short"],
            "full": r["name_full"],
            "type": r["type"],
            "parent": r.get("parent", ""),   # место внутри места: лазарет внутри кремля
            "x": float(r["x"]),
            "y": float(r["y"]),
            "museumCount": int(r["persons_museum_count"] or 0),
            "note": r.get("note", ""),
            "about": r.get("about", ""),   # историческая справка, правится в places.csv
            "work": r.get("work", ""),     # род работ: лесоразработки, промысел, торфоразработки…
            # Полная исходная строка: по ней панель музея собирает places.csv обратно
            # без потери колонок, которых нет в интерфейсе (широта, долгота, статус).
            "raw": dict(r),
        })
    return places, fields


def read_persons(xlsx):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb[u"ВСЕ алф"]

    persons = []
    seen = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        name, surname = norm(row[1]), norm(row[2])
        if name.lower() == u"имя" and surname.lower() == u"фамилия":
            continue                      # строка-заголовок внутри листа
        if not (name or surname):
            continue
        # id считается от самих данных, а не от номера строки: при правке Excel
        # он не съедет, и привязанные к нему фотографии останутся на своих людях.
        base = u"|".join([surname.lower(), name.lower(), norm(row[3]).lower()])
        pid = "P" + hashlib.md5(base.encode("utf-8")).hexdigest()[:6]
        seen[pid] = seen.get(pid, 0) + 1
        if seen[pid] > 1:                 # полные тёзки в одном сане
            pid = "%s-%d" % (pid, seen[pid])
        persons.append({
            "id": pid,
            "name": name,
            "surname": surname,
            "rank": norm(row[3]),
            "years": norm(row[4]),
            "source": norm(row[5]),
            "places": [],
        })

    by_surname = defaultdict(list)
    for p in persons:
        if p["surname"]:
            by_surname[key(p["surname"])].append(p)

    unmatched = []
    for sheet, place_id in SHEET_TO_PLACE.items():
        if sheet not in wb.sheetnames:
            continue
        for row in wb[sheet].iter_rows(values_only=True):
            cells = [norm(c) for c in row]
            if not RE_SAN.search(" ".join(cells)):
                continue
            if any(c.lower() == u"фамилия" for c in cells):
                continue                  # строка-заголовок
            hit = None
            for c in cells:
                if key(c) in by_surname:
                    hit = by_surname[key(c)][0]
                    break
            if hit:
                if place_id not in hit["places"]:
                    hit["places"].append(place_id)
            else:
                unmatched.append((sheet, " | ".join(c for c in cells if c)[:100]))
    return persons, unmatched


GLOSSARY = [
    (u"СЛОН", u"Соловецкий лагерь особого назначения. Действовал на архипелаге в 1923–1933 годах."),
    (u"Командировка", u"Отдалённый участок лагеря с собственным начальством и работами — лесной, рыболовный, сельскохозяйственный."),
    (u"Тоня", u"Место промыслового лова рыбы на морском берегу и стан при нём."),
    (u"Скит", u"Небольшое монашеское поселение в отдалении от главного монастыря. В лагерное время скиты занимали под места заключения."),
    (u"Сан", u"Степень священства. По возрастанию: диакон, священник (иерей), протоиерей, епископ, архиепископ, митрополит."),
    (u"Сщмч.", u"Священномученик — священнослужитель, принявший мученическую смерть за веру."),
    (u"Прмч.", u"Преподобномученик — монах, принявший мученическую смерть за веру."),
    (u"Штрафной изолятор", u"Место содержания заключённых в наказание, с наиболее тяжёлыми условиями."),
]


PERSON_FIELDS = ["id", "name", "surname", "rank", "years_details", "source",
                 "places", "has_source", "has_place"]


def write_persons(persons):
    path = os.path.join(HERE, "persons.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(PERSON_FIELDS)
        for p in persons:
            w.writerow([p["id"], p["name"], p["surname"], p["rank"], p["years"],
                        p["source"], ";".join(p["places"]),
                        int(bool(p["source"])), int(bool(p["places"]))])


def read_persons_csv():
    """persons.csv — источник правды. Пусто или нет файла — вернём None."""
    path = os.path.join(HERE, "persons.csv")
    if not os.path.exists(path):
        return None
    out = []
    with io.open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r.get("id"):
                continue
            out.append({
                "id": r["id"],
                "name": r.get("name", ""),
                "surname": r.get("surname", ""),
                "rank": r.get("rank", ""),
                "years": r.get("years_details", ""),
                "source": r.get("source", ""),
                "places": [x for x in (r.get("places") or "").split(";") if x],
            })
    return out or None


def main():
    reimport = "--import" in sys.argv
    persons = None if reimport else read_persons_csv()
    unmatched = []

    if persons is None:
        xlsx = find_xlsx()
        if reimport and os.path.exists(os.path.join(HERE, "persons.csv")):
            import shutil
            shutil.copy(os.path.join(HERE, "persons.csv"),
                        os.path.join(HERE, "persons.csv.bak"))
            print(u"Прежний persons.csv сохранён как persons.csv.bak")
        persons, unmatched = read_persons(xlsx)
        write_persons(persons)
        print(u"Импорт из Excel: %s" % xlsx)
    else:
        print(u"Источник: persons.csv (правится в панели музея)")

    places, place_fields = read_places()

    placed = [p for p in persons if p["places"]]
    counts = defaultdict(int)
    for p in placed:
        for pl in p["places"]:
            counts[pl] += 1
    for pl in places:
        pl["count"] = counts.get(pl["id"], 0)

    data = {
        "credits": read_credits(),
        "settings": read_settings(),
        "types": read_types(),
        "meta": {
            "total": len(persons),
            "placed": len(placed),
            "unplaced": len(persons) - len(placed),
            "withSource": sum(1 for p in persons if p["source"]),
            "source": "persons.csv",
        },
        "places": places,
        "placeFields": place_fields,
        "persons": persons,
        "glossary": [{"term": t, "text": d} for t, d in GLOSSARY],
    }

    out = os.path.join(HERE, "data.js")
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(u"// Файл собран автоматически: python3 build.py\n")
        f.write(u"// Руками не править — правьте Excel и пересоберите.\n")
        f.write(u"window.DATA = ")
        f.write(json.dumps(data, ensure_ascii=False, indent=1))
        f.write(u";\n")

    m = data["meta"]
    print(u"Персон:     %d" % m["total"])
    print(u"  с местом: %d (%.0f%%)" % (m["placed"], 100.0 * m["placed"] / m["total"]))
    print(u"  без места:%d (%.0f%%)" % (m["unplaced"], 100.0 * m["unplaced"] / m["total"]))
    print(u"  с источн.:%d (%.0f%%)" % (m["withSource"], 100.0 * m["withSource"] / m["total"]))
    print(u"Мест:       %d" % len(places))
    print(u"Записано:   data.js, persons.csv")
    if unmatched:
        print(u"\nНЕ СОПОСТАВЛЕНО со списком «ВСЕ алф» — %d строк, разобрать вручную:" % len(unmatched))
        for sheet, text in unmatched:
            print(u"  [%s] %s" % (sheet, text))


if __name__ == "__main__":
    main()
