// Pagina de diagnostico de M1 (ROADMAP.md, primera tarea): la abre la tele
// por HTTP plano, sin build ni dependencias externas (la tele puede no
// tener salida a internet — kagami es LAN-first). Vanilla HTML/CSS/JS en
// un unico fichero a proposito, igual que las paginas del spike M-1.
export const DIAG_RANGE_PAGE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>kagami — diagnostico de range requests (M1)</title>
<style>
  * { box-sizing: border-box; }
  body {
    background: #000;
    color: #fff;
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 24px;
  }
  h1 { font-size: 2.2rem; margin: 0 0 4px; }
  .ua { font-size: 1.1rem; color: #9ad; word-break: break-all; margin-bottom: 24px; }
  .section {
    border: 2px solid #333;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 24px;
  }
  .section h2 { font-size: 1.6rem; margin-top: 0; }
  video { width: 100%; max-width: 480px; background: #111; display: block; margin-bottom: 12px; }
  button {
    font-size: 1.4rem;
    padding: 14px 28px;
    border-radius: 10px;
    border: none;
    background: #2563eb;
    color: #fff;
    cursor: pointer;
    margin-bottom: 16px;
  }
  button:disabled { background: #444; cursor: default; }
  ul.steps { list-style: none; padding: 0; font-size: 1.3rem; line-height: 1.9; }
  .pass { color: #4ade80; }
  .fail { color: #f87171; }
  .pending { color: #999; }
  .running { color: #facc15; }
  .summary {
    margin-top: 12px;
    font-size: 1.15rem;
    background: #111;
    border-radius: 8px;
    padding: 12px;
  }
  .summary p { margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 0.85rem; }
  th, td { border: 1px solid #333; padding: 4px 8px; text-align: left; }
  th { color: #9ad; }
</style>
</head>
<body>
  <h1>kagami — diagnostico de range requests (M1)</h1>
  <p class="ua" id="ua"></p>

  <div class="section" data-variant="faststart">
    <h2>faststart.mp4 (moov al principio)</h2>
    <video playsinline muted></video>
    <button type="button" class="run">Run tests</button>
    <ul class="steps"></ul>
    <div class="summary"></div>
  </div>

  <div class="section" data-variant="plain">
    <h2>plain.mp4 (moov al final, sin faststart)</h2>
    <video playsinline muted></video>
    <button type="button" class="run">Run tests</button>
    <ul class="steps"></ul>
    <div class="summary"></div>
  </div>

<script>
document.getElementById("ua").textContent = navigator.userAgent;

var STEP_NAMES = ["load", "play", "seek-mid", "seek-back", "play-after-seek"];

function waitForEvent(el, eventName, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      cleanup();
      reject(new Error("timeout esperando " + eventName));
    }, timeoutMs);
    function onEvent() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      var err = el.error;
      var msg = err ? "video error code " + err.code : "error desconocido";
      reject(new Error(msg));
    }
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener(eventName, onEvent);
      el.removeEventListener("error", onError);
    }
    el.addEventListener(eventName, onEvent, { once: true });
    el.addEventListener("error", onError, { once: true });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// El listener de "playing" se engancha ANTES de llamar a play(): el evento
// puede dispararse practicamente a la vez que resuelve la promesa de
// play(), y engancharlo despues (dentro de un .then) llega tarde de verdad
// — se vio en pruebas locales como un timeout falso en cada intento.
function playAndWaitPlaying(video, timeoutMs) {
  var playing = waitForEvent(video, "playing", timeoutMs);
  return video.play().then(function () { return playing; });
}

function renderSteps(ul, results) {
  ul.innerHTML = "";
  STEP_NAMES.forEach(function (name) {
    var r = results[name];
    var li = document.createElement("li");
    var cls = "pending";
    var text = name + ": pendiente";
    if (r) {
      cls = r.status;
      text = name + ": " + r.status.toUpperCase() + (r.detail ? " — " + r.detail : "") + (r.ms != null ? " (" + r.ms + "ms)" : "");
    }
    li.className = cls;
    li.textContent = text;
    ul.appendChild(li);
  });
}

function runStep(results, ul, name, fn) {
  results[name] = { status: "running", detail: null, ms: null };
  renderSteps(ul, results);
  var start = performance.now();
  return fn().then(
    function (detail) {
      results[name] = { status: "pass", detail: detail || null, ms: Math.round(performance.now() - start) };
      renderSteps(ul, results);
    },
    function (err) {
      results[name] = { status: "fail", detail: err.message, ms: Math.round(performance.now() - start) };
      renderSteps(ul, results);
    }
  );
}

function fetchLog(variant) {
  return fetch("/diag/range/log")
    .then(function (r) { return r.json(); })
    .then(function (all) {
      return all.filter(function (e) { return e.url.indexOf("/diag/range/video/" + variant + ".mp4") === 0; });
    });
}

function renderSummary(el, results, entries) {
  var sentRange = entries.some(function (e) { return !!e.requestRange; });
  var got206 = entries.some(function (e) {
    return e.statusCode === 206 && e.contentRange && /^bytes \\d+-\\d+\\/\\d+$/.test(e.contentRange);
  });
  var initial200 = entries.find(function (e) { return e.statusCode === 200; });
  var contentType = entries.length ? entries[entries.length - 1].contentType : null;
  var seekReal = results["play-after-seek"] && results["play-after-seek"].status === "pass";

  var html = "<p><strong>¿La tele envio cabecera Range?</strong> " + (sentRange ? "SI" : "NO") + "</p>";
  html += "<p><strong>¿El servidor respondio 206 con Content-Range correcto?</strong> " + (got206 ? "SI" : "NO") + "</p>";
  html += "<p><strong>¿Accept-Ranges: bytes en la respuesta 200 inicial?</strong> " + (initial200 ? (initial200.acceptRanges || "(ausente)") : "(sin respuesta 200 registrada)") + "</p>";
  html += "<p><strong>Content-Type servido:</strong> " + (contentType || "(desconocido)") + "</p>";
  html += "<p><strong>¿El salto funciono de verdad (currentTime avanzo tras reanudar)?</strong> " + (seekReal ? "SI" : "NO / no verificado") + "</p>";

  if (entries.length) {
    html += "<table><thead><tr><th>hora</th><th>status</th><th>Range pedido</th><th>Content-Range</th></tr></thead><tbody>";
    entries.slice(-10).forEach(function (e) {
      html += "<tr><td>" + e.time.slice(11, 19) + "</td><td>" + e.statusCode + "</td><td>" + (e.requestRange || "—") + "</td><td>" + (e.contentRange || "—") + "</td></tr>";
    });
    html += "</tbody></table>";
  }
  el.innerHTML = html;
}

function setupSection(section) {
  var variant = section.dataset.variant;
  var video = section.querySelector("video");
  var button = section.querySelector("button.run");
  var ul = section.querySelector("ul.steps");
  var summaryEl = section.querySelector(".summary");
  var results = {};

  button.addEventListener("click", function () {
    button.disabled = true;
    results = {};
    renderSteps(ul, results);

    runStep(results, ul, "load", function () {
      video.src = "/diag/range/video/" + variant + ".mp4";
      video.load();
      return waitForEvent(video, "loadedmetadata", 10000).then(function () {
        return "duracion " + video.duration.toFixed(1) + "s";
      });
    })
      .then(function () {
        return runStep(results, ul, "play", function () {
          return playAndWaitPlaying(video, 8000);
        });
      })
      .then(function () { return sleep(1500); })
      .then(function () {
        return runStep(results, ul, "seek-mid", function () {
          var target = video.duration / 2;
          video.currentTime = target;
          return waitForEvent(video, "seeked", 8000).then(function () {
            var delta = Math.abs(video.currentTime - target);
            if (delta > 1.5) throw new Error("currentTime quedo lejos del objetivo (" + delta.toFixed(2) + "s de diferencia)");
            return "currentTime=" + video.currentTime.toFixed(1);
          });
        });
      })
      .then(function () {
        return runStep(results, ul, "seek-back", function () {
          var target = Math.min(2, video.duration - 1);
          video.currentTime = target;
          return waitForEvent(video, "seeked", 8000).then(function () {
            return "currentTime=" + video.currentTime.toFixed(1);
          });
        });
      })
      .then(function () {
        return runStep(results, ul, "play-after-seek", function () {
          var before = video.currentTime;
          return playAndWaitPlaying(video, 8000)
            .then(function () { return sleep(1200); })
            .then(function () {
              var advanced = video.currentTime - before;
              if (advanced < 0.3) throw new Error("currentTime no avanzo tras reanudar (delta " + advanced.toFixed(2) + "s) — el salto 'parece' funcionar pero no reproduce de verdad");
              return "avanzo " + advanced.toFixed(2) + "s en 1.2s reales";
            });
        });
      })
      .catch(function () { /* cada paso ya registro su propio fallo */ })
      .then(function () { return fetchLog(variant); })
      .then(function (entries) { renderSummary(summaryEl, results, entries); })
      .finally(function () { button.disabled = false; });
  });
}

document.querySelectorAll(".section").forEach(setupSection);
</script>
</body>
</html>
`;
