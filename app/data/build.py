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
from datetime import datetime
from collections import defaultdict

import openpyxl

HERE = os.path.dirname(os.path.realpath(__file__))
XLSX_NAME = "Spisok_po_mestam_3.xlsx"

# Листы Excel -> id места из places.csv
# Листы Excel -> id места из places.csv.
#
# Названия листов приведены в точности, включая хвостовые пробелы: «Секирная »
# и «Муксалма » в файле музея именно такие.
#
# Правка 26.08.2026: листы «Раб.городок», «Ник.лазарет» и «Сельд.тоня» из
# таблицы исчезли, «Муксолма» переименована в «Муксалма», появились «Секирная»
# и «Кирп.завод».
#
# «Раб.городок» и «Сельд.тоня» убраны и отсюда: сами места удалены из
# places.csv по решению заказчика — на карте они стояли метками, за которыми
# нет ни одного человека. «Ник.лазарет» оставлен: место осталось, оно вложено
# в Кремль и отдельной меткой не рисуется.
#
# «Неизвестно где» здесь НЕ значится, и это осознанно: 211 человек с этого
# листа попадают в реестр без точки на карте — ровно то, что музей и имел в виду.
SHEET_TO_PLACE = {
    "1 отделение": "L01",
    "Секирная ": "L02",
    "Кемь": "L03",
    "Анзер": "L04",
    "Савватьево": "L05",

    "Филимонова тоня": "L07",
    "Варварка": "L08",
    "Ник.лазарет ": "L09",
    "Заяцкий": "L10",
    "Муксалма ": "L11",
    "Муксолма ": "L11",
    "Белужье ": "L12",
    "пос.Филимоново": "L13",

    "Филип.пустынь": "L15",
    "Кирп.завод": "L19",
}

# Лист «Цифры» — собственный учёт музея по местам. Подписи там свои,
# не совпадающие с именами листов, и с опечатками («Филомоново»).
#
# Числа нужны не для красоты: расхождение с тем, что реально расписано
# по фамилиям, показывает, где список неполон. На 29.08.2026 девять мест
# из тринадцати сходятся точь-в-точь, четыре разошлись на 11 человек —
# и ровно там сидят люди, которых нет в «ВСЕ алф», и неразличимые однофамильцы.
COUNT_TO_PLACE = {
    u"1-ое отделение": "L01", u"секирная": "L02", u"кемь": "L03",
    u"анзер": "L04", u"савватьево": "L05", u"филимонова тоня": "L07",
    u"варварка": "L08", u"заяцкий": "L10", u"муксалма": "L11",
    u"белужье": "L12", u"пос.филомоново": "L13", u"пос.филимоново": "L13",
    u"филип.пустынь": "L15", u"кирпичный завод": "L19",
}


def read_counts(wb):
    """Учёт музея с листа «Цифры»: id места -> число."""
    out = {}
    if u"Цифры" not in wb.sheetnames:
        return out
    for row in wb[u"Цифры"].iter_rows(values_only=True):
        cells = [norm(c) for c in row]
        label = num = None
        for c in cells:
            if not c:
                continue
            if c.isdigit():
                num = int(c)
            elif label is None:
                label = c
        pid = COUNT_TO_PLACE.get((label or "").lower().replace(u"ё", u"е"))
        if pid and num is not None:
            out[pid] = num
    return out


def write_counts(counts):
    """Переписывает только колонку persons_museum_count, остальное не трогая.
    Места, которых в «Цифрах» нет, получают 0: их листы из таблицы исчезли."""
    path = os.path.join(HERE, "places.csv")
    rows = list(csv.reader(io.open(path, encoding="utf-8")))
    head = rows[0]
    if "persons_museum_count" not in head:
        return 0
    i = head.index("persons_museum_count")
    n = 0
    for r in rows[1:]:
        was = r[i]
        r[i] = str(counts.get(r[0], 0))
        if r[i] != was:
            n += 1
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(rows)
    return n


# Заголовки групп в столбце А листов мест. С правки от 26.08.2026 сан
# указывается ОДИН раз на группу, а строки под ним содержат только номер,
# имя и фамилию:
#
#     Священники | 3 | 1 | Дионисий   | Александров |
#                | 4 | 2 | Константин | Безсонов    |
#
# Прежний код искал сан в каждой строке и потому брал из группы только
# первого. На «Савватьеве» из 23 человек проходили четверо.
#
# Сан для карточки всё равно берётся из листа «ВСЕ алф», здесь группы нужны
# лишь чтобы отличить заголовок от фамилии и не принять «Миряне» за человека.
GROUP_WORDS = {
    u"архиереи", u"архиепископы", u"епископы", u"митрополиты",
    u"архимандриты", u"игумены", u"иеромонахи", u"иеродиаконы",
    u"протоиереи", u"протопресвитеры", u"священники", u"иереи",
    u"диаконы", u"протодиаконы", u"иподиаконы",
    u"монахи", u"монахини", u"монахи/монахини", u"схимонахи",
    u"послушники", u"псаломщики", u"миряне", u"мирянки",
}


def is_group(c):
    return c.lower().strip().rstrip(":").replace(u"ё", u"е") in GROUP_WORDS


# Сан для тех, кого приходится заводить с листа места: в группе он во
# множественном числе, а в карточке нужен в единственном.
GROUP_RANK = {
    u"архиереи": u"архиерей", u"архиепископы": u"архиепископ",
    u"епископы": u"епископ", u"митрополиты": u"митрополит",
    u"архимандриты": u"архимандрит", u"игумены": u"игумен",
    u"иеромонахи": u"иеромонах", u"иеродиаконы": u"иеродиакон",
    u"протоиереи": u"протоиерей", u"протопресвитеры": u"протопресвитер",
    u"священники": u"священник", u"иереи": u"иерей",
    u"диаконы": u"диакон", u"протодиаконы": u"протодиакон",
    u"иподиаконы": u"иподиакон",
    u"монахи": u"монах", u"монахини": u"монахиня",
    u"монахи/монахини": u"монашествующий", u"схимонахи": u"схимонах",
    u"послушники": u"послушник", u"псаломщики": u"псаломщик",
    u"миряне": u"мирянин", u"мирянки": u"мирянка",
}


# Уточнения к сану: священномученик, преподобномученик, исповедник и прочее.
# Стоят в отдельной ячейке и часто в скобках.
RE_QUAL = re.compile(
    r"^(сщмч|прмч|прп|мч|мц|прмц|священноисповедник|исповедник|"
    r"священномученик|преподобномученик|новомученик)$", re.I)


def group_rank(c):
    return GROUP_RANK.get(c.lower().strip().rstrip(":").replace(u"ё", u"е"), "")


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


# Правки, подтверждённые музеем. Живут здесь, а не в Excel: исходник —
# файл заказчика, править его мы не вправе, а без этих поправок каждый
# --import возвращал бы ошибку обратно.
CONFIRMED = [
    # Отчество Кирилла Оегостурова: на «Секирной» он Викентьевич, на
    # «Савватьеве» Лавреньевич. Музей 26.08.2026 подтвердил — Лаврентьевич.
    (u"Оегостуров", {"name": u"Кирилл Лаврентьевич"}),
]


def apply_confirmed(persons):
    for p in persons:
        for surname, fix in CONFIRMED:
            if p["surname"].strip().lower() == surname.lower():
                p.update(fix)
    return persons


def nkey(name):
    """Ключ имени: регистр и ё/е. «Пётр» и «Петр» — один человек."""
    return name.lower().replace(u"ё", u"е").strip()


def key(surname):
    """Ключ сопоставления фамилий: регистр, ё/е, скобки.

    Скобки в этой таблице значат две разные вещи, и путать их нельзя:

      «Кремышенский (Кремышанский)» — в скобках ВАРИАНТ написания, его
          отбрасываем и сопоставляем по основной форме;

      «(Троицкий)» — в скобках ВСЯ фамилия. Так по церковной традиции
          записывают мирскую фамилию монашествующего: он при постриге
          получил новое имя, а фамилия ушла в скобки. Её надо оставить.

    Прежняя версия вырезала любые скобки и от «(Троицкий)» не оставляла
    ничего. На таблице от 26.08.2026 это стоило 73 непривязанных строк —
    почти всех епископов и архиепископов.
    """
    s = surname.lower().replace(u"ё", u"е").strip()
    m = re.match(r"^\(([^)]*)\)?$", s)      # скобка может быть и не закрыта: «(Руднев»
    if m:
        return m.group(1).strip()
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


def read_glossary():
    """Словарь терминов. Вынесен в таблицу, чтобы музей правил его сам."""
    path = os.path.join(HERE, "glossary.csv")
    if not os.path.exists(path):
        return []
    with io.open(path, encoding="utf-8") as f:
        return [{"term": r.get("term", ""), "text": r.get("text", ""),
                 "term_en": r.get("term_en", ""), "text_en": r.get("text_en", "")}
                for r in csv.DictReader(f) if r.get("term")]


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


def read_zones():
    """Зоны работ: мягкие эллипсы поверх карты, цвет берётся от типа.

    Геометрия хранится в процентах от габаритов подложки — так же, как метки,
    поэтому от замены карты и от пропорций экрана не зависит.
    Две формы:
      shape=ellipse — пятно, задаётся x/y/rx/ry. Быстро, для схематичной разметки.
      shape=poly    — многоугольник, задаётся points: «x,y;x,y;…» в процентах.

    Колонка geo — те же вершины в широте и долготе: «lat,lon;lat,lon;…».
    Если она заполнена, make_map.py пересчитывает из неё points тем же
    меркатором, каким проецируется береговая линия. Тогда зона привязана
    к местности, а не к картинке, и переживает замену подложки.
    """
    path = os.path.join(HERE, "zones.csv")
    if not os.path.exists(path):
        return []
    out = []
    with io.open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if not r.get("id"):
                continue
            pts = []
            for pair in (r.get("points") or "").split(";"):
                pair = pair.strip()
                if not pair:
                    continue
                try:
                    a, bb = pair.split(",")
                    pts.append([round(float(a), 2), round(float(bb), 2)])
                except ValueError:
                    continue
            try:
                out.append({
                    "id": r["id"], "type": r.get("type", ""), "label": r.get("label", ""),
                    "shape": (r.get("shape") or "ellipse").strip(),
                    "x": float(r.get("x") or 50), "y": float(r.get("y") or 50),
                    "rx": float(r.get("rx") or 8), "ry": float(r.get("ry") or 8),
                    "points": pts,
                    "geo": (r.get("geo") or "").strip(),
                    "note": r.get("note", ""),
                })
            except ValueError:
                continue
    return out


def read_types():
    """Справочник видов: цвет и значок.

    Колонка kind разводит две разные таксономии: place — типы мест
    (отделение, командировка, лазарет), zone — виды работ по легенде
    карты-схемы музея (лесоразработки, промысел, торфоразработки).
    Смешивать их нельзя: это ответы на разные вопросы.
    """
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
            "name_en": r.get("name_en", ""),
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


def known_places():
    """Идентификаторы мест, которые есть в places.csv.

    Нужны, чтобы импорт не привязал человека к месту, которого больше нет.
    Так уже могло случиться: 29.08.2026 из places.csv удалили три места
    без единого человека — Никольский лазарет, Голгофу и Троицкий скит, —
    а SHEET_TO_PLACE по-прежнему сопоставляет лист «Ник.лазарет» с L09.
    Пока по этому листу никто не опознаётся, и ссылок не возникло, но
    молчаливая ссылка в никуда — это ровно та ошибка, которую замечают
    в зале, а не при импорте.
    """
    path = os.path.join(HERE, "places.csv")
    with io.open(path, encoding="utf-8") as f:
        return {r["id"] for r in csv.DictReader(f) if r.get("id")}


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

    # Индексируем и основную форму, и вариант из скобок: в «ВСЕ алф» стоит
    # «Кремышенский (Кремышанский)», а на листах мест — «Кремышанский».
    # По одной основной форме такой человек не находился.
    # Люди без фамилии вообще: архиерей Иустин на Анзере, священник Спиридон
    # на Филимоновой тоне. Музей подтвердил, что фамилий нет и заносить надо
    # как есть. По фамилии их не найти, поэтому отдельный индекс по имени.
    by_name = defaultdict(list)
    for p in persons:
        if not p["surname"] and p["name"]:
            by_name[nkey(p["name"])].append(p)

    by_surname = defaultdict(list)
    for p in persons:
        if not p["surname"]:
            continue
        forms = {key(p["surname"])}
        for var in re.findall(r"\(([^)]+)\)", p["surname"]):
            forms.add(key(var))
        for f in forms:
            if f:
                by_surname[f].append(p)

    unmatched = []
    known = known_places()
    skipped = sorted({(s, p) for s, p in SHEET_TO_PLACE.items()
                      if p not in known and s in wb.sheetnames})
    for sheet, place_id in SHEET_TO_PLACE.items():
        if sheet not in wb.sheetnames:
            continue
        if place_id not in known:
            continue          # место удалено из places.csv — привязывать не к чему
        group = ""                                    # текущий заголовок группы
        for row in wb[sheet].iter_rows(values_only=True):
            cells = [norm(c) for c in row]
            if not any(cells):
                continue
            for c in cells:
                if is_group(c):
                    group = c
                    break
            low = [c.lower() for c in cells]
            if u"фамилия" in low or u"имя" in low:
                continue                              # шапка внутри листа
            words_all = [c for c in cells if c and not c.isdigit() and not is_group(c)]
            hit = None
            for c in words_all:
                k = key(c)
                if not k or k not in by_surname:
                    continue
                cand = by_surname[k]
                if len(cand) == 1:
                    hit = cand[0]
                    break
                # Однофамильцы. Рудневых в списке трое — Евгений, Пётр и Платон,
                # и все трое встречаются на листах мест. Брать первого попавшегося
                # значит приписать человека к чужому месту, а это в мемориальной
                # экспозиции прямая фактическая ошибка. Различаем по имени.
                # Сравниваем по первому слову имени: на листах мест пишут
                # «Анатолий Сергеевич», в алфавитном — просто «Анатолий».
                names = {nkey(x).split()[0] for x in words_all if nkey(x).split()}
                exact = [p for p in cand
                         if nkey(p["name"]).split() and nkey(p["name"]).split()[0] in names]
                if len(exact) == 1:
                    hit = exact[0]
                    break
                unmatched.append((sheet, u"ОДНОФАМИЛЬЦЫ (%d), не различить: %s"
                                  % (len(cand), " | ".join(cells).strip(" |")[:70])))
                hit = "ambiguous"
                break
            if hit == "ambiguous":
                continue

            # Безфамильный: ищем по имени среди тех, у кого фамилии нет
            if not hit:
                for c in words_all:
                    cand = by_name.get(nkey(c)) or []
                    if len(cand) == 1:
                        hit = cand[0]
                        break
            if hit:
                if place_id not in hit["places"]:
                    hit["places"].append(place_id)
                continue
            # Не опознали. Похоже ли это вообще на строку человека? Заголовок
            # группы и название листа — не люди, о них молчим.
            words = [c for c in cells if c and not c.isdigit() and not is_group(c)]
            if len(words) < 2:
                continue

            # Человек есть на листе места, но его нет в «ВСЕ алф». Это дефект
            # таблицы музея, и таких 14. Молча терять задокументированных людей
            # из мемориальной экспозиции нельзя, поэтому заводим их отсюда —
            # с пометкой, откуда взяты, чтобы музей увидел и подтвердил.
            nm, rest = words[0], words[1:]
            rank = group_rank(group)

            # Фамилия — первая словесная ячейка после имени, но только если это
            # не сам сан: у архиерея Иустина на Анзере фамилии нет вовсе, и без
            # проверки «архиерей» попадал бы в фамилию.
            fam = ""
            if rest and not (RE_SAN.search(rest[0]) and len(rest[0]) < 24):
                fam = rest[0]
                rest = rest[1:]
            elif rest:
                rank = rest[0]
                rest = rest[1:]

            # «(сщмч.)», «(священноисповедник)» — это не сан, а уточнение к нему.
            # Само по себе оно человека не описывает, поэтому приписывается
            # к сану из группы, а не заменяет его.
            qual = ""
            for c in rest:
                bare = c.strip("() ").rstrip(".")
                if RE_QUAL.match(bare):
                    qual = bare
                elif not rank and RE_SAN.search(c) and len(c) < 24:
                    rank = c
            if qual:
                rank = (rank + " " + qual).strip()

            fam = fam.strip()
            m = re.match(r"^\(([^)]*)\)?$", fam)      # мирская фамилия монаха
            if m:
                fam = m.group(1).strip()
            base = u"|".join([fam.lower(), nm.lower(), rank.lower()])
            pid = "P" + hashlib.md5(base.encode("utf-8")).hexdigest()[:6]
            while pid in {p["id"] for p in persons}:
                pid += "x"
            p = {
                "id": pid, "name": nm, "surname": fam, "rank": rank,
                "years": "", "source": "", "places": [place_id],
                "note": u"взят с листа «%s»: в алфавитном списке музея отсутствует" % sheet,
            }
            persons.append(p)
            for f in {key(fam)}:
                if f:
                    by_surname[f].append(p)
            unmatched.append((sheet, " | ".join(c for c in cells if c)[:100]))
    return apply_confirmed(persons), unmatched, skipped


# name_en и rank_en — путь переопределения машинной транслитерации.
# Пусто (обычное состояние) — приложение транслитерирует само по BGN/PCGN.
# Заполнено — берётся написание музея: у них могут быть свои формы имён
# новомучеников, принятые в их изданиях. Через --import колонки обнуляются
# вместе со всем остальным, это уже описано выше.
PERSON_FIELDS = ["id", "name", "surname", "rank", "years_details", "source",
                 "places", "year_from", "year_to", "has_source", "has_place",
                 "name_en", "rank_en", "note"]

# Годы в графе «годы и обстоятельства» записаны свободным текстом:
# «1927-1934гг.», «с 1930-1933», «на зиму 1927-1928гг». Вытаскиваем все
# четырёхзначные числа в пределах лагерного времени и берём размах.
# Разбираем ТОЛЬКО эту графу: в графе источника стоят страницы и годы изданий.
RE_YEAR = re.compile(r"(19[2-3][0-9]|194[0-5])")


def years_of(text):
    ys = [int(y) for y in RE_YEAR.findall(text or "")]
    ys = [y for y in ys if 1920 <= y <= 1940]
    return (min(ys), max(ys)) if ys else ("", "")


def write_persons(persons):
    path = os.path.join(HERE, "persons.csv")
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(PERSON_FIELDS)
        for p in persons:
            yf, yt = years_of(p["years"])
            w.writerow([p["id"], p["name"], p["surname"], p["rank"], p["years"],
                        p["source"], ";".join(p["places"]), yf, yt,
                        int(bool(p["source"])), int(bool(p["places"])),
                        p.get("name_en", ""), p.get("rank_en", ""),
                        p.get("note", "")])


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
                "name_en": r.get("name_en", ""),
                "rank_en": r.get("rank_en", ""),
                "note": r.get("note", ""),
            })
    return out or None


def jpeg_size(path):
    """Размеры JPEG без сторонних библиотек: читаем маркер кадра.

    Нужны, чтобы карточка отвела место под снимок ЗАРАНЕЕ. Иначе галерея
    сначала пустая, потом появляется картинка, и всё содержимое карточки
    уезжает вниз рывком — на 478 пикселей у Кремля.
    """
    try:
        with io.open(path, "rb") as f:
            if f.read(2) != b"\xff\xd8":
                return None
            while True:
                b = f.read(1)
                while b and b != b"\xff":
                    b = f.read(1)
                m = f.read(1)
                while m == b"\xff":
                    m = f.read(1)
                if not m:
                    return None
                # SOF0..SOF15, кроме DHT(c4), JPG(c8) и DAC(cc)
                if 0xC0 <= m[0] <= 0xCF and m[0] not in (0xC4, 0xC8, 0xCC):
                    f.read(3)                       # длина и точность
                    h = int.from_bytes(f.read(2), "big")
                    w = int.from_bytes(f.read(2), "big")
                    return (w, h)
                ln = int.from_bytes(f.read(2), "big")
                if ln < 2:
                    return None
                f.seek(ln - 2, 1)
    except Exception:
        return None


def read_gallery():
    """Опись снимков: id -> [[ширина, высота], ...] в порядке показа.

    Имена по соглашению: L01.jpg, L01-2.jpg, L01-3.jpg. Опись обрывается
    на первом пропуске — так же, как их перебирает приложение.

    Приложение всё равно продолжает проверять файлы после последнего
    известного: снимок, положенный в папку без пересборки, покажется —
    просто с прежним рывком. Это осознанно: в инструкции музею написано
    «положите файл, приложение подхватит само», и ломать это нельзя.
    """
    out = {}
    for d in ("photos", "places"):
        folder = os.path.join(os.path.dirname(HERE), "assets", d)
        if not os.path.isdir(folder):
            continue
        names = {f[:-4] for f in os.listdir(folder) if f.endswith(".jpg")}
        ids = sorted({n.split("-")[0] for n in names})
        got = {}
        for pid in ids:
            sizes, i = [], 1
            while True:
                name = pid if i == 1 else "%s-%d" % (pid, i)
                if name not in names:
                    break
                wh = jpeg_size(os.path.join(folder, name + ".jpg"))
                sizes.append(list(wh) if wh else [0, 0])
                i += 1
            if sizes:
                got[pid] = sizes
        out[d] = got
    return out


def stamp_index():
    """Дописывает метку времени к ссылке на data.js в index.html.

    Браузер кэширует файлы и по протоколу file:// тоже. Сотрудник музея
    сохраняет правки, обновляет страницу — и видит прежние данные, потому
    что data.js взят из кэша. Понять причину без опыта невозможно: файл
    на диске новый, а на экране старое.

    Поэтому в ссылку подставляется время сборки. Путь меняется — кэш
    промахивается — данные всегда свежие. Тот же приём для style.css
    и app.js: их правим мы, и та же ловушка ждёт при показе заказчику.
    """
    path = os.path.join(os.path.dirname(HERE), "index.html")
    if not os.path.exists(path):
        return
    with io.open(path, encoding="utf-8") as f:
        html = f.read()
    v = datetime.now().strftime("%Y%m%d%H%M%S")
    out = re.sub(r'(src|href)="((?:data/data\.js|css/style\.css|js/app\.js|js/lang\.js))(?:\?v=\d+)?"',
                 lambda m: '%s="%s?v=%s"' % (m.group(1), m.group(2), v), html)
    if out != html:
        with io.open(path, "w", encoding="utf-8", newline="") as f:
            f.write(out)


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
        persons, unmatched, skipped = read_persons(xlsx)
        for sheet, pid in skipped:
            print(u"Лист «%s» пропущен: места %s нет в places.csv" % (sheet, pid))
        write_persons(persons)
        wbc = openpyxl.load_workbook(xlsx, data_only=True)
        changed = write_counts(read_counts(wbc))
        if changed:
            print(u"Учёт музея с листа «Цифры»: обновлено мест — %d" % changed)
        print(u"Импорт из Excel: %s" % xlsx)
    else:
        print(u"Источник: persons.csv (правится в панели музея)")
        # Файл, собранный прежней версией, не знает про name_en/rank_en.
        # Дописываем колонки круговым обходом: всё, что read_persons_csv
        # читает, write_persons тем же и пишет — потерять нечего.
        with io.open(os.path.join(HERE, "persons.csv"), encoding="utf-8") as f:
            head = f.readline()
        if "name_en" not in head or "note" not in head:
            write_persons(persons)
            print(u"В persons.csv добавлены пустые колонки name_en и rank_en")

    places, place_fields = read_places()

    placed = [p for p in persons if p["places"]]
    counts = defaultdict(int)
    for p in placed:
        for pl in p["places"]:
            counts[pl] += 1
    for pl in places:
        pl["count"] = counts.get(pl["id"], 0)

    for p in persons:
        yf, yt = years_of(p["years"])
        p["y0"], p["y1"] = yf, yt

    data = {
        "credits": read_credits(),
        "gallery": read_gallery(),
        "settings": read_settings(),
        "types": read_types(),
        "zones": read_zones(),
        "meta": {
            "total": len(persons),
            "placed": len(placed),
            "unplaced": len(persons) - len(placed),
            "withSource": sum(1 for p in persons if p["source"]),
            "withYears": sum(1 for p in persons if p["y0"]),
            "source": "persons.csv",
        },
        "places": places,
        "placeFields": place_fields,
        "persons": persons,
        "glossary": read_glossary(),
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
    stamp_index()
    print(u"Записано:   data.js, persons.csv (+ метка версии в index.html)")
    # Копии снимков для сайта: карточка и миниатюры по сети без оригиналов
    import make_web_photos
    make_web_photos.run()
    if unmatched:
        print(u"\nНЕ СОПОСТАВЛЕНО со списком «ВСЕ алф» — %d строк, разобрать вручную:" % len(unmatched))
        for sheet, text in unmatched:
            print(u"  [%s] %s" % (sheet, text))


if __name__ == "__main__":
    main()
