#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка редакторского режима в настоящем браузере.

Запуск:  python3 app/data/test_edit.py

Зачем отдельный скрипт. Слои карты — метки, зоны, подписи, вершины — лежат
друг на друге, и трижды случалось так, что нажатие уходило не в тот слой:
обводка заводила новые места, потом перестало работать и то и другое.
Поймать это глазами трудно, а поломка тихая.

Главное правило здесь: событие адресуется через document.elementFromPoint,
то есть тому, что РЕАЛЬНО лежит под курсором. Если отправлять события прямо
нужному элементу, тест пройдёт даже на полностью перекрытой карте — именно
так дефект дважды и проскочил.

Захват указателя (setPointerCapture) на синтетическом указателе бросает
исключение, но заглушить его пустышкой нельзя: он и есть предмет проверки.
Поэтому контракт браузера воспроизводится вручную.

Выход: 0 — всё хорошо, 1 — есть провалы.
"""
import io, os, re, sys, html, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

TEST = r"""
<pre id="TESTOUT" style="position:fixed;left:0;top:0;z-index:9999;background:#000;color:#0f0;font:12px monospace;padding:8px;max-height:100%;overflow:auto"></pre>
<script>
setTimeout(function () {
  var out = [], pass = 0, fail = 0;
  function ok(name, cond, extra) {
    if (cond) pass++; else fail++;
    out.push((cond ? "PASS " : "FAIL ") + name + (extra ? "   [" + extra + "]" : ""));
  }
  function note(s) { out.push("      · " + s); }

  /* Настоящий setPointerCapture на синтетическом указателе бросает исключение,
     но просто заглушить его нельзя: захват — это ровно то, что проверяется.
     Поэтому воспроизводим контракт браузера: пока захват держится, события
     идут захватившему элементу, а не тому, что лежит под курсором; на
     отпускании захват снимается сам. */
  var captured = null;
  Element.prototype.setPointerCapture = function () { captured = this; };
  Element.prototype.releasePointerCapture = function () { if (captured === this) captured = null; };
  SVGElement.prototype.setPointerCapture = Element.prototype.setPointerCapture;
  SVGElement.prototype.releasePointerCapture = Element.prototype.releasePointerCapture;

  function at(x, y) { return document.elementFromPoint(x, y); }
  function nameOf(el) {
    if (!el) return "ничего";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      (el.getAttribute && el.getAttribute("class") ? "." + el.getAttribute("class").split(" ")[0] : "");
  }
  // Событие уходит тому, что РЕАЛЬНО лежит под точкой, и всплывает как настоящее.
  function ptr(type, x, y) {
    var el = captured || at(x, y);
    if (!el) return null;
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, pointerId: 1, pointerType: "mouse",
      button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true
    }));
    if (type === "pointerup") captured = null;
    return el;
  }
  function click(x, y) {
    ptr("pointerdown", x, y); ptr("pointerup", x, y);
    var el = at(x, y);
    if (el) el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y
    }));
    return el;
  }
  function drag(x1, y1, x2, y2) {
    ptr("pointerdown", x1, y1);
    ptr("pointermove", x2, y2);
    ptr("pointerup", x2, y2);
  }
  function pressAt(sel) {
    var b = document.querySelector(sel);
    if (!b) { ok("есть кнопка " + sel, false); return false; }
    var r = b.getBoundingClientRect();
    if (!r.width || !r.height) { ok("кнопка " + sel + " видима", false); return false; }
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var hit = at(x, y);
    if (!hit || (hit !== b && !b.contains(hit))) {
      ok("кнопка " + sel + " доступна нажатию", false, "сверху лежит " + nameOf(hit));
      return false;
    }
    click(x, y);
    return true;
  }

  var D = window.DATA;
  var inner = document.getElementById("map-inner");
  function ir() { return inner.getBoundingClientRect(); }
  function pct(px, py) { var r = ir(); return { x: r.left + r.width * px / 100, y: r.top + r.height * py / 100 }; }
  // пустое место = под точкой нет ни метки, ни фигуры зоны, ни подписи
  function freeSpots(allowShapes) {
    var r = ir(), res = [];
    for (var py = 10; py < 94; py += 2) {
      for (var px = 6; px < 96; px += 2) {
        var x = r.left + r.width * px / 100, y = r.top + r.height * py / 100;
        var el = at(x, y);
        if (!el) continue;
        if (el.closest && el.closest(".pt")) continue;
        if (el.classList && (el.classList.contains("zlab") || el.classList.contains("zdot"))) continue;
        var shape = (el.tagName === "polygon" || el.tagName === "ellipse");
        if (shape && !allowShapes) continue;
        if (shape || el === inner || el.id === "map-base" || el.id === "zones" ||
            el.id === "zlabels" || el.id === "map-points")
          res.push({ x: x, y: y, px: px, py: py, on: nameOf(el) });
      }
    }
    return res;
  }
  function findEmpty() { return freeSpots()[0] || null; }
  // Панель редактора накрывает часть карты. Тянуть надо в точку, про которую
  // проверено, что под ней действительно карта, а не панель.
  function farFrom(x, y) {
    var all = freeSpots(), best = null, bd = -1;
    for (var i = 0; i < all.length; i++) {
      var d = Math.hypot(all[i].x - x, all[i].y - y);
      if (d > bd) { bd = d; best = all[i]; }
    }
    return best;
  }

  try {
    /* --- подготовка --- */
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));   // разбудить
    /* Экран покоя уходит с затуханием: класс сразу, скрытие через 350 мс.
       Проверка синхронная, поэтому смотрим на признак ухода, а не на hidden —
       иначе тест ловит момент, когда экран ещё виден, и всё, что ниже,
       упирается в него как в перекрытие. Убираем его руками: предмет этого
       стенда — слои карты, а не заставка. */
    var idleEl = document.getElementById("idle");
    ok("экран покоя уходит", idleEl.classList.contains("is-out") || idleEl.hidden);
    idleEl.hidden = true;
    idleEl.classList.remove("is-out");
    // Единственный способ войти. Событие шлём сами: смена хеша порождает
    // hashchange асинхронно, и проверка успевала бы раньше обработчика.
    location.hash = "#edit";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    ok("режим разметки включён", document.body.classList.contains("is-edit"));
    ok("по умолчанию правятся метки", document.body.classList.contains("is-places"));
    ok("кнопка добавления по умолчанию НЕ взведена",
       document.querySelector("#edit-add").getAttribute("aria-pressed") === "false" &&
       !document.body.classList.contains("is-add"));

    ok("до правок признака «не сохранено» нет",
       !document.querySelector("#edit-save").classList.contains("is-dirty") &&
       document.querySelector("#edit-dirty").textContent === "");
    var sb = document.querySelector("#edit-save");
    var sr = sb.getBoundingClientRect();
    var shit = at(sr.left + sr.width / 2, sr.top + sr.height / 2);
    ok("кнопка «Сохранить» есть на панели карты и доступна нажатию",
       shit && (shit === sb || sb.contains(shit)), "под курсором " + nameOf(shit));

    // Легенда лежит поверх карты. Если она ловит нажатия, в её углу
    // не поставить ни метку, ни вершину — а это заметный кусок карты.
    var lg = document.querySelector(".legend");
    if (lg) {
      var lr = lg.getBoundingClientRect();
      var lhit = at(lr.left + lr.width / 2, lr.top + lr.height / 2);
      ok("легенда не перехватывает нажатия по карте под собой",
         !!lhit && !lhit.closest(".legend"), "под курсором " + nameOf(lhit));
    }

    var e1 = findEmpty();
    if (!e1) { ok("нашлось пустое место на карте", false); throw new Error("нет пустого места"); }
    note("пустое место " + e1.px + "%," + e1.py + "% — под курсором " + e1.on);

    /* --- 1. метки --- */
    var n0 = D.places.length;
    click(e1.x, e1.y);
    ok("нажатие по пустому месту НЕ заводит метку, пока кнопка не взведена",
       D.places.length === n0, "было " + n0 + ", стало " + D.places.length);

    pressAt("#edit-add");
    ok("«+ Метка» взводится",
       document.querySelector("#edit-add").getAttribute("aria-pressed") === "true" &&
       document.body.classList.contains("is-add"));

    var e2 = findEmpty();
    click(e2.x, e2.y);
    ok("при взведённой кнопке нажатие ставит метку",
       D.places.length === n0 + 1, "было " + n0 + ", стало " + D.places.length);

    ok("добавление метки помечает правки несохранёнными",
       document.querySelector("#edit-save").classList.contains("is-dirty") &&
       document.querySelector("#edit-dirty").textContent.length > 0,
       "надпись: «" + document.querySelector("#edit-dirty").textContent + "»");

    var n1 = D.places.length;
    var pt = document.querySelector("#map-points .pt[data-place]");
    if (pt) {
      var pr = pt.getBoundingClientRect();
      var cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
      var hit = at(cx, cy);
      ok("метка — верхний элемент под своим курсором",
         hit && hit.closest(".pt") === pt, "под курсором " + nameOf(hit));
      var id = pt.dataset.place;
      var obj = D.places.filter(function (p) { return p.id === id; })[0];
      var x0 = obj.x, y0 = obj.y;
      var dst = farFrom(cx, cy);
      note("метку тянем в " + dst.px + "%," + dst.py + "% — там " + dst.on);
      drag(cx, cy, dst.x, dst.y);
      ok("метка перетаскивается курсором",
         Math.abs(obj.x - x0) > 0.1 || Math.abs(obj.y - y0) > 0.1,
         "x " + x0.toFixed(2) + "->" + obj.x.toFixed(2) + "  y " + y0.toFixed(2) + "->" + obj.y.toFixed(2));
      ok("перетаскивание метки не плодит новых",
         D.places.length === n1, "было " + n1 + ", стало " + D.places.length);
    } else ok("на карте есть метка для перетаскивания", false);

    pressAt("#edit-add");
    var n2 = D.places.length, e3 = findEmpty();
    click(e3.x, e3.y);
    ok("после выключения кнопки метки снова не заводятся",
       D.places.length === n2, "было " + n2 + ", стало " + D.places.length);

    /* --- 2. переключение режима --- */
    pressAt('[data-mode="zones"]');
    ok("уход в зоны снимает взвод меток",
       !document.body.classList.contains("is-add") &&
       document.querySelector("#edit-add").getAttribute("aria-pressed") === "false");
    ok("«+ Метка» в режиме зон спрятана", document.querySelector("#edit-add").offsetParent === null);
    ok("«+ Вершина» в режиме зон показана", document.querySelector("#edit-vx").offsetParent !== null);
    ok("«+ Вершина» выключена, пока контур не выбран", document.querySelector("#edit-vx").disabled);

    /* --- 3. зоны --- */
    D.zones.push({ id: "ZTEST", type: "лесоразработки", label: "Тестовый контур", shape: "poly",
                   x: 30, y: 30, rx: 5, ry: 5, points: [[22, 22], [42, 22], [32, 42]], geo: "", note: "" });
    pressAt('[data-mode="zones"]');            // перерисовать
    var c = pct(32, 28);
    var pel = at(c.x, c.y);
    ok("многоугольник ловит нажатие", pel && pel.tagName === "polygon", "под курсором " + nameOf(pel));
    click(c.x, c.y);
    ok("«+ Вершина» включается, когда выбран контур", !document.querySelector("#edit-vx").disabled);

    var z = D.zones.filter(function (x) { return x.id === "ZTEST"; })[0];
    var v0 = z.points.length;
    var pv = freeSpots(true)[0];
    note("пробное нажатие без взвода в " + pv.px + "%," + pv.py + "% — там " + pv.on);
    click(pv.x, pv.y);
    ok("без взведённой кнопки вершина НЕ добавляется",
       z.points.length === v0, "было " + v0 + ", стало " + z.points.length);

    pressAt("#edit-vx");
    ok("«+ Вершина» взводится",
       document.querySelector("#edit-vx").getAttribute("aria-pressed") === "true" &&
       document.body.classList.contains("is-draw"));
    var pv2 = freeSpots(true)[0];
    note("вершину ставим в " + pv2.px + "%," + pv2.py + "% — там " + pv2.on);
    click(pv2.x, pv2.y);
    ok("при взведённой кнопке нажатие ставит вершину",
       z.points.length === v0 + 1, "было " + v0 + ", стало " + z.points.length);

    pressAt("#edit-vx");                        // снять взвод
    ok("обводка выключается", !document.body.classList.contains("is-draw"));
    var dot = document.querySelector("#zlabels .zdot");
    if (dot) {
      var dr = dot.getBoundingClientRect();
      var dx = dr.left + dr.width / 2, dy = dr.top + dr.height / 2;
      var dhit = at(dx, dy);
      ok("вершина — верхний элемент под своим курсором",
         dhit === dot, "под курсором " + nameOf(dhit));
      var i = +dot.dataset.vx, was = z.points[i].slice(), cnt = z.points.length;
      var vdst = farFrom(dx, dy);
      note("вершину тянем в " + vdst.px + "%," + vdst.py + "% — там " + vdst.on);
      ptr("pointerdown", dx, dy);
      ptr("pointermove", vdst.x, vdst.y);
      ok("элемент вершины пережил перетаскивание (иначе теряется захват)", dot.isConnected);
      ptr("pointerup", vdst.x, vdst.y);
      ok("вершина перетаскивается курсором",
         Math.abs(z.points[i][0] - was[0]) > 0.1 || Math.abs(z.points[i][1] - was[1]) > 0.1,
         was + " -> " + z.points[i]);
      ok("перетаскивание вершины не плодит новых",
         z.points.length === cnt, "было " + cnt + ", стало " + z.points.length);
    } else ok("вершины выбранного контура нарисованы", false);

    /* --- новая зона прямо с карты --- */
    var zn0 = D.zones.length;
    pressAt("#edit-zadd");
    ok("«+ Зона» заводит новую зону", D.zones.length === zn0 + 1,
       "было " + zn0 + ", стало " + D.zones.length);
    var nz = D.zones[D.zones.length - 1];
    ok("новая зона — контур и пока без вершин",
       nz.shape === "poly" && nz.points.length === 0, nz.shape + ", точек " + nz.points.length);
    ok("добавление вершин включилось сразу",
       document.querySelector("#edit-vx").getAttribute("aria-pressed") === "true");
    ok("удаление вершин недоступно у пустого контура",
       document.querySelector("#edit-vxdel").disabled);

    var sp = freeSpots(true);
    var picks = [sp[0], sp[Math.floor(sp.length / 2)], sp[sp.length - 1], sp[Math.floor(sp.length / 4)]];
    note("вершины ставим в " + picks.map(function (p) { return p.px + "%," + p.py + "%"; }).join("  "));
    for (var k = 0; k < 3; k++) click(picks[k].x, picks[k].y);
    ok("три нажатия дают три вершины", nz.points.length === 3, "точек " + nz.points.length);
    ok("контур появился на карте с третьей вершины",
       !!document.querySelector('#zones [data-zone="' + nz.id + '"]'));
    ok("на трёх вершинах удаление ещё недоступно",
       document.querySelector("#edit-vxdel").disabled);

    click(picks[3].x, picks[3].y);
    ok("четвёртая вершина добавилась", nz.points.length === 4, "точек " + nz.points.length);
    ok("на четырёх вершинах удаление стало доступно",
       !document.querySelector("#edit-vxdel").disabled);

    /* --- удаление конкретной вершины --- */
    pressAt("#edit-vxdel");
    ok("«− Вершина» взводится и гасит добавление",
       document.querySelector("#edit-vxdel").getAttribute("aria-pressed") === "true" &&
       document.querySelector("#edit-vx").getAttribute("aria-pressed") === "false" &&
       document.body.classList.contains("is-erase") &&
       !document.body.classList.contains("is-draw"));

    var dots = document.querySelectorAll("#zlabels .zdot");
    ok("вершины нарисованы все четыре", dots.length === 4, "кружков " + dots.length);
    var victim = dots[1], vi = +victim.dataset.vx, gone = nz.points[vi].slice();
    var vr = victim.getBoundingClientRect();
    var vx = vr.left + vr.width / 2, vy = vr.top + vr.height / 2;
    ok("вершина под курсором — та самая", at(vx, vy) === victim, "под курсором " + nameOf(at(vx, vy)));
    click(vx, vy);
    ok("удалилась именно выбранная вершина, а не последняя",
       nz.points.length === 3 &&
       !nz.points.some(function (p) { return p[0] === gone[0] && p[1] === gone[1]; }),
       "убирали " + gone + ", осталось " + JSON.stringify(nz.points));

    ok("на трёх вершинах взвод удаления снялся сам",
       document.querySelector("#edit-vxdel").disabled &&
       !document.body.classList.contains("is-erase"));

    var dots2 = document.querySelectorAll("#zlabels .zdot");
    var d2 = dots2[0], d2r = d2.getBoundingClientRect();
    click(d2r.left + d2r.width / 2, d2r.top + d2r.height / 2);
    ok("ниже трёх вершин удалить нельзя", nz.points.length === 3, "точек " + nz.points.length);

    /* --- пятно целиком --- */
    // Контуры, наставленные выше, растянулись поверх пятна. Уводим их в угол:
    // иначе до пятна физически не дотянуться, и провалится не приложение, а тест.
    D.zones.forEach(function (x) {
      if (x.id !== "Z1" && x.shape === "poly") x.points = [[2, 2], [9, 2], [5, 9]];
    });
    pressAt('[data-mode="zones"]');                // перерисовать
    // Пятно заводим сами: полагаться на пример в данных нельзя, музей его
    // удалил, и проверка отвалилась вместе с ним.
    D.zones.push({ id: "ZELL", type: "лесоразработки", label: "Тестовое пятно",
                   shape: "ellipse", x: 66, y: 41.5, rx: 5.2, ry: 6.5,
                   points: [], geo: "", note: "" });
    pressAt('[data-mode="zones"]');
    var z1 = D.zones.filter(function (x) { return x.id === "ZELL"; })[0];
    if (z1 && z1.shape !== "poly") {
      var ec = pct(z1.x, z1.y);
      var eel = at(ec.x, ec.y);
      ok("пятно ловит нажатие", eel && eel.tagName === "ellipse", "под курсором " + nameOf(eel));
      var ex0 = z1.x, ey0 = z1.y;
      ptr("pointerdown", ec.x, ec.y);
      ok("«+ Вершина» выключена для пятна: вершин у него нет",
         document.querySelector("#edit-vx").disabled);
      var edst = farFrom(ec.x, ec.y);
      ptr("pointermove", edst.x, edst.y);
      ok("пятно перетаскивается курсором",
         Math.abs(z1.x - ex0) > 0.1 || Math.abs(z1.y - ey0) > 0.1,
         ex0 + "," + ey0 + " -> " + z1.x + "," + z1.y);
      ptr("pointerup", edst.x, edst.y);
    } else ok("в данных есть пятно для проверки", false);

    var np = D.places.length;
    var e4 = freeSpots()[0];
    click(e4.x, e4.y);
    ok("в режиме зон нажатие по карте НЕ заводит метку",
       D.places.length === np, "было " + np + ", стало " + D.places.length);

    /* --- 4. возврат --- */
    pressAt("#edit-vx");                        // взвести перед уходом
    pressAt('[data-mode="places"]');
    ok("возврат к меткам гасит обводку", !document.body.classList.contains("is-draw"));
    ok("«+ Вершина» снова спрятана", document.querySelector("#edit-vx").offsetParent === null);
    var np2 = D.places.length, e5 = findEmpty();
    click(e5.x, e5.y);
    ok("после возврата метки по-прежнему требуют кнопки",
       D.places.length === np2, "было " + np2 + ", стало " + D.places.length);
  } catch (err) {
    out.push("ИСКЛЮЧЕНИЕ: " + (err && err.message) + "\n" + (err && err.stack || ""));
    fail++;
  }

  out.unshift("ИТОГ: успешно " + pass + ", провалено " + fail);
  document.getElementById("TESTOUT").textContent = out.join("\n");
}, 300);
</script>
"""


def main():
    if not os.path.exists(CHROME):
        sys.exit("не найден Chrome: " + CHROME)
    src = io.open(os.path.join(APP, "index.html"), encoding="utf-8").read()
    page = src.replace("</body>", TEST + "\n</body>")
    if page == src:
        sys.exit("в index.html не найден </body>")
    # Страница кладётся рядом с index.html: иначе не разрешатся data/ и assets/
    tmp = os.path.join(APP, "__test.html")
    io.open(tmp, "w", encoding="utf-8").write(page)
    try:
        r = subprocess.run(
            [CHROME, "--headless", "--disable-gpu", "--no-sandbox",
             "--window-size=1400,900", "--virtual-time-budget=6000",
             "--dump-dom", "file://" + os.path.realpath(tmp)],
            capture_output=True)
        dom = r.stdout.decode("utf-8", "replace")
    finally:
        os.remove(tmp)

    m = re.search(r'<pre id="TESTOUT"[^>]*>(.*?)</pre>', dom, re.S)
    if not m:
        sys.exit("страница не отдала результатов: Chrome не запустился "
                 "или приложение упало до конца проверок")
    text = html.unescape(m.group(1))
    print(text)
    sys.exit(1 if "FAIL " in text else 0)


main()
