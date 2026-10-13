#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Смена снимка в карточке: наплыв и плавная высота.

Запуск:  python3 app/data/test_photo.py

Снимки у мест разной пропорции, и место под них нужно разное: пейзаж вдвое
ниже портрета. Раньше при нажатии на миниатюру высота менялась мгновенно —
подпись и лента прыгали вниз ещё до того, как появлялся сам снимок, — а сама
картинка гасла в фон и проявлялась заново, то есть «моргала».

Что здесь меряется:
  · высота идёт промежуточными значениями, а не одним прыжком;
  · уходящий кадр лежит поверх нового и растворяется постепенно;
  · после перехода не осталось ни призрака, ни высоты, прибитой к пикселям;
  · частые щелчки по миниатюрам не копят мусор в разметке.

Пара снимков выбирается не по разнице пропорций, а по разнице ОТРИСОВАННЫХ
высот: высота упирается в потолок max-height, и два портрета выглядят
одинаково высокими — на такой паре проверять нечего.

Выход: 0 — всё хорошо, 1 — есть провалы.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import open_app, ev, check, total

APP = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "index.html")

p, ws = open_app(APP, port=9335)
ev(ws, "var i=document.querySelector('#idle'); i && (i.hidden = true)")

# Место, у которого снимки ОТРИСУЮТСЯ разной высоты. Одной разницы пропорций
# мало: высота упирается в потолок max-height, и два портрета выглядят
# одинаково высокими — на такой паре ничего не проверишь.
first = ev(ws, """(function(){
  var g = (window.DATA.gallery && window.DATA.gallery.places) || {};
  var id = Object.keys(g).filter(function(x){ return g[x].length > 1; })[0] || "";
  var b = id && document.querySelector('.plist__b[data-place="' + id + '"]');
  if (b) b.click();
  return id;
})()""")
time.sleep(1.0)
box = json.loads(ev(ws, """(function(){
  var m = document.querySelector('#gal-main');
  var cs = getComputedStyle(m);
  return JSON.stringify({w: m.clientWidth, cap: parseFloat(cs.maxHeight),
                         min: parseFloat(cs.minHeight)});
})()"""))
pick = ev(ws, """(function(){
  var W = %(w)s, CAP = %(cap)s, MIN = %(min)s;
  var g = (window.DATA.gallery && window.DATA.gallery.places) || {};
  function h(a){ return Math.max(MIN, Math.min(CAP, W * a[1] / a[0])); }
  var best = null;
  Object.keys(g).forEach(function(id){
    var a = g[id];
    if (a.length < 2) return;
    for (var i = 1; i < a.length; i++){
      var d = Math.abs(h(a[0]) - h(a[i]));
      if (!best || d > best.d) best = {id:id, at:i, d:d, a:a, h0:h(a[0]), h1:h(a[i])};
    }
  });
  return best ? JSON.stringify(best) : "";
})()""" % box)
check("нашлась пара снимков, которые рисуются разной высоты", bool(pick), pick)
best = json.loads(pick)
check("разница высот заметная", best["d"] > 20,
      "%.0f -> %.0f px, разница %.0f" % (best["h0"], best["h1"], best["d"]))

r = json.loads(ev(ws, """(function(){ return new Promise(function(done){
  var b = document.querySelector('.plist__b[data-place="%s"]');
  if (!b) return done(JSON.stringify({err:'нет кнопки места'}));
  b.click();
  setTimeout(function(){
    var m = document.querySelector('#gal-main');
    var th = document.querySelectorAll('.card__thumb');
    done(JSON.stringify({
      ok: !!m, thumbs: th.length,
      wrapped: !!(m && m.parentNode.classList.contains('card__shot')),
      h0: m ? m.getBoundingClientRect().height : 0
    }));
  }, 900);
}); })()""" % best["id"]))
check("карточка места открылась со снимком", r.get("ok"), r)
check("снимок обёрнут в .card__shot", r.get("wrapped"))
check("лента миниатюр на месте", r.get("thumbs", 0) >= 2, "миниатюр: %s" % r.get("thumbs"))

# щёлкаем по второй миниатюре и замеряем высоту по кадрам
sw = json.loads(ev(ws, """(function(){ return new Promise(function(done){
  var m = document.querySelector('#gal-main');
  var box = m.parentNode;
  var h0 = m.getBoundingClientRect().height;
  var src0 = m.currentSrc || m.src;
  var seen = [], ghostSeen = 0, ghostOp = [];
  var t = setInterval(function(){
    var g = box.querySelector('.card__ghost');
    if (g) { ghostSeen++; ghostOp.push(+getComputedStyle(g).opacity); }
    seen.push(+m.getBoundingClientRect().height.toFixed(1));
  }, 40);
  document.querySelectorAll('.card__thumb')[AT].click();
  setTimeout(function(){
    clearInterval(t);
    var m2 = document.querySelector('#gal-main');
    done(JSON.stringify({
      h0: +h0.toFixed(1), heights: seen,
      hEnd: +m2.getBoundingClientRect().height.toFixed(1),
      srcChanged: (m2.currentSrc||m2.src) !== src0,
      ghostSeen: ghostSeen, ghostOp: ghostOp,
      ghostLeft: !!box.querySelector('.card__ghost'),
      inlineH: m2.style.height, ratio: m2.style.aspectRatio
    }));
  }, 900);
}); })()""".replace("AT", str(best["at"]))))

hs = sw["heights"]
check("снимок сменился", sw["srcChanged"])
check("высота изменилась", abs(sw["hEnd"] - sw["h0"]) > 4,
      "%s -> %s px" % (sw["h0"], sw["hEnd"]))
mids = [h for h in hs if min(sw["h0"], sw["hEnd"]) + 3 < h < max(sw["h0"], sw["hEnd"]) - 3]
check("высота ехала, а не прыгнула: есть промежуточные значения",
      len(mids) >= 3, "промежуточных кадров: %d из %d" % (len(mids), len(hs)))
check("уходящий кадр действительно накладывался поверх",
      sw["ghostSeen"] >= 3, "кадров с призраком: %d" % sw["ghostSeen"])
ops = sw["ghostOp"]
check("уходящий кадр растворялся постепенно",
      len(ops) > 2 and ops[0] > 0.5 and min(ops) < 0.5 and len(set(ops)) >= 3,
      "прозрачность: %s" % (", ".join("%.2f" % o for o in ops[:8])))
check("после перехода призрак убран", not sw["ghostLeft"])
check("после перехода высоту снова держит пропорция, а не пиксели",
      sw["inlineH"] == "" and "/" in (sw["ratio"] or ""),
      "height=%r aspect-ratio=%r" % (sw["inlineH"], sw["ratio"]))
check("итоговая высота — ровно та, что даёт пропорция нового снимка",
      abs(sw["hEnd"] - best["h1"]) < 3,
      "ждали %.1f, вышло %.1f" % (best["h1"], sw["hEnd"]))

# быстрые щелчки подряд не должны оставлять призраков
r2 = json.loads(ev(ws, """(function(){ return new Promise(function(done){
  var th = document.querySelectorAll('.card__thumb');
  th[0].click(); setTimeout(function(){ th[1].click(); }, 60);
  setTimeout(function(){ th[0].click(); }, 120);
  setTimeout(function(){
    var box = document.querySelector('.card__shot');
    done(JSON.stringify({ghosts: box.querySelectorAll('.card__ghost').length,
                         inlineH: document.querySelector('#gal-main').style.height}));
  }, 1000);
}); })()"""))
check("частые щелчки по миниатюрам не копят призраков",
      r2["ghosts"] == 0, "осталось призраков: %d" % r2["ghosts"])
check("и не оставляют высоту прибитой к пикселям",
      r2["inlineH"] == "", "height=%r" % r2["inlineH"])


# ---- листание во весь экран ----
"""В карточке снимки меняют друг друга наплывом, а во весь экран листались
гашением в чёрный фон: между кадрами пустота. Здесь проверяется, что наплыв
теперь и там, и что у него есть направление — новый кадр приходит с той
стороны, куда листаешь."""

LB = """
(function(){ return new Promise(function(done){
  document.querySelector('#gal-main').click();       // открыть во весь экран
  setTimeout(function(){
    var lb = document.querySelector('#lb');
    var m = document.querySelector('#lb-img');
    if (lb.hidden) return done(JSON.stringify({err:'полный экран не открылся'}));
    var src0 = m.currentSrc || m.src;
    var cap0 = document.querySelector('#lb-cap').textContent;
    var seen = [], ghostOp = [], froms = {}, tos = {}, shifts = [], capIn = 0;
    var t = setInterval(function(){
      var g = lb.querySelector('.lb__ghost');
      if (g){
        ghostOp.push(+getComputedStyle(g).opacity);
        if (g.classList.contains('is-to-l')) tos['l'] = 1;
        if (g.classList.contains('is-to-r')) tos['r'] = 1;
      }
      if (m.classList.contains('is-from-r')) froms['r'] = 1;
      if (m.classList.contains('is-from-l')) froms['l'] = 1;
      if (document.querySelector('#lb-cap').classList.contains('is-in')) capIn = 1;
      var cs = getComputedStyle(m);
      seen.push(+cs.opacity);
      // Матрица вида matrix(1,0,0,1,X,Y): X — тот самый сдвиг
      var mt = /matrix\(([^)]+)\)/.exec(cs.transform);
      if (mt) shifts.push(+mt[1].split(',')[4]);
    }, 30);
    document.querySelector('#lb-next').click();       // ЛИСТАЕМ ВПЕРЁД
    setTimeout(function(){
      clearInterval(t);
      done(JSON.stringify({
        srcChanged: (m.currentSrc||m.src) !== src0,
        capChanged: document.querySelector('#lb-cap').textContent !== cap0,
        capIn: capIn, capText: document.querySelector('#lb-cap').textContent.trim().length,
        ghostFrames: ghostOp.length, ghostOp: ghostOp,
        froms: Object.keys(froms), tos: Object.keys(tos),
        opacities: seen, shifts: shifts,
        ghostLeft: !!lb.querySelector('.lb__ghost'),
        classLeft: m.className
      }));
    }, 800);
  }, 500);
}); })()
"""
r = json.loads(ev(ws, LB))
check("полный экран открылся и снимок сменился",
      r.get("srcChanged"), r.get("err", ""))
# Текст подписи сравнивать нельзя: у соседних снимков музея авторство одно и то же,
# и подпись законно совпадает. Проверяем, что она перерисована и не пуста.
check("подпись перерисовывается вместе со снимком",
      bool(r.get("capIn")) and r.get("capText", 0) > 0,
      u"проявление: %s, длина подписи: %s%s" % (
          r.get("capIn"), r.get("capText"),
          u", текст изменился" if r.get("capChanged") else u", текст тот же — авторство общее"))
check("прежний кадр остаётся лежать поверх", r.get("ghostFrames", 0) >= 3,
      "кадров с копией: %s" % r.get("ghostFrames"))
check("копия растворяется постепенно, а не гаснет разом",
      len(set(r.get("ghostOp") or [])) > 2,
      "непрозрачность копии: %s" % (r.get("ghostOp") or [])[:6])
check("новый кадр приходит справа — туда, куда листаем",
      r.get("froms") == ["r"], "сторона: %s" % r.get("froms"))
check("старый уходит влево", r.get("tos") == ["l"], "сторона: %s" % r.get("tos"))
check("наплыв действительно играл: снимок проступал, а не возник разом",
      min(r.get("opacities") or [1]) < .9,
      "наименьшая непрозрачность снимка: %s" % min(r.get("opacities") or [1]))
check("и приехал со сдвигом, а не появился на месте",
      max(abs(x) for x in (r.get("shifts") or [0])) > 4,
      "наибольший сдвиг: %.1f px" % max(abs(x) for x in (r.get("shifts") or [0])))
check("после перехода копия убрана", not r.get("ghostLeft"))
check("и сдвиг с нового кадра снят", "is-from" not in (r.get("classLeft") or ""),
      "классы: %s" % r.get("classLeft"))

BACK = """
(function(){ return new Promise(function(done){
  var lb = document.querySelector('#lb'), m = document.querySelector('#lb-img');
  var froms = {}, tos = {};
  var t = setInterval(function(){
    var g = lb.querySelector('.lb__ghost');
    if (g){
      if (g.classList.contains('is-to-l')) tos['l'] = 1;
      if (g.classList.contains('is-to-r')) tos['r'] = 1;
    }
    if (m.classList.contains('is-from-r')) froms['r'] = 1;
    if (m.classList.contains('is-from-l')) froms['l'] = 1;
  }, 30);
  document.querySelector('#lb-prev').click();         // ЛИСТАЕМ НАЗАД
  setTimeout(function(){
    clearInterval(t);
    // и напоследок частые нажатия: копии не должны копиться
    for (var i = 0; i < 6; i++) document.querySelector('#lb-next').click();
    setTimeout(function(){
      done(JSON.stringify({froms:Object.keys(froms), tos:Object.keys(tos),
                           ghosts: lb.querySelectorAll('.lb__ghost').length}));
    }, 700);
  }, 500);
}); })()
"""
r2 = json.loads(ev(ws, BACK))
check("назад — кадр приходит слева", r2.get("froms") == ["l"],
      "сторона: %s" % r2.get("froms"))
check("и старый уходит вправо", r2.get("tos") == ["r"], "сторона: %s" % r2.get("tos"))
check("частое листание не копит копий", r2.get("ghosts") == 0,
      "копий осталось: %s" % r2.get("ghosts"))
p.terminate()
sys.exit(total())
