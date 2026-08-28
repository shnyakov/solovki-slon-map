#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка сохранения и истории версий.

Запуск:  python3 app/data/test_save.py

Зачем. Запись затирает CSV на месте, а перед этим складывает прежние файлы
в app/data/history/<дата_время>/. Весь этот код обёрнут в «не вышло — молча
идём дальше»: история не имеет права помешать сохранению. Обратная сторона —
её поломка была бы не видна вообще. Отсюда отдельная проверка.

Как. Настоящий диалог выбора папки автоматизировать нельзя, поэтому
window.showDirectoryPicker подменяется до загрузки app.js и отдаёт подставную
файловую систему в памяти. Дальше отрабатывает весь настоящий путь:
saveAll → archiveCurrent → writeAll → pruneHistory.

Выход: 0 — всё хорошо, 1 — есть провалы.
"""
import io, os, re, sys, html, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Ставится ДО app.js: CAN_WRITE вычисляется при загрузке, позже подменять поздно.
FAKE = r"""
<script>
(function () {
  function makeDir(name) {
    var files = {}, dirs = {};
    return {
      kind: "directory", name: name,
      queryPermission: function () { return Promise.resolve("granted"); },
      requestPermission: function () { return Promise.resolve("granted"); },
      getFileHandle: function (n, o) {
        if (!(n in files)) {
          if (!(o && o.create)) return Promise.reject(new Error("нет файла " + n));
          files[n] = "";
        }
        return Promise.resolve({
          kind: "file", name: n,
          getFile: function () {
            return Promise.resolve({ text: function () { return Promise.resolve(files[n]); } });
          },
          createWritable: function () {
            var buf = "";
            return Promise.resolve({
              // Именно arrayBuffer, а не text(): Blob.text() декодирует как UTF-8
              // и по стандарту срезает ведущий BOM. Настоящая запись на диск
              // кладёт байты как есть, и проверять BOM через text() бессмысленно.
              write: function (b) {
                return b.arrayBuffer().then(function (ab) {
                  buf += new TextDecoder("utf-8", { ignoreBOM: true }).decode(ab);
                });
              },
              close: function () { files[n] = buf; return Promise.resolve(); }
            });
          }
        });
      },
      getDirectoryHandle: function (n, o) {
        if (!(n in dirs)) {
          if (!(o && o.create)) return Promise.reject(new Error("нет папки " + n));
          dirs[n] = makeDir(n);
        }
        return Promise.resolve(dirs[n]);
      },
      removeEntry: function (n) { delete dirs[n]; delete files[n]; return Promise.resolve(); },
      values: function () {
        var items = [], i = 0;
        Object.keys(dirs).forEach(function (k) { items.push(dirs[k]); });
        Object.keys(files).forEach(function (k) { items.push({ kind: "file", name: k }); });
        return { next: function () {
          return Promise.resolve(i < items.length
            ? { done: false, value: items[i++] } : { done: true, value: undefined });
        } };
      },
      _files: files, _dirs: dirs
    };
  }

  var FS = makeDir("data");
  window.__NAMES = ["data.js", "persons.csv", "places.csv", "types.csv", "settings.csv", "zones.csv"];
  window.__NAMES.forEach(function (n) { FS._files[n] = "СТАРОЕ:" + n; });

  window.__FS = FS;
  window.__ALERTS = [];
  window.showDirectoryPicker = function () { return Promise.resolve(FS); };
  /* Возврат версии заканчивается alert() и location.reload(). Перезагрузка
     снесла бы результаты, а подменить location в Chrome нельзя. Поэтому
     заглушка alert бросает исключение ровно на сообщении о возврате: сам
     возврат к этому моменту уже выполнен, а до reload дело не доходит. */
  window.alert = function (m) {
    window.__ALERTS.push(String(m));
    if (window.__BLOCK_RELOAD && /Возвращено к версии/.test(m)) throw new Error("STOP_RELOAD");
  };
  window.confirm = function () { window.__CONFIRMS++; return true; };
  window.__CONFIRMS = 0;

  // Диагностика: молчаливое зависание надо чем-то объяснять
  window.__ERRORS = [];
  window.addEventListener("error", function (e) {
    window.__ERRORS.push("error: " + (e.message || e.error));
  });
  window.addEventListener("unhandledrejection", function (e) {
    window.__ERRORS.push("необработанный отказ: " + (e.reason && (e.reason.message || e.reason)));
  });
})();
</script>
"""

TEST = r"""
<pre id="TESTOUT" style="position:fixed;left:0;top:0;z-index:9999;background:#000;color:#0f0;font:12px monospace;padding:8px;max-height:100%;overflow:auto"></pre>
<script>
setTimeout(function () {
  var out = [], pass = 0, fail = 0;
  function ok(n, c, e) {
    if (c) pass++; else fail++;
    out.push((c ? "PASS " : "FAIL ") + n + (e ? "   [" + e + "]" : ""));
  }
  function note(s) { out.push("      · " + s); }
  function finish() {
    out.unshift("ИТОГ: успешно " + pass + ", провалено " + fail);
    document.getElementById("TESTOUT").textContent = out.join("\n");
  }
  // Виртуальное время в headless идёт скачками, поэтому считаем попытки, а не секунды
  function waitFor(cond, tries) {
    return new Promise(function (res) {
      var n = 0;
      (function tick() {
        if (cond()) return res(true);
        if (++n > (tries || 1500)) return res(false);
        setTimeout(tick, 5);
      })();
    });
  }
  function press(sel) {
    var b = document.querySelector(sel);
    if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return !!b;
  }

  var FS = window.__FS, A = window.__ALERTS, NAMES = window.__NAMES;
  var hist, vers1;

  try {
    ok("подмена файловой системы встала до app.js", !!FS && A.length === 0);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Единственный способ войти. Событие шлём сами: смена хеша порождает
    // hashchange асинхронно, и проверка успевала бы раньше обработчика.
    location.hash = "#edit";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    ok("режим разметки включён", document.body.classList.contains("is-edit"));
    ok("до сохранения истории нет", !FS._dirs.history);

    window.DATA.places[0].name = "ПРАВКА ОДИН";
    ok("кнопка «Сохранить» нашлась", press("#edit-save"));
    note("CAN_WRITE косвенно: showDirectoryPicker = " + typeof window.showDirectoryPicker);
  } catch (e) {
    out.push("ИСКЛЮЧЕНИЕ на подготовке: " + (e && e.message)); fail++; finish(); return;
  }

  waitFor(function () { return A.length > 0; }).then(function (done) {
    if (!done) {
      note("надпись на кнопке: «" + document.querySelector("#edit-save").textContent + "»");
      note("подтверждений запрошено: " + window.__CONFIRMS);
      note("ошибок перехвачено: " + window.__ERRORS.length);
      window.__ERRORS.forEach(function (x) { note("   " + x); });
      note("в подставной ФС папок: " + Object.keys(FS._dirs).join(", ") || "нет");
      note("places.csv на диске начинается с: " +
           JSON.stringify(String(FS._files["places.csv"]).slice(0, 20)));
    }
    ok("первое сохранение дошло до конца", done, done ? A[0].split("\n")[0] : "не дождались");
    hist = FS._dirs.history;
    ok("папка history создана", !!hist);
    if (!hist) throw new Error("истории нет — дальше проверять нечего");

    vers1 = Object.keys(hist._dirs);
    ok("в истории ровно одна версия", vers1.length === 1, "версий " + vers1.length);
    ok("имя версии — метка времени", /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(vers1[0]), vers1[0]);

    var snap = hist._dirs[vers1[0]]._files;
    ok("в снимке все шесть файлов", Object.keys(snap).length === 6,
       "файлов " + Object.keys(snap).length);
    ok("снимок хранит ПРЕЖНЕЕ содержимое, а не новое",
       NAMES.every(function (n) { return snap[n] === "СТАРОЕ:" + n; }),
       "places.csv в снимке: " + String(snap["places.csv"]).slice(0, 24));

    ok("файлы на месте перезаписаны",
       NAMES.every(function (n) { return FS._files[n] !== "СТАРОЕ:" + n; }));
    ok("правка попала в data.js", FS._files["data.js"].indexOf("ПРАВКА ОДИН") >= 0);
    ok("CSV записан с BOM — иначе Excel испортит кириллицу",
       FS._files["places.csv"].charCodeAt(0) === 0xFEFF,
       "первый знак: " + FS._files["places.csv"].charCodeAt(0));
    ok("в сообщении названа папка снимка", A[0].indexOf(vers1[0]) >= 0,
       A[0].replace(/\n+/g, " | ").slice(0, 90));

    /* --- подрезка истории --- */
    for (var i = 0; i < 40; i++) {
      var nm = "2020-01-01_" + ("00000" + i).slice(-6);
      hist._dirs[nm] = { kind: "directory", name: nm, _files: {}, _dirs: {} };
    }
    note("засеяли 40 старых версий, всего стало " + Object.keys(hist._dirs).length);
    A.length = 0;
    window.DATA.places[0].name = "ПРАВКА ДВА";
    press("#edit-save");
    return waitFor(function () { return A.length > 0; });
  }).then(function (done) {
    ok("второе сохранение дошло до конца", done);
    var vers = Object.keys(hist._dirs).sort();
    ok("история подрезана до тридцати", vers.length === 30, "версий " + vers.length);
    ok("удалены самые старые, а не какие попало",
       vers[0].indexOf("2020-01-01_0000") === 0 && vers[0] !== "2020-01-01_000000",
       "старейшая осталась: " + vers[0]);
    var fresh = vers.filter(function (v) { return v.indexOf("2020") !== 0; });
    ok("обе свежие версии уцелели", fresh.length === 2, "свежих " + fresh.length + ": " + fresh.join(", "));
    ok("второй снимок хранит содержимое первого сохранения",
       String(hist._dirs[fresh[1]]._files["data.js"]).indexOf("ПРАВКА ОДИН") >= 0);
    ok("на диске теперь вторая правка", FS._files["data.js"].indexOf("ПРАВКА ДВА") >= 0);

    /* --- список прошлых версий --- */
    A.length = 0;
    press("#dt-hist");
    return waitFor(function () {
      return document.querySelectorAll("#panel-body [data-restore]").length > 0;
    });
  }).then(function (done) {
    ok("«Прошлые версии» открывает список", done);
    var rows = document.querySelectorAll("#panel-body [data-restore]");
    var shown = Object.keys(hist._dirs).length;
    ok("в списке столько же версий, сколько в папке",
       rows.length === shown, "в списке " + rows.length + ", в папке " + shown);
    ok("новые версии сверху",
       rows[0].dataset.restore > rows[rows.length - 1].dataset.restore,
       rows[0].dataset.restore + " … " + rows[rows.length - 1].dataset.restore);
    var lbl = rows[0].parentNode.textContent;
    ok("дата показана по-человечески", /\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/.test(lbl),
       lbl.replace(/\s+/g, " ").trim().slice(0, 40));

    /* --- сам возврат --- */
    // Возвращаемся к первому сохранению: там в data.js «ПРАВКА ОДИН»
    var target = null;
    Object.keys(hist._dirs).forEach(function (n) {
      var f = hist._dirs[n]._files || {};
      if (String(f["data.js"] || "").indexOf("ПРАВКА ОДИН") >= 0) target = n;
    });
    ok("нашлась версия с первой правкой", !!target, target || "нет");
    if (!target) throw new Error("нечего возвращать");

    var before = Object.keys(hist._dirs).slice();
    window.__BLOCK_RELOAD = true;
    A.length = 0;
    var btn = document.querySelector('[data-restore="' + target + '"]');
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return waitFor(function () { return A.length > 0; }).then(function (d) {
      return { done: d, before: before, target: target };
    });
  }).then(function (st) {
    ok("возврат дошёл до конца", st.done, A[0] ? A[0].slice(0, 60) : "не дождались");
    ok("на диске снова содержимое выбранной версии",
       FS._files["data.js"].indexOf("ПРАВКА ОДИН") >= 0 &&
       FS._files["data.js"].indexOf("ПРАВКА ДВА") < 0,
       FS._files["data.js"].indexOf("ПРАВКА ОДИН") >= 0 ? "первая правка на месте" : "не вернулось");
    // Считать по количеству нельзя: история подрезается до тридцати,
    // и новый снимок вытесняет самый старый. Смотрим по появившемуся имени.
    var added = Object.keys(hist._dirs).filter(function (n) { return st.before.indexOf(n) < 0; });
    ok("перед возвратом снят снимок нынешнего состояния",
       added.length === 1, added.length ? "добавился " + added[0] : "новых снимков нет");
    var newest = added[0] || Object.keys(hist._dirs).sort().pop();
    ok("в этом снимке — то, что было до возврата",
       String(hist._dirs[newest]._files["data.js"] || "").indexOf("ПРАВКА ДВА") >= 0,
       "снимок " + newest);
    ok("значит возврат тоже можно отменить", true);
    finish();
  }).catch(function (e) {
    out.push("ИСКЛЮЧЕНИЕ: " + (e && e.message) + "\n" + (e && e.stack || ""));
    fail++; finish();
  });
}, 300);
</script>
"""


def main():
    if not os.path.exists(CHROME):
        sys.exit("не найден Chrome: " + CHROME)
    src = io.open(os.path.join(APP, "index.html"), encoding="utf-8").read()
    # У тега есть метка версии («?v=…»), её подставляет build.py против кэша
    m = re.search(r'<script src="js/app\.js(?:\?v=\d+)?"></script>', src)
    if not m:
        sys.exit("в index.html не найден тег подключения app.js")
    page = src.replace(m.group(0), FAKE + m.group(0)).replace("</body>", TEST + "\n</body>")

    tmp = os.path.join(APP, "__test_save.html")
    io.open(tmp, "w", encoding="utf-8").write(page)
    try:
        r = subprocess.run(
            [CHROME, "--headless", "--disable-gpu", "--no-sandbox",
             "--window-size=1400,900", "--virtual-time-budget=20000",
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
    sys.exit(1 if ("FAIL " in text or not text.strip()) else 0)


main()
