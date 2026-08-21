/* Интерактивная карта мест заключения священнослужителей СЛОН.
   Данные — window.DATA из data/data.js (собирается build.py).
   Никаких модулей и сборки: страница должна открываться с флешки по file://. */
(function () {
  "use strict";

  var D = window.DATA;
  var $ = function (s) { return document.querySelector(s); };
  var byId = {};
  D.places.forEach(function (p) { byId[p.id] = p; });

  var IDLE_MS = 90000;   // возврат на экран покоя через 90 с бездействия

  /* ---------------- экраны ---------------- */

  function showView(name) {
    ["map", "registry", "glossary", "data"].forEach(function (v) {
      $("#view-" + v).hidden = v !== name;
    });
    document.querySelectorAll(".tab").forEach(function (t) {
      t.setAttribute("aria-selected", String(t.dataset.view === name));
    });
    // полоса разметки относится только к карте, на других вкладках она мешает
    $("#edit").hidden = !(editing && name === "map");
    closePanel();
  }

  document.querySelectorAll(".tab").forEach(function (t) {
    t.onclick = function () { showView(t.dataset.view); };
  });

  /* ---------------- панель карточки ---------------- */

  function openPanel(html) {
    $("#panel-body").innerHTML = html;
    $("#panel").hidden = false;
    $("#scrim").hidden = false;
    $("#panel").scrollTop = 0;
  }
  function closePanel() {
    $("#panel").hidden = true;
    $("#scrim").hidden = true;
    lbClose();
  }
  $("#panel-close").onclick = closePanel;
  $("#scrim").onclick = closePanel;

  // Клики по ссылкам внутри карточки (места и люди)
  $("#panel-body").onclick = function (e) {
    var el = e.target.closest("[data-person],[data-place]");
    if (!el) return;
    if (el.dataset.person) showPerson(el.dataset.person);
    else showPlace(el.dataset.place);
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function field(label, value, emptyText) {
    var has = value && String(value).trim();
    return '<div class="card__row"><p class="card__k">' + esc(label) + '</p>' +
      '<p class="card__v' + (has ? '' : ' card__v--none') + '">' +
      esc(has ? value : (emptyText || "сведения уточняются")) + '</p></div>';
  }

  /* ---------------- изображения ---------------- */
  /* Файлы ищутся по соглашению об имени: <id>.jpg, затем <id>-2.jpg, -3 и так далее.
     Каталог с file:// не прочитать, поэтому просто пробуем загрузить по очереди
     и останавливаемся на первом промахе. Подписи берутся из photo-credits.csv
     по имени файла, так что у каждого снимка может быть свой источник. */

  var PHOTO_MAX = 8;

  function creditHtml(name, tag) {
    var c = (D.credits || {})[name];
    var parts = c ? [c.author, c.date, c.license].filter(Boolean) : [];
    if (!parts.length) return "";
    var txt = esc(parts.join(" · "));
    var body = c.url
      ? '<a href="' + esc(c.url) + '" target="_blank" rel="noopener">' + txt + "</a>"
      : txt;
    return "<" + tag + ' class="' + (tag === "p" ? "card__credit" : "lb__cap") + '">' +
           body + "</" + tag + ">";
  }

  // Сначала изображение, встроенное через панель музея, затем файлы по соглашению.
  // Возвращаем пары {src, key}: key нужен, чтобы найти подпись в photo-credits.
  function findPhotos(dir, id, done) {
    var found = [];
    var embedded = (D.photos || {})[id];
    if (embedded) found.push({ src: embedded, key: id });
    var n = 0;
    (function step() {
      if (found.length >= PHOTO_MAX) return done(found);
      var name = id + (n ? "-" + (n + 1) : "");
      n++;
      var img = new Image();
      img.onload = function () {
        found.push({ src: "assets/" + dir + "/" + name + ".jpg", key: name });
        step();
      };
      img.onerror = function () { done(found); };
      img.src = "assets/" + dir + "/" + name + ".jpg";
    })();
  }

  var lbList = [], lbDir = "", lbAt = 0;

  function lbShow(i) {
    lbAt = (i + lbList.length) % lbList.length;
    $("#lb-img").src = lbList[lbAt].src;
    $("#lb-cap").innerHTML = creditHtml(lbList[lbAt].key, "span");
    var many = lbList.length > 1;
    $("#lb-prev").hidden = !many;
    $("#lb-next").hidden = !many;
  }
  function lbOpen(dir, list, i) {
    lbDir = dir; lbList = list;
    $("#lb").hidden = false;
    lbShow(i);
  }
  function lbClose() { $("#lb").hidden = true; }

  $("#lb-close").onclick = lbClose;
  $("#lb-img").onclick = lbClose;
  $("#lb").onclick = function (e) { if (e.target === $("#lb")) lbClose(); };
  $("#lb-prev").onclick = function () { lbShow(lbAt - 1); };
  $("#lb-next").onclick = function () { lbShow(lbAt + 1); };
  document.addEventListener("keydown", function (e) {
    if ($("#lb").hidden) return;
    if (e.key === "Escape") lbClose();
    if (e.key === "ArrowLeft") lbShow(lbAt - 1);
    if (e.key === "ArrowRight") lbShow(lbAt + 1);
  });

  // Галерея вставляется в карточку после того, как выяснилось, сколько файлов есть
  function fillGallery(dir, id) {
    var slot = $("#gallery");
    if (!slot) return;
    findPhotos(dir, id, function (list) {
      if (!list.length) { slot.remove(); return; }
      var thumbs = list.length > 1
        ? '<div class="card__thumbs">' + list.map(function (it, i) {
            return '<img class="card__thumb' + (i ? "" : " is-on") + '" data-i="' + i +
                   '" src="' + esc(it.src) + '" alt="">';
          }).join("") + "</div>"
        : "";
      slot.innerHTML = '<img class="card__photo" id="gal-main" src="' + esc(list[0].src) +
        '" alt="">' + creditHtml(list[0].key, "p") + thumbs;

      function pick(i) {
        $("#gal-main").src = list[i].src;
        var cap = slot.querySelector(".card__credit");
        var html = creditHtml(list[i].key, "p");
        if (cap) cap.outerHTML = html || '<p class="card__credit"></p>';
        slot.querySelectorAll(".card__thumb").forEach(function (el, j) {
          el.classList.toggle("is-on", j === i);
        });
        slot.dataset.at = i;
      }
      slot.dataset.at = 0;
      slot.onclick = function (e) {
        var th = e.target.closest(".card__thumb");
        if (th) { pick(+th.dataset.i); return; }
        if (e.target.id === "gal-main") lbOpen(dir, list, +(slot.dataset.at || 0));
      };
    });
  }

  function personRowHtml(p) {
    return '<li><button class="row" data-person="' + p.id + '">' +
      '<span class="row__name">' + esc(p.name + " " + p.surname) + '</span>' +
      '<span class="row__rank">' + esc(p.rank) + '</span>' +
      (p.source ? '' : '<span class="row__flag">без источника</span>') +
      '</button></li>';
  }

  function showPerson(id) {
    var p = D.persons.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var places = p.places.map(function (pid) {
      return '<button class="chip" data-place="' + pid + '">' + esc(byId[pid].name) + '</button>';
    }).join("");

    openPanel(
      '<p class="card__over">Персоналия</p>' +
      '<figure class="card__fig" id="gallery"></figure>' +
      '<h2 class="card__name">' + esc((p.name + " " + p.surname).trim()) + '</h2>' +
      '<p class="card__rank">' + esc(p.rank) + '</p>' +
      '<div class="card__row"><p class="card__k">Место пребывания</p>' +
        (places ? '<div>' + places + '</div>'
                : '<p class="card__v card__v--none">не установлено</p>') + '</div>' +
      field("Годы и обстоятельства", p.years) +
      field("Источник", p.source, "ссылка на источник не указана — требует уточнения")
    );
    fillGallery("photos", p.id);
  }

  function showPlace(id) {
    var pl = byId[id];
    if (!pl) return;
    var people = D.persons.filter(function (p) { return p.places.indexOf(id) >= 0; });
    var kids = D.places.filter(function (p) { return p.parent === id; });
    var kidsHtml = kids.length
      ? '<div class="card__row"><p class="card__k">Внутри этого места</p>' +
        '<ul class="list card__list">' + kids.map(function (p) {
          return '<li><button class="row" data-place="' + p.id + '">' +
            '<span class="row__name">' + esc(p.name) + '</span>' +
            '<span class="row__rank">' + esc(p.type) + '</span>' +
            '<span class="row__flag">' + p.count + '</span></button></li>';
        }).join("") + '</ul></div>'
      : '';
    var warn = pl.count !== pl.museumCount
      ? '<div class="card__row"><p class="card__k">Расхождение</p><p class="card__v card__v--none">' +
        'по учёту музея — ' + pl.museumCount + ', в таблице расписано — ' + pl.count +
        '. Уточнить у заказчика.</p></div>' : '';

    openPanel(
      '<p class="card__over">' + esc(pl.type) + '</p>' +
      '<figure class="card__fig" id="gallery"></figure>' +
      '<h2 class="card__name">' + esc(pl.name) + '</h2>' +
      '<p class="card__rank">' + esc(pl.full) + '</p>' +
      field("Историческая справка", pl.about, "справка ещё не написана") +
      field("Работы заключённых", pl.work, "сведения уточняются") +
      kidsHtml + warn +
      '<div class="card__row"><p class="card__k">Известно имён: ' + people.length + '</p>' +
      '<ul class="list card__list">' + people.map(personRowHtml).join("") + '</ul></div>'
    );
    fillGallery("places", id);
  }

  function showUnplaced() {
    var people = D.persons.filter(function (p) { return !p.places.length; });
    openPanel(
      '<p class="card__over">Место не установлено</p>' +
      '<h2 class="card__name">' + people.length + " имён</h2>" +
      '<p class="card__rank">Известно, что эти люди прошли через соловецкие лагеря, ' +
      'но где именно они содержались и работали — пока не установлено. Исследование продолжается.</p>' +
      '<ul class="list card__list">' + people.map(personRowHtml).join("") + '</ul>'
    );
  }
  $("#btn-unplaced").onclick = showUnplaced;

  /* ---------------- карта: раскладка, зум, панорама ---------------- */

  var K_MIN = 1, K_MAX = 24;
  var k = 1, tx = 0, ty = 0;            // масштаб и сдвиг от центра, px
  var fitW = 0, fitH = 0;               // размер карты при k = 1
  var lastK = -1;                       // масштаб, на котором собраны группы
  var frame = $("#map-frame"), inner = $("#map-inner"), baseImg = $("#map-base");

  // Тема живёт в данных (settings.theme), а не в разметке: иначе сотруднику музея
  // пришлось бы править index.html руками. Цвета карты зашиты внутрь SVG —
  // CSS до них не достаёт, поэтому подложка подменяется файлом.
  var THEME_KEY = "okoyom-theme";

  function applyTheme(name, remember) {
    D.settings = D.settings || {};
    D.settings.theme = name;
    document.documentElement.setAttribute("data-theme", name);
    var want = name === "light" ? "assets/map-base-light.svg" : "assets/map-base.svg";
    if (baseImg.getAttribute("src") !== want) baseImg.src = want;
    // Запоминаем в браузере: иначе выбор слетал бы при каждом обновлении страницы,
    // пока сотрудник не выгрузит файлы. settings.csv остаётся умолчанием
    // для свежей копии приложения на другой машине.
    if (remember) {
      try { localStorage.setItem(THEME_KEY, name); } catch (e) {}
    }
  }

  var savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(savedTheme || (D.settings || {}).theme || "light", false);

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Карта подгоняется ПО ШИРИНЕ, а не вписывается целиком.
  // Причина в самой карте: суша (материковый берег) доходит до западной кромки,
  // а север и юг — открытое море. Поле сбоку обрывало бы материк ровной
  // вертикалью посреди воды; поле сверху и снизу просто сливается с морем,
  // потому что рамка покрашена в тот же цвет.
  // Закрывать кадр целиком тоже нельзя: на вертикальном экране обрезало бы
  // Кемь, а это 24 человека.
  function layout() {
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var iw = baseImg.naturalWidth || 1, ih = baseImg.naturalHeight || 1;
    fitW = fw;
    fitH = fw * ih / iw;
    lastK = -1;      // размер карты изменился — группы пересобрать заново
    resetZoom();     // и заново подобрать вид под область с метками
  }

  // Зум — это ширина и высота, а не transform. SVG и текст перерисовываются
  // на новом размере и остаются чёткими на любом масштабе.
  function apply() {
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var w = fitW * k, h = fitH * k;
    var mx = Math.max(0, (w - fw) / 2), my = Math.max(0, (h - fh) / 2);
    tx = clamp(tx, -mx, mx);
    ty = clamp(ty, -my, my);
    inner.style.width = w + "px";
    inner.style.height = h + "px";
    inner.style.left = ((fw - w) / 2 + tx) + "px";
    inner.style.top = ((fh - h) / 2 + ty) + "px";
    if (k !== lastK) { lastK = k; buildPoints(); }   // группы пересобираются от масштаба
    else relabel();                                   // при сдвиге хватает подписей
  }

  // Подписи налезают друг на друга там, где точки стоят кучно.
  // Жадно прячем те, что пересекаются с уже показанной: приоритет —
  // у мест с большим числом людей. При зуме точки расходятся,
  // места освобождается больше, и подписи возвращаются сами.
  function relabel() {
    var els = [].slice.call(inner.querySelectorAll(".pt"));
    if (!els.length || !inner.clientWidth) return;
    els.sort(function (a, b) {
      return byId[b.dataset.place].count - byId[a.dataset.place].count;
    });
    var PAD = 3, dots = [], shown = [];
    for (var d = 0; d < els.length; d++) {
      var dr = els[d].querySelector(".pt__dot").getBoundingClientRect();
      dots.push({ l: dr.left - 1, t: dr.top - 1, r: dr.right + 1, b: dr.bottom + 1 });
    }
    function hits(box, o) {
      return box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t;
    }
    function free(box, self) {
      for (var s = 0; s < shown.length; s++) if (hits(box, shown[s])) return false;
      // чужие кружки тоже занимают место, свой собственный — нет
      for (var q = 0; q < dots.length; q++) if (q !== self && hits(box, dots[q])) return false;
      return true;
    }
    function boxOf(lab) {
      var r = lab.getBoundingClientRect();
      return { l: r.left - PAD, t: r.top - PAD, r: r.right + PAD, b: r.bottom + PAD };
    }
    var SPOTS = ["", "pt__label--top", "pt__label--right", "pt__label--left"];
    for (var i = 0; i < els.length; i++) {
      var lab = els[i].querySelector(".pt__label");
      lab.style.visibility = "visible";
      var placed = null;
      for (var v = 0; v < SPOTS.length; v++) {
        lab.className = "pt__label" + (SPOTS[v] ? " " + SPOTS[v] : "");
        var box = boxOf(lab);
        if (free(box, i)) { placed = box; break; }
      }
      if (placed) shown.push(placed);
      else { lab.className = "pt__label"; lab.style.visibility = "hidden"; }
    }
  }

  // Точка под курсором остаётся на месте.
  function zoomAt(cx, cy, factor) {
    var k2 = clamp(k * factor, K_MIN, K_MAX);
    if (k2 === k) return;
    var r = frame.getBoundingClientRect();
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var w = fitW * k, w2 = fitW * k2, h = fitH * k, h2 = fitH * k2;
    var sx = cx - r.left, sy = cy - r.top;            // курсор в координатах рамки
    var px = (sx - (fw - w) / 2 - tx) / w;            // та же точка в долях картинки
    var py = (sy - (fh - h) / 2 - ty) / h;
    tx = sx - (fw - w2) / 2 - px * w2;
    ty = sy - (fh - h2) / 2 - py * h2;
    k = k2;
    if (k === K_MIN) { tx = 0; ty = 0; }
    apply();
  }

  // Вид по умолчанию подгоняется под ОБЛАСТЬ С МЕТКАМИ, а не под весь лист.
  // Лист шире и выше, чем нужно: по краям пустое море. На широком экране это
  // терпимо, на вертикальном киоске карта превращалась в тонкую полосу
  // с пустой водой сверху и снизу на две трети высоты.
  function defaultView() {
    var pts = mapped();
    if (!pts.length || !fitW) return { k: 1, tx: 0, ty: 0 };
    var x0 = 100, x1 = 0, y0 = 100, y1 = 0;
    pts.forEach(function (p) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    });
    var PADX = 7, PADY = 9;            // запас под кружки и подписи
    x0 -= PADX; x1 += PADX; y0 -= PADY; y1 += PADY;
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var kx = fw / (fitW * (x1 - x0) / 100);
    var ky = fh / (fitH * (y1 - y0) / 100);
    var k0 = clamp(Math.min(kx, ky), K_MIN, K_MAX);
    var cx = (x0 + x1) / 200, cy = (y0 + y1) / 200;
    return { k: k0, tx: (0.5 - cx) * fitW * k0, ty: (0.5 - cy) * fitH * k0 };
  }

  function resetZoom() {
    var v = defaultView();
    k = v.k; tx = v.tx; ty = v.ty;
    apply();
  }

  function zoomCenter(f) {
    var r = frame.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  }

  $("#z-in").onclick = function () { zoomCenter(1.5); };
  $("#z-out").onclick = function () { zoomCenter(1 / 1.5); };
  $("#z-reset").onclick = resetZoom;

  frame.addEventListener("wheel", function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  // Панорама и щипок. Один палец — тащим, два — масштабируем.
  var ptrs = {}, panFrom = null, pinchFrom = null;
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  frame.addEventListener("pointerdown", function (e) {
    if (editing && e.target.closest(".pt")) return;   // в разметке метку тащим отдельно
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    if (ids.length === 1) {
      panFrom = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      frame.classList.add("is-drag");
    } else if (ids.length === 2) {
      panFrom = null;
      pinchFrom = { d: dist(ptrs[ids[0]], ptrs[ids[1]]), k: k };
    }
  });

  frame.addEventListener("pointermove", function (e) {
    if (!ptrs[e.pointerId]) return;
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(ptrs);
    if (pinchFrom && ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (dist(a, b) / pinchFrom.d) * pinchFrom.k / k);
    } else if (panFrom && (fitW * k > frame.clientWidth + 1 ||
                           fitH * k > frame.clientHeight + 1)) {
      tx = panFrom.tx + (e.clientX - panFrom.x);
      ty = panFrom.ty + (e.clientY - panFrom.y);
      apply();
    }
  });

  function endPtr(e) {
    delete ptrs[e.pointerId];
    if (Object.keys(ptrs).length < 2) pinchFrom = null;
    if (!Object.keys(ptrs).length) { panFrom = null; frame.classList.remove("is-drag"); }
  }
  frame.addEventListener("pointerup", endPtr);
  frame.addEventListener("pointercancel", endPtr);

  window.addEventListener("resize", layout);
  baseImg.addEventListener("load", layout);

  // Размер кружка растёт с числом людей, но упирается в потолок.
  // Без потолка Кремль с его 83 именами превращается в кляксу
  // и физически накрывает соседние точки.
  // Вид метки по типу места. Палитра и значки правятся в data/types.csv
  // и в панели музея — код про конкретные цвета ничего не знает.
  var TYPES = {};
  (D.types || []).forEach(function (t) { TYPES[t.type] = t; });

  // Две разные таксономии: типы мест и виды работ. Смешивать нельзя —
  // это ответы на разные вопросы, и у музея они разными легендами.
  function typesOf(kind) {
    return (D.types || []).filter(function (t) { return (t.kind || "place") === kind; });
  }

  function typeOf(p) {
    return TYPES[(p.type || "").trim()] || null;
  }
  function iconSvg(name, cls) {
    var body = (window.ICONS || {})[name];
    if (!body) return "";
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true">' + body + "</svg>";
  }

  var SIZE_CAP = 40;
  function dotSize(n) {
    return 24 + Math.round(28 * Math.sqrt(Math.min(n, SIZE_CAP) / SIZE_CAP));
  }

  // Точки, оказавшиеся ближе суммы радиусов, сливаются в одну группу.
  // Часть наложений неустранима координатами: Никольский лазарет стоит
  // внутри Кремля, Рабочий городок вплотную. При зуме расстояния растут
  // в пикселях, и группы распадаются сами.
  // Места с указанным parent на карте не рисуются: они показываются
  // внутри карточки родителя. Так Никольский лазарет перестаёт спорить
  // с Кремлём за одну и ту же точку.
  function mapped() {
    return D.places.filter(function (p) { return !p.parent; });
  }

  function cluster() {
    var w = fitW * k, h = fitH * k;
    var list = mapped().map(function (p) {
      return { p: p, px: p.x / 100 * w, py: p.y / 100 * h, r: dotSize(p.count) / 2 };
    }).sort(function (a, b) { return b.p.count - a.p.count; });

    var groups = [], taken = [];
    for (var i = 0; i < list.length; i++) {
      if (taken[i]) continue;
      var g = [list[i]];
      taken[i] = true;
      for (var j = i + 1; j < list.length; j++) {
        if (taken[j]) continue;
        var d = Math.hypot(list[i].px - list[j].px, list[i].py - list[j].py);
        if (d < list[i].r + list[j].r + 4) { g.push(list[j]); taken[j] = true; }
      }
      groups.push(g);
    }
    return groups;
  }

  function buildPoints() {
    // В режиме разметки группировка мешает: метки надо таскать поштучно
    var groups = editing ? mapped().map(function (p) {
      return [{ p: p, px: 0, py: 0, r: 0 }];
    }) : cluster();

    $("#map-points").innerHTML = groups.map(function (g) {
      var head = g[0].p;
      var n = 0;
      for (var i = 0; i < g.length; i++) n += g[i].p.count;
      var ids = g.map(function (m) { return m.p.id; }).join(" ");
      var label = g.length > 1 ? head.name + " +" + (g.length - 1) : head.name;
      var size = dotSize(n);
      var ty = typeOf(head);
      var col = ty && ty.color ? ";background:" + ty.color : "";
      var badge = ty && ty.icon && g.length === 1 ? iconSvg(ty.icon, "pt__ic") : "";
      return '<button class="pt' + (n ? "" : " pt--empty") + (g.length > 1 ? " pt--group" : "") + '"' +
        ' data-place="' + head.id + '" data-ids="' + ids + '"' +
        ' style="left:' + head.x + '%;top:' + head.y + '%;z-index:' + (10 + Math.min(n, 99)) + '">' +
        '<span class="pt__dot" style="width:' + size + 'px;height:' + size + 'px' + col + '">' +
        n + badge + '</span>' +
        '<span class="pt__label">' + esc(label) + '</span></button>';
    }).join("");

    $("#map-points").onclick = function (e) {
      var b = e.target.closest("[data-place]");
      if (!b || editing) return;
      var ids = b.dataset.ids.split(" ");
      if (ids.length > 1) showGroup(ids); else showPlace(ids[0]);
    };
    relabel();
  }

  // Дублирует метки карты списком: на вертикальном экране это основной способ
  // добраться до места, потому что сама карта там мелкая.
  function renderPlaceStrip() {
    var list = mapped().slice().sort(function (a, b) { return b.count - a.count; });
    $("#plist").innerHTML = list.map(function (p) {
      var ty = typeOf(p);
      return '<button class="plist__b" data-place="' + p.id + '">' +
        '<span class="plist__d" style="background:' + (ty && ty.color ? esc(ty.color) : "var(--accent)") +
        '">' + p.count + "</span><span>" + esc(p.name) + "</span>" +
        '<span class="plist__t">' + esc(ty ? (ty.label || ty.type) : p.type) + "</span></button>";
    }).join("");
    $("#plist").onclick = function (e) {
      var b = e.target.closest("[data-place]");
      if (b && !editing) showPlace(b.dataset.place);
    };
  }

  function renderLegend() {
    var used = {};
    mapped().forEach(function (p) {
      var t = typeOf(p);
      if (t) used[t.type] = t;
    });
    var items = Object.keys(used).map(function (k) { return used[k]; });

    // Виды работ — отдельной группой и только если зоны действительно есть
    var zused = {};
    D.zones.forEach(function (z) {
      var t = TYPES[(z.type || "").trim()];
      if (t) zused[t.type] = t;
    });
    var zitems = Object.keys(zused).map(function (k) { return zused[k]; });

    function line(t, zone) {
      return '<span class="legend__i"><span class="legend__d' + (zone ? " legend__d--z" : "") +
        '" style="background:' + esc(t.color) + '">' +
        (zone ? "" : iconSvg(t.icon, "pt__ic")) + "</span>" + esc(t.label || t.type) + "</span>";
    }
    var html = items.length < 2 ? "" : items.map(function (t) { return line(t, false); }).join("");
    if (zitems.length) {
      html += '<span class="legend__h">Работы</span>' +
        zitems.map(function (t) { return line(t, true); }).join("");
    }
    $("#legend").innerHTML = html;
  }

  // Карточка группы: перечень слипшихся мест с числами
  function showGroup(ids) {
    var list = ids.map(function (id) { return byId[id]; });
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i].count;
    openPanel(
      '<p class="card__over">Несколько мест рядом</p>' +
      '<h2 class="card__name">' + list.length + ' места, ' + total + ' имён</h2>' +
      '<p class="card__rank">Точки стоят слишком близко, чтобы развести их на карте. ' +
      'Приблизьте карту — они разойдутся сами, или выберите место из списка.</p>' +
      '<ul class="list card__list">' + list.map(function (p) {
        return '<li><button class="row" data-place="' + p.id + '">' +
          '<span class="row__name">' + esc(p.name) + '</span>' +
          '<span class="row__rank">' + esc(p.type) + '</span>' +
          '<span class="row__flag">' + p.count + '</span></button></li>';
      }).join("") + '</ul>'
    );
  }

  function renderMap() {
    lastK = -1;
    buildPoints();
    $("#btn-unplaced").querySelector(".unplaced__n").textContent = D.meta.unplaced;
    renderLegend();
    renderPlaceStrip();
    renderZones();
    if (baseImg.complete) layout(); else apply();
  }

  /* ---------------- режим разметки ---------------- */
  /* Метки перетаскиваются мышью, на выходе — готовые столбцы x,y для places.csv.
     Нужен, когда карту заменят на изображение и координаты перестанут
     считаться из широты и долготы. Включение: Ctrl+E или #edit в адресе. */

  var editing = false, dragPt = null;

  function editOut() {
    var moved = "id,x,y\n" + D.places.map(function (p) {
      return p.id + "," + p.x.toFixed(1) + "," + p.y.toFixed(1);
    }).join("\n");
    var fresh = D.places.filter(function (p) { return p.isNew; });
    if (fresh.length) {
      moved += "\n\n# новые места — вставить строками в places.csv и заполнить названия:\n" +
        "# id,name_short,name_full,type,about,work,x,y,persons_museum_count,lat_approx,lon_approx,coord_status,note\n" +
        fresh.map(function (p) {
          return p.id + ",НОВОЕ МЕСТО,,командировка,,," +
                 p.x.toFixed(1) + "," + p.y.toFixed(1) + ",0,,,НЕ ВЕРИФИЦИРОВАНО,";
        }).join("\n");
    }
    $("#edit-out").value = moved;
  }

  // Клик по пустому месту карты в режиме разметки заводит новую точку.
  // Координаты снимаются кликом, названия дописываются в places.csv.
  function addPlace(cx, cy) {
    var r = inner.getBoundingClientRect();
    var n = 1;
    while (byId["L" + (n < 10 ? "0" : "") + n]) n++;
    var p = {
      id: "L" + (n < 10 ? "0" : "") + n,
      name: "НОВОЕ МЕСТО", full: "", type: "командировка",
      about: "", work: "", note: "", museumCount: 0, count: 0, isNew: true,
      x: clamp((cx - r.left) / r.width * 100, 0, 100),
      y: clamp((cy - r.top) / r.height * 100, 0, 100)
    };
    D.places.push(p);
    byId[p.id] = p;
    renderMap();
    setEdit(true);
  }

  function setEdit(on) {
    editing = on;
    $("#edit").hidden = !(on && $("#view-map") && !$("#view-map").hidden);
    document.querySelector(".tab--staff").hidden = !on;
    document.body.classList.toggle("is-edit", on);
    if (on) renderStaff();
    else if (!$("#view-data").hidden) showView("map");
    var pts = inner.querySelectorAll(".pt");
    for (var i = 0; i < pts.length; i++) pts[i].classList.toggle("pt--edit", on);
    if (on) editOut();
  }

  /* Вход в служебный режим — тремя способами, и это не роскошь:
     в зале у киоска может не быть клавиатуры вообще.
       1. долгое нажатие на заголовок слева вверху (2 секунды) — работает на сенсоре;
       2. Cmd+E или Ctrl+E — на маке Ctrl+E перехватывает система, поэтому оба;
       3. адрес index.html#edit — когда под рукой клавиатура и адресная строка. */

  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      setEdit(!editing);
    }
  });
  if (location.hash === "#edit") setTimeout(function () { setEdit(true); }, 0);

  (function longPress() {
    var el = document.querySelector(".top__title"), timer = null;
    function start() {
      clearTimeout(timer);
      el.classList.add("is-hold");
      timer = setTimeout(function () {
        el.classList.remove("is-hold");
        setEdit(!editing);
      }, 2000);
    }
    function stop() {
      clearTimeout(timer);
      el.classList.remove("is-hold");
    }
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointerleave", stop);
    el.addEventListener("pointercancel", stop);
  })();

  $("#edit-off").onclick = function () { setEdit(false); };
  $("#edit-copy").onclick = function () {
    $("#edit-out").select();
    try { document.execCommand("copy"); } catch (err) {}
    $("#edit-copy").textContent = "Скопировано";
    setTimeout(function () { $("#edit-copy").textContent = "Скопировать"; }, 1500);
  };

  inner.addEventListener("pointerdown", function (e) {
    if (!editing) return;
    var el = e.target.closest(".pt");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    dragPt = byId[el.dataset.place];
    el.setPointerCapture(e.pointerId);
  });

  inner.addEventListener("pointermove", function (e) {
    if (!dragPt) return;
    var r = inner.getBoundingClientRect();     // учитывает текущий зум и сдвиг
    dragPt.x = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
    dragPt.y = clamp((e.clientY - r.top) / r.height * 100, 0, 100);
    var el = inner.querySelector('[data-place="' + dragPt.id + '"]');
    el.style.left = dragPt.x + "%";
    el.style.top = dragPt.y + "%";
    editOut();
  });

  inner.addEventListener("pointerup", function () { dragPt = null; });

  inner.addEventListener("click", function (e) {
    if (editing && !e.target.closest(".pt")) addPlace(e.clientX, e.clientY);
  });

  /* ---------------- реестр ---------------- */

  function fillSelect(sel, values) {
    sel.innerHTML += values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + "</option>";
    }).join("");
  }

  function renderRegistry() {
    var q = $("#q").value.trim().toLowerCase();
    var rank = $("#f-rank").value;
    var place = $("#f-place").value;

    var rows = D.persons.filter(function (p) {
      if (rank && p.rank !== rank) return false;
      if (place === "__none" && p.places.length) return false;
      if (place && place !== "__none" && p.places.indexOf(place) < 0) return false;
      if (q && (p.name + " " + p.surname).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    $("#list").innerHTML = rows.map(personRowHtml).join("") ||
      '<li class="card__v--none">Ничего не найдено</li>';
    $("#found").textContent = rows.length + " из " + D.meta.total;
  }

  $("#list").onclick = function (e) {
    var b = e.target.closest("[data-person]");
    if (b) showPerson(b.dataset.person);
  };
  ["#q", "#f-rank", "#f-place"].forEach(function (s) {
    $(s).oninput = renderRegistry;
  });

  /* ---------------- словарь ---------------- */

  function renderGlossary() {
    $("#glossary").innerHTML = D.glossary.map(function (g) {
      return "<dt>" + esc(g.term) + "</dt><dd>" + esc(g.text) + "</dd>";
    }).join("");
  }

  /* ---------------- панель музея ---------------- */
  /* Полноценный редактор: персоналии, места, вид меток, изображения.
     Правится всё, что видит посетитель. Источник правды — data/persons.csv
     и data/places.csv; приложение выгружает их обратно готовыми файлами.

     Изображения можно не раскладывать по папкам: выбранный файл уменьшается
     прямо в браузере и хранится внутри данных. Для сотрудника это один клик,
     а не «положите файл с правильным именем в правильную папку». */

  D.photos = D.photos || {};          // встроенные изображения: id -> data:URL

  var subNow = "over", edPerson = null, edPlace = null;

  function showSub(name) {
    subNow = name;
    ["over", "pers", "plcs", "zons", "typs"].forEach(function (s) {
      $("#sub-" + s).hidden = s !== name;
    });
    document.querySelectorAll(".sub__b").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.sub === name));
    });
    if (name === "over") renderOverview();
    if (name === "pers") { renderPersonList(); renderPersonForm(); }
    if (name === "plcs") { renderPlaceList(); renderPlaceForm(); }
    if (name === "zons") { renderZoneList(); renderZoneForm(); }
    if (name === "typs") { renderThemes(); renderTypes(); }
  }
  $("#dt-sub").onclick = function (e) {
    var b = e.target.closest("[data-sub]");
    if (b) showSub(b.dataset.sub);
  };

  /* ---- обзор ---- */

  function issueHtml(key, n, title, items, ok) {
    return '<div class="iss' + (ok ? " iss--ok" : "") + '">' +
      '<button class="iss__t" data-iss="' + key + '">' +
      '<span class="iss__n">' + n + '</span><span>' + esc(title) + '</span></button>' +
      '<ul class="iss__b" id="iss-' + key + '" hidden>' +
      (items.length ? items.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("")
                    : "<li>всё в порядке</li>") + "</ul></div>";
  }

  function renderOverview() {
    var P = D.persons, PL = D.places;
    var noSrc = P.filter(function (p) { return !p.source; });
    var noPlace = P.filter(function (p) { return !p.places.length; });
    var noAbout = PL.filter(function (p) { return !p.about; });
    var diff = PL.filter(function (p) { return p.count !== p.museumCount; });
    var nm = function (p) { return (p.name + " " + p.surname).trim() + " — " + p.rank; };

    $("#dt-sum").innerHTML = [
      [P.length, "персоналий"], [P.length - noPlace.length, "с местом"],
      [P.length - noSrc.length, "со ссылкой"], [PL.length, "мест"],
      [PL.length - noAbout.length, "мест со справкой"]
    ].map(function (x) {
      return '<div><span class="dt__n">' + x[0] + '</span><span class="dt__l">' + x[1] + "</span></div>";
    }).join("");

    $("#dt-issues").innerHTML =
      issueHtml("src", noSrc.length, "персоналий без ссылки на источник", noSrc.slice(0, 200).map(nm), !noSrc.length) +
      issueHtml("plc", noPlace.length, "персоналий без места пребывания", noPlace.slice(0, 200).map(nm), !noPlace.length) +
      issueHtml("dif", diff.length, "мест с расхождением счёта", diff.map(function (p) {
        return p.name + ": по учёту музея " + p.museumCount + ", расписано " + p.count;
      }), !diff.length) +
      issueHtml("abt", noAbout.length, "мест без исторической справки",
        noAbout.map(function (p) { return p.name; }), !noAbout.length);

    $("#dt-issues").onclick = function (e) {
      var b = e.target.closest("[data-iss]");
      if (!b) return;
      var body = $("#iss-" + b.dataset.iss);
      if (body) body.hidden = !body.hidden;
    };
  }

  /* ---- изображения ---- */

  function pickImage(id, after) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          // уменьшаем до 900 px по длинной стороне — иначе данные разбухнут
          var k = Math.min(1, 900 / Math.max(img.width, img.height));
          var cv = document.createElement("canvas");
          cv.width = Math.round(img.width * k);
          cv.height = Math.round(img.height * k);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          D.photos[id] = cv.toDataURL("image/jpeg", 0.75);
          after();
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    };
    inp.click();
  }

  function picHtml(dir, id) {
    var src = D.photos[id] || ("assets/" + dir + "/" + id + ".jpg");
    return '<div class="ed__pic">' +
      '<img src="' + esc(src) + '" alt="" onerror="this.style.display=\'none\'">' +
      '<div><button class="edit__btn" data-pic="' + id + '">Выбрать файл…</button>' +
      (D.photos[id] ? ' <button class="ed__del" data-picdel="' + id + '">убрать</button>' : "") +
      '<p class="fld__hint">Уменьшится автоматически. Можно и просто положить файл ' +
      '<code>' + esc(id) + '.jpg</code> в папку <code>assets/' + dir + '</code>.</p></div></div>';
  }

  /* ---- персоналии ---- */

  function renderPersonList() {
    var q = ($("#ed-q").value || "").trim().toLowerCase();
    var rows = D.persons.filter(function (p) {
      return !q || (p.name + " " + p.surname).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 300);
    $("#ed-rows").innerHTML = rows.map(function (p) {
      return '<button class="ed__r" data-p="' + p.id + '"' +
        (edPerson === p.id ? ' aria-selected="true"' : "") + ">" +
        esc((p.name + " " + p.surname).trim()) +
        "<small>" + esc(p.rank || "сан не указан") + "</small></button>";
    }).join("") || '<p class="ed__empty" style="padding:.6em">Ничего не найдено</p>';
  }
  $("#ed-q").oninput = renderPersonList;
  $("#ed-rows").onclick = function (e) {
    var b = e.target.closest("[data-p]");
    if (!b) return;
    edPerson = b.dataset.p;
    renderPersonList();
    renderPersonForm();
  };

  function fld(k, html, hint) {
    return '<div class="fld"><span class="fld__k">' + esc(k) + "</span>" + html +
      (hint ? '<p class="fld__hint">' + esc(hint) + "</p>" : "") + "</div>";
  }

  function renderPersonForm() {
    var p = D.persons.filter(function (x) { return x.id === edPerson; })[0];
    if (!p) {
      $("#ed-form").innerHTML = '<p class="ed__empty">Выберите человека в списке слева ' +
        'или добавьте нового.</p>';
      return;
    }
    $("#ed-form").innerHTML =
      fld("имя", '<input data-k="name" value="' + esc(p.name) + '">') +
      fld("фамилия", '<input data-k="surname" value="' + esc(p.surname) + '">') +
      fld("сан", '<input data-k="rank" value="' + esc(p.rank) + '">',
          "как в источнике: священник, протоиерей, епископ, иеромонах") +
      fld("годы и обстоятельства", '<textarea rows="3" data-k="years">' + esc(p.years) + "</textarea>") +
      fld("источник", '<textarea rows="2" data-k="source">' + esc(p.source) + "</textarea>",
          "издание и страница. Пусто — в карточке будет «сведения уточняются»") +
      fld("места пребывания", '<div class="chks">' + D.places.map(function (pl) {
        var on = p.places.indexOf(pl.id) >= 0;
        return '<label class="chk' + (on ? " is-on" : "") + '"><input type="checkbox" data-pl="' +
          pl.id + '"' + (on ? " checked" : "") + ">" + esc(pl.name) + "</label>";
      }).join("") + "</div>") +
      fld("фотография", picHtml("photos", p.id)) +
      '<p class="fld__hint" style="grid-column:1/-1">Идентификатор: ' + esc(p.id) +
      ' · <button class="ed__del" data-pdel="' + p.id + '">удалить человека</button></p>';

    $("#ed-form").oninput = function (e) {
      var k = e.target.dataset.k;
      if (k) { p[k] = e.target.value; renderPersonList(); return; }
      var pl = e.target.dataset.pl;
      if (pl) {
        var i = p.places.indexOf(pl);
        if (e.target.checked && i < 0) p.places.push(pl);
        if (!e.target.checked && i >= 0) p.places.splice(i, 1);
        e.target.closest(".chk").classList.toggle("is-on", e.target.checked);
        recount();
      }
    };
    $("#ed-form").onclick = function (e) {
      var t = e.target;
      if (t.dataset.pic) return pickImage(t.dataset.pic, renderPersonForm);
      if (t.dataset.picdel) { delete D.photos[t.dataset.picdel]; renderPersonForm(); }
      if (t.dataset.pdel) {
        if (!confirm("Удалить " + (p.name + " " + p.surname).trim() + " из реестра?")) return;
        D.persons.splice(D.persons.indexOf(p), 1);
        edPerson = null;
        recount(); renderPersonList(); renderPersonForm();
      }
    };
  }

  $("#ed-add").onclick = function () {
    var id = "P" + Math.random().toString(16).slice(2, 8);
    D.persons.unshift({ id: id, name: "", surname: "Новая запись", rank: "",
                        years: "", source: "", places: [] });
    edPerson = id;
    $("#ed-q").value = "";
    renderPersonList(); renderPersonForm();
  };

  function recount() {
    var c = {};
    D.persons.forEach(function (p) {
      p.places.forEach(function (id) { c[id] = (c[id] || 0) + 1; });
    });
    D.places.forEach(function (p) { p.count = c[p.id] || 0; });
    D.meta.total = D.persons.length;
    D.meta.placed = D.persons.filter(function (p) { return p.places.length; }).length;
    D.meta.unplaced = D.meta.total - D.meta.placed;
    D.meta.withSource = D.persons.filter(function (p) { return p.source; }).length;
    renderMap();
    renderRegistry();
  }

  /* ---- места ---- */

  function renderPlaceList() {
    $("#pl-rows").innerHTML = D.places.map(function (p) {
      return '<button class="ed__r" data-l="' + p.id + '"' +
        (edPlace === p.id ? ' aria-selected="true"' : "") + ">" + esc(p.name) +
        "<small>" + esc(p.type || "тип не задан") + " · " + p.count + " имён</small></button>";
    }).join("");
  }
  $("#pl-rows").onclick = function (e) {
    var b = e.target.closest("[data-l]");
    if (!b) return;
    edPlace = b.dataset.l;
    renderPlaceList();
    renderPlaceForm();
  };

  function renderPlaceForm() {
    var p = byId[edPlace];
    if (!p) {
      $("#pl-form").innerHTML = '<p class="ed__empty">Выберите место в списке слева.</p>';
      return;
    }
    var typeOpts = typesOf("place").map(function (t) {
      return '<option value="' + esc(t.type) + '"' +
        (t.type === p.type ? " selected" : "") + ">" + esc(t.label || t.type) + "</option>";
    }).join("");
    var parentOpts = '<option value="">— самостоятельное место —</option>' +
      D.places.filter(function (x) { return x.id !== p.id; }).map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === p.parent ? " selected" : "") +
          ">" + esc(x.name) + "</option>";
      }).join("");

    $("#pl-form").innerHTML =
      fld("название", '<input data-k="name" value="' + esc(p.name) + '">') +
      fld("полное название", '<input data-k="full" value="' + esc(p.full) + '">') +
      fld("тип", '<select data-k="type">' + typeOpts + "</select>",
          "определяет цвет и значок метки — настраивается в разделе «Вид меток»") +
      fld("внутри места", '<select data-k="parent">' + parentOpts + "</select>",
          "например, Никольский лазарет внутри Кремля. Такое место не рисуется отдельной точкой") +
      fld("историческая справка", '<textarea rows="4" data-k="about">' + esc(p.about) + "</textarea>") +
      fld("работы заключённых", '<input data-k="work" value="' + esc(p.work) + '">',
          "лесоразработки, рыболовный промысел, торфоразработки, смолокурение") +
      fld("по учёту музея", '<input data-k="museumCount" value="' + p.museumCount + '">',
          "сколько человек числится по документам музея. Расхождение с расписанным видно в «Обзоре»") +
      fld("фотография", picHtml("places", p.id)) +
      '<p class="fld__hint" style="grid-column:1/-1">Идентификатор: ' + esc(p.id) +
      " · положение на карте · x " + p.x.toFixed(1) + " y " + p.y.toFixed(1) +
      " (двигается перетаскиванием на карте) · " +
      '<button class="ed__del" data-ldel="' + p.id + '">удалить место</button></p>';

    $("#pl-form").oninput = function (e) {
      var k = e.target.dataset.k;
      if (!k) return;
      var v = e.target.value;
      p[k] = k === "museumCount" ? (parseInt(v, 10) || 0) : v;
      if (p.raw) {
        var map = { name: "name_short", full: "name_full", type: "type",
                    parent: "parent", about: "about", work: "work",
                    museumCount: "persons_museum_count" };
        if (map[k]) p.raw[map[k]] = v;
      }
      renderPlaceList();
      renderMap();
    };
    $("#pl-form").onclick = function (e) {
      var t = e.target;
      if (t.dataset.pic) return pickImage(t.dataset.pic, renderPlaceForm);
      if (t.dataset.picdel) { delete D.photos[t.dataset.picdel]; renderPlaceForm(); }
      if (t.dataset.ldel) {
        if (!confirm("Удалить место «" + p.name + "»? Привязки людей к нему пропадут.")) return;
        D.persons.forEach(function (x) {
          var i = x.places.indexOf(p.id);
          if (i >= 0) x.places.splice(i, 1);
        });
        D.places.splice(D.places.indexOf(p), 1);
        delete byId[p.id];
        edPlace = null;
        recount(); renderPlaceList(); renderPlaceForm();
      }
    };
  }

  $("#pl-add").onclick = function () {
    var n = 1;
    while (byId["L" + (n < 10 ? "0" : "") + n]) n++;
    var id = "L" + (n < 10 ? "0" : "") + n;
    var p = { id: id, name: "Новое место", full: "", type: "командировка", parent: "",
              about: "", work: "", note: "", museumCount: 0, count: 0, x: 50, y: 50,
              raw: { id: id, name_short: "Новое место", type: "командировка" } };
    D.places.push(p);
    byId[id] = p;
    edPlace = id;
    recount(); renderPlaceList(); renderPlaceForm();
  };

  /* ---------------- зоны работ ---------------- */
  /* Показывают, ГДЕ КАКИЕ РАБОТЫ велись: вторая половина брифа наряду
     с местами заключения. Мягкий эллипс поверх карты, цвет — от типа места.
     Геометрия в процентах от габаритов подложки, как и метки, поэтому
     не зависит ни от замены карты, ни от пропорций экрана.

     Эллипс, а не многоугольник, выбран нарочно: на карте-схеме музея зоны
     нарисованы такими же мягкими пятнами, а обводить контуры пальцем
     на киоске невозможно. Если музей отдаст векторный исходник — можно
     будет заменить на настоящие полигоны, модель к этому готова. */

  D.zones = D.zones || [];
  var edZone = null;

  function zoneColor(z) {
    var t = TYPES[(z.type || "").trim()];
    return t && t.color ? t.color : "#888";
  }
  function zoneCenter(z) {
    if (z.shape !== "poly" || !z.points.length) return { x: z.x, y: z.y, ry: z.ry };
    var sx = 0, sy = 0, my = 0;
    z.points.forEach(function (p) { sx += p[0]; sy += p[1]; if (p[1] > my) my = p[1]; });
    var cx = sx / z.points.length, cy = sy / z.points.length;
    return { x: cx, y: cy, ry: my - cy };
  }

  function renderZones() {
    $("#zones").innerHTML = D.zones.map(function (z) {
      var sel = edZone === z.id ? ' class="is-on"' : "";
      var col = ' fill="' + esc(zoneColor(z)) + '"';
      if (z.shape === "poly") {
        if (z.points.length < 3) return "";
        return '<polygon data-zone="' + z.id + '" points="' +
          z.points.map(function (p) { return p[0] + "," + p[1]; }).join(" ") + '"' + col + sel + "/>";
      }
      return '<ellipse data-zone="' + z.id + '" cx="' + z.x + '" cy="' + z.y +
        '" rx="' + z.rx + '" ry="' + z.ry + '"' + col + sel + "/>";
    }).join("");

    // Подписи и вершины — обычным HTML: слой SVG растянут неравномерно,
    // текст в нём деформируется, а кружки вершин стали бы эллипсами.
    var html = D.zones.filter(function (z) { return z.label; }).map(function (z) {
      var c = zoneCenter(z);
      return '<span class="zlab" style="left:' + c.x + '%;top:' + (c.y + c.ry) + '%">' +
        esc(z.label) + "</span>";
    }).join("");

    var sel = D.zones.filter(function (z) { return z.id === edZone; })[0];
    if (editing && sel && sel.shape === "poly") {
      html += sel.points.map(function (p, i) {
        return '<span class="zdot" data-vx="' + i + '" style="left:' + p[0] +
          "%;top:" + p[1] + '%"></span>';
      }).join("");
    }
    $("#zlabels").innerHTML = html;
    $("#zlabels").style.pointerEvents = (editing && sel && sel.shape === "poly") ? "auto" : "none";
  }

  /* ---- работа с геометрией на карте ---- */

  var dragZone = null, dragVx = -1, drawing = null;

  function mapPct(e) {
    var r = inner.getBoundingClientRect();
    if (!r.width || !r.height) return null;    // карта скрыта другой вкладкой
    return { x: +clamp((e.clientX - r.left) / r.width * 100, 0, 100).toFixed(2),
             y: +clamp((e.clientY - r.top) / r.height * 100, 0, 100).toFixed(2) };
  }

  // перетаскивание вершины
  $("#zlabels").addEventListener("pointerdown", function (e) {
    var d = e.target.closest("[data-vx]");
    if (!editing || !d) return;
    e.preventDefault(); e.stopPropagation();
    dragVx = +d.dataset.vx;
  });
  $("#zlabels").addEventListener("pointermove", function (e) {
    if (dragVx < 0) return;
    var z = D.zones.filter(function (x) { return x.id === edZone; })[0], p = mapPct(e);
    if (!z || !p) return;
    z.points[dragVx] = [p.x, p.y];
    z.geo = "";                                 // геометрию правили руками
    renderZones();
  });
  $("#zlabels").addEventListener("pointerup", function () { dragVx = -1; });

  // обводка: каждое нажатие добавляет вершину
  $("#zones").addEventListener("pointerdown", function (e) {
    if (!editing) return;
    if (drawing) {
      var z = D.zones.filter(function (x) { return x.id === drawing; })[0], p = mapPct(e);
      if (z && p) {
        e.preventDefault();
        z.points.push([p.x, p.y]);
        z.geo = "";
        renderZones(); renderZoneForm();
      }
      return;
    }
    var el = e.target.closest("[data-zone]");
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    var zz = D.zones.filter(function (x) { return x.id === el.dataset.zone; })[0];
    edZone = zz ? zz.id : null;
    if (zz && zz.shape !== "poly") dragZone = zz;   // пятно тащим целиком
    renderZones(); renderZoneList(); renderZoneForm();
  });
  $("#zones").addEventListener("pointermove", function (e) {
    if (!dragZone) return;
    var p = mapPct(e);
    if (!p) return;
    dragZone.x = p.x; dragZone.y = p.y;
    renderZones(); renderZoneForm();
  });
  $("#zones").addEventListener("pointerup", function () { dragZone = null; });

  function renderZoneList() {
    var rows = D.zones.map(function (z) {
      var t = TYPES[(z.type || "").trim()];
      return '<button class="ed__r" data-z="' + z.id + '"' +
        (edZone === z.id ? ' aria-selected="true"' : "") + ">" +
        esc(z.label || "без подписи") +
        "<small>" + esc(t ? (t.label || t.type) : z.type || "тип не задан") + "</small></button>";
    }).join("");
    $("#zn-rows").innerHTML = rows ||
      '<p class="ed__empty" style="padding:.6em">Зон пока нет</p>';
  }
  $("#zn-rows").onclick = function (e) {
    var b = e.target.closest("[data-z]");
    if (!b) return;
    edZone = b.dataset.z;
    renderZoneList();
    renderZoneForm();
    renderZones();
  };

  function renderZoneForm() {
    var z = D.zones.filter(function (x) { return x.id === edZone; })[0];
    if (!z) {
      $("#zn-form").innerHTML = '<p class="ed__empty">Выберите зону слева или добавьте новую.</p>';
      return;
    }
    var opts = typesOf("zone").map(function (t) {
      return '<option value="' + esc(t.type) + '"' + (t.type === z.type ? " selected" : "") +
        ">" + esc(t.label || t.type) + "</option>";
    }).join("");
    var poly = z.shape === "poly";
    var geom = poly
      ? fld("вершины", '<span class="fld__v">' + z.points.length + " шт." +
            (z.geo ? " · заданы координатами" : "") + "</span>",
            "нажимайте по карте, чтобы добавлять; тащите точки, чтобы двигать") +
        '<div class="fld"><span class="fld__k"></span><div class="dt__acts">' +
        '<button class="edit__btn" data-zdraw="' + z.id + '">' +
        (drawing === z.id ? "Закончить обводку" : "Обводить по карте") + "</button>" +
        '<button class="edit__btn" data-zundo="' + z.id + '">Убрать точку</button></div></div>'
      : fld("ширина, %", '<input data-k="rx" type="number" step="0.5" value="' + z.rx + '">') +
        fld("высота, %", '<input data-k="ry" type="number" step="0.5" value="' + z.ry + '">');

    $("#zn-form").innerHTML =
      fld("подпись", '<input data-k="label" value="' + esc(z.label) + '">',
          "видна на карте под зоной. Пусто — зона без подписи") +
      fld("вид работ", '<select data-k="type">' + opts + "</select>",
          "цвет зоны берётся отсюда, из раздела «Оформление»") +
      fld("форма", '<select data-k="shape">' +
          '<option value="ellipse"' + (poly ? "" : " selected") + ">пятно</option>" +
          '<option value="poly"' + (poly ? " selected" : "") + ">многоугольник</option></select>",
          "пятно — быстрая схематичная разметка; многоугольник — точный контур") +
      geom +
      fld("примечание", '<input data-k="note" value="' + esc(z.note || "") + '">',
          "откуда взята геометрия: исходник музея, GPS на местности") +
      '<p class="fld__hint" style="grid-column:1/-1">' +
      (poly ? "Контур правится на вкладке «Карта»."
            : "Положение — перетаскиванием на карте: x " + z.x + " y " + z.y) +
      ' · <button class="ed__del" data-zdel="' + z.id + '">удалить зону</button></p>';

    $("#zn-form").oninput = function (e) {
      var k = e.target.dataset.k;
      if (!k) return;
      z[k] = (k === "rx" || k === "ry") ? (parseFloat(e.target.value) || 1) : e.target.value;
      if (k === "shape") {
        if (z.shape === "poly" && !z.points.length) {
          // стартовый треугольник вокруг прежнего пятна, чтобы было что тащить
          z.points = [[z.x - z.rx, z.y + z.ry], [z.x, z.y - z.ry], [z.x + z.rx, z.y + z.ry]];
        }
        renderZoneForm();
      }
      renderZones();
      renderZoneList();
    };
    $("#zn-form").onclick = function (e) {
      var t = e.target;
      if (t.dataset.zdraw) {
        drawing = (drawing === z.id) ? null : z.id;
        if (drawing) showView("map");     // обводить можно только на карте
        renderZoneForm(); renderZones();
        return;
      }
      if (t.dataset.zundo) {
        z.points.pop();
        z.geo = "";
        renderZones(); renderZoneForm();
        return;
      }
      if (!t.dataset.zdel) return;
      if (!confirm("Удалить зону «" + (z.label || z.id) + "»?")) return;
      D.zones.splice(D.zones.indexOf(z), 1);
      edZone = null;
      renderZones(); renderZoneList(); renderZoneForm();
    };
  }

  $("#zn-add").onclick = function () {
    var n = 1;
    while (D.zones.filter(function (z) { return z.id === "Z" + n; }).length) n++;
    var t = typesOf("zone")[0];
    var z = { id: "Z" + n, type: t ? t.type : "", label: "Новая зона", shape: "ellipse",
              x: 50, y: 50, rx: 8, ry: 6, points: [], geo: "", note: "" };
    D.zones.push(z);
    edZone = z.id;
    renderZones(); renderZoneList(); renderZoneForm();
  };

  function zonesCsv() {
    var lines = ["id,type,label,shape,x,y,rx,ry,points,geo,note"];
    D.zones.forEach(function (z) {
      var pts = (z.points || []).map(function (p) { return p[0] + "," + p[1]; }).join(";");
      lines.push([z.id, csvCell(z.type), csvCell(z.label), z.shape || "ellipse",
                  z.x, z.y, z.rx, z.ry, csvCell(pts), csvCell(z.geo || ""),
                  csvCell(z.note || "")].join(","));
    });
    return lines.join("\n");
  }

  /* ---- вид меток ---- */

  var THEMES = [["light", "Светлая", "для светлого зала и дневного света"],
                ["dark", "Тёмная", "для затемнённого зала и подсветки витрин"]];

  function renderThemes() {
    var now = (D.settings || {}).theme || "light";
    $("#thm").innerHTML = THEMES.map(function (t) {
      return '<button class="thm__b' + (t[0] === now ? " is-on" : "") + '" data-th="' + t[0] + '">' +
        '<span class="thm__sw thm__sw--' + t[0] + '"></span>' +
        "<b>" + esc(t[1]) + "</b><small>" + esc(t[2]) + "</small></button>";
    }).join("");
  }
  $("#thm").onclick = function (e) {
    var b = e.target.closest("[data-th]");
    if (!b) return;
    applyTheme(b.dataset.th, true);
    renderThemes();
    renderTypes();
  };

  function renderTypes() {
    var icons = Object.keys(window.ICONS || {});
    $("#ty-rows").innerHTML = (D.types || []).map(function (t, i) {
      return '<div class="ty" data-i="' + i + '">' +
        '<input type="color" data-t="color" value="' + esc(t.color) + '">' +
        '<input type="text" data-t="label" value="' + esc(t.label || t.type) + '">' +
        '<select data-t="icon">' + icons.map(function (n) {
          return '<option value="' + n + '"' + (n === t.icon ? " selected" : "") + ">" + n + "</option>";
        }).join("") + "</select>" +
        '<span class="legend__d" style="background:' + esc(t.color) + '">' +
        iconSvg(t.icon, "pt__ic") + "</span>" +
        '<span class="dt__l">' + esc(t.type) + "</span></div>";
    }).join("");

    $("#ty-rows").oninput = function (e) {
      var k = e.target.dataset.t;
      if (!k) return;
      var t = D.types[+e.target.closest(".ty").dataset.i];
      t[k] = e.target.value;
      TYPES[t.type] = t;
      renderTypes();
      renderZones();
      renderMap();
    };
  }

  /* ---- выгрузка ---- */

  function download(name, text, mime) {
    var blob = new Blob(["﻿" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvCell(v) {
    v = v == null ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function placesCsv() {
    var f = D.placeFields || [];
    var lines = [f.join(",")];
    D.places.forEach(function (p) {
      var r = p.raw || (p.raw = { id: p.id });
      r.x = p.x.toFixed(1);
      r.y = p.y.toFixed(1);
      lines.push(f.map(function (k) { return csvCell(r[k]); }).join(","));
    });
    return lines.join("\n");
  }
  function personsCsv() {
    var lines = ["id,name,surname,rank,years_details,source,places,has_source,has_place"];
    D.persons.forEach(function (p) {
      lines.push([p.id, csvCell(p.name), csvCell(p.surname), csvCell(p.rank),
        csvCell(p.years), csvCell(p.source), csvCell(p.places.join(";")),
        p.source ? 1 : 0, p.places.length ? 1 : 0].join(","));
    });
    return lines.join("\n");
  }
  function settingsCsv() {
    var s = D.settings || {};
    return "key,value\n" + Object.keys(s).map(function (k) {
      return csvCell(k) + "," + csvCell(s[k]);
    }).join("\n");
  }
  function typesCsv() {
    var lines = ["type,label,color,icon"];
    (D.types || []).forEach(function (t) {
      lines.push([csvCell(t.type), csvCell(t.label), csvCell(t.color), csvCell(t.icon)].join(","));
    });
    return lines.join("\n");
  }

  $("#dt-save").onclick = function () { download("places.csv", placesCsv()); };
  $("#dt-savep").onclick = function () { download("persons.csv", personsCsv()); };
  $("#dt-report").onclick = function () {
    var lines = ["id,имя,сан,места,есть источник,есть место"];
    D.persons.forEach(function (p) {
      lines.push([p.id, csvCell((p.name + " " + p.surname).trim()), csvCell(p.rank),
        csvCell(p.places.map(function (i) { return byId[i] ? byId[i].name : i; }).join("; ")),
        p.source ? "да" : "НЕТ", p.places.length ? "да" : "НЕТ"].join(","));
    });
    download("отчёт-о-полноте.csv", lines.join("\n"));
  };

  // «Сохранить всё»: приложение само пересобирает data.js из того, что в памяти,
  // и заодно отдаёт три таблицы — чтобы правки пережили пересборку скриптом.
  $("#dt-apply").onclick = function () {
    recount();
    var text = "// Файл собран панелью музея " + new Date().toISOString().slice(0, 10) + "\n" +
      "// Положите его в app/data вместо старого — правки применятся.\n" +
      "window.DATA = " + JSON.stringify(D, null, 1) + ";\n";
    download("data.js", text, "application/javascript");
    setTimeout(function () { download("persons.csv", personsCsv()); }, 400);
    setTimeout(function () { download("places.csv", placesCsv()); }, 800);
    setTimeout(function () { download("types.csv", typesCsv()); }, 1200);
    setTimeout(function () { download("settings.csv", settingsCsv()); }, 1600);
    setTimeout(function () { download("zones.csv", zonesCsv()); }, 2000);
    alert("Скачано шесть файлов.\n\n" +
      "1. data.js — положите в папку app/data вместо старого.\n" +
      "2. persons.csv, places.csv, types.csv, settings.csv, zones.csv — туда же.\n\n" +
      "После этого обновите страницу.");
  };

  $("#dt-help").onclick = function () {
    alert("Панель музея\n\n" +
      "ОБЗОР — что в данных не заполнено. Нажмите на строку, чтобы увидеть, кого это касается.\n\n" +
      "ПЕРСОНАЛИИ — найдите человека в списке слева и правьте справа. Места отмечаются галочками.\n\n" +
      "МЕСТА — описание, тип, вложенность, фотография. Положение метки двигается на самой карте.\n\n" +
      "ЗОНЫ РАБОТ — где какие работы велись. Добавьте зону и перетащите её на карте.\n\n" +
      "ОФОРМЛЕНИЕ — тема (светлая или тёмная) и вид меток: цвет и значок по типу места.\n\n" +
      "Фотографию можно просто выбрать файлом, она уменьшится сама.\n\n" +
      "Когда закончили — «Сохранить всё» и положите скачанные файлы в папку app/data.");
  };

  function renderStaff() { showSub(subNow); }

  /* ---------------- экран покоя ---------------- */

  var idleTimer, nameTimer, idleShown = true;

  function goIdle() {
    $("#idle").hidden = false;
    idleShown = true;
    closePanel();
    setEdit(false);
    resetZoom();
    showView("map");
    $("#q").value = "";
    $("#f-rank").value = "";
    $("#f-place").value = "";
    renderRegistry();
  }
  function wake() {
    if (idleShown) { $("#idle").hidden = true; idleShown = false; }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, IDLE_MS);
  }
  ["click", "touchstart", "keydown", "wheel"].forEach(function (ev) {
    document.addEventListener(ev, wake, { passive: true });
  });

  // Одно имя за раз, два слоя встречно гасятся. Высота сцены постоянна,
  // поэтому ничего не прыгает и старое имя не может остаться поверх нового.
  function rotateNames() {
    var pool = D.persons.filter(function (p) { return p.surname; });
    var layers = [$("#idle-a"), $("#idle-b")];
    var cur = 0, seen = [];

    function pick() {
      var p, guard = 0;
      do { p = pool[Math.floor(Math.random() * pool.length)]; guard++; }
      while (seen.indexOf(p.id) >= 0 && guard < 50);      // не повторяться подряд
      seen.push(p.id);
      if (seen.length > 30) seen.shift();
      return p;
    }

    function show() {
      if (!idleShown) return;
      var p = pick();
      var next = layers[cur ^ 1];
      next.innerHTML = esc((p.name + " " + p.surname).trim()) +
        "<span>" + esc(p.rank.split("\n")[0]) + "</span>";
      layers[cur].classList.remove("is-on");
      next.classList.add("is-on");
      cur ^= 1;
    }

    show();
    nameTimer = setInterval(show, 5000);
  }

  /* ---------------- киоск ---------------- */

  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });

  /* ---------------- запуск ---------------- */

  $("#idle-total").textContent = D.meta.total;

  var ranks = {};
  D.persons.forEach(function (p) { if (p.rank) ranks[p.rank] = 1; });
  fillSelect($("#f-rank"), Object.keys(ranks).sort());
  $("#f-place").innerHTML += '<option value="__none">Место не установлено</option>';
  fillSelect($("#f-place"), []);
  D.places.forEach(function (p) {
    $("#f-place").innerHTML += '<option value="' + p.id + '">' + esc(p.name) + "</option>";
  });

  renderMap();
  renderRegistry();
  renderGlossary();
  showView("map");
  rotateNames();
})();
