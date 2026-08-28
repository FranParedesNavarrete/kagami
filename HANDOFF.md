# kagami — HANDOFF M0

> Estado real al cerrar M0 (2026-08-28). Formato estilo hibiki: estado,
> mediciones, desviaciones, deuda.

## Estado real

M0 está construido y funcionando de extremo a extremo, verificado tres
veces con el mismo flujo (Playwright directo, servidor de producción
compilado, y contenedor Docker real):

- **Monorepo pnpm**: `packages/shared` (esquemas zod + código de sala),
  `apps/server` (Fastify + `@fastify/websocket`), `apps/web` (React +
  Vite + Tailwind).
- **Salas en memoria**: código de 4 caracteres del alfabeto sin ambiguas,
  caduca a los 10 min sin emparejar, no admite un segundo emisor, muere
  entera si cualquiera de los dos lados se va (un código usado no vuelve).
  11 tests de Vitest cubren esto con temporizadores falsos.
- **Señalización WS completa**: create-room/join-room/offer/answer/ice/
  leave, validada con zod en los dos lados; un mensaje inválido se
  rechaza con log, nunca se procesa.
- **Vista pantalla**: HTTP plano, código enorme + QR, pasa a vídeo a
  pantalla completa al conectar, vuelve a un código *nuevo* cuando el
  emisor se va (no reutiliza el código muerto).
- **Vista emisor**: `getDisplayMedia`, indicador de si hay audio,
  detección honesta de iOS (explica por qué no hay espejo en vez de
  dejar que falle en silencio).
- **Sin STUN/TURN**: `RTCConfiguration.iceServers: []` en los dos lados.
- **i18n en/es/pt**: paridad de claves comprobada con un test de Vitest.
- **e2e Playwright** (`apps/server/e2e/mirror.spec.ts`, 3 casos) contra
  el servidor real compilado, con captura de pantalla fingida via flags
  de Chromium: ciclo completo sala→conexión→compartir→cortar→código
  nuevo, código inexistente muestra error, segundo emisor rechazado.
- **Docker de producción**: build de dos fases, solo publica en
  `127.0.0.1:7421`. Construido y ejecutado de verdad (no solo `docker
  build`): el contenedor real sirvió el flujo completo de espejo.

## Mediciones

- `pnpm test` (shared + server + web): 16 tests, todos en verde.
- `pnpm --filter @kagami/server e2e`: 3/3 en verde.
- Bundle de `apps/web`: 243.96 kB JS (74.75 kB gzip), 8.15 kB CSS.
- Build de Docker desde cero: ~5 s (capas de `pnpm install` cacheadas
  aparte). Imagen arrancada y respondiendo en `/health` en <1 s.
- **Lo que NO está medido**: la puerta humana de M0 —10 minutos de
  espejo real Mac→tele con latencia ≤400 ms (foto a las dos pantallas,
  restar)— no se ha ejecutado. Ver ROADMAP.md, queda sin marcar a
  propósito.

## Desviaciones respecto a ROADMAP/SPECS

- **Rutas, no vistas separadas por rol**: SPECS describe "abrir la web →
  elegir Espejo/Cast", pero se implementó como una sola SPA con estado
  en el cliente (`home` → `screen` | `sender`) en vez de rutas de
  servidor distintas. El QR codifica `?code=XXXX` sobre la misma URL
  raíz, que salta directo al flujo de emisor. No cambia nada de cara al
  usuario, pero quien retome esto no debe buscar `/screen` o `/sender`
  como rutas reales del servidor — no existen, son solo estados de
  `App.tsx`.
- **Sin STUN/TURN confirmado que basta**: no fue necesario ningún ajuste
  extra más allá de `iceServers: []`; en LAN los candidatos host
  conectan directos en los tres entornos probados (local, contenedor,
  Playwright con Chromium).
- **`pino-pretty` en logs de desarrollo, JSON crudo en producción**: el
  server usa `Fastify({ logger: true })` (pino nativo de Fastify) para
  logs de petición/respuesta, y un logger `pino` propio
  (`lib/logger.ts`) solo para lo que pasa fuera del ciclo de petición
  (señalización WS, arranque). No se pasó un logger custom a Fastify
  (`loggerInstance`) porque generaba un choque de tipos entre
  `FastifyBaseLogger` y la instancia de pino tipada — más simple dejar
  que Fastify gestione el suyo.

## Deuda conocida

- **`<video>` por range requests sigue fallando en la tele real** (visto
  en el spike M-1, dos corridas, ni con el fix de adjuntar el elemento
  al DOM). Documentado como riesgo abierto en SPECS.md §4.3 y como
  primera tarea de M1 en ROADMAP.md — M1 no debe construir subida/
  limpieza de ficheros de cast sin resolver esto antes.
- **`.gitignore` cambió de contenido tres veces durante la sesión de
  M-1** por algo externo a este agente (contenido de un proyecto no
  relacionado, `apps/api/fixtures`, `pgdata/`, etc.). Se dejó en el
  estado que coincide con `CODESTYLE.md` §6; si vuelve a cambiar solo,
  vale la pena averiguar qué lo está tocando antes de seguir confiando
  en él a ciegas.
- **Sin CI real**: "CI comprueba que las tres tienen exactamente las
  mismas claves" (CODESTYLE.md §1) se resolvió como un test de Vitest
  (`apps/web/src/i18n/keys.test.ts`), no como un paso de integración
  continua aparte — no se pidió infraestructura de CI en esta sesión.
- **Countdown del código no es en vivo**: `screen.expiresIn` muestra los
  minutos calculados en el momento de crear la sala, no un contador que
  baje en tiempo real. Cosmético, no afecta a la caducidad real (esa la
  controla el servidor).
- **`RTCRtpSender`/codec forzado del spike no se llevó a M0**: M0 no
  fuerza H.264 ni VP8 (a diferencia del spike, que sí lo hacía para
  poder probar los dos por separado) — usa la negociación por defecto
  del navegador. Es lo correcto para producción; solo lo apunto porque
  si algún día hace falta forzar codec por lo que sea, la lógica ya
  probada está en `spike/public/sender.js`.

## Qué falta para cerrar M0 del todo

Un único paso, humano, documentado en ROADMAP.md: 10 minutos de espejo
Mac→tele real, sin cortes, con la latencia medida por el método de la
foto (reloj en ms en el emisor, foto a las dos pantallas, restar). Con
el servidor ya en Docker en el puerto 7421, el comando es
`docker compose up -d` y luego abrir la tele y el Mac como en el flujo
normal.
