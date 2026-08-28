#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Метки не должны скакать при зуме.

Запуск:  python3 app/data/test_map.py

Жалоба, с которой всё началось: «при приближении метки передвигаются, потом
через некоторое время встают корректно». Причина не в анимации, а в том, что
группировка меток считается в пикселях и потому зависит от масштаба. Пока
карта движется, пересобирать её нельзя — см. CONTEXT.md, раздел про
пересборку на покоящейся карте.

Что здесь меряется:
  · сколько раз слой меток перестроился ПО ХОДУ жеста (должно быть ноль);
  · не отклеилась ли метка от своего места на карте — положение считается
    ОТНОСИТЕЛЬНО слоя, потому что абсолютное обязано меняться: слой растёт;
  · пересобрался ли слой ровно один раз после того, как движение кончилось.

Выход: 0 — всё хорошо, 1 — есть провалы.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import open_app, ev, check, total

APP = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "index.html")

p, ws = open_app(APP, touch=True, port=9334)

SPY = """
window.__spy = {builds:0};
/* Считаем ПЕРЕСБОРКИ слоя, а не всякое движение в разметке. Уезжающая
   копия метки (.pt--ghost) добавляется и убирается отдельно — это часть
   анимации переезда, а не новая сборка, и в счёт идти не должна. */
function realOnly(list){
  return [].slice.call(list).some(function(n){
    return !(n.classList && n.classList.contains('pt--ghost'));
  });
}
new MutationObserver(function(ms){
  for (var i = 0; i < ms.length; i++){
    if (realOnly(ms[i].addedNodes) || realOnly(ms[i].removedNodes)){
      window.__spy.builds++; return;
    }
  }
}).observe(document.querySelector('#map-points'), {childList:true});
/* Положение метки ОТНОСИТЕЛЬНО СЛОЯ. Слой при зуме растёт, и абсолютные
   координаты обязаны меняться — это и есть «едет вместе с картой».
   Скачок — это когда меняется доля: метка отклеилась от своего места. */
window.__snap = function(){
  var lay = document.querySelector('#map-inner').getBoundingClientRect();
  var pts = [].slice.call(document.querySelectorAll('#map-points .pt:not(.pt--ghost)'));
  var rel = {};
  pts.forEach(function(e){
    var r = e.getBoundingClientRect();
    rel[e.dataset.place] = [(r.left + r.width/2 - lay.left)/lay.width,
                            (r.top + r.height/2 - lay.top)/lay.height];
  });
  return {n: pts.length,
          ids: pts.map(function(e){return e.dataset.ids;}).sort().join('|'),
          rel: rel, w: lay.width};
};
window.__reset = function(){
  return new Promise(function(d){
    document.querySelector('#z-reset').click();
    // 900 мс мало: переход 520 + переезд меток 420. Считать начинаем
    // только когда всё это доиграло, иначе в счёт попадёт хвост сброса.
    setTimeout(function(){ window.__spy.builds = 0; d(1); }, 1400);
  });
};
"""
ev(ws, SPY)
ev(ws, "var i=document.querySelector('#idle'); i && (i.hidden = true)")
time.sleep(.4)


def drift(a, b):
    """Наибольшее смещение метки относительно слоя, в долях ширины."""
    m = 0.0
    for pid, xy in a.items():
        if pid in b:
            m = max(m, abs(xy[0] - b[pid][0]), abs(xy[1] - b[pid][1]))
    return m


def stage(title, script):
    print("=== %s ===" % title)
    ev(ws, "window.__reset()")
    return json.loads(ev(ws, script))


PINCH = """
(function(){ return new Promise(function(done){
  var f = document.querySelector('#map-frame');
  var r = f.getBoundingClientRect();
  var cx = r.left + r.width/2, cy = r.top + r.height/2;
  function pe(t,id,x,y){ return new PointerEvent(t,{pointerId:id,pointerType:'touch',
    clientX:x, clientY:y, bubbles:true, cancelable:true, buttons:1, isPrimary:id===1}); }
  var before = window.__snap(); window.__spy.builds = 0;
  f.dispatchEvent(pe('pointerdown',1,cx-60,cy));
  f.dispatchEvent(pe('pointerdown',2,cx+60,cy));
  var s = 0, seen = [];
  (function step(){
    if (s++ >= 24){
      f.dispatchEvent(pe('pointerup',1,cx-204,cy));
      f.dispatchEvent(pe('pointerup',2,cx+204,cy));
      setTimeout(function(){
        done(JSON.stringify({before:before, during:seen,
                             after:{builds:window.__spy.builds, snap:window.__snap()}}));
      }, 900);
      return;
    }
    var d = 60 + s*6;
    f.dispatchEvent(pe('pointermove',1,cx-d,cy));
    f.dispatchEvent(pe('pointermove',2,cx+d,cy));
    seen.push({builds:window.__spy.builds, snap:window.__snap()});
    setTimeout(step, 16);
  })();
}); })()
"""
r = stage("ЩИПОК на сенсорном (два пальца, 24 шага)", PINCH)
dur = r["during"]
check("за весь щипок слой меток не пересобрался ни разу",
      max(x["builds"] for x in dur) == 0,
      "пересборок за жест: %d" % max(x["builds"] for x in dur))
check("за весь щипок состав меток не менялся",
      len(set(x["snap"]["ids"] for x in dur)) == 1,
      "разных составов: %d" % len(set(x["snap"]["ids"] for x in dur)))
mx = max(drift(r["before"]["rel"], x["snap"]["rel"]) for x in dur)
check("метки всё время приклеены к своим местам на карте",
      mx < 0.002, "наибольшее смещение: %.5f ширины слоя" % mx)
check("щипок действительно приблизил карту",
      dur[-1]["snap"]["w"] > r["before"]["w"] * 1.5,
      "%d -> %d px" % (r["before"]["w"], dur[-1]["snap"]["w"]))
changed = r["after"]["snap"]["ids"] != dur[-1]["snap"]["ids"]
check("после щипка пересборка ровно одна (или ни одной, если состав тот же)",
      r["after"]["builds"] == (1 if changed else 0),
      "состав %s, пересборок %d" % ("сменился" if changed else "тот же", r["after"]["builds"]))
check("после щипка группы распались",
      r["after"]["snap"]["n"] > r["before"]["n"],
      "%d -> %d меток" % (r["before"]["n"], r["after"]["snap"]["n"]))
d2 = drift(dur[-1]["snap"]["rel"], r["after"]["snap"]["rel"])
check("пересборка не сдвинула метки, оставшиеся на карте",
      d2 < 0.002, "смещение: %.5f" % d2)

WHEEL = """
(function(){ return new Promise(function(done){
  var f = document.querySelector('#map-frame');
  var r = f.getBoundingClientRect();
  var cx = r.left + r.width/2, cy = r.top + r.height/2;
  var before = window.__snap(); window.__spy.builds = 0;
  var s = 0, seen = [];
  (function step(){
    if (s++ >= 25){
      setTimeout(function(){
        done(JSON.stringify({before:before, during:seen,
                             after:{builds:window.__spy.builds, snap:window.__snap()}}));
      }, 900);
      return;
    }
    f.dispatchEvent(new WheelEvent('wheel',{deltaY:-8, clientX:cx, clientY:cy,
                                            bubbles:true, cancelable:true}));
    seen.push({builds:window.__spy.builds, snap:window.__snap()});
    setTimeout(step, 16);
  })();
}); })()
"""
r = stage("КОЛЕСО — трекпад, 25 мелких событий подряд", WHEEL)
dur = r["during"]
check("за всю прокрутку слой меток не пересобрался ни разу",
      max(x["builds"] for x in dur) == 0,
      "пересборок за прокрутку: %d" % max(x["builds"] for x in dur))
mx = max(drift(r["before"]["rel"], x["snap"]["rel"]) for x in dur)
check("метки приклеены к местам и при прокрутке",
      mx < 0.002, "наибольшее смещение: %.5f" % mx)
check("после паузы пересобрались один раз",
      r["after"]["builds"] == 1, "пересборок: %d" % r["after"]["builds"])
check("после прокрутки группы распались",
      r["after"]["snap"]["n"] > r["before"]["n"],
      "%d -> %d меток" % (r["before"]["n"], r["after"]["snap"]["n"]))

BTN = """
(function(){ return new Promise(function(done){
  var before = window.__snap(); window.__spy.builds = 0;
  document.querySelector('#z-in').click();
  var seen = [];
  var t = setInterval(function(){ seen.push({builds:window.__spy.builds, snap:window.__snap()}); }, 60);
  setTimeout(function(){ clearInterval(t); }, 420);
  setTimeout(function(){
    done(JSON.stringify({before:before, during:seen,
                         after:{builds:window.__spy.builds, snap:window.__snap()}}));
  }, 1200);
}); })()
"""
r = stage("КНОПКА ЗУМА — переход 400 мс", BTN)
dur = r["during"]
check("пока слой едет, метки не пересобираются",
      max(x["builds"] for x in dur) == 0,
      "пересборок за переход: %d" % max(x["builds"] for x in dur))
mx = max(drift(r["before"]["rel"], x["snap"]["rel"]) for x in dur)
check("во время перехода метки едут вместе со слоем, а не сами по себе",
      mx < 0.002, "наибольшее смещение: %.5f" % mx)
changed = r["after"]["snap"]["ids"] != r["before"]["ids"]
check("после перехода пересборка не больше одной",
      r["after"]["builds"] <= 1, "пересборок: %d" % r["after"]["builds"])
check("состав меток к концу перехода обновлён",
      (r["after"]["builds"] == 1) == changed,
      "состав %s" % ("сменился" if changed else "тот же"))

PAN = """
(function(){ return new Promise(function(done){
  var f = document.querySelector('#map-frame');
  var r = f.getBoundingClientRect();
  var cx = r.left + r.width/2, cy = r.top + r.height/2;
  function pe(t,id,x,y){ return new PointerEvent(t,{pointerId:id,pointerType:'touch',
    clientX:x, clientY:y, bubbles:true, cancelable:true, buttons:1, isPrimary:true}); }
  window.__spy.builds = 0;
  f.dispatchEvent(pe('pointerdown',7,cx,cy));
  var s=0;
  (function step(){
    if (s++ >= 15){
      f.dispatchEvent(pe('pointerup',7,cx-120,cy));
      setTimeout(function(){ done(JSON.stringify({builds:window.__spy.builds})); }, 600);
      return;
    }
    f.dispatchEvent(pe('pointermove',7,cx-s*8,cy));
    setTimeout(step, 16);
  })();
}); })()
"""
r = stage("ПЕРЕТАСКИВАНИЕ — масштаб не меняется", PAN)
check("перетаскивание слой меток не трогает вовсе",
      r["builds"] == 0, "пересборок: %d" % r["builds"])

LOST = """
(function(){ return new Promise(function(done){
  var f = document.querySelector('#map-frame');
  var r = f.getBoundingClientRect();
  var cx = r.left + r.width/2, cy = r.top + r.height/2;
  function pe(t,id,x,y){ return new PointerEvent(t,{pointerId:id,pointerType:'touch',
    clientX:x, clientY:y, bubbles:true, cancelable:true, buttons:1, isPrimary:id===1}); }
  var before = window.__snap(); window.__spy.builds = 0;
  f.dispatchEvent(pe('pointerdown',11,cx-60,cy));
  f.dispatchEvent(pe('pointerdown',12,cx+60,cy));
  var s = 0;
  (function step(){
    if (s++ >= 20){
      // Пальцы отпущены ЗА пределами карты: до неё событие не дойдёт.
      window.dispatchEvent(pe('pointerup',11,-999,-999));
      window.dispatchEvent(pe('pointerup',12,-999,-999));
      setTimeout(function(){
        done(JSON.stringify({before:before, builds:window.__spy.builds,
                             snap:window.__snap()}));
      }, 900);
      return;
    }
    var d = 60 + s*6;
    f.dispatchEvent(pe('pointermove',11,cx-d,cy));
    f.dispatchEvent(pe('pointermove',12,cx+d,cy));
    setTimeout(step, 16);
  })();
}); })()
"""
r = stage("ПАЛЬЦЫ ОТПУЩЕНЫ ЗА КРАЕМ ЭКРАНА", LOST)
check("карта не считается движущейся вечно: метки всё равно пересобрались",
      r["builds"] == 1, "пересборок: %d" % r["builds"])
check("и группы распались как положено",
      r["snap"]["n"] > r["before"]["n"],
      "%d -> %d меток" % (r["before"]["n"], r["snap"]["n"]))

# ---- центровка метки во время анимации появления ----
# .pt центрируется через transform. Если анимация transform не повторит
# translate(-50%,-50%), метка на время анимации съедет на пол-кружка
# и в конце вернётся рывком. Это и была та самая «скачка».
CENTER = """
(function(){ return new Promise(function(done){
  var el = document.querySelector('#map-points .pt');
  var lay = document.querySelector('#map-inner');
  function mid(){
    var r = el.getBoundingClientRect(), L = lay.getBoundingClientRect();
    return [(r.left + r.width/2 - L.left), (r.top + r.height/2 - L.top)];
  }
  var base = mid(), seen = [];
  el.classList.add('pt--fade');
  var t = setInterval(function(){ seen.push(mid()); }, 30);
  setTimeout(function(){
    clearInterval(t);
    el.classList.remove('pt--fade');
    done(JSON.stringify({base:base, seen:seen, after:mid()}));
  }, 320);
}); })()
"""
ev(ws, "window.__reset()")
r = json.loads(ev(ws, CENTER))
off = max(max(abs(p[0]-r["base"][0]), abs(p[1]-r["base"][1])) for p in r["seen"])
check("метка не съезжает, пока играет анимация появления",
      off < 1.5, "наибольший сдвиг центра: %.2f px за %d кадров" % (off, len(r["seen"])))
check("и после анимации остаётся там же",
      abs(r["after"][0]-r["base"][0]) < 0.5 and abs(r["after"][1]-r["base"][1]) < 0.5,
      "%s -> %s" % ([round(x,1) for x in r["base"]], [round(x,1) for x in r["after"]]))

# ---- слияние: метка уезжает в кластер, а не исчезает на месте ----
MERGE = """
(function(){ return new Promise(function(done){
  var host = document.querySelector('#map-points');
  var n0 = host.querySelectorAll('.pt').length;
  document.querySelector('#z-in').click();
  setTimeout(function(){
    // приблизили — группы распались; теперь отдаляем обратно
    var nIn = host.querySelectorAll('.pt').length;
    var seen = [];
    document.querySelector('#z-out').click();
    var t = setInterval(function(){
      seen.push({ghosts: host.querySelectorAll('.pt--ghost').length,
                 moves: host.querySelectorAll('.pt--move').length});
    }, 40);
    setTimeout(function(){
      clearInterval(t);
      done(JSON.stringify({n0:n0, nIn:nIn, seen:seen,
        ghostsLeft: host.querySelectorAll('.pt--ghost').length,
        n1: host.querySelectorAll('.pt').length,
        stuck: host.querySelectorAll('.pt--move').length}));
    }, 1500);
  }, 1200);
}); })()
"""
ev(ws, "window.__reset()")
r = json.loads(ev(ws, MERGE))
check("приближение распустило группы", r["nIn"] > r["n0"],
      "%d -> %d меток" % (r["n0"], r["nIn"]))
check("при слиянии метка уезжает в кластер, а не исчезает на месте",
      max(x["ghosts"] for x in r["seen"]) > 0,
      "кадров с уезжающими метками: %d" % sum(1 for x in r["seen"] if x["ghosts"]))
check("после слияния уехавшие метки убраны из разметки",
      r["ghostsLeft"] == 0, "осталось: %d" % r["ghostsLeft"])
check("и переход снят со всех оставшихся",
      r["stuck"] == 0, "с классом перехода осталось: %d" % r["stuck"])
check("группы собрались обратно", r["n1"] < r["nIn"],
      "%d -> %d меток" % (r["nIn"], r["n1"]))

# ---- распад: метка выезжает из кластера ----
SPLIT = """
(function(){ return new Promise(function(done){
  var host = document.querySelector('#map-points');
  var seen = [];
  document.querySelector('#z-in').click();
  var t = setInterval(function(){
    seen.push(host.querySelectorAll('.pt--move').length);
  }, 40);
  setTimeout(function(){
    clearInterval(t);
    var left = [].slice.call(host.querySelectorAll('.pt')).filter(function(e){
      return e.style.transform && e.style.transform !== 'none';
    }).length;
    done(JSON.stringify({seen:seen, left:left,
                         stuck: host.querySelectorAll('.pt--move').length}));
  }, 1600);
}); })()
"""
ev(ws, "window.__reset()")
r = json.loads(ev(ws, SPLIT))
check("при распаде метки выезжают из кластера",
      max(r["seen"]) > 0, "кадров с выезжающими метками: %d" % sum(1 for x in r["seen"] if x))
check("после распада ни одна метка не осталась сдвинутой",
      r["left"] == 0, "сдвинутых: %d" % r["left"])
check("и переход снят", r["stuck"] == 0, "с классом перехода: %d" % r["stuck"])

# ---- то же самое, но НАСТОЯЩИМИ касаниями ----
"""Все жесты выше разосланы из самой страницы. Этого хватает, чтобы поймать
пересборку, но мимо проходит половина пути: попадание пальца по элементу,
`touch-action` (без него браузер забрал бы щипок себе и увеличил всю
страницу целиком) и click, который браузер синтезирует после отпускания.
Здесь события идут снаружи, через протокол отладки, — то есть так же,
как от стекла киоска."""

def touch(kind, pts):
    ws.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints":
            [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


SEE = ("JSON.stringify({builds:window.__spy.builds, snap:window.__snap(),"
       " panel:!document.querySelector('#panel').hidden})")

print("=== ЩИПОК НАСТОЯЩИМИ КАСАНИЯМИ ===")
ev(ws, "window.__reset()")
ev(ws, "var i=document.querySelector('#idle'); i && (i.hidden = true)")
# Палец ставится ПРЯМО НА МЕТКУ: в зале карту берут именно так, и это
# худший случай — щипок не должен обернуться нажатием на метку.
fx, fy = json.loads(ev(ws, """(function(){
  var e = document.querySelector('#map-points .pt:not(.pt--ghost) .pt__dot');
  var r = e.getBoundingClientRect();
  return JSON.stringify([r.left + r.width/2, r.top + r.height/2]);
})()"""))
before = json.loads(ev(ws, SEE))
a, b = (fx, fy), (fx + 140, fy + 40)
touch("touchStart", [a, b])
seen = []
for i in range(1, 11):
    f = 1 + i * .13
    cx, cy = (a[0] + b[0]) / 2., (a[1] + b[1]) / 2.
    touch("touchMove", [(cx + (a[0] - cx) * f, cy + (a[1] - cy) * f),
                        (cx + (b[0] - cx) * f, cy + (b[1] - cy) * f)])
    time.sleep(.045)
    seen.append(json.loads(ev(ws, SEE)))
touch("touchEnd", [])
time.sleep(1.2)
after = json.loads(ev(ws, SEE))

check("настоящий щипок приблизил карту — браузер не забрал жест себе",
      seen[-1]["snap"]["w"] > before["snap"]["w"] * 1.5,
      "%d -> %d px" % (before["snap"]["w"], seen[-1]["snap"]["w"]))
check("за настоящий щипок слой меток не пересобрался ни разу",
      max(x["builds"] for x in seen) == 0,
      "пересборок за жест: %d" % max(x["builds"] for x in seen))
mx = max(drift(before["snap"]["rel"], x["snap"]["rel"]) for x in seen)
check("метки приклеены к местам и при настоящем касании",
      mx < 0.002, "наибольшее смещение: %.5f ширины слоя" % mx)
check("щипок с пальцем на метке не открыл карточку",
      not after["panel"] and not any(x["panel"] for x in seen))
check("после настоящего щипка пересборка ровно одна",
      after["builds"] == 1, "пересборок: %d" % after["builds"])

# Сведение пальцев: то же самое в обратную сторону
ev(ws, "window.__spy.builds = 0")
zoomed = json.loads(ev(ws, SEE))
cx, cy = json.loads(ev(ws, """(function(){
  var r = document.querySelector('#map-frame').getBoundingClientRect();
  return JSON.stringify([r.left + r.width/2, r.top + r.height/2]);
})()"""))
touch("touchStart", [(cx - 260, cy), (cx + 260, cy)])
seen2 = []
for i in range(1, 11):
    d = 260 - i * 22
    touch("touchMove", [(cx - d, cy), (cx + d, cy)])
    time.sleep(.045)
    seen2.append(json.loads(ev(ws, SEE)))
touch("touchEnd", [])
time.sleep(1.2)
back = json.loads(ev(ws, SEE))

check("за сведение пальцев слой тоже не пересобирался",
      max(x["builds"] for x in seen2) == 0,
      "пересборок за жест: %d" % max(x["builds"] for x in seen2))
check("после сведения группы собрались обратно",
      back["snap"]["n"] < zoomed["snap"]["n"],
      "%d -> %d меток на ширине %d px"
      % (zoomed["snap"]["n"], back["snap"]["n"], back["snap"]["w"]))

p.terminate()
sys.exit(total())
