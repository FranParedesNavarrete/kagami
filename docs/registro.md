# Registro de sesión

> Una entrada por sesión de agente, más reciente arriba.

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
