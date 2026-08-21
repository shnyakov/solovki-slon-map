# -*- coding: utf-8 -*-
"""Собирает просмотр.html из всех знаков в этой папке. python3 make_preview.py"""
import glob, io, os, re

HERE = os.path.dirname(os.path.realpath(__file__))
NAMES = {
    "01-krest": (u"Соловецкий крест", u"Прямая отсылка к теме. Самый уместный и самый обязывающий: знак читается как церковный, а музей — светское учреждение."),
    "02-sekirnaya": (u"Секирная", u"Церковь-маяк на Секирной горе. Узнаваемый силуэт именно лагерной истории, а не монастырской."),
    "03-ostrov": (u"Остров и метка", u"Про способ подачи: карта и точка на ней. Нейтрально, без религиозной символики."),
    "04-imena": (u"Имена", u"Девять точек, три закрашены — 33 %, та самая доля, в какой известно место пребывания: 124 человека из 411. Знак говорит о главном свойстве материала: о большинстве судеб мы не знаем, где они прошли."),
    "05-more": (u"Крест над морем", u"Белое море, которым везли на острова, и вера над ним. Мягче прямого креста."),
    "06-bashnya": (u"Башня кремля", u"Соловецкий кремль. Узнаваемо, но говорит о монастыре, а не об экспозиции."),
}

def body(path):
    t = io.open(path, encoding="utf-8").read()
    t = re.sub(r"<\?xml.*?\?>", "", t)
    return re.sub(r'\s(width|height)="[^"]*"', "", t).strip()

def main():
    files = sorted(f for f in glob.glob(os.path.join(HERE, "*.svg")))
    cards = []
    for f in files:
        key = os.path.splitext(os.path.basename(f))[0]
        title, note = NAMES.get(key, (key, ""))
        svg = body(f)
        cards.append(u'''<article class="card">
  <div class="row">
    <span class="m m--64">%s</span>
    <span class="m m--40">%s</span>
    <span class="m m--24">%s</span>
    <span class="m m--16">%s</span>
  </div>
  <h2>%s</h2>
  <p class="file">%s.svg</p>
  <p class="note">%s</p>
  <div class="lock"><span class="m m--28">%s</span>
    <span class="lock__t"><b>Испытание веры</b><small>Век ХХ · места заключения священнослужителей</small></span>
  </div>
</article>''' % (svg, svg, svg, svg, title, key, note, svg))

    html = u'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Знаки проекта — просмотр</title>
<style>
:root{--bg:#f5f2ec;--ink:#1b2022;--dim:#5d686b;--line:#ddd5c7;--accent:#8a672c}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:var(--bg);color:var(--ink);
     font:16px/1.5 system-ui,"Segoe UI",-apple-system,sans-serif}
h1{font:400 30px/1.2 Georgia,serif;margin:0 0 4px}
.lead{color:var(--dim);margin:0 0 28px;max-width:52em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
.card{border:1px solid var(--line);border-radius:10px;padding:18px;background:#fff}
.row{display:flex;align-items:flex-end;gap:18px;color:var(--accent);
     padding:14px 0 18px;border-bottom:1px solid var(--line);margin-bottom:14px}
.m{display:inline-flex}
.m--64 svg{width:64px;height:64px}.m--40 svg{width:40px;height:40px}
.m--28 svg{width:28px;height:28px}.m--24 svg{width:24px;height:24px}
.m--16 svg{width:16px;height:16px}
h2{font:400 19px/1.2 Georgia,serif;margin:0 0 2px}
.file{margin:0 0 8px;font:12px/1 ui-monospace,Menlo,monospace;color:var(--dim)}
.note{margin:0 0 14px;font-size:14px;color:var(--dim)}
.lock{display:flex;align-items:center;gap:10px;color:var(--accent);
      border-top:1px solid var(--line);padding-top:12px}
.lock__t b{display:block;font:400 16px/1.15 Georgia,serif;color:var(--ink)}
.lock__t small{display:block;font-size:11px;color:var(--dim)}
.dark{margin-top:32px;background:#14181a;border-radius:10px;padding:24px}
.dark h3{margin:0 0 16px;font:400 17px/1.2 Georgia,serif;color:#e8e4dc}
.dark .row{color:#b08a4a;border:0;padding:0;margin:0;flex-wrap:wrap;gap:26px}
</style></head><body>
<h1>Знаки проекта</h1>
<p class="lead">Шесть вариантов, все в одном цвете и одной толщине линии. Тема мемориальная,
поэтому геометрия строгая, без декоративных элементов. Формат SVG, цвет наследуется
от текста — знак примет цвет интерфейса в любой теме. Каждый показан в четырёх размерах:
64, 40, 24 и 16 пикселей, последний — размер значка вкладки.</p>
<div class="grid">%s</div>
<div class="dark"><h3>На тёмном фоне</h3><div class="row">%s</div></div>
</body></html>''' % (u"\n".join(cards),
                     u"".join(u'<span class="m m--40">%s</span>' % body(f) for f in files))

    out = os.path.join(HERE, u"просмотр.html")
    io.open(out, "w", encoding="utf-8").write(html)
    print(u"собрано: %s (знаков: %d)" % (os.path.basename(out), len(files)))

if __name__ == "__main__":
    main()
