# kagami — CODESTYLE

> Las mismas reglas que hibiki, adaptadas a un proyecto mas pequeño. Si
> una duda no esta cubierta aqui, se resuelve como la resolveria hibiki.

## 1 · Idiomas

| Que | Idioma |
|---|---|
| Codigo (nombres, ficheros, commits) | Ingles |
| Texto de la UI | Ingles via i18n (en por defecto, es, pt) |
| Comentarios | Español |
| Documentos (.md) | Español (salvo README.md, en ingles) |

- i18n en JSON: `apps/web/src/i18n/{en,es,pt}.json`. `en.json` es la
  fuente de verdad; ninguna cadena visible se escribe inline en JSX.
  CI comprueba que las tres tienen exactamente las mismas claves.
- Comentarios exclusivamente tecnicos y necesarios: explican un porque no
  evidente, un limite medido o una decision. Prohibidos los comentarios
  vagos ("// helper", "// main logic") y los que repiten el codigo.

## 2 · Nombres y estructura

- camelCase para variables/funciones, PascalCase para componentes y
  tipos, ficheros en camelCase ingles (`roomService.ts`, `ScreenView.tsx`).
- Monorepo pnpm:

```
apps/server/src/
├── routes/        endpoints HTTP (paginas, subida de cast, salud)
├── ws/            señalizacion WebSocket (join/offer/answer/ice/leave)
├── services/      salas, ficheros de cast, limpieza
└── lib/           env, logger, utilidades
apps/web/src/
├── views/         screen/ (la tele), sender/ (emisor)
├── components/
├── hooks/         useSignaling, useMirror, useCast
├── lib/           webrtc, api
└── i18n/
packages/shared/src/
└── schemas.ts     mensajes de señalizacion y config, tipados con zod
```

- Las rutas no tocan estado directamente: `routes/ws → services → lib`.
- Todo mensaje que cruza el WebSocket se valida con zod en los dos lados.
  Un mensaje invalido se rechaza con log; jamas se procesa "a ver si cuela".

## 3 · Herramientas

- TypeScript estricto en todo. Node 22. pnpm.
- Biome para formato y lint; el codigo se commitea siempre formateado.
- pino para logs del server (nunca console.log). Niveles con criterio:
  info para ciclo de vida de salas, warn para rechazos, error para fallos.
- Sin dependencias nuevas sin justificarlo en el commit. En particular:
  nada de librerias de WebRTC del lado cliente (la API nativa basta) y
  nada de STUN/TURN.

## 4 · Tests

- Vitest para unidad/integracion: salas (caducidad, un solo uso, no
  admitir segundo emisor), esquemas, limpieza de ficheros (los dos
  caminos: cierre de sala y barrido de 24 h).
- Playwright para e2e contra el server real: la captura de pantalla se
  finge con los flags de Chromium (`--auto-select-desktop-capture-source`,
  media fake), nunca con mocks del codigo propio.
- Lo que exige la tele fisica no se simula: queda documentado como
  pendiente humano. Un test que finge la tele miente.

## 5 · Prohibiciones

- Nada escucha fuera de 127.0.0.1 en el compose de produccion.
- Ningun fichero subido se sirve fuera de su sala ni sobrevive al barrido.
- Ninguna clave, token o endpoint inventado por el agente.
- No mover tags publicados; no reescribir historia.
- No añadir cuentas, base de datos ni Redis: si parece que hacen falta,
  es una conversacion de SPECS, no una decision de implementacion.
- No reconstruir un control nativo (`<select>`, etc.) como componente
  a medida solo para poder tematizarlo entero. Deuda aceptada a
  proposito, no descuido: el `<select>` de dispositivo de audio
  (`SenderView.tsx`) tiene fondo/borde/texto tematizados, pero su
  flecha y su desplegable los pinta el sistema operativo — ninguna
  propiedad CSS estandar llega ahi (`accent-color` no se aplica a
  `<select>`, solo a checkbox/radio/range/progress). Reconstruirlo con
  un `<div>`/`<ul>` a medida es la forma clasica de romper el teclado y
  los lectores de pantalla; que la flecha la pinte el sistema es un
  precio barato, y decirlo aqui es mejor que taparlo (ver
  `docs/screen-aspect.md`, "Controles nativos sin tematizar", para el
  resto de esta misma clase de fallo).

## 6 · Git

- Criterio de que se publica: la documentacion que sirve a quien no ha
  trabajado en el proyecto (`README.md`, `CODESTYLE.md`, `SPECS.md`,
  y los documentos de `docs/` que explican una decision o una medida)
  se sube al repo. El registro de trabajo (`ROADMAP.md`, `HANDOFF.md`,
  `docs/registro.md`, `docs/ui-inventario.md`, `docs/ui-propuesta.html`)
  se queda en local — el propio `.gitignore` nombra cada uno de estos
  con el motivo, para que quien los busque encuentre por que faltan.
- Antes de subir un documento por primera vez, revisarlo por datos de
  la red o la maquina de quien lo escribio (hostnames internos,
  direcciones LAN, nombres de tailnet, rutas absolutas) y sustituirlos
  por ejemplos genericos — el historial de git conserva todo lo que
  se sube, aunque se borre despues.
- Commits incrementales, en ingles, citando el milestone: `M0: room
  codes expire after 10 minutes`.
