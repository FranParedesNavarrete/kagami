# Registro de sesión

> Una entrada por sesión de agente, más reciente arriba.

## 2026-08-28 — M0: monorepo completo, construido y verificado en tres capas

- Actualizado SPECS.md §4.3 con el riesgo abierto del range-request de
  M-1 (no se trackea en git — viaja por el chat, ver CODESTYLE.md §6) y
  añadida la primera tarea de M1 en ROADMAP.md: diagnosticar eso antes
  de construir el cast de ficheros encima.
- Construido M0 entero de una sesión: `packages/shared` (esquemas zod +
  codigo de sala, 10 tests), `apps/server` (Fastify + WS, RoomService
  puro y testeable con 11 tests, 3 e2e de Playwright contra el server
  real), `apps/web` (React+Vite+Tailwind, i18n en/es/pt con test de
  paridad de claves, deteccion honesta de iOS).
- Verificado en tres capas, no solo "compila": (1) Playwright contra el
  server de Node corriendo directo, (2) mismo flujo contra el build de
  produccion, (3) mismo flujo otra vez contra el contenedor Docker real
  ya corriendo en 127.0.0.1. Las tres veces: sala -> codigo -> el emisor
  entra -> comparte -> la pantalla ve el video -> cortar -> codigo nuevo.
- Dos bugs de Docker encontrados y arreglados en el momento, no
  reportados nunca: `pnpm@10.32.0` fijado en `packageManager` porque
  Alpine bajaba pnpm 11 via corepack y su nueva politica de
  "minimum release age" rechazaba paquetes publicados el mismo dia del
  lockfile; y `*.tsbuildinfo` faltaba en `.dockerignore`, colandose una
  cache incremental de tsc del host que hacia que `tsc -b` de
  `packages/shared` no reemitiera los `.d.ts` dentro del contenedor.
- El `.gitignore` volvio a cambiar solo durante esta sesion tambien (ver
  la entrada de M-1 abajo) — se dejo en el estado que coincide con
  CODESTYLE.md §6, sin volver a tocarlo mas alla de eso.
- `HANDOFF.md` escrito con el estado real, mediciones, desviaciones (SPA
  de una sola ruta con estado en vez de rutas de servidor separadas) y
  deuda conocida (range-request aun sin resolver; sin CI real, resuelto
  con un test).
- La puerta humana de M0 (10 min de espejo real Mac→tele con latencia
  medida) queda sin marcar en ROADMAP.md — no se simula.

## 2026-08-28 — M-1: spike construido y verificado en local

- Repo ya tenía un commit inicial (`.gitignore`, `CODESTYLE.md`,
  `ROADMAP.md`) hecho fuera de esta sesión. El `.gitignore` committeado era
  una copia literal del de hibiki, con excepciones a ficheros de hibiki
  que no existen en kagami (`docs/mcp-design.md`, `apps/api/measurements/`,
  etc.) — lo reescribí a la regla real de `CODESTYLE.md` §6 más las
  excepciones que este ROADMAP pide (`docs/spike-tv.md`, `docs/registro.md`).
  Durante la sesión el fichero volvió a cambiar en disco por fuera de mis
  ediciones, con contenido de un tercer proyecto (`apps/api/fixtures`,
  `pgdata/`, `n8n-data/`); lo dejé sin tocar y lo reporté — ver el informe
  de la sesión, no lo revertí por mi cuenta.
- `REAMDE.md` (typo) renombrado a `README.md`.
- `LICENSE` (MIT) añadido — SPECS §5 lo exige desde el primer commit; no
  estaba en el commit inicial, así que entra en este.
- Construido `spike/`: servidor de un fichero (`server.mjs`, Node + `ws`,
  sin dependencias del stack final), página receptora (`public/screen.js`)
  y emisora (`public/sender.js`) con las seis pruebas de M-1.
- Verificación en local con Playwright + Chromium headless (dos contextos,
  `--use-fake-device-for-media-stream`), no como test versionado sino como
  smoke test manual: las seis pruebas pasan. Encontrado y arreglado en el
  proceso:
  - `addTransceiver(track, {...})` sin `streams: [stream]` llega con
    `ev.streams` vacío al receptor → `video.srcObject` quedaba `undefined`.
  - `video.srcObject` asignado por JS necesita `video.play()` explícito;
    el atributo `autoplay` del HTML no basta en ese caso.
  - ICE candidates cruzados entre pruebas si el humano lanza H.264 y VP8
    sin esperar a que la primera termine → añadido `sessionId` por intento
    y cola de candidatos hasta tener remote description.
- Lo que exige la tele física (todo M-1 en sí) queda sin marcar en
  ROADMAP.md — pendiente de ejecutarse con Fran delante. Ver
  `docs/spike-tv.md` para instrucciones exactas.
- Prueba de campo real con Fran (Mac como emisor, iPhone como receptor de
  pie mientras la tele no estaba disponible — no sustituye a M-1, el
  iPhone no es la tele). Encontrados y arreglados dos bugs reales que el
  smoke test local no había visto:
  - `crypto.randomUUID()` en `sender.js` fallaba fuera de contexto
    seguro: `http://<ip-lan>:7421` no lo es (solo HTTPS o localhost), y
    mi smoke test solo había probado contra `localhost`. Sustituido por
    un id de correlación sin Web Crypto.
  - En el iPhone, la prueba de `<video>` por range requests fallaba sola
    (las otras cinco, incluido el video WebRTC en vivo, en verde) — el
    elemento de prueba nunca se insertaba en el DOM, y iOS Safari es
    agresivo reteniendo recursos de video para elementos así. Reproducido
    el patrón en Chromium headless y WebKit de escritorio (ambos pasan,
    confirma que no es el servidor ni el range-request), pero no pude
    reproducir Safari de iOS real aquí — el fix (insertar oculto en el
    DOM, `playsInline`) queda pendiente de reconfirmar en el propio
    iPhone o en la tele.
  - Dato de campo real de la prueba de estabilidad Mac→iPhone: 601 s,
    0 fotogramas perdidos, RTT de WS avg 19 ms / max 203 ms, 1 pico
    >200 ms. No es la puerta de M-1 (esa es con la tele), pero es la
    primera señal de que la señalización aguanta bien en esta LAN.
