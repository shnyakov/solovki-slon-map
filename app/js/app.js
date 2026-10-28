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

  /* ---------------- язык ---------------- */
  /* Переводится только то, что видит посетитель. Панель сотрудника музея
     оставлена по-русски намеренно: ею пользуются в музее.
     Названия мест и терминов берутся из данных (name_en, label_en, term_en),
     пусто — показывается русское. */

  var LANG_KEY = "okoyom-lang", lang = "ru";
  try { lang = localStorage.getItem(LANG_KEY) || (D.settings || {}).lang || "ru"; } catch (e) {}

  function T(k) {
    var s = (window.LANG[lang] || {})[k];
    if (s == null) s = (window.LANG.ru || {})[k];
    return s == null ? k : s;
  }
  function Tf(k) {                       // подстановка %1, %2
    var s = T(k), a = arguments;
    return s.replace(/%(\d)/g, function (_, i) { return a[+i]; });
  }
  function placeName(p) { return (lang === "en" && p.name_en) || p.name; }

  /* Широта и долгота лежат в raw — полной строке places.csv. В карточку они
     выводятся текстом, а не ссылкой на карту: на островах нет сети, и ссылка
     была бы мёртвой. Заодно видно, откуда координата взята: у части мест она
     от заказчика, у части сверена с OSM, а у одной требует подтверждения. */
  function coordText(p) {
    var r = p.raw || {};
    var la = (r.lat_approx || "").trim(), lo = (r.lon_approx || "").trim();
    if (!la || !lo) return "";
    var st = (r.coord_status || "").trim();
    var mark = /ТРЕБУЕТ/i.test(st) ? " · " + st.toLowerCase() : "";
    return la + ", " + lo + mark;
  }

  /* ---- имена персоналий по-английски ----

     411 фамилий кириллицей в английском режиме выглядели как незаконченная
     работа. Транслитерация делается на лету, в данные не пишется.

     Схема — BGN/PCGN, та, что принята в англоязычных текстах о России
     (х → kh, ц → ts, щ → shch). Окончания -ский/-ий приводятся к -sky/-y:
     «Ostashkovskiy» формально верно, но по-английски так не пишут.

     ЭТО МАШИННАЯ ТРАНСЛИТЕРАЦИЯ, а не написание, утверждённое музеем.
     У них могут быть свои формы имён новомучеников, принятые в их изданиях.
     Поэтому есть путь переопределения: колонки name_en и rank_en в persons.csv.
     Заполнены — берутся они, пусто — работает транслитерация. */

  var TR = {
    "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z",
    "и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r",
    "с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh",
    "щ":"shch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"
  };

  function tr(src) {
    var out = "";
    for (var i = 0; i < src.length; i++) {
      var ch = src[i], low = ch.toLowerCase(), rep = TR[low];
      if (rep === undefined) { out += ch; continue; }          // латиница, цифры, знаки
      // Мягкий знак перед е/ё/и даёт «y»: Арефьев → Arefyev, а не Arefev.
      // Перед я/ю он не нужен — те и сами дают ya/yu (Ильяс → Ilyas).
      if (low === "ь") {
        var nx = (src[i + 1] || "").toLowerCase();
        rep = (nx === "е" || nx === "ё" || nx === "и") ? "y" : "";
      }
      if (ch !== low && rep) rep = rep[0].toUpperCase() + rep.slice(1);
      out += rep;
    }
    // Окончания: Ostashkovskiy -> Ostashkovsky, Yuriy -> Yury
    return out.replace(/iy\b/g, "y").replace(/yy\b/g, "y");
  }

  // Сан переводится, а не транслитерируется: «episkop» ничего не сообщает
  // англоязычному посетителю, Bishop — сообщает. Слова вне словаря
  // (обычно прилагательные от городов) транслитерируются.
  var RANKS = {
    "епископ":"Bishop", "еп":"Bishop",
    "архиепископ":"Archbishop", "архиеп":"Archbishop", "архепис":"Archbishop",
    "митрополит":"Metropolitan", "митропол":"Metropolitan",
    "архиерей":"Hierarch", "архиер":"Hierarch",
    "священник":"Priest", "свящ":"Priest", "свящ-к":"Priest", "иерей":"Priest",
    "протоиерей":"Archpriest", "протоир":"Archpriest", "протоиер":"Archpriest",
    "протопресвитер":"Protopresbyter", "протопресв":"Protopresbyter",
    "иеромонах":"Hieromonk", "иеромон":"Hieromonk",
    "игумен":"Hegumen", "архимандрит":"Archimandrite",
    "диакон":"Deacon", "дьякон":"Deacon", "протодиакон":"Protodeacon",
    "монах":"Monk", "монахиня":"Nun",
    // «мон.» в таблице музея стоит и у мужчин, и у женщин — гадать нельзя
    "мон":"Monastic",
    "схимонах":"Schemamonk", "послушник":"Novice",
    "псаломщик":"Psalm-reader", "псалом":"Psalm-reader",
    "сщмч":"Hieromartyr", "прмч":"Venerable Martyr", "прп":"Venerable", "мч":"Martyr",
    "священноисп":"Hieroconfessor", "преподобноисп":"Venerable Confessor",
    // Написания, встречающиеся в таблице музея, в том числе с опечатками:
    // «протоирей» стоит в 34 записях, «архепископ» в 15 — переводим как есть,
    // исправлять чужой источник не наше дело.
    "протоирей":"Archpriest", "прот":"Archpriest", "архепископ":"Archbishop",
    "иподиакон":"Subdeacon", "иеродиакон":"Hierodeacon",
    "мирянин":"Layman", "мирянка":"Laywoman",
    "исповедник":"Confessor", "исповедница":"Confessor",
    "настоятель":"Superior", "монастыря":"Monastery",
    "и":"and",
    /* «арх.» без уточнения — это может быть и архимандрит, и архиепископ.
       Таких записей 7. Гадать в мемориальной экспозиции нельзя, поэтому
       оставляем честное сокращение, а музею вопрос задан отдельно. */
    "арх":"Arch."
  };

  function rankEn(src) {
    return String(src || "").split(/(\s+)/).map(function (w) {
      if (/^\s+$/.test(w) || !w) return w;
      var key = w.toLowerCase().replace(/[.,]+$/, "");
      var hit = RANKS[key];
      if (!hit) return tr(w);
      return w.slice(-1) === "," ? hit + "," : hit;
    }).join("");
  }

  /* Фильтр по сану.

     В таблице музея сан записан вместе с кафедрой: «епископ Осташковский»,
     «архепископ Куйбышевский и Ставропольский». Если брать строку как есть,
     в списке получается сто двадцать пунктов, и почти за каждым стоит один
     человек. Фильтровать нечем.

     Поэтому сводим к основному сану: кафедру и уточнения вроде «сщмч»
     отбрасываем, сокращения разворачиваем. Порядок в списке — церковная
     иерархия, а не алфавит: он тут и есть содержательный. Рядом число людей.

     Написания с опечатками («архепископ», «протоирей») учтены: это таблица
     музея, править её не наше дело. */
  var RANK_BASE = {
    "митрополит":"митрополит", "митр":"митрополит",
    "архиепископ":"архиепископ", "архепископ":"архиепископ", "археп":"архиепископ",
    "архепскоп":"архиепископ", "архиеп":"архиепископ",
    "епископ":"епископ", "еп":"епископ",
    "архиерей":"архиерей",
    "архимандрит":"архимандрит", "арх":"архимандрит",
    "игумен":"игумен",
    "протопресвитер":"протопресвитер", "протопресв":"протопресвитер",
    "протоиерей":"протоиерей", "протоирей":"протоиерей", "прот":"протоиерей",
    "иеромонах":"иеромонах", "иеромон":"иеромонах", "иером":"иеромонах",
    "священник":"священник", "свящ":"священник", "свящ-к":"священник", "иерей":"священник",
    "протодиакон":"протодиакон",
    "иеродиакон":"иеродиакон",
    "иподиакон":"иподиакон",
    "диакон":"диакон", "дьякон":"диакон",
    "схимонах":"схимонах",
    "монахиня":"монахиня",
    "монах":"монах", "мон":"монашествующий", "монашествующий":"монашествующий",
    "послушник":"послушник",
    "псаломщик":"псаломщик", "псалом":"псаломщик",
    "регент":"регент",
    "мирянка":"мирянка", "мирянин":"мирянин", "миряни":"мирянин",
    "отец":"священник"
  };

  /* Порядок церковной иерархии. Всё, чего здесь нет, уходит в конец.
     Порядок задан музеем (письмо А. П. Яковлевой, 26.10.2026): архиепископы —
     епископы — архимандриты — игумены — иеромонахи — протоиереи — иереи —
     иеродиаконы — диаконы — монахи — миряне. Иеромонах, значит, выше
     протоиерея: монашествующее духовенство идёт первым. */
  var RANK_ORDER = ["митрополит", "архиепископ", "епископ", "архиерей",
    "архимандрит", "игумен", "иеромонах", "протопресвитер", "протоиерей",
    "священник", "протодиакон", "иеродиакон", "иподиакон", "диакон",
    "схимонах", "монах", "монахиня", "монашествующий", "послушник",
    "псаломщик", "регент", "мирянин", "мирянка"];

  /* В списках людей монахи и монахини — одна ступень, миряне и мирянки тоже:
     у музея внутри неё общий алфавит («Дмитрий Лихачёв, Клавдия Пискановская,
     Михаил Кречетов»). В фильтре по сану они по-прежнему раздельны. */
  var RANK_STEP = { "монахиня": "монах", "монашествующий": "монах", "мирянка": "мирянин" };

  function baseRank(rank) {
    var words = String(rank || "").split(/[\s.,]+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i].toLowerCase().replace(/ё/g, "е").replace(/[?()]/g, "");
      if (RANK_BASE[w]) return RANK_BASE[w];
    }
    return "";
  }

  // Список людей места: по сану, внутри сана по имени, затем по фамилии
  // («Александр Поспелов, Борис Рукин, Владимир Введенский» — так у музея).
  function byRank(list) {
    function step(p) {
      var b = baseRank(p.rank);
      var i = RANK_ORDER.indexOf(RANK_STEP[b] || b);
      return i < 0 ? 99 : i;
    }
    function key(s) { return String(s || "").toLowerCase().replace(/ё/g, "е"); }
    return list.slice().sort(function (a, b) {
      return step(a) - step(b) ||
        key(a.name).localeCompare(key(b.name), "ru") ||
        key(a.surname).localeCompare(key(b.surname), "ru");
    });
  }

  function personName(p) {
    var ru = (p.name + " " + p.surname).trim();
    if (lang !== "en") return ru;
    return (p.name_en || "").trim() || tr(ru);
  }
  function personRank(p) {
    if (lang !== "en") return p.rank;
    return (p.rank_en || "").trim() || rankEn(p.rank);
  }
  function typeLabel(t) { return (lang === "en" && t.label_en) || t.label || t.type; }

  function applyLang() {
    document.documentElement.setAttribute("lang", lang);
    $("#lang").textContent = lang === "ru" ? "EN" : "РУС";
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = T(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = T(el.dataset.i18nHtml);
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.placeholder = T(el.dataset.i18nPh);
    });
    document.querySelectorAll("[data-i18n-t]").forEach(function (el) {
      el.setAttribute("aria-label", T(el.dataset.i18nT));
    });
  }
  $("#lang").onclick = function () {
    lang = lang === "ru" ? "en" : "ru";
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    D.persons.forEach(function (p) { p._h = null; });
    applyLang();
    renderMap(); renderYears(); renderRegistry(); renderGlossary(); closePanel();
  };

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

  // История переходов внутри панели: место -> человек -> обратно к месту.
  // Без неё из карточки человека приходилось заново искать место.
  var cardNow = null, cardHist = [];
  var CARDS = {};

  function showCard(kind, arg) {
    if (cardNow) cardHist.push(cardNow);
    cardNow = [kind, arg];
    CARDS[kind](arg);
  }
  function cardBack() {
    var prev = cardHist.pop();
    if (!prev) return;
    cardNow = prev;
    CARDS[prev[0]](prev[1]);
  }
  function cardReset() { cardNow = null; cardHist.length = 0; }

  function openPanel(html) {
    if (cardHist.length) {
      html = '<button class="panel__back" id="panel-back">' + esc(T("back")) + '</button>' + html;
    }
    var body = $("#panel-body");
    body.innerHTML = html;
    var b = $("#panel-back");
    if (b) b.onclick = cardBack;

    var p = $("#panel");
    // Могли попасть сюда посреди затухания — отменяем его
    clearTimeout(panelTimer);
    p.classList.remove("is-out");
    p.hidden = false;
    $("#scrim").hidden = false;
    p.scrollTop = 0;

    // Переход внутри карточки: место -> человек -> обратно. Содержимое
    // подменяется целиком, и без перехода это выглядит подменой страницы.
    body.classList.remove("is-in");
    body.offsetHeight;
    body.classList.add("is-in");
  }
  /* Закрытие с затуханием — зеркало открытия. Убрать display сразу нельзя:
     анимации на исчезновение в CSS не бывает, поэтому сперва класс, потом
     скрытие по таймеру. Повторный вызов во время затухания игнорируется. */
  var panelTimer = null;
  function closePanel() {
    var p = $("#panel");
    if (p.hidden || p.classList.contains("is-out")) return;
    cardReset();
    lbClose();
    p.classList.add("is-out");
    clearTimeout(panelTimer);
    panelTimer = setTimeout(function () {
      p.hidden = true;
      p.classList.remove("is-out");
      $("#scrim").hidden = true;
    }, 200);
  }
  $("#panel-close").onclick = closePanel;
  $("#scrim").onclick = closePanel;

  // Клики по ссылкам внутри карточки (места и люди)
  $("#panel-body").onclick = function (e) {
    var rb = e.target.closest("[data-restore]");
    if (rb) {
      var name = rb.dataset.restore;
      if (!confirm("Вернуть данные к версии " + prettyStamp(name) + "?\n\n" +
                   "Нынешнее состояние будет сохранено отдельным снимком.\n" +
                   "После возврата страница перезагрузится.")) return;
      rb.textContent = "Возвращаю…";
      (srv
        ? fetch("api/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name })
          }).then(function (r) { return r.json(); })
            .then(function (j) { if (j.error) throw new Error(j.error); })
        : withDir().then(function (h) {
            if (!h) return Promise.reject(new Error("папка не выбрана"));
            return restoreVersion(h, name);
          })
      ).then(function () {
        dirty = false;                      // иначе beforeunload перехватит перезагрузку
        alert("Возвращено к версии " + prettyStamp(name) + ".");
        location.reload();
      }).catch(function (err) {
        rb.textContent = "Вернуть";
        alert("Не удалось вернуть: " + err.message);
      });
      return;
    }
    var el = e.target.closest("[data-person],[data-place]");
    if (!el) return;
    if (el.dataset.person) showCard("person", el.dataset.person);
    else showCard("place", el.dataset.place);
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  /* Пустое поле лучше не показывать вовсе.

     Историческая справка не написана ни у одного из 19 мест, источник
     не указан у 83 % персоналий — и карточки состояли наполовину из
     «справка ещё не написана» и «требует уточнения». Посетителю это
     ничего не даёт: сделать он с этим ничего не может, а экспозиция
     выглядит недоделанной.

     Пробелы никуда не спрятались: их считает и показывает «Обзор»
     в панели музея — тем, кто действительно может их закрыть.

     emptyText передаётся, только когда отсутствие само по себе
     содержательно. Ни одного такого поля сейчас нет, но параметр
     оставлен: вернуть подпись — одна строка. */
  function field(label, value, emptyText) {
    var has = value && String(value).trim();
    if (!has && !emptyText) return "";
    return '<div class="card__row"><p class="card__k">' + esc(label) + '</p>' +
      '<p class="card__v' + (has ? '' : ' card__v--none') + '">' +
      esc(has ? value : emptyText) + '</p></div>';
  }

  /* ---------------- изображения ---------------- */
  /* Файлы ищутся по соглашению об имени: <id>.jpg, затем <id>-2.jpg, -3 и так далее.
     Каталог с file:// не прочитать, поэтому просто пробуем загрузить по очереди
     и останавливаемся на первом промахе. Подписи берутся из photo-credits.csv
     по имени файла, так что у каждого снимка может быть свой источник. */

  // Пятнадцать снимков у Кремля: четырнадцать от музея плюс прежний
  // с Викисклада. Предел в восемь обрезал бы почти половину.
  var PHOTO_MAX = 16;

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
  /* Снимки берутся из описи, собранной build.py: там уже известны и состав,
     и размеры каждого файла. Благодаря этому карточка отводит место под
     снимок СРАЗУ — раньше галерея была пустой, пока шла проверка файлов,
     а потом содержимое уезжало вниз рывком (у Кремля на 478 пикселей).

     Каталог по file:// прочитать нельзя, поэтому опись и нужна. Но перебор
     файлов не выброшен: он продолжается после последнего известного снимка.
     Так работает обещание из инструкции музею — «положите файл в папку,
     приложение подхватит его само». Такой снимок покажется с прежним рывком,
     зато без пересборки. */
  /* Состав галереи известен заранее — из описи, которую собирает build.py:
     там и список файлов, и размеры каждого. Поэтому карточка отводит место
     под снимок СРАЗУ. Раньше галерея была пустой, пока шёл перебор файлов,
     а потом содержимое уезжало вниз рывком — у Кремля на 478 пикселей.

     Каталог по file:// прочитать нельзя, оттого опись и нужна. Но перебор
     не выброшен: он продолжается после последнего известного снимка. Так
     держится обещание из инструкции музею — «положите файл в папку,
     приложение подхватит его само». Такой снимок появится с прежним рывком,
     зато без пересборки. */
  function knownPhotos(dir, id) {
    var out = [];
    var embedded = (D.photos || {})[id];
    if (embedded) out.push({ src: embedded, key: id, w: 0, h: 0 });
    var known = ((D.gallery || {})[dir] || {})[id] || [];
    for (var i = 0; i < known.length && out.length < PHOTO_MAX; i++) {
      var nm = i ? id + "-" + (i + 1) : id;
      out.push({ src: "assets/" + dir + "/" + nm + ".jpg", key: nm,
                 w: known[i][0], h: known[i][1] });
    }
    return out;
  }

  // Ищет то, чего опись не знает: файлы, положенные без пересборки
  function extraPhotos(dir, id, from, done) {
    var found = [], n = from;
    (function step() {
      if (from + found.length >= PHOTO_MAX) return done(found);
      var name = n ? id + "-" + (n + 1) : id;
      n++;
      var img = new Image();
      img.onload = function () {
        found.push({ src: "assets/" + dir + "/" + name + ".jpg", key: name,
                     w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
        step();
      };
      img.onerror = function () { done(found); };
      img.src = "assets/" + dir + "/" + name + ".jpg";
    })();
  }

  var lbList = [], lbDir = "", lbAt = 0;

  /* Подмена снимка встык выглядит как рывок: один кадр сменяется другим
     без перехода. Гасим, ставим новый источник, проявляем по загрузке.
     Снимки уже в кэше, так что пауза почти незаметна — но глаз успевает
     понять, что картинка сменилась, а не «моргнула». */
  function swapImage(el, src) {
    if (!el) return;
    el.classList.add("is-swap");
    el.onload = el.onerror = function () { el.classList.remove("is-swap"); };
    el.src = src;
  }

  // В CSS движение отключается медиа-запросом, но наплыв снимков делается
  // из кода — здесь тот же запрос нужен руками.
  function motionOff() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  /* Смена снимка внутри карточки — это два движения сразу, и нужны оба.

     Первое — сама картинка. Гашение в пустоту и проявление читались как
     «моргнуло»: между снимками показывался фон карточки. Теперь наплыв:
     старый кадр остаётся лежать поверх и растворяется, пока новый
     проступает под ним.

     Второе — высота. Снимки разной пропорции, и места им нужно разное:
     портрет вдвое выше пейзажа. Раньше высота менялась в тот самый миг,
     когда нажали миниатюру: подпись и лента миниатюр прыгали вниз ещё
     до того, как появлялся новый снимок. Теперь высота едет тем же
     переходом, и прыжка нет.

     Целевая высота берётся из описи (w/h в data.js), а не из загруженного
     файла: иначе пришлось бы сперва дождаться загрузки, и переход
     начинался бы с опозданием. */
  var shotTimer = null;

  function swapShot(m, it) {
    if (!m) return;
    var box = m.parentNode;
    if (!box || !box.classList.contains("card__shot") || !(it.w && it.h) || motionOff()) {
      if (it.w && it.h) m.style.aspectRatio = it.w + "/" + it.h;
      swapImage(m, it.src);
      return;
    }

    clearTimeout(shotTimer);
    var stale = box.querySelector(".card__ghost");   // быстро щёлкают по миниатюрам
    if (stale) stale.parentNode.removeChild(stale);

    var cs = getComputedStyle(m);
    var from = m.getBoundingClientRect().height;
    var wide = m.clientWidth;
    var cap = parseFloat(cs.maxHeight), min = parseFloat(cs.minHeight);
    var to = wide * it.h / it.w;
    if (cap) to = Math.min(to, cap);
    if (min) to = Math.max(to, min);

    var ghost = document.createElement("img");
    ghost.className = "card__ghost";
    ghost.src = m.currentSrc || m.src;
    box.appendChild(ghost);

    // Высота задаётся явно: пропорция как способ её задать на время
    // перехода не годится — переходить нужно между двумя числами.
    m.style.aspectRatio = "auto";
    m.style.height = from + "px";
    m.classList.add("is-swap");
    m.onload = m.onerror = function () {
      m.classList.remove("is-swap");                 // новый проступает,
      ghost.classList.add("is-out");                 // старый растворяется
    };
    m.src = it.src;

    m.offsetHeight;                                  // принять высоту до перехода
    m.style.height = to + "px";

    shotTimer = setTimeout(function () {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      m.classList.remove("is-swap");
      m.style.height = "";
      m.style.aspectRatio = it.w + "/" + it.h;       // дальше высоту держит пропорция
    }, 420);
  }

  /* Листание во весь экран. Раньше снимок гас в чёрный фон и проявлялся
     обратно: между кадрами была пустота, и это читалось как «моргнуло» —
     та же беда, что уже вылечена в карточке.

     Теперь наплыв и направление. Старый кадр остаётся лежать поверх и
     растворяется, уезжая в ту сторону, откуда листаем; новый проступает
     под ним, приходя с той стороны, куда листаем. Направление важнее
     красоты: в ленте из пятнадцати снимков без него непонятно, вперёд
     ты пошёл или назад.

     Копия кладётся по координатам самого снимка, а не в общий поток:
     у соседних кадров разная пропорция, и место под них разное — старому
     надо остаться ровно там, где он был, пока не растворится. */
  var lbSwapTimer = null;

  function lbSwap(src, dir) {
    var m = $("#lb-img"), lb = $("#lb");
    if (!m) return;
    if (!dir || motionOff()) { swapImage(m, src); return; }

    clearTimeout(lbSwapTimer);
    var stale = lb.querySelector(".lb__ghost");      // листают быстрее, чем идёт наплыв
    if (stale) stale.parentNode.removeChild(stale);

    var r = m.getBoundingClientRect();
    var ghost = document.createElement("img");
    ghost.className = "lb__ghost";
    ghost.src = m.currentSrc || m.src;
    ghost.style.left = r.left + "px";
    ghost.style.top = r.top + "px";
    ghost.style.width = r.width + "px";
    ghost.style.height = r.height + "px";
    lb.appendChild(ghost);

    var from = dir > 0 ? "is-from-r" : "is-from-l";
    var to = dir > 0 ? "is-to-l" : "is-to-r";
    m.classList.remove("is-from-r", "is-from-l");
    m.onload = m.onerror = function () {
      replay(m, from);                               // новый выезжает на место,
      ghost.classList.add(to);                       // старый уходит и гаснет
    };
    m.src = src;

    lbSwapTimer = setTimeout(function () {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      m.classList.remove("is-from-r", "is-from-l");
    }, 420);
  }

  function lbShow(i, dir) {
    lbAt = (i + lbList.length) % lbList.length;
    lbSwap(lbList[lbAt].src, dir || 0);
    $("#lb-cap").innerHTML = creditHtml(lbList[lbAt].key, "span");
    if (dir) replay($("#lb-cap"), "is-in");          // подпись меняется вместе со снимком
    var many = lbList.length > 1;
    $("#lb-prev").hidden = !many;
    $("#lb-next").hidden = !many;
  }
  function lbOpen(dir, list, i) {
    lbDir = dir; lbList = list;
    $("#lb").hidden = false;
    lbShow(i);
  }
  /* Закрытие с затуханием. Убрать display сразу нельзя — анимации на
     исчезновение в CSS нет, поэтому сперва класс, потом скрытие по таймеру.
     Повторный вызов во время затухания игнорируется: закрывать уже нечего. */
  var lbTimer = null;
  function lbClose() {
    var lb = $("#lb");
    if (lb.hidden || lb.classList.contains("is-out")) return;
    lb.classList.add("is-out");
    clearTimeout(lbTimer);
    lbTimer = setTimeout(function () {
      lb.hidden = true;
      lb.classList.remove("is-out");
      var g = lb.querySelector(".lb__ghost");        // закрыли посреди наплыва
      if (g) g.parentNode.removeChild(g);
      $("#lb-img").classList.remove("is-from-r", "is-from-l");
    }, 180);
  }

  $("#lb-close").onclick = lbClose;
  $("#lb-img").onclick = lbClose;
  $("#lb").onclick = function (e) { if (e.target === $("#lb")) lbClose(); };
  $("#lb-prev").onclick = function () { lbShow(lbAt - 1, -1); };
  $("#lb-next").onclick = function () { lbShow(lbAt + 1, 1); };
  document.addEventListener("keydown", function (e) {
    if ($("#lb").hidden) return;
    if (e.key === "Escape") lbClose();
    if (e.key === "ArrowLeft") lbShow(lbAt - 1, -1);
    if (e.key === "ArrowRight") lbShow(lbAt + 1, 1);
  });

  // Галерея вставляется в карточку после того, как выяснилось, сколько файлов есть
  // Пропорции в разметку: браузер отводит место до того, как покажет снимок
  function ratio(it) {
    return (it.w && it.h) ? ' style="aspect-ratio:' + it.w + "/" + it.h + '"' : "";
  }

  function fillGallery(dir, id) {
    var slot = $("#gallery");
    if (!slot) return;
    var list = knownPhotos(dir, id);

    function render() {
      // Не удаляем, а прячем: если музей положит снимок в папку без
      // пересборки, extraPhotos его найдёт — и вставлять будет куда.
      slot.hidden = !list.length;
      if (!list.length) return;
      var thumbs = list.length > 1
        ? '<div class="card__thumbs">' + list.map(function (it, i) {
            return '<img class="card__thumb' + (i ? "" : " is-on") + '" data-i="' + i +
                   '" src="' + esc(it.src) + '" alt="">';
          }).join("") + "</div>"
        : "";
      var at = Math.min(+(slot.dataset.at || 0), list.length - 1);
      slot.innerHTML = '<div class="card__shot"><img class="card__photo" id="gal-main"' +
        ratio(list[at]) + ' src="' + esc(list[at].src) + '" alt=""></div>' +
        creditHtml(list[at].key, "p") + thumbs;
      slot.dataset.at = at;
    }

    function pick(i) {
      var m = $("#gal-main");
      if (!m) return;
      swapShot(m, list[i]);
      var cap = slot.querySelector(".card__credit");
      var html = creditHtml(list[i].key, "p");
      if (cap) cap.outerHTML = html || '<p class="card__credit"></p>';
      slot.querySelectorAll(".card__thumb").forEach(function (el, j) {
        el.classList.toggle("is-on", j === i);
      });
      slot.dataset.at = i;
    }

    slot.dataset.at = 0;
    render();                                  // сразу, без ожидания
    slot.classList.add("is-in");

    slot.onclick = function (e) {
      var th = e.target.closest(".card__thumb");
      if (th) { pick(+th.dataset.i); return; }
      if (e.target.id === "gal-main") lbOpen(dir, list, +(slot.dataset.at || 0));
    };

    // Догоняем то, чего нет в описи. Обычно ничего не находит и молчит.
    extraPhotos(dir, id, list.length, function (extra) {
      if (!extra.length) return;
      list = list.concat(extra);
      render();
    });
  }

  function personRowHtml(p) {
    return '<li><button class="row" data-person="' + p.id + '">' +
      '<span class="row__name">' + esc(personName(p)) + '</span>' +
      '<span class="row__rank">' + esc(personRank(p)) + '</span>' +
      /* Пометки «без источника» здесь больше нет.

          Она стояла у 363 записей из 434 и в списке читалась как брак,
          хотя означала лишь, что музей не проставил ссылку на издание.
          Источник у всех данных один и тот же — Соловецкий музей-заповедник,
          и сказано об этом один раз, в подписи под картой.

          Для сотрудников счёт никуда не делся: «Данные → Обзор» по-прежнему
          показывает, у скольких персоналий ссылки нет. */
      '</button></li>';
  }

  function showPerson(id) {
    var p = D.persons.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var places = p.places.map(function (pid) {
      return '<button class="chip" data-place="' + pid + '">' + esc(placeName(byId[pid])) + '</button>';
    }).join("");

    openPanel(
      '<p class="card__over">' + esc(T("cardPerson")) + '</p>' +
      '<figure class="card__fig" id="gallery"></figure>' +
      '<h2 class="card__name">' + esc(personName(p)) + '</h2>' +
      '<p class="card__rank">' + esc(personRank(p)) + '</p>' +
      '<div class="card__row"><p class="card__k">' + esc(T("cardPlaces")) + '</p>' +
        (places ? '<div>' + places + '</div>'
                : '<p class="card__v card__v--none">' + esc(T("cardNotSet")) + '</p>') + '</div>' +
      (p.y0 ? field(T("cardInCamp"), p.y0 === p.y1 ? String(p.y0) : p.y0 + "–" + p.y1) : "") +
      field(T("cardYears"), p.years) +
      field(T("cardSource"), p.source)
    );
    fillGallery("photos", p.id);
  }

  function showPlace(id) {
    var pl = byId[id];
    if (!pl) return;
    var people = byRank(D.persons.filter(function (p) { return p.places.indexOf(id) >= 0; }));
    var kids = D.places.filter(function (p) { return p.parent === id; });
    var kidsHtml = kids.length
      ? '<div class="card__row"><p class="card__k">' + esc(T("cardInside")) + '</p>' +
        '<ul class="list card__list">' + kids.map(function (p) {
          return '<li><button class="row" data-place="' + p.id + '">' +
            '<span class="row__name">' + esc(p.name) + '</span>' +
            '<span class="row__rank">' + esc(p.type) + '</span>' +
            '<span class="row__flag">' + p.count + '</span></button></li>';
        }).join("") + '</ul></div>'
      : '';
    /* Расхождение учёта музея с расписанным по фамилиям посетителю не говорит
       ничего: он не знает ни про учёт, ни про таблицу. Это рабочий сигнал для
       музея, и он остался там, где ему место, — в «Данные → Обзор», строка
       «мест с расхождением счёта», и в 03_Данные_аудит.md. */

    openPanel(
      '<p class="card__over">' + esc(TYPES[pl.type] ? typeLabel(TYPES[pl.type]) : pl.type) + '</p>' +
      '<figure class="card__fig" id="gallery"></figure>' +
      '<h2 class="card__name">' + esc(placeName(pl)) + '</h2>' +
      '<p class="card__rank">' + esc(pl.full) + '</p>' +
      field(T("cardAbout"), pl.about) +
      field(T("cardWork"), pl.work) +
      kidsHtml +
      '<div class="card__row"><p class="card__k">' + esc(T("cardKnown")) + ": " + people.length + '</p>' +
      '<ul class="list card__list">' + people.map(personRowHtml).join("") + '</ul></div>' +
      /* Координаты — сведение для сотрудника, а не для посетителя: в зале
         они не значат ничего, а место в карточке занимали наравне с работами.
         Поэтому в самый низ и почти незаметно. */
      (coordText(pl) ? '<p class="card__tech">' + esc(coordText(pl)) + '</p>' : "")
    );
    fillGallery("places", id);
  }

  function showUnplaced() {
    var people = D.persons.filter(function (p) { return !p.places.length; });
    openPanel(
      '<p class="card__over">' + esc(T("unplacedOver")) + '</p>' +
      '<h2 class="card__name">' + esc(Tf("unplacedTitle", people.length)) + "</h2>" +
      '<p class="card__rank">' + esc(T("unplacedHint")) + '</p>' +
      '<ul class="list card__list">' + people.map(personRowHtml).join("") + '</ul>'
    );
  }
  CARDS.person = showPerson;
  CARDS.place = showPlace;
  CARDS.group = showGroup;
  CARDS.unplaced = showUnplaced;

  /* ---------------- карта: раскладка, зум, панорама ---------------- */

  var K_MIN = 1, K_MAX = 24;
  var k = 1, tx = 0, ty = 0;            // масштаб и сдвиг от центра, px
  var fitW = 0, fitH = 0;               // размер карты при k = 1
  var lastK = -1;                       // масштаб, на котором собраны группы
  var frame = $("#map-frame"), inner = $("#map-inner"), baseImg = $("#map-base");

  /* ГРУППЫ ПЕРЕСОБИРАЮТСЯ ТОЛЬКО НА ПОКОЯЩЕЙСЯ КАРТЕ.

     Метки стоят в процентах от слоя, поэтому при изменении масштаба они едут
     вместе с ним и сами по себе никуда не прыгают. Прыгает — группировка:
     она считается в пикселях, и на каждом новом масштабе состав групп другой.
     Пока карта движется, эта пересборка не нужна и только мешает: слой ещё
     едет, а метки уже переставлены под то, куда он приедет.

     Движением считаем три вещи, и все три — «палец на пульсе», а не догадки:
       · gestureOn — на карте есть указатель (перетаскивание, щипок);
       · wheelOn   — колесо ещё крутится (у трекпада это десятки событий в секунду);
       · is-anim   — идёт переход по ширине после кнопки зума.
     Пока хоть одно верно, пересборка откладывается; когда всё стихло —
     выполняется один раз. */
  var gestureOn = false, wheelOn = false;
  var pendingBuild = false, rebuildTimer = null;

  function mapMoving() {
    return gestureOn || wheelOn || inner.classList.contains("is-anim");
  }

  var waitFrom = 0;
  var WAIT_MAX = 2500;         // дольше этого ждать нечего: что-то пошло не так

  function schedulePoints() {
    if (!mapMoving()) { pendingBuild = false; clearTimeout(rebuildTimer); buildPoints(true); return; }
    if (!pendingBuild) waitFrom = Date.now();
    pendingBuild = true;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(settlePoints, 250);
  }

  /* Вызывается там, где движение заведомо кончилось: отпустили пальцы,
     доиграл переход, замолчало колесо. Плюс сама себя переспрашивает
     по таймеру — на случай, если такое событие не придёт вовсе.

     Ждать бесконечно нельзя. Киоск работает в зале без присмотра, и если
     признак движения почему-то залипнет, метки останутся собранными
     по старому масштабу до перезагрузки страницы. Через две с половиной
     секунды пересобираем, что бы там ни было. */
  function settlePoints() {
    clearTimeout(rebuildTimer);
    if (!pendingBuild) return;
    if (mapMoving() && Date.now() - waitFrom < WAIT_MAX) {
      rebuildTimer = setTimeout(settlePoints, 250);
      return;
    }
    pendingBuild = false;
    buildPoints(true);
  }

  // Тема живёт в данных (settings.theme), а не в разметке: иначе сотруднику музея
  // пришлось бы править index.html руками. Цвета карты зашиты внутрь SVG —
  // CSS до них не достаёт, поэтому подложка подменяется файлом.
  var THEME_KEY = "okoyom-theme";

  /* Спутниковый слой.

     Снимок Sentinel-2 собран по той же рамке и в той же проекции, что и схема
     (см. make_satellite.py), поэтому просто подменяет картинку — метки, зоны
     и подписи остаются на своих местах, пересчитывать нечего.

     Слой намеренно НЕ основной. Снимок показывает сегодняшние Соловки:
     посёлок, дороги, причалы. Экспозиция про 1923–1939 годы, и если сделать
     его подложкой по умолчанию, посетитель решит, что так было и тогда.
     Кнопка превращает это в осознанное сравнение: «а как это выглядит сейчас».

     Второе: схема сделана так, чтобы уступать меткам. Снимок — тёмный лес,
     тёмная вода и много текстуры, метки на нём читаются хуже. Ещё одна
     причина держать его вторым, а не первым. */
  var satOn = false;

  function baseSrc() {
    if (satOn) return "assets/map-satellite.jpg";
    return D.settings && D.settings.theme === "light"
      ? "assets/map-base-light.svg" : "assets/map-base.svg";
  }

  function setSat(on) {
    satOn = !!on;
    document.body.classList.toggle("is-sat", satOn);
    var b = $("#sat-toggle");
    if (b) {
      b.setAttribute("aria-pressed", String(satOn));
      b.textContent = satOn ? "Схема" : "Спутник";
      b.title = satOn ? "Вернуться к схеме" : "Показать снимок из космоса";
    }
    // Лицензия снимка требует указания источника. Заодно оговариваем год:
    // посетитель должен понимать, что смотрит на сегодняшние Соловки.
    var note = document.querySelector(".map__note");
    if (note) note.innerHTML = satOn ? T("satNote") : T("mapNote");
    var want = baseSrc();
    if (baseImg.getAttribute("src") !== want) baseImg.src = want;
  }

  function applyTheme(name, remember) {
    D.settings = D.settings || {};
    D.settings.theme = name;
    document.documentElement.setAttribute("data-theme", name);
    var want = baseSrc();
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
  /* keep = true — пересчитать размеры, но НЕ трогать масштаб и сдвиг.

     Нужно потому, что событие load у подложки прилетает не только при первом
     показе: оно же срабатывает при переключении на спутниковый слой и когда
     картинка догрузилась после того, как человек уже что-то нажал. Лист при
     этом тот же самый — та же рамка, та же пропорция, — и сбрасывать вид
     незачем: приблизил человек Анзер, включил спутник, и его выбросило
     обратно на весь архипелаг.

     Это же съедало сдвиг карты из-под панели: догружалась подложка и
     возвращала всё на место. */
  var laidOut = false;

  function layout(keep) {
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var iw = baseImg.naturalWidth || 1, ih = baseImg.naturalHeight || 1;
    fitW = fw;
    fitH = fw * ih / iw;
    lastK = -1;      // размер карты изменился — группы пересобрать заново
    if (keep === true && laidOut) apply();
    else resetZoom();     // первый показ: подобрать вид под область с метками
    laidOut = true;
  }

  // Зум — это ширина и высота, а не transform. SVG и текст перерисовываются
  // на новом размере и остаются чёткими на любом масштабе.
  /* Панель карточки лежит поверх правой части карты. Пока она открыта,
     разрешаем сдвинуть карту левее обычного предела — иначе метку у правого
     края просто нечем вытащить из-под панели: ограничитель не пускает. */
  function panelW() {
    var p = $("#panel");
    if (!p || p.hidden) return 0;
    var w = p.getBoundingClientRect().width;
    return w > frame.clientWidth * 0.8 ? 0 : w;    // узкий экран: панель почти во весь лист
  }

  /* Включает плавность на один переход. Класс снимается по таймеру: держать
     его постоянно нельзя — перетаскивание карты станет вязким. */
  var animTimer = null;
  function animate() {
    inner.classList.add("is-anim");
    inner.offsetHeight;                     // заставляем пересчитать стиль до правки
    clearTimeout(animTimer);
    animTimer = setTimeout(function () {
      inner.classList.remove("is-anim");
      settlePoints();                       // переход кончился — можно пересобирать
    }, 520);
  }

  function apply() {
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var w = fitW * k, h = fitH * k;
    var mx = Math.max(0, (w - fw) / 2), my = Math.max(0, (h - fh) / 2);
    tx = clamp(tx, -mx - panelW(), mx);
    ty = clamp(ty, -my, my);
    inner.style.width = w + "px";
    inner.style.height = h + "px";
    inner.style.left = ((fw - w) / 2 + tx) + "px";
    inner.style.top = ((fh - h) / 2 + ty) + "px";
    /* Масштаб сменился — группы, возможно, устарели. Возможно: пересборка
       произойдёт не сейчас, а когда карта остановится (см. schedulePoints),
       и только если состав меток от неё действительно поменяется. */
    if (k !== lastK) {
      lastK = k;
      schedulePoints();
    } else relabel();                                 // при сдвиге хватает подписей
  }

  // Подписи налезают друг на друга там, где точки стоят кучно.
  // Жадно прячем те, что пересекаются с уже показанной: приоритет —
  // у мест с большим числом людей. При зуме точки расходятся,
  // места освобождается больше, и подписи возвращаются сами.
  function relabel() {
    var els = [].slice.call(inner.querySelectorAll(".pt:not(.pt--ghost)"));
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
  /* Ставит точку в середину той полосы карты, которая осталась видимой
     слева от панели. Масштаб не трогаем: сбрасывать его при каждом открытии
     карточки — значит терять место, куда человек смотрел. */
  function focusPoint(xPct, yPct) {
    var fw = frame.clientWidth, fh = frame.clientHeight;
    var pw = panelW();
    if (!pw) return;
    animate();
    var w = fitW * k, h = fitH * k;
    tx = (fw - pw) / 2 - (fw - w) / 2 - xPct / 100 * w;
    ty = fh / 2 - (fh - h) / 2 - yPct / 100 * h;
    apply();
  }

  /* Во сколько раз надо приблизить, чтобы точки группы разошлись.
     0 — развести нельзя: координаты совпадают (Кремль и Никольский лазарет
     стоят в одной точке, и это правда, а не ошибка данных). */
  function spreadZoom(g) {
    var need = 1;
    for (var i = 0; i < g.length; i++) {
      for (var j = i + 1; j < g.length; j++) {
        var d = Math.hypot(g[i].px - g[j].px, g[i].py - g[j].py);
        if (d < 0.5) return 0;
        need = Math.max(need, (g[i].r + g[j].r + 6) / d);
      }
    }
    return need;
  }

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
    animate();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  }

  $("#sat-toggle").onclick = function () { setSat(!satOn); };

  $("#z-in").onclick = function () { zoomCenter(1.5); };
  $("#z-out").onclick = function () { zoomCenter(1 / 1.5); };
  $("#z-reset").onclick = function () { animate(); resetZoom(); };

  /* Колесо мыши даёт щелчки, а трекпад — сплошной поток мелких событий:
     десятки в секунду. Пересобирать группы на каждое — то же мельтешение,
     что и при щипке. Поэтому пока колесо крутится, карта считается движущейся,
     и пересборка ждёт паузы в 140 мс после последнего события. */
  var wheelTimer = null;
  frame.addEventListener("wheel", function (e) {
    e.preventDefault();
    wheelOn = true;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () { wheelOn = false; settlePoints(); }, 140);
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  // Панорама и щипок. Один палец — тащим, два — масштабируем.
  var ptrs = {}, panFrom = null, pinchFrom = null, dragMoved = false;
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  frame.addEventListener("pointerdown", function (e) {
    if (editing && e.target.closest(".pt")) return;   // в разметке метку тащим отдельно
    ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    gestureOn = true;
    var ids = Object.keys(ptrs);
    if (ids.length === 1) {
      panFrom = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
      dragMoved = false;
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
      // Порог в 4 пикселя: палец на сенсоре всегда чуть съезжает,
      // и без него любое нажатие считалось бы перетаскиванием.
      if (Math.hypot(e.clientX - panFrom.x, e.clientY - panFrom.y) > 4) dragMoved = true;
      apply();
    }
  });

  function endPtr(e) {
    delete ptrs[e.pointerId];
    if (Object.keys(ptrs).length < 2) pinchFrom = null;
    if (!Object.keys(ptrs).length) {
      panFrom = null;
      frame.classList.remove("is-drag");
      gestureOn = false;
      settlePoints();                       // пальцы убрали — карта встала
    }
  }
  frame.addEventListener("pointerup", endPtr);
  frame.addEventListener("pointercancel", endPtr);
  /* И то же самое на окне. Палец можно увести за край экрана, а мышь —
     отпустить над панелью карточки: тогда pointerup до карты не дойдёт,
     указатель останется числиться нажатым, и карта будет считаться
     движущейся вечно — метки замрут собранными по старому масштабу.
     Дубль вреда не делает: удалять уже удалённое нечего. */
  window.addEventListener("pointerup", endPtr);
  window.addEventListener("pointercancel", endPtr);

  /* Нажатие по пустому месту карты закрывает карточку.

     По метке — открывает другую, не требуя сперва закрыть эту: так ведут
     себя все карты, и это единственный способ сравнить два места подряд.
     Нажатия по меткам сюда не доходят — их разбирает обработчик #map-points,
     а кнопки зума и переключатель слоя отсеиваются вместе с ними. */
  frame.addEventListener("click", function (e) {
    if (editing || dragMoved) return;
    if (e.target.closest("button, a")) return;
    if (!$("#panel").hidden) closePanel();
  });

  window.addEventListener("resize", layout);
  // Первая загрузка подбирает вид, все последующие его сохраняют
  baseImg.addEventListener("load", function () { layout(true); });

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

  var lastSig = null;                    // разметка слоя меток на прошлой сборке

  /* Кто где живёт: место -> координаты метки, которая его показывает.
     У группы это координаты её головы, и все места группы показывают
     на неё же — именно поэтому переезд считается по местам, а не по меткам. */
  function homes(host) {
    var out = {};
    [].slice.call(host.children).forEach(function (el) {
      if (!el.dataset || !el.dataset.ids) return;
      var xy = [+el.dataset.x, +el.dataset.y];
      el.dataset.ids.split(" ").forEach(function (id) { out[id] = xy; });
    });
    return out;
  }

  function shift(dx, dy) {
    // Центровка метки на своей точке сделана тем же transform. Потерять её
    // нельзя ни на кадр — иначе метка прыгнет на пол-кружка. См. style.css.
    return "translate(-50%,-50%) translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
  }

  /* Показать переезд между двумя разбиениями на группы.

     Распад: метка, которую раньше показывала группа, выезжает из её кружка
     на своё место. Слияние: метка, которую группа поглотила, уезжает
     в кружок группы и там гаснет — для этого старый узел возвращается
     в слой призраком и удаляется по таймеру.

     Считается всё в процентах от нынешнего размера слоя, и это верно:
     во время жеста слой не пересобирался, поэтому старые метки к этому
     моменту стоят на своих процентах уже нового, конечного размера. */
  var morphTimer = null;

  function morph(host, was, gone) {
    var w = host.clientWidth || inner.clientWidth;
    var h = host.clientHeight || inner.clientHeight;
    if (!w || !h) return false;
    var now = homes(host);
    var moved = [], ghosts = [];

    [].slice.call(host.children).forEach(function (el) {
      var from = was[el.dataset.place];
      if (!from) { el.classList.add("pt--fade"); return; }   // такого места на карте не было
      var dx = (from[0] - +el.dataset.x) / 100 * w;
      var dy = (from[1] - +el.dataset.y) / 100 * h;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;      // никуда не переезжала
      el.style.transform = shift(dx, dy);                    // ставим В ПРЕЖНЕЕ место
      moved.push(el);
    });

    gone.forEach(function (el) {
      if (!el.dataset || !el.dataset.place) return;
      var to = now[el.dataset.place];
      if (!to) return;                                       // места на карте больше нет
      var dx = (to[0] - +el.dataset.x) / 100 * w;
      var dy = (to[1] - +el.dataset.y) / 100 * h;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;      // осталась на месте
      el.className += " pt--ghost";
      host.appendChild(el);
      ghosts.push([el, dx, dy]);
    });

    if (!moved.length && !ghosts.length) return false;
    host.offsetHeight;                                       // один пересчёт на всех
    moved.forEach(function (el) {
      el.classList.add("pt--move");
      el.style.transform = "";                               // едет на своё место
    });
    ghosts.forEach(function (g) {
      g[0].classList.add("is-out");
      g[0].style.transform = shift(g[1], g[2]);              // едет в кружок группы
    });

    clearTimeout(morphTimer);
    morphTimer = setTimeout(function () {
      moved.forEach(function (el) { el.classList.remove("pt--move"); });
      [].slice.call(host.querySelectorAll(".pt--ghost")).forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      relabel();                             // подписи считаем по конечным местам
    }, 420);
    return true;
  }

  /* fade = true — состав меток мог смениться на глазах у человека
     (доехал зум), и смену стоит показать проявлением. При первой отрисовке
     и при перестроении данных проявлять нечего. */
  function buildPoints(fade) {
    // В режиме разметки группировка мешает: метки надо таскать поштучно
    var groups = editing ? mapped().map(function (p) {
      return [{ p: p, px: 0, py: 0, r: 0 }];
    }) : cluster();

    var html = groups.map(function (g) {
      var head = g[0].p;
      var n = 0;
      for (var i = 0; i < g.length; i++) n += g[i].p.count;
      var ids = g.map(function (m) { return m.p.id; }).join(" ");
      var label = g.length > 1 ? placeName(head) + " +" + (g.length - 1) : placeName(head);
      var size = dotSize(n);
      var ty = typeOf(head);
      var col = ty && ty.color ? ";background:" + ty.color : "";
      var badge = ty && ty.icon && g.length === 1 ? iconSvg(ty.icon, "pt__ic") : "";
      var spread = g.length > 1 ? spreadZoom(g) : 0;
      return '<button class="pt' + (n ? "" : " pt--empty") + (g.length > 1 ? " pt--group" : "") + '"' +
        ' data-place="' + head.id + '" data-ids="' + ids + '"' +
        ' data-spread="' + spread.toFixed(3) + '" data-x="' + head.x + '" data-y="' + head.y + '"' +
        ' style="left:' + head.x + '%;top:' + head.y + '%;z-index:' + (10 + Math.min(n, 99)) + '">' +
        '<span class="pt__dot" style="width:' + size + 'px;height:' + size + 'px' + col + '">' +
        n + badge + '</span>' +
        '<span class="pt__label">' + esc(label) + '</span></button>';
    }).join("");

    /* Разметка совпала с прошлой — значит и группы те же, и трогать слой
       нечем. Это главный тормоз против скачков: перезапись innerHTML
       выбрасывает старые кнопки и строит новые, браузер заново считает
       их положение, и метка моргает и дёргается, хотя на карте
       не изменилось ровным счётом ничего.

       Сверяем именно разметку, а не список групп: тогда правка данных
       в служебном режиме (имя, число, цвет типа) тоже доходит до карты. */
    if (html === lastSig) { relabel(); return; }
    lastSig = html;

    var host = $("#map-points");
    /* Где какое место показывалось ДО пересборки и какие метки за это
       отвечали. Нужно, чтобы показать переезд: точка не исчезает на месте
       и не появляется из ниоткуда, а въезжает в группу или выезжает из неё. */
    var was = (fade && !motionOff()) ? homes(host) : null;
    var gone = was ? [].slice.call(host.children) : null;

    host.innerHTML = html;
    // Пока метки переезжают, подписи считать бессмысленно: их расставят
    // по местам, которых уже не будет. Это делает morph, когда переезд кончится.
    var riding = was ? morph(host, was, gone) : false;

    $("#map-points").onclick = function (e) {
      var b = e.target.closest("[data-place]");
      if (!b || editing) return;
      var ids = b.dataset.ids.split(" ");

      /* Нажатие по группе сначала пробует её РАСКРЫТЬ, а не показать список.
         Точки слиплись потому, что на этом масштабе им тесно; приблизим —
         и они разойдутся сами. Это привычнее любого списка: человек видит,
         где именно эти места, а не читает их названия.

         Список остаётся запасным выходом на два случая: координаты совпадают
         (Кремль и Никольский лазарет — одна точка) или нужного приближения
         не хватает до предела в 24×. */
      if (ids.length > 1) {
        /* Раскрываем группу И показываем сводку. Одного раскрытия мало:
           точки разошлись, но человек не знает, что это за места и какая
           из них какая. Одного списка тоже мало: он не отвечает на вопрос
           «где это». Вместе они и отвечают.

           Порядок важен: сперва зум (он пересобирает метки), потом карточка,
           потом сдвиг — панель уже открыта, и есть от чего считать полосу. */
        var need = parseFloat(b.dataset.spread || "0");
        var x = parseFloat(b.dataset.x), y = parseFloat(b.dataset.y);
        groupSpread = need > 1 && k * need <= K_MAX;
        if (groupSpread) {
          var r = b.getBoundingClientRect();
          animate();
          zoomAt(r.left + r.width / 2, r.top + r.height / 2, need);
        }
        cardReset();
        showCard("group", ids);
        focusPoint(x, y);
        return;
      }

      cardReset();
      showCard("place", ids[0]);
      focusPoint(parseFloat(b.dataset.x), parseFloat(b.dataset.y));
    };
    if (!riding) relabel();
  }

  // Дублирует метки карты списком: на вертикальном экране это основной способ
  // добраться до места, потому что сама карта там мелкая.
  function renderPlaceStrip() {
    var list = mapped().slice().sort(function (a, b) { return b.count - a.count; });
    $("#plist").innerHTML = list.map(function (p) {
      var ty = typeOf(p);
      return '<button class="plist__b" data-place="' + p.id + '">' +
        '<span class="plist__d" style="background:' + (ty && ty.color ? esc(ty.color) : "var(--accent)") +
        '">' + p.count + "</span><span>" + esc(placeName(p)) + "</span>" +
        '<span class="plist__t">' + esc(ty ? typeLabel(ty) : p.type) + "</span></button>";
    }).join("");
    $("#plist").onclick = function (e) {
      var b = e.target.closest("[data-place]");
      if (b && !editing) { cardReset(); showCard("place", b.dataset.place); }
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
        (zone ? "" : iconSvg(t.icon, "pt__ic")) + "</span>" + esc(typeLabel(t)) + "</span>";
    }
    var html = items.length < 2 ? "" : items.map(function (t) { return line(t, false); }).join("");
    if (zitems.length) {
      html += '<span class="legend__h">' + esc(T("works")) + '</span>' +
        zitems.map(function (t) { return line(t, true); }).join("");
    }
    $("#legend").innerHTML = html;
  }

  // Карточка группы: перечень слипшихся мест с числами
  /* Русское согласование числительных. В шаблоне словаря стояло «%1 места»
     наотрез, и на экране получалось «5 места, 112 имён». Для экспозиции,
     где речь идёт о людях, такая небрежность заметна. */
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b > 1 && b < 5) return few;
    return many;
  }

  // Раскрылся ли кластер перед показом карточки. От этого зависит подсказка:
  // «точки разошлись, выбирайте на карте» против «развести нельзя, вот список».
  var groupSpread = false;

  function showGroup(ids) {
    var list = ids.map(function (id) { return byId[id]; });
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i].count;
    openPanel(
      '<p class="card__over">' + esc(T("groupOver")) + '</p>' +
      '<h2 class="card__name">' + esc(lang === "en"
        ? Tf("groupTitle", list.length, total)
        : list.length + " " + plural(list.length, "место", "места", "мест") + ", " +
          total + " " + plural(total, "имя", "имени", "имён")) + '</h2>' +
      '<p class="card__rank">' + esc(T(groupSpread ? "groupHintZoom" : "groupHint")) + '</p>' +
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
    renderLegend();
    renderPlaceStrip();
    renderZones();
    if (baseImg.complete) layout(); else apply();
  }

  /* ---------------- режим разметки ---------------- */
  /* Метки перетаскиваются мышью, на выходе — готовые столбцы x,y для places.csv.
     Нужен, когда карту заменят на изображение и координаты перестанут
     считаться из широты и долготы. Включение: Ctrl+E или #edit в адресе. */

  var editing = false, dragPt = null, editMode = "places", dirty = false;
  // Взведена ли кнопка «+ Метка». Зонам такой флаг уже был — это drawing.
  // Третье состояние — удаление вершин; со взводом добавления несовместимо.
  var adding = false, erasing = false;

  // Правки живут в открытой вкладке, пока не нажали «Сохранить».
  // Закрыть её случайно — потерять всю работу, поэтому предупреждаем.
  function markDirty() {
    if (dirty) return;
    dirty = true;
    syncDirty();
  }

  /* Признак несохранённого нужен в двух местах сразу. Метки и зоны двигают
     на вкладке «Карта», таблицы правят на вкладке «Данные», а забыть
     сохранить можно из любой. Раньше и признак, и кнопка сохранения жили
     только в «Данных» — с карты не было видно ни того, ни другого. */
  function syncDirty() {
    if (dirty) setWhere("dirty");
    var d = $("#edit-dirty");
    if (d) d.textContent = dirty ? "есть несохранённые правки" : "";
    var b = $("#edit-save");
    if (b) b.classList.toggle("is-dirty", dirty);
  }
  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Правится что-то одно: метки или зоны. Иначе два слоя спорят за одну
  // площадь карты, и нажатие уходит не туда — на этом уже обжигались.
  function setMode(m) {
    editMode = m;
    zoneHit = false;
    document.body.classList.toggle("is-places", m === "places");
    document.body.classList.toggle("is-zones", m === "zones");
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.mode === m));
    });
    // Взведённую кнопку гасим при уходе из её режима: иначе она доживёт
    // до другого слоя и начнёт плодить объекты там, где их не ждали.
    if (m !== "places") adding = false;
    if (m !== "zones") { drawing = null; erasing = false; }
    syncArm();
    renderZones();
  }

  /* Добавление и перемещение разведены намеренно.
     Тащить курсором можно всегда — это основное действие режима.
     А создать новую метку или новую вершину — только при взведённой кнопке.
     Сотрудник правит координаты часами, и случайное нажатие по пустому
     месту не должно молча заводить объект, который потом ищи и удаляй. */
  function armText() {
    var z = D.zones.filter(function (x) { return x.id === edZone; })[0];
    if (editMode === "places") {
      return adding
        ? "<b>Добавление меток включено.</b> Каждое нажатие по карте ставит новую метку — её сразу можно перетащить. Выключите кнопку, когда закончите."
        : "Правка меток: перетаскивайте их курсором. Чтобы завести новую — включите «+ Метка». Зоны сейчас не трогаются.";
    }
    if (drawing) {
      var few = z && z.points.length < 3;
      return "<b>Добавление вершин включено.</b> Каждое нажатие по карте ставит вершину" +
        (few ? "; контур появится с третьей" : ", готовые тянутся курсором") +
        ". Выключите кнопку, когда закончите.";
    }
    if (erasing) {
      return "<b>Удаление вершин включено.</b> Нажимайте по вершинам — они исчезают. Меньше трёх не даст: у многоугольника пропадёт площадь.";
    }
    if (!z) return "Правка зон: выберите зону нажатием по карте или в «Данные → Зоны», либо заведите новую кнопкой «+ Зона». Метки сейчас не трогаются.";
    if (z.shape !== "poly") return "Правка зон: перетаскивайте пятно курсором, размеры — в «Данные → Зоны». Метки сейчас не трогаются.";
    return "Правка зон: перетаскивайте вершины курсором. Добавить — «+ Вершина», удалить — «− Вершина». Метки сейчас не трогаются.";
  }

  // Единственное место, где кнопки, курсор и подсказка приводятся в согласие
  // с состоянием. Разложить это по обработчикам — гарантированно разъедется.
  function syncArm() {
    if (drawing && drawing !== edZone) drawing = null;   // выбрали другую зону
    var z = D.zones.filter(function (x) { return x.id === edZone; })[0];
    var poly = !!(z && z.shape === "poly");              // вершины есть только у контура
    // Треугольник — предел. Дальше у многоугольника пропадает площадь,
    // поэтому кнопка удаления гаснет, а взвод с неё снимается сам:
    // иначе он остался бы висеть на кнопке, по которой уже не нажать.
    if (!poly || z.points.length <= 3) erasing = false;
    var a = $("#edit-add"), v = $("#edit-vx"), x = $("#edit-vxdel");
    if (a) a.setAttribute("aria-pressed", String(adding));
    if (v) {
      v.setAttribute("aria-pressed", String(!!drawing));
      v.disabled = !poly;
    }
    if (x) {
      x.setAttribute("aria-pressed", String(erasing));
      x.disabled = !poly || z.points.length <= 3;
    }
    document.body.classList.toggle("is-add", adding && editMode === "places");
    document.body.classList.toggle("is-draw", !!drawing && editMode === "zones");
    document.body.classList.toggle("is-erase", erasing && editMode === "zones");
    $("#edit-t").innerHTML = armText();
  }

  function setErasing(on) {
    if (on && editMode !== "zones") setMode("zones");
    if (on) drawing = null;
    erasing = !!on;
    syncArm();
    renderZones();
    renderZoneForm();
  }

  function setAdding(on) {
    if (on && editMode !== "places") setMode("places");
    adding = !!on;
    syncArm();
  }

  function setDrawing(id) {
    if (id && editMode !== "zones") setMode("zones");
    if (id) erasing = false;                             // ставить и убирать разом нельзя
    drawing = id || null;
    if (drawing) showView("map");                        // обводить можно только на карте
    syncArm();
    renderZones();
    renderZoneForm();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mode]");
    if (b) setMode(b.dataset.mode);
  });

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
    snapshot();
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
    if (!on) { drawing = null; adding = false; syncArm(); }
    if (on) { setMode(editMode); renderStaff(); }
    else if (!$("#view-data").hidden) showView("map");
    var pts = inner.querySelectorAll(".pt");
    for (var i = 0; i < pts.length; i++) pts[i].classList.toggle("pt--edit", on);
    if (on) editOut();
  }

  /* Вход в служебный режим — только адресом `index.html#edit`.

     Раньше было три пути: долгое нажатие на заголовок, Cmd+E и адрес.
     Первые два убраны намеренно.

     Долгое нажатие — прямая опасность в зале: посетитель держит палец
     на заголовке две секунды и оказывается в панели правки данных.
     Заметить это некому, а испортить он может всё.

     Cmd+E не опасен, но и не нужен: на киоске нет клавиатуры, а на машине
     сотрудника адрес с `#edit` открывается один раз и держится при
     перезагрузке. Два способа делать одно и то же — лишнее знание
     для человека, которому это объяснять раз в год.

     Слушаем и hashchange: дописать `#edit` к уже открытой странице
     перезагрузки не вызывает, и без этого ничего бы не произошло. */

  /* Правка доступна только там, где есть что править: приложение открыто
     с диска (`file://`) или со своего компьютера — через `server.py`,
     который нужен Safari и Firefox.

     На опубликованной в сети копии служебный режим прячется целиком.
     Испортить данные через него нельзя и так — запись идёт на диск того,
     кто открыл страницу, а не в репозиторий, — но посетитель, случайно
     набравший `#edit`, оказывался бы в панели правки музейных данных
     и решал бы, что правит экспозицию. */
  function localCopy() {
    if (location.protocol === "file:") return true;
    var h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" ||
           /\.localhost$/.test(h);
  }

  function checkHash() {
    if (location.hash === "#edit" && localCopy()) setEdit(true);
  }
  window.addEventListener("hashchange", checkHash);
  setTimeout(checkHash, 0);

  /* Поле координат по умолчанию свёрнуто: в развёрнутом виде панель закрывала
     нижнюю четверть карты. Выбор запоминается — как тема и язык. */
  function setCoords(on) {
    $("#edit").classList.toggle("is-min", !on);
    $("#edit-coords").setAttribute("aria-pressed", String(!!on));
    try { localStorage.setItem("okoyom.coords", on ? "1" : "0"); } catch (e) {}
  }
  setCoords((function () {
    try { return localStorage.getItem("okoyom.coords") === "1"; } catch (e) { return false; }
  })());
  $("#edit-coords").onclick = function () {
    setCoords($("#edit").classList.contains("is-min"));
  };

  $("#edit-add").onclick = function () { setAdding(!adding); };
  $("#edit-vx").onclick = function () {
    if (!edZone) return;
    setDrawing(drawing ? null : edZone);
  };
  $("#edit-vxdel").onclick = function () { setErasing(!erasing); };
  // Новая зона прямо с карты: сразу контуром и сразу готовая принимать вершины.
  // Кнопка в «Данные → Зоны» заводит пятно — там это быстрая схематичная
  // разметка, а здесь человек уже стоит над картой и собирается обводить.
  $("#edit-zadd").onclick = function () {
    if (editMode !== "zones") setMode("zones");
    snapshot();
    var n = 1;
    while (D.zones.filter(function (z) { return z.id === "Z" + n; }).length) n++;
    var t = typesOf("zone")[0];
    var z = { id: "Z" + n, type: t ? t.type : "", label: "Новая зона", shape: "poly",
              x: 50, y: 50, rx: 8, ry: 6, points: [], geo: "", note: "" };
    D.zones.push(z);
    edZone = z.id;
    renderZoneList();
    setDrawing(z.id);
  };
  $("#edit-off").onclick = function () { setEdit(false); };
  $("#edit-undo").onclick = undo;
  $("#edit-copy").onclick = function () {
    $("#edit-out").select();
    try { document.execCommand("copy"); } catch (err) {}
    $("#edit-copy").textContent = "Скопировано";
    setTimeout(function () { $("#edit-copy").textContent = "Скопировать"; }, 1500);
  };

  inner.addEventListener("pointerdown", function (e) {
    if (!editing || editMode !== "places") return;
    var el = e.target.closest(".pt");
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    snapshot();
    dragPt = byId[el.dataset.place];
    el.setPointerCapture(e.pointerId);
  });

  inner.addEventListener("pointermove", function (e) {
    if (!dragPt) return;
    var r = inner.getBoundingClientRect();     // учитывает текущий зум и сдвиг
    markDirty();
    dragPt.x = clamp((e.clientX - r.left) / r.width * 100, 0, 100);
    dragPt.y = clamp((e.clientY - r.top) / r.height * 100, 0, 100);
    var el = inner.querySelector('[data-place="' + dragPt.id + '"]');
    el.style.left = dragPt.x + "%";
    el.style.top = dragPt.y + "%";
    editOut();
  });

  inner.addEventListener("pointerup", function () { dragPt = null; });

  inner.addEventListener("click", function (e) {
    // Флаг снимаем всегда, даже когда выходим раньше: иначе он доживёт
    // до смены режима и съест первое нажатие уже по меткам.
    var hit = zoneHit;
    zoneHit = false;
    if (!editing || editMode !== "places") return;
    if (!adding) return;                       // без взведённой кнопки — ничего
    if (hit) return;
    if (e.target.closest(".pt")) return;
    addPlace(e.clientX, e.clientY);
  });

  /* ---------------- реестр ---------------- */

  function fillSelect(sel, values) {
    sel.innerHTML += values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + "</option>";
    }).join("");
  }

  // Русский поиск обязан считать ё и е одной буквой: посетитель наберёт
  // «Зернов», а в реестре «Зёрнов» — и не найдёт ничего.
  function norm(s) {
    return String(s || "").toLowerCase().replace(/ё/g, "е");
  }
  // Искать только по имени мало: «епископ» или «Анзер» давали пусто,
  // и это выглядело как поломка.
  function haystack(p) {
    if (p._h) return p._h;
    // Латинская форма кладётся в тот же стог: посетитель наберёт «Abalymov»
    // в английском режиме и должен найти Абалымова.
    p._h = norm([p.name, p.surname, tr(p.name + " " + p.surname), p.rank, p.years, p.source,
                 p.places.map(function (id) { return byId[id] ? byId[id].name : ""; }).join(" ")
                ].join(" "));
    return p._h;
  }

  var yearNow = 0;

  // Годы разобраны из свободного текста и известны у меньшинства, поэтому
  // отбор по году честно подписывает, сколько записей он вообще может видеть.
  function renderYears() {
    var have = D.persons.filter(function (p) { return p.y0; }).length;
    var html = '<button class="years__b" data-year="0"' +
      (yearNow ? "" : ' aria-selected="true" aria-pressed="true"') + ">" + esc(T("yearAll")) + "</button>";
    for (var y = 1923; y <= 1939; y++) {
      html += '<button class="years__b" data-year="' + y + '"' +
        (yearNow === y ? ' aria-pressed="true"' : "") + ">" + y + "</button>";
    }
    html += '<span class="years__n">' + esc(T("yearsKnown")) + " " + have + " " + esc(T("yearsFrom")) +
      " " + D.meta.total + ", " + esc(T("yearsHow")) + "</span>";
    $("#years").innerHTML = html;
  }
  $("#years").onclick = function (e) {
    var b = e.target.closest("[data-year]");
    if (!b) return;
    yearNow = +b.dataset.year;
    renderYears();
    renderRegistry();
  };

  /* Перезапуск анимации у элемента, содержимое которого только что заменили.
     Снять класс, заставить пересчитать стиль, повесить обратно — иначе
     браузер не считает это новым запуском и ничего не проигрывает. */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    el.offsetHeight;
    el.classList.add(cls);
  }

  function renderRegistry() {
    var q = norm($("#q").value.trim());
    var rank = $("#f-rank").value;
    var place = $("#f-place").value;

    var rows = D.persons.filter(function (p) {
      if (rank && baseRank(p.rank) !== rank) return false;
      if (place === "__none" && p.places.length) return false;
      if (place && place !== "__none" && p.places.indexOf(place) < 0) return false;
      if (q && haystack(p).indexOf(q) < 0) return false;
      if (yearNow && !(p.y0 && p.y0 <= yearNow && p.y1 >= yearNow)) return false;
      return true;
    });

    $("#list").innerHTML = rows.map(personRowHtml).join("") ||
      '<li class="card__v--none">' + esc(T("nothing")) + '</li>';
    replay($("#list"), "is-in");
    $("#found").textContent = yearNow
      ? rows.length + " " + T("inYear") + " " + yearNow
      : rows.length + " " + T("of") + " " + D.meta.total;
  }

  $("#list").onclick = function (e) {
    var b = e.target.closest("[data-person]");
    if (b) { cardReset(); showCard("person", b.dataset.person); }
  };
  ["#q", "#f-rank", "#f-place"].forEach(function (s) {
    $(s).oninput = renderRegistry;
  });

  /* ---------------- словарь ---------------- */

  function renderGlossary() {
    $("#glossary").innerHTML = D.glossary.map(function (g) {
      var term = (lang === "en" && g.term_en) || g.term;
      var text = (lang === "en" && g.text_en) || g.text;
      return "<dt>" + esc(term) + "</dt><dd>" + esc(text) + "</dd>";
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
    if (name === "plcs") { setMode("places"); renderPlaceList(); renderPlaceForm(); }
    if (name === "zons") { setMode("zones"); renderZoneList(); renderZoneForm(); }
    if (name === "typs") { renderThemes(); renderTypes(); }
  }
  document.addEventListener("input", function (e) {
    if (editing && e.target.closest("#view-data")) markDirty();
  });

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
        snapshot();
        D.persons.splice(D.persons.indexOf(p), 1);
        edPerson = null;
        recount(); renderPersonList(); renderPersonForm();
      }
    };
  }

  $("#ed-add").onclick = function () {
    snapshot();
    var id = "P" + Math.random().toString(16).slice(2, 8);
    D.persons.unshift({ id: id, name: "", surname: "Новая запись", rank: "",
                        years: "", source: "", places: [] });
    edPerson = id;
    $("#ed-q").value = "";
    renderPersonList(); renderPersonForm();
  };

  function recount() {
    D.persons.forEach(function (p) { p._h = null; });   // кэш поиска устарел
    markDirty();
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
        snapshot();
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
    snapshot();
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
      return '<span class="zlab" data-zlab="' + z.id + '" style="left:' + c.x +
        "%;top:" + (c.y + c.ry) + '%">' + esc(z.label) + "</span>";
    }).join("");

    var sel = D.zones.filter(function (z) { return z.id === edZone; })[0];
    if (editing && editMode === "zones" && sel && sel.shape === "poly") {
      html += sel.points.map(function (p, i) {
        return '<span class="zdot" data-vx="' + i + '" style="left:' + p[0] +
          "%;top:" + p[1] + '%"></span>';
      }).join("");
    }
    $("#zlabels").innerHTML = html;
  }

  /* ---- работа с геометрией на карте ---- */

  var dragZone = null, dragVx = -1, dragDot = null, drawing = null;
  // Нажатие по зоне или вершине всплывает дальше и попадает в обработчик,
  // который заводит новое место. Помечаем такие нажатия и пропускаем их.
  var zoneHit = false;

  /* Во время перетаскивания нельзя звать renderZones(): она пересобирает
     слои целиком и уничтожает элемент, который держит захват указателя.
     Поэтому тащим точечно, а полную перерисовку делаем на отпускании. */
  function movedDom(z) {
    var poly = $("#zones").querySelector('[data-zone="' + z.id + '"]');
    if (poly) {
      if (z.shape === "poly") {
        poly.setAttribute("points", z.points.map(function (q) { return q[0] + "," + q[1]; }).join(" "));
      } else {
        poly.setAttribute("cx", z.x);
        poly.setAttribute("cy", z.y);
      }
    }
    var lab = $("#zlabels").querySelector('[data-zlab="' + z.id + '"]');
    if (lab) {
      var c = zoneCenter(z);
      lab.style.left = c.x + "%";
      lab.style.top = (c.y + c.ry) + "%";
    }
  }

  function mapPct(e) {
    var r = inner.getBoundingClientRect();
    if (!r.width || !r.height) return null;    // карта скрыта другой вкладкой
    return { x: +clamp((e.clientX - r.left) / r.width * 100, 0, 100).toFixed(2),
             y: +clamp((e.clientY - r.top) / r.height * 100, 0, 100).toFixed(2) };
  }

  // перетаскивание вершины
  $("#zlabels").addEventListener("pointerdown", function (e) {
    var d = e.target.closest("[data-vx]");
    if (!editing || editMode !== "zones" || !d) return;
    e.preventDefault(); e.stopPropagation();
    zoneHit = true;
    if (erasing) {
      var ez = D.zones.filter(function (x) { return x.id === edZone; })[0];
      // Кнопка в этом случае недоступна, но проверку дублируем: между её
      // отрисовкой и нажатием состояние могло измениться.
      if (!ez || ez.points.length <= 3) return;
      snapshot();
      ez.points.splice(+d.dataset.vx, 1);
      ez.geo = "";                              // геометрию правили руками
      renderZones(); renderZoneList(); renderZoneForm();
      return;
    }
    snapshot();
    dragVx = +d.dataset.vx;
    dragDot = d;
    // Без захвата движение мыши уходит слою зон — а он соседняя ветка дерева,
    // и обработчик подписей его не увидит. Вершина отклеится от курсора,
    // едва он сойдёт с кружка в тринадцать пикселей.
    try { d.setPointerCapture(e.pointerId); } catch (err) {}
  });
  $("#zlabels").addEventListener("pointermove", function (e) {
    if (dragVx < 0) return;
    var z = D.zones.filter(function (x) { return x.id === edZone; })[0], p = mapPct(e);
    if (!z || !p) return;
    markDirty();
    z.points[dragVx] = [p.x, p.y];
    z.geo = "";                                 // геометрию правили руками
    if (dragDot) { dragDot.style.left = p.x + "%"; dragDot.style.top = p.y + "%"; }
    movedDom(z);
  });
  $("#zlabels").addEventListener("pointerup", function () {
    if (dragVx < 0) return;
    dragVx = -1; dragDot = null;
    renderZones(); renderZoneForm();
  });

  // обводка: каждое нажатие добавляет вершину
  $("#zones").addEventListener("pointerdown", function (e) {
    if (!editing || editMode !== "zones") return;
    if (drawing) {
      var z = D.zones.filter(function (x) { return x.id === drawing; })[0], p = mapPct(e);
      if (z && p) {
        e.preventDefault();
        zoneHit = true;
        markDirty();
        z.points.push([p.x, p.y]);
        z.geo = "";
        renderZones(); renderZoneForm();
      }
      return;
    }
    var el = e.target.closest("[data-zone]");
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    zoneHit = true;
    snapshot();
    var zz = D.zones.filter(function (x) { return x.id === el.dataset.zone; })[0];
    edZone = zz ? zz.id : null;
    // Перерисовать надо до захвата: перерисовка заменяет элемент, и захват,
    // взятый на старом, пропал бы в ту же миллисекунду.
    renderZones(); renderZoneList(); renderZoneForm();
    if (zz && zz.shape !== "poly") {              // пятно тащим целиком
      dragZone = zz;
      var fresh = $("#zones").querySelector('[data-zone="' + zz.id + '"]');
      if (fresh) { try { fresh.setPointerCapture(e.pointerId); } catch (err) {} }
    }
  });
  $("#zones").addEventListener("pointermove", function (e) {
    if (!dragZone) return;
    var p = mapPct(e);
    if (!p) return;
    markDirty();
    dragZone.x = p.x; dragZone.y = p.y;
    movedDom(dragZone);
  });
  $("#zones").addEventListener("pointerup", function () {
    if (!dragZone) return;
    dragZone = null;
    renderZones(); renderZoneForm();
  });

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
    syncArm();                                 // выбор зоны меняет доступность «+ Вершина»
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
            "добавляются кнопкой ниже или «+ Вершина» на карте; тащатся курсором") +
        '<div class="fld"><span class="fld__k"></span><div class="dt__acts">' +
        '<button class="edit__btn" data-zdraw="' + z.id + '">' +
        (drawing === z.id ? "Закончить добавление" : "Добавлять вершины") + "</button>" +
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
        setDrawing(drawing === z.id ? null : z.id);
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
      snapshot();
      D.zones.splice(D.zones.indexOf(z), 1);
      edZone = null;
      renderZones(); renderZoneList(); renderZoneForm();
    };
  }

  $("#zn-add").onclick = function () {
    snapshot();
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

  $("#dt-report").onclick = function () {
    var lines = ["id,имя,сан,места,есть источник,есть место"];
    D.persons.forEach(function (p) {
      lines.push([p.id, csvCell((p.name + " " + p.surname).trim()), csvCell(p.rank),
        csvCell(p.places.map(function (i) { return byId[i] ? byId[i].name : i; }).join("; ")),
        p.source ? "да" : "НЕТ", p.places.length ? "да" : "НЕТ"].join(","));
    });
    download("отчёт-о-полноте.csv", lines.join("\n"));
  };

  /* ---- отмена действия ---- */
  /* Снимок всех правимых данных перед каждым изменением. Данные простые,
     весь снимок — около 120 КБ, тридцати хватает с запасом и по памяти,
     и по смыслу: дальше проще перезагрузить страницу.

     Снимок делается ДО изменения. Для текстовых полей — в момент, когда
     в поле входят (focusin), а не на каждую букву: иначе стек забьётся
     посимвольно и отмена станет бесполезной. */

  var UNDO_MAX = 30, hist = [];

  function snapState() {
    return JSON.stringify({
      p: D.persons, l: D.places, z: D.zones, t: D.types, s: D.settings, ph: D.photos
    });
  }

  function snapshot() {
    hist.push(snapState());
    if (hist.length > UNDO_MAX) hist.shift();
    refreshUndo();
    /* «Можно отменить» и «не сохранено» — это одно и то же событие, поэтому
       признак ставится здесь, а не в каждом обработчике по отдельности.
       Раньше он стоял россыпью, и addPlace() его просто забыли: сотрудник мог
       наставить меток, закрыть вкладку и не получить ни одного предупреждения.
       Изредка признак встанет зря — нажали на метку и отпустили, не сдвинув.
       Лишний вопрос при закрытии дешевле потерянной работы. */
    markDirty();
  }

  function refreshUndo() {
    var b = $("#edit-undo");
    if (!b) return;
    b.disabled = !hist.length;
    b.textContent = hist.length ? "Отменить (" + hist.length + ")" : "Отменить";
  }

  function undo() {
    var s = hist.pop();
    if (!s) return;
    var o = JSON.parse(s);
    D.persons = o.p; D.places = o.l; D.zones = o.z; D.types = o.t;
    D.settings = o.s; D.photos = o.ph || {};

    // справочники строятся заново: ссылки на прежние объекты больше не годятся
    for (var k in byId) delete byId[k];
    D.places.forEach(function (p) { byId[p.id] = p; });
    for (var k2 in TYPES) delete TYPES[k2];
    (D.types || []).forEach(function (t) { TYPES[t.type] = t; });
    edPerson = edPlace = edZone = null;
    drawing = null;
    document.body.classList.remove("is-draw");

    applyTheme((D.settings || {}).theme || "light", false);
    recount();
    if (!$("#view-data").hidden) renderStaff();
    refreshUndo();
  }

  document.addEventListener("keydown", function (e) {
    if (!editing) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" ||
        e.key === "я" || e.key === "Я")) {
      e.preventDefault();
      undo();
    }
  });

  // Вход в текстовое поле панели = начало правки: снимаем состояние до неё
  document.addEventListener("focusin", function (e) {
    if (!editing) return;
    if (e.target.closest("#view-data") &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) snapshot();
  });

  /* ---- проверка данных перед записью ---- */
  /* Мусор накапливается незаметно: человек без фамилии, два места с одним
     названием, ссылка на удалённое место. Проверяем перед сохранением
     и показываем список — сохранить всё равно можно, но осознанно. */

  function validate() {
    var bad = [];
    var seenPlace = {}, seenId = {};

    D.persons.forEach(function (p) {
      if (!(p.name + p.surname).trim()) bad.push("Персоналия " + p.id + " без имени и фамилии");
      if (seenId[p.id]) bad.push("Повторяющийся идентификатор персоналии: " + p.id);
      seenId[p.id] = 1;
      p.places.forEach(function (id) {
        if (!byId[id]) bad.push((p.name + " " + p.surname).trim() + " привязан к несуществующему месту " + id);
      });
    });

    D.places.forEach(function (pl) {
      var key = pl.name.trim().toLowerCase();
      if (!key) bad.push("Место " + pl.id + " без названия");
      else if (seenPlace[key]) bad.push("Два места с названием «" + pl.name + "»");
      else seenPlace[key] = 1;
      if (!pl.type) bad.push("У места «" + pl.name + "» не задан тип");
      if (pl.parent && !byId[pl.parent]) bad.push("Место «" + pl.name + "» вложено в несуществующее " + pl.parent);
      if (pl.parent === pl.id) bad.push("Место «" + pl.name + "» вложено само в себя");
    });

    D.zones.forEach(function (z) {
      if (!z.type) bad.push("У зоны «" + (z.label || z.id) + "» не задан вид работ");
      if (z.shape === "poly" && z.points.length < 3)
        bad.push("У зоны «" + (z.label || z.id) + "» меньше трёх вершин — она не нарисуется");
    });

    return bad;
  }

  function checkBeforeSave() {
    var bad = validate();
    if (!bad.length) return true;
    var head = bad.length === 1 ? "Нашлась одна неточность:" : "Нашлось неточностей: " + bad.length;
    return confirm(head + "\n\n" + bad.slice(0, 12).join("\n") +
      (bad.length > 12 ? "\n… и ещё " + (bad.length - 12) : "") +
      "\n\nСохранить всё равно?");
  }

  /* ---- сохранение ---- */
  /* Браузер умеет писать в папку напрямую, если пользователь один раз её выбрал.
     Папка запоминается в IndexedDB, поэтому спрашивают только в первый раз.
     Где API недоступен (не Chrome) — откат на скачивание файлов. */

  var dirHandle = null;
  var CAN_WRITE = typeof window.showDirectoryPicker === "function";

  /* Ограничение по времени здесь не перестраховка, а обязательное.

     На file:// IndexedDB не работает и — что хуже — не сообщает об этом:
     indexedDB.open() не бросает исключение и не присылает ни onsuccess,
     ни onerror. Запрос просто повисает навсегда. Проверено в Chrome.

     А сохранение начинается с чтения запомненной папки. Без ограничения
     первое же «Сохранить» вешало всю запись: кнопка оставалась в «Сохраняю…»
     и не происходило ничего — ни файлов, ни ошибки. Нашлось тестом
     app/data/test_save.py.

     Последствие, которое надо знать: по file:// папка между сеансами
     не запоминается, её указывают один раз за открытие страницы.
     В пределах сеанса дескриптор живёт в dirHandle и больше не спрашивается. */

  var IDB_MS = 1500;
  var idbBroken = false;

  function idbOpen() {
    return new Promise(function (res, rej) {
      var over = false;
      var t = setTimeout(function () {
        over = true; idbBroken = true;
        rej(new Error("IndexedDB не отвечает"));
      }, IDB_MS);
      var r;
      try { r = indexedDB.open("okoyom", 1); }
      catch (e) { clearTimeout(t); idbBroken = true; return rej(e); }
      r.onupgradeneeded = function () { r.result.createObjectStore("h"); };
      r.onsuccess = function () { if (over) return; clearTimeout(t); res(r.result); };
      r.onerror = function () {
        if (over) return;
        clearTimeout(t); idbBroken = true; rej(r.error);
      };
    });
  }
  function idbGet(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var q = db.transaction("h").objectStore("h").get(k);
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function idbPut(k, v) {
    return idbOpen().then(function (db) {
      db.transaction("h", "readwrite").objectStore("h").put(v, k);
    }).catch(function () {});
  }

  function files() {
    return {
      "data.js": "// Файл собран панелью музея " + new Date().toISOString().slice(0, 10) +
                 "\n// Правки сделаны в приложении.\nwindow.DATA = " +
                 JSON.stringify(D, null, 1) + ";\n",
      "persons.csv": personsCsv(),
      "places.csv": placesCsv(),
      "types.csv": typesCsv(),
      "settings.csv": settingsCsv(),
      "zones.csv": zonesCsv()
    };
  }

  function allow(h) {
    return h.queryPermission({ mode: "readwrite" }).then(function (p) {
      return p === "granted" ? p : h.requestPermission({ mode: "readwrite" });
    }).then(function (p) { return p === "granted"; });
  }

  function pickDir() {
    return window.showDirectoryPicker({ mode: "readwrite" }).then(function (h) {
      // Проверяем, что выбрали именно папку данных, а не что попало
      return h.getFileHandle("places.csv").then(function () {
        dirHandle = h;
        return idbPut("dataDir", h).then(function () { return h; });
      }, function () {
        alert("В этой папке нет places.csv.\n\nНужно выбрать папку app/data " +
              "внутри папки приложения.");
        return null;
      });
    }, function () { return null; });      // пользователь закрыл выбор
  }

  /* История сохранений.

     Запись затирает CSV на месте, и до этого откатиться было нечем: «Отменить»
     живёт только в открытой странице и пропадает при обновлении. На острове,
     где неделя ручного ввода и нет интернета, одна неверная запись стоила бы
     всей работы.

     Поэтому перед каждой записью прежние файлы уходят в
     app/data/history/<дата_время>/. Копируется то, что лежит на диске, а не то,
     что в памяти: так самый первый снимок сохраняет исходное состояние.

     Папка history/ закрыта в .gitignore — там копии persons.csv с именами
     из неопубликованной таблицы музея. Правила выше заданы точными путями
     и на подпапки не действуют, поэтому для history/ строка отдельная. */

  var HISTORY_KEEP = 30;

  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* Метка времени идёт с точностью до секунды, и два сохранения подряд
     попадали в одну папку — второе молча затирало первое. Хуже того:
     возврат сразу после сохранения уничтожал ровно ту версию, к которой
     возвращались, потому что сначала клал туда нынешнее состояние.
     Поэтому занятое имя не переиспользуется, а получает суффикс. */
  function freshDir(hist, base) {
    function attempt(name, n) {
      if (n > 50) return hist.getDirectoryHandle(name, { create: true });
      return hist.getDirectoryHandle(name).then(
        function () { return attempt(base + "-" + (n + 2), n + 1); },   // занято
        function () { return hist.getDirectoryHandle(name, { create: true }); }
      );
    }
    return attempt(base, 0);
  }

  function archiveCurrent(h) {
    var names = Object.keys(files()), name = stamp();
    return h.getDirectoryHandle("history", { create: true }).then(function (hist) {
      return freshDir(hist, name).then(function (dst) {
        name = dst.name || name;
        return names.reduce(function (chain, fn) {
          return chain.then(function () {
            // Файла может не быть — это не повод рушить сохранение
            return h.getFileHandle(fn)
              .then(function (fh) { return fh.getFile(); })
              .then(function (f) { return f.text(); })
              .then(function (text) {
                return dst.getFileHandle(fn, { create: true })
                  .then(function (nf) { return nf.createWritable(); })
                  .then(function (w) {
                    return w.write(new Blob([text])).then(function () { return w.close(); });
                  });
              })
              .catch(function () {});
          });
        }, Promise.resolve());
      }).then(function () { return pruneHistory(hist); }).then(function () { return name; });
    }).catch(function () { return null; });   // не вышло сложить историю — всё равно сохраняем
  }

  // Тридцати версий хватает на всю экспедицию, а папка не растёт бесконечно.
  function pruneHistory(hist) {
    var dirs = [], it = hist.values();
    function step() {
      return it.next().then(function (r) {
        if (r.done) return;
        if (r.value.kind === "directory") dirs.push(r.value.name);
        return step();
      });
    }
    return step().then(function () {
      dirs.sort();                                   // имена — метки времени
      return dirs.slice(0, Math.max(0, dirs.length - HISTORY_KEEP))
        .reduce(function (chain, n) {
          return chain.then(function () {
            return hist.removeEntry(n, { recursive: true }).catch(function () {});
          });
        }, Promise.resolve());
    }).catch(function () {});
  }

  function writeAll(h) {
    var f = files(), names = Object.keys(f);
    return names.reduce(function (chain, name) {
      return chain.then(function () {
        return h.getFileHandle(name, { create: true })
          .then(function (fh) { return fh.createWritable(); })
          .then(function (w) {
            return w.write(new Blob(["﻿" + f[name]])).then(function () { return w.close(); });
          });
      });
    }, Promise.resolve()).then(function () { return names.length; });
  }

  function downloadAll() {
    var f = files(), i = 0;
    Object.keys(f).forEach(function (name) {
      setTimeout(function () {
        download(name, f[name], name === "data.js" ? "application/javascript" : "text/csv");
      }, i++ * 400);
    });
    dirty = false;
    syncDirty();
    alert("Скачано шесть файлов.\n\nПоложите их все в папку app/data вместо старых " +
          "и обновите страницу. Старые перед заменой отложите в сторону: при таком " +
          "способе история версий не ведётся и вернуться будет некуда.\n\n" +
          "Чтобы сохранять сразу в папку — и с историей — откройте приложение " +
          "в Chrome. Safari и Firefox писать в файлы не умеют.");
  }

  // Папку спрашивают в двух местах: при сохранении и при возврате версии.
  function withDir() {
    return (dirHandle ? Promise.resolve(dirHandle) : idbGet("dataDir"))
      .then(function (h) {
        if (!h) return pickDir();
        return allow(h).then(function (okp) { return okp ? (dirHandle = h) : pickDir(); });
      });
  }

  /* Возврат к прошлой версии.

     История писалась с самого начала, но вернуться из неё можно было только
     копированием файлов в Finder. Для разработчика это нормально, для
     сотрудника музея после нашего отъезда — нет.

     Возврат сам делает снимок нынешнего состояния перед подменой, поэтому
     отменить возврат тоже можно: он попадает в тот же список. */

  function listHistory(h) {
    return h.getDirectoryHandle("history").then(function (hist) {
      var names = [], it = hist.values();
      return (function step() {
        return it.next().then(function (r) {
          if (r.done) return names;
          if (r.value.kind === "directory") names.push(r.value.name);
          return step();
        });
      })().then(function (n) { return n.sort().reverse(); });   // новые сверху
    }, function () { return []; });                             // папки ещё нет
  }

  function prettyStamp(n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(-\d+)?$/.exec(n);
    if (!m) return n;
    return m[3] + "." + m[2] + "." + m[1] + ", " + m[4] + ":" + m[5] +
           (m[7] ? " (" + m[7].slice(1) + ")" : "");
  }

  function restoreVersion(h, name) {
    return archiveCurrent(h)                       // нынешнее — тоже в историю
      .then(function () { return h.getDirectoryHandle("history"); })
      .then(function (hist) { return hist.getDirectoryHandle(name); })
      .then(function (src) {
        return Object.keys(files()).reduce(function (chain, n) {
          return chain.then(function () {
            return src.getFileHandle(n)
              .then(function (fh) { return fh.getFile(); })
              .then(function (f) { return f.text(); })
              .then(function (t) {
                return h.getFileHandle(n, { create: true })
                  .then(function (fh) { return fh.createWritable(); })
                  .then(function (w) {
                    return w.write(new Blob([t])).then(function () { return w.close(); });
                  });
              })
              .catch(function () {});              // файла в снимке нет — пропускаем
          });
        }, Promise.resolve());
      });
  }

  // Список версий приходит либо от сервера, либо из выбранной папки —
  // дальше рисуется одинаково, поэтому источник спрятан здесь.
  function historyNames() {
    if (srv) {
      return fetch("api/history").then(function (r) { return r.json(); })
        .then(function (j) { return j.versions || []; });
    }
    return withDir().then(function (h) { return h ? listHistory(h) : null; });
  }

  function showHistory() {
    if (!srv && !CAN_WRITE) {
      alert("История версий ведётся только при сохранении в папку.\n\n" +
            "Откройте приложение в Chrome — или запустите app/data/server.py " +
            "и работайте по адресу 127.0.0.1:8765, тогда история будет " +
            "в любом браузере.");
      return;
    }
    historyNames().then(function (names) {
      if (names === null) return;              // папку так и не выбрали
      return (function () {
        var head = '<p class="card__over">Данные</p><h2 class="card__name">Прошлые версии</h2>';
        if (!names.length) {
          openPanel(head + '<p class="card__v card__v--none">Пока ни одной. ' +
            'Снимок делается сам при каждом сохранении.</p>');
          return;
        }
        openPanel(head +
          '<p class="fld__hint">Снимок делается перед каждым сохранением, хранятся ' +
          'последние тридцать. Возврат сначала сохранит нынешнее состояние отдельным ' +
          'снимком, так что отменить возврат тоже можно.</p><div>' +
          names.map(function (n) {
            return '<div class="hist__r"><span><b>' + esc(prettyStamp(n)) + '</b><br>' +
              '<small>history/' + esc(n) + '</small></span>' +
              '<button class="edit__btn" data-restore="' + esc(n) + '">Вернуть</button></div>';
          }).join("") + "</div>");
      })();
    });
  }

  $("#dt-hist").onclick = showHistory;

  function saveAll(btn) {
    recount();
    if (!checkBeforeSave()) return;
    btn = btn || $("#dt-apply");
    if (srv) return saveViaServer(btn);
    if (!CAN_WRITE) return downloadAll();
    var was = btn.textContent;
    btn.textContent = "Сохраняю…";
    withDir()
      .then(function (h) {
        if (!h) { btn.textContent = was; return null; }
        return archiveCurrent(h).then(function (kept) {
          return writeAll(h).then(function (n) {
            btn.textContent = was;
            dirty = false;
            syncDirty();
            setWhere("saved");
            alert("Сохранено, файлов: " + n + ".\n\n" +
                  (kept ? "Прежняя версия отложена в app/data/history/" + kept +
                          "\nЕсли что-то пойдёт не так, файлы оттуда можно вернуть " +
                          "на место в Finder.\n\n"
                        : "") +
                  "Обновите страницу, чтобы увидеть результат так, " +
                  "как его увидит посетитель.");
          });
        });
      })
      .catch(function (err) {
        btn.textContent = was;
        alert("Не удалось записать в папку: " + err.message + "\n\nСкачаю файлы, " +
              "положите их в app/data вручную.");
        downloadAll();
      });
  }

  $("#dt-apply").onclick = function () { saveAll($("#dt-apply")); };
  // Та же самая операция, просто дотянуться до неё можно с карты,
  // не уходя на вкладку «Данные» и не теряя место, которое правишь.
  $("#edit-save").onclick = function () { saveAll($("#edit-save")); };
  /* Про папку сотруднику знать почти не нужно: «Сохранить» спросит её сам
     в первый раз и запомнит. Поэтому отдельной кнопки в ряду больше нет —
     сменить папку можно из справки, это делают раз в жизни.
     В строке состояния теперь только то, что важно прямо сейчас:
     есть ли несохранённое. */
  function setWhere(state) {
    var w = $("#dt-where");
    if (!w) return;
    if (state === "dirty") w.textContent = "есть несохранённые правки";
    else if (state === "saved") w.textContent = "сохранено";
    else if (!CAN_WRITE) w.textContent = "этот браузер сохраняет через «Загрузки»";
    else w.textContent = "";
  }

  function askDir() {
    if (!CAN_WRITE) {
      alert("Этот браузер не умеет писать прямо в папку.\n\n" +
            "Сохранение будет скачивать файлы, их придётся класть в app/data вручную.\n\n" +
            "Чтобы сохранять в один клик, откройте приложение в Chrome.");
      return;
    }
    pickDir().then(function (h) {
      alert(h ? "Папка выбрана. Дальше сохранение в один клик." : "Папка не выбрана.");
    });
  }

  setWhere("");

  /* Сохранить можно тремя способами, в порядке предпочтения:

       1. локальный сервер `app/data/server.py` — работает в ЛЮБОМ браузере;
       2. File System Access API — без сервера, но только Chrome и Edge;
       3. скачивание шести файлов — последний рубеж, с ручной раскладкой
          и без истории версий.

     Первый способ появился потому, что второго нет в Safari и Firefox,
     а третий теряет историю. Киоск в зале при этом по-прежнему открывается
     двойным щелчком по index.html — сервер нужен только тому, кто правит. */
  var srv = false;
  var srvReady = (location.protocol.indexOf("http") === 0)
    ? fetch("api/ping").then(function (r) { return r.json(); })
        .then(function (j) { srv = !!(j && j.okoyom); })
        .catch(function () { srv = false; })
    : Promise.resolve();

  srvReady.then(function () {
    var w = $("#dt-warn");
    if (!w) return;
    if (srv || CAN_WRITE) { w.hidden = true; return; }
    // Ни сервера, ни записи в папку — узнать об этом надо ДО работы, а не после
    w.innerHTML =
      "<b>Этот браузер не умеет сохранять прямо в папку.</b> " +
      "Сохранение будет скачивать шесть файлов, раскладывать их в " +
      "<code>app/data</code> придётся вручную, и история версий вестись не будет.<br>" +
      "Два выхода: открыть приложение в <b>Chrome</b> — или запустить " +
      "<code>app/data/server.py</code> и работать по адресу " +
      "<code>127.0.0.1:8765</code>. Со сервером сохранение работает в любом браузере.";
    w.hidden = false;
  });

  function saveViaServer(btn) {
    var was = btn.textContent;
    btn.textContent = "Сохраняю…";
    fetch("api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: files() })
    }).then(function (r) { return r.json(); }).then(function (j) {
      btn.textContent = was;
      if (j.error) throw new Error(j.error);
      dirty = false;
      syncDirty();
      setWhere("saved");
      alert("Сохранено, файлов: " + j.n + "." +
        (j.kept ? "\n\nПрежняя версия отложена в app/data/history/" + j.kept +
                  "\nЕсли что-то пойдёт не так — «Прошлые версии»." : "") +
        "\n\nОбновите страницу, чтобы увидеть результат так, " +
        "как его увидит посетитель.");
    }).catch(function (e) {
      btn.textContent = was;
      alert("Сервер не принял сохранение: " + e.message);
    });
  }

  $("#dt-help").onclick = function () {
    openPanel(
      '<p class="card__over">Служебный режим</p>' +
      '<h2 class="card__name">Справка</h2>' +

      '<h3 class="dt__h">Как работать</h3>' +
      '<ol class="steps steps--panel">' +
        '<li><b>Правьте.</b> Тексты, фотографии и привязки — здесь, во вкладке «Данные». ' +
        'Положение меток и очертания зон — на вкладке «Карта».</li>' +
        '<li><b>Нажимайте «Сохранить».</b> Кнопка есть и здесь, и внизу карты — это одно и то же ' +
        'действие. Пока написано «есть несохранённые правки», работа существует только ' +
        'в открытой странице.</li>' +
        '<li><b>Обновите страницу</b> (Cmd+R или Ctrl+R), чтобы увидеть результат так, ' +
        'как его увидит посетитель.</li>' +
      '</ol>' +

      '<h3 class="dt__h">Что где правится</h3>' +
      '<table class="help"><tbody>' +
        '<tr><td>Имя, сан, годы, источник, фотография, места пребывания</td><td>Данные → Персоналии</td></tr>' +
        '<tr><td>Описание места, тип, вложенность, фотография</td><td>Данные → Места</td></tr>' +
        '<tr><td>Подпись зоны, вид работ, форма</td><td>Данные → Зоны работ</td></tr>' +
        '<tr><td>Тема и вид меток</td><td>Данные → Оформление</td></tr>' +
        '<tr><td><b>Где стоит метка на карте</b></td><td>Карта → «Метки мест», перетащить</td></tr>' +
        '<tr><td><b>Очертания зоны</b></td><td>Карта → «Зоны работ», перетащить вершины</td></tr>' +
      '</tbody></table>' +

      '<h3 class="dt__h">Если что-то пошло не так</h3>' +
      '<p class="fld__hint"><b>Отменить последнее действие</b> — кнопка «Отменить» внизу карты ' +
      'или Cmd+Z. Хранится тридцать шагов, но только пока страница открыта.</p>' +
      '<p class="fld__hint"><b>Вернуть то, что было раньше</b> — кнопка «Прошлые версии». ' +
      'Приложение само делает снимок перед каждым сохранением, хранятся последние тридцать.</p>' +

      '<h3 class="dt__h">Куда сохраняется</h3>' +
      '<p class="fld__hint">В папку <code>app/data</code> внутри папки приложения. В первый раз ' +
      'браузер спросит эту папку и запомнит — больше спрашивать не будет. Ничего копировать ' +
      'и никуда вставлять не нужно.</p>' +
      '<p class="fld__hint">Менять папку почти никогда не требуется, но если нужно — ' +
      '<button class="edit__btn" id="help-dir">выбрать другую папку</button></p>');
    var hb = $("#help-dir");
    if (hb) hb.onclick = askDir;
  };

  function renderStaff() { showSub(subNow); }

  /* ---------------- экран покоя ---------------- */

  var idleTimer, nameTimer, idleShown = true;

  var idleTimerOut = null;

  function goIdle() {
    var el = $("#idle");
    clearTimeout(idleTimerOut);
    el.classList.remove("is-out");
    el.hidden = false;
    idleShown = true;
    closePanel();
    setEdit(false);
    resetZoom();
    showView("map");
    $("#q").value = "";
    yearNow = 0;
    renderYears();
    $("#f-rank").value = "";
    $("#f-place").value = "";
    renderRegistry();
  }
  function wake() {
    if (idleShown) {
      // Уходит с затуханием: экран включается каждые полторы минуты,
      // и весь день рывок был бы заметнее самого экрана.
      var el = $("#idle");
      el.classList.add("is-out");
      clearTimeout(idleTimerOut);
      idleTimerOut = setTimeout(function () {
        el.hidden = true;
        el.classList.remove("is-out");
      }, 350);
      idleShown = false;
    }
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
      next.innerHTML = esc(personName(p)) +
        "<span>" + esc(personRank(p).split("\n")[0]) + "</span>";
      layers[cur].classList.remove("is-on");
      next.classList.add("is-on");
      cur ^= 1;
    }

    show();
    nameTimer = setInterval(show, 5000);
  }

  /* ---------------- экранная клавиатура ---------------- */

  /* Зачем. На сенсорном киоске физической клавиатуры нет, а системная
     всплывает не во всякой сборке: на Windows обычно да, на Linux часто нет.
     Без неё поиск по 434 фамилиям становится недоступен вовсе.

     Когда показывать. По умолчанию — только там, где есть сенсорный ввод.
     На рабочем компьютере сотрудника она была бы помехой. Решение
     переопределяется в settings.csv ключом `keyboard`: авто | всегда | никогда.

     Раскладка ЙЦУКЕН: набирают русские фамилии. Латиница не нужна —
     английский режим сейчас скрыт, а имена в нём транслитерируются. */

  var KB_ROWS = [
    "йцукенгшщзхъ",
    "фывапролджэ",
    "ячсмитьбю"
  ];

  function kbWanted() {
    var mode = ((D.settings || {}).keyboard || "авто").toLowerCase();
    if (mode === "всегда") return true;
    if (mode === "никогда") return false;
    return (navigator.maxTouchPoints || 0) > 0;
  }

  function kbBuild() {
    var html = KB_ROWS.map(function (row) {
      return '<div class="kb__r">' + row.split("").map(function (ch) {
        return '<button class="kb__k" data-ch="' + ch + '">' + ch + "</button>";
      }).join("") + "</div>";
    }).join("");
    html += '<div class="kb__r">' +
      '<button class="kb__k kb__k--wide" data-ch=" ">пробел</button>' +
      '<button class="kb__k" data-act="back" title="Стереть букву">&#9003;</button>' +
      '<button class="kb__k kb__k--txt" data-act="clear">Очистить</button>' +
      '<button class="kb__k kb__k--txt kb__k--act" data-act="done">Готово</button>' +
      "</div>";
    $("#kb-rows").innerHTML = html;
  }

  var kbTimer = null;

  function kbShow() {
    var kb = $("#kb");
    clearTimeout(kbTimer);
    kb.classList.remove("is-out");
    kb.hidden = false;
    var c = $("#kb-call");
    if (c) c.setAttribute("aria-pressed", "true");
  }

  function kbHide() {
    var kb = $("#kb");
    if (kb.hidden || kb.classList.contains("is-out")) return;
    kb.classList.add("is-out");
    clearTimeout(kbTimer);
    kbTimer = setTimeout(function () {
      kb.hidden = true;
      kb.classList.remove("is-out");
    }, 180);
    var c = $("#kb-call");
    if (c) c.setAttribute("aria-pressed", "false");
  }

  /* Клавиатура собирается всегда: кнопка вызова должна работать и там,
     где сенсора нет — например, когда сотрудник проверяет киоск с мышью,
     или когда `авто` угадало неверно. Автоматически по касанию поля она
     открывается только там, где сенсор есть. */
  if (((D.settings || {}).keyboard || "авто").toLowerCase() !== "никогда") {
    kbBuild();
    $("#kb-call").hidden = false;
    $("#kb-call").innerHTML = iconSvg("keyboard", "");
    $("#kb-call").onclick = function () {
      if ($("#kb").hidden) { kbShow(); $("#q").focus(); } else kbHide();
    };
    if (kbWanted()) $("#q").addEventListener("focus", kbShow);

    $("#kb").onclick = function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var q = $("#q");
      if (b.dataset.act === "done") { kbHide(); return; }
      if (b.dataset.act === "clear") q.value = "";
      else if (b.dataset.act === "back") q.value = q.value.slice(0, -1);
      else q.value += b.dataset.ch;
      // input, а не change: реестр перерисовывается на каждый знак
      q.dispatchEvent(new Event("input", { bubbles: true }));
      q.focus();
    };

    // Ушли с поиска — клавиатура не нужна. Нажатия по самой клавиатуре
    // сюда не попадают: обработчик стоит на документе, а она его гасит.
    document.addEventListener("pointerdown", function (e) {
      if (e.target.closest("#kb") || e.target.closest("#q") ||
          e.target.closest("#kb-call")) return;
      kbHide();
    });
    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", kbHide);
    });
  }

  /* ---------------- киоск ---------------- */

  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });

  /* ---------------- запуск ---------------- */

  $("#idle-total").textContent = D.meta.total;

  var ranks = {};
  D.persons.forEach(function (p) {
    var b = baseRank(p.rank);
    if (b) ranks[b] = (ranks[b] || 0) + 1;
  });
  $("#f-rank").innerHTML += Object.keys(ranks)
    .sort(function (a, b) {
      var ia = RANK_ORDER.indexOf(a), ib = RANK_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(function (r) {
      return '<option value="' + esc(r) + '">' +
        esc(r[0].toUpperCase() + r.slice(1)) + " · " + ranks[r] + "</option>";
    }).join("");
  $("#f-place").innerHTML += '<option value="__none">' + esc(T("noPlace")) + '</option>';
  fillSelect($("#f-place"), []);
  D.places.forEach(function (p) {
    $("#f-place").innerHTML += '<option value="' + p.id + '">' + esc(p.name) + "</option>";
  });

  applyLang();
  renderMap();
  renderYears();
  renderRegistry();
  renderGlossary();
  showView("map");
  rotateNames();
})();
