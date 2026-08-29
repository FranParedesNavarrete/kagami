# Modos de aspecto en la vista pantalla: dos fallos reales en la LG

> Probado en real y corregido el mismo día. El primer intento
> (`docs/webrtc-quality.md` menciona los modos de pasada) tenía dos
> fallos que solo aparecieron en la tele de verdad, no en Chromium
> headless: barra de scroll, y las franjas de los ratios fijos recortaban
> contenido en vez de encajarlo.

## Los dos fallos

1. **Scrollbar en la vista pantalla.** El contenedor raíz usaba
   `100vh`/`100vw`. El navegador de webOS reporta `vh` incluyendo área
   oculta bajo su propia barra — el resultado es un documento
   ligeramente más alto que el viewport visible, y eso basta para que
   aparezca una barra de desplazamiento. En Chromium headless (donde se
   probó primero) esto no se reproduce, porque no tiene esa barra.
2. **Franjas que ocultaban contenido.** Los tres modos de ratio fijo
   (16:9/21:9/4:3) usaban `object-fit: cover` dentro de la caja del
   ratio. `cover` **recorta** lo que no encaja — exactamente lo
   contrario de lo que se quería. El usuario pide un formato sabiendo
   que deforma la imagen; lo que no puede pasar es que además pierda
   contenido.

## La corrección

### Cero scroll, siempre

`apps/web/src/index.css` define una clase `.kagami-fullscreen` con
`margin:0; padding:0; height:100%; overflow:hidden` para `html` y
`body`. `ScreenView` la añade al montar y la quita al desmontar
(`document.documentElement.classList` / `document.body.classList`) —
es un toggle de clase, no un cálculo de estilos por JS; los valores
viven enteros en el CSS. Se aplica solo mientras `ScreenView` está
montado: el emisor sigue pudiendo hacer scroll en pantallas pequeñas,
donde con todos los selectores de esta sesión (codec, resolución,
calidad, audio, aspecto...) puede hacer falta de verdad.

El contenedor raíz de `ScreenView` usa `h-[100dvh] w-[100dvw]`
(Tailwind arbitrario) en vez de `h-screen w-screen` (que es `100vh`).
`dvh`/`dvw` son las unidades de *viewport dinámico*: reflejan el área
realmente visible, no un valor que puede incluir barras del navegador.

### El video siempre es `100%/100%/block`; el modo cambia la CAJA y el `object-fit`

`apps/web/src/lib/aspect.ts` expone dos funciones puras:

- `containerStyleForAspect(mode)` — el tamaño de la caja que envuelve
  al `<video>`.
- `videoObjectFitForAspect(mode)` — el `object-fit` del video dentro de
  esa caja.

| Modo | Caja | `object-fit` | Qué hace |
|---|---|---|---|
| `auto` (defecto) | viewport completo | `contain` | Se ve todo, proporción real, franjas si el origen no es 16:9 |
| `expanded` | viewport completo | `cover` | Llena la tele, proporción real, recorta bordes — **el único modo donde se pierde contenido, a propósito** |
| `16:9` | `aspect-ratio:16/9`, la mayor que quepa, centrada | `fill` | Se ve todo, deforma para llenar la caja |
| `21:9` | `aspect-ratio:21/9`, la mayor que quepa, centrada | `fill` | Se ve todo, deforma, franjas arriba y abajo |
| `4:3` | `aspect-ratio:4/3`, la mayor que quepa, centrada | `fill` | Se ve todo, deforma, franjas a los lados |

En los tres modos de ratio fijo la deformación es intencionada — el
usuario pidió ese formato sabiendo que su pantalla no lo es. Lo que no
es aceptable es perder contenido; por eso `fill` (estira) y nunca
`cover` (recortaría).

Regla que ningún modo puede romper: **o el fotograma entero está
visible, o se ha recortado explícitamente por geometría — solo en
`expanded`.** Nunca por una capa encima.

### La caja del ratio: `min()`/`calc()`, no `cover`

`min(100dvw, calc(100dvh * ratio))` / `min(100dvh, calc(100dvw / ratio))`
da exactamente "la caja del ratio pedido más grande que quepa en el
viewport, centrada" — resuelto por el motor de CSS en cada repintado,
sin medir nada por JS ni depender de un `ResizeObserver`. Ver el
comentario en `lib/aspect.ts` para el razonamiento completo.

### Nunca una franja superpuesta

Lo que se ve "vacío" alrededor de la caja (letterbox/pillarbox en
21:9/4:3) es sencillamente el fondo `#000` del contenedor raíz
asomando — nunca un `<div>` de franja por encima del vídeo. El wrapper
del vídeo (`data-testid="video-wrapper"`) no tiene más hijos que el
propio `<video>`; los tests lo comprueban contando
`wrapper.children.length === 1` en los cinco modos.

### Nota sobre estirar 16:9 desde un origen 16:10

Un MacBook con pantalla 16:10 hacia una tele 16:9: el modo `16:9` es el
**único** que llena la pantalla entera sin franjas ni recorte, a cambio
de un estiramiento del ~1,1% — imperceptible en la práctica.

## Verificación

- **Unitaria** (`apps/web/src/lib/aspect.test.ts`, 7 tests): cada modo
  usa el `object-fit` que le corresponde (nunca `cover` fuera de
  `expanded`), y las cajas de ratio fijo usan `dvh`/`dvw`, nunca
  `vh`/`vw` a secas.
- **e2e** (`apps/server/e2e/screen-aspect.spec.ts`, dos tests contra el
  servidor real: espejo y cast — ver la sección siguiente para por qué
  ya no vive en `mirror.spec.ts`): cero scrollbar
  (`scrollWidth === clientWidth`), `object-fit` correcto por modo, el
  rectángulo del `<video>` cae entero dentro del viewport, y el wrapper
  del vídeo no tiene hijos de más.
- **Sin verificar todavía (requiere la tele real)**: la fuente de
  origen en las pruebas automatizadas es la que da el dispositivo de
  vídeo fingido de Chromium (16:9 por defecto) — no se ha probado
  automatizado con orígenes de 16:10 o 4:3 de verdad, ni en el propio
  navegador de la LG. Eso es exactamente lo que pide el punto 8 del
  encargo: comprobar a ojo, con un emisor a 1280×800 y otro a
  resolución nativa, que ninguno de los cinco modos mete scrollbar, que
  `auto` no esconde nada, y que `21:9`/`4:3` deforman sin ocultar.

## Investigación de un reporte de regresión (2026-08-29) — resultado: no reproducible en el código

Fran reportó, verificado en la LG real tras la sesión de M1 (cast): los
cinco modos de aspecto habían dejado de cambiar nada en el espejo.
Sospecha inicial: el `<video>` del espejo había quedado anidado dentro
de la caja nueva de la fase `casting`, o `containerStyleForAspect` ya
no se aplicaba al contenedor correcto.

**Investigación realizada, en orden:**

1. `git diff` completo entre `8fa6acb` (el commit con la puerta de
   aspecto verificada en la LG) y el HEAD de la sesión de cast — línea
   por línea, en `ScreenView.tsx`, `SenderView.tsx`, `aspect.ts`,
   `index.css`, `App.tsx` y los esquemas de `packages/shared`.
   Resultado: el bloque JSX del `<video>` de espejo
   (`data-testid="video-wrapper"`) es **byte a byte idéntico** entre
   los dos commits. El `<video>` de cast se añadió como un `<div>`
   **hermano posterior**, nunca como padre — la hipótesis de anidado
   queda descartada por lectura directa del código, no solo por
   sospecha.
2. Como el punto 1 no es prueba suficiente por sí sola (este proyecto
   ya tiene precedente de bugs reales en la LG invisibles en Chromium
   headless — los dos fallos de este mismo documento), se hizo la
   comparación pedida **contra el DOM real, no razonando sobre el
   código**: un `git worktree` con el commit `8fa6acb`, build completo
   de las dos versiones, y un script de Playwright con los mismos
   flags de captura fingida que usa `playwright.config.ts`
   (`--use-fake-device-for-media-stream` etc. — el primer intento sin
   estos flags hizo que `getDisplayMedia()` nunca resolviera, un error
   de metodología en la propia investigación, no del producto) contra
   los dos servidores en paralelo. Se comparó el DOM y los estilos
   computados (`getComputedStyle`, `getBoundingClientRect`, conteo de
   hijos) en los cinco modos. **Resultado: salida idéntica entre las
   dos versiones**, incluyendo geometría distinta y correcta por modo
   (p. ej. `21:9` da 1280×549, `4:3` da 960×720, sobre un viewport
   1280×720) en ambas.
3. Se revisó también `SenderView.tsx` (735 líneas de diff de la sesión
   de cast): el bloque de "sharing" que contiene los botones de los
   cinco modos y `changeAspectMode()` **no aparece en ningún hunk del
   diff** — no se tocó en absoluto. El selector de aspecto vive
   exclusivamente en la fase "sharing", nunca en el formulario nuevo de
   cast.

**Conclusión: no se encontró ninguna diferencia de código ni de DOM
entre el commit verificado y el HEAD de la sesión de cast que explique
el síntoma descrito.** No se descarta que el problema sea real en la
LG — dado el precedente de esta misma tele — pero si lo es, no está en
este diff. Candidatos no verificables desde aquí: build de Docker no
reconstruido con el código nuevo, caché del navegador de la TV sirviendo
JS viejo sobre un `index.html` nuevo (los ficheros de Vite van con hash
de contenido, pero `index.html` no), o un firmware/estado de la propia
LG. **No se marca nada como arreglado** porque no se identificó nada
que arreglar — arreglar un síntoma sin causa confirmada habría sido
justo lo que este documento pide no hacer.

### El fallo real que SÍ apareció al investigar: la prueba no miraba lo que decía mirar

Aunque no se encontró la regresión reportada, la investigación encontró
un defecto real y distinto **en la propia prueba automática**
(`mirror.spec.ts`, test "all five aspect modes"): localizaba el vídeo
con `document.querySelector("video")`, es decir, "el primer `<video>`
del documento" — no "el que se ve". Mientras solo existió un `<video>`
en `ScreenView`, esto coincidía por accidente con lo correcto. Desde
que la fase `casting` añadió un segundo `<video>` (el de espejo sigue
siempre en el DOM, oculto con la clase `hidden`; el de cast solo existe
mientras la fase es literalmente `casting`), ese `querySelector` seguía
apuntando al de espejo — por casualidad de orden en el DOM, no porque
la prueba comprobara nada sobre visibilidad. **Se verificó que esto es
un fallo real y no cosmético**: mutando `ScreenView.tsx` para que el
`<video>` de espejo NO se oculte durante el cast (justo el tipo de
regresión que un reordenamiento de JSX futuro podría introducir sin
querer), el test viejo lo habría dejado pasar en silencio, mientras que
el nuevo (`screen-aspect.spec.ts`) lo detecta de inmediato:
`video:visible` resuelve a 2 elementos en vez de 1 y el test falla con
un mensaje claro. Ver `docs/registro.md` para el detalle de esa mutación
de prueba.

**Corrección aplicada a la cobertura** (`apps/server/e2e/
screen-aspect.spec.ts`, nuevo fichero, sustituye el test de aspecto de
`mirror.spec.ts`):

- El vídeo se localiza con `video:visible` (el pseudo-selector de
  Playwright que comprueba visibilidad real, no presencia en el DOM) y
  se afirma explícitamente que solo hay **uno** visible a la vez —
  antes y durante los cinco modos, y también durante el cast.
- Se comprueban las mismas reglas (cero scrollbar, vídeo entero dentro
  del viewport, sin hermanos que simulen una franja, `fill` en los tres
  ratios fijos, `cover` solo en `expanded`) en **las dos fases**: los
  cinco modos durante el espejo, y la única configuración de cast
  (`contain`, sin selector de modos — el emisor de cast no elige
  aspecto) durante el cast.
- Se comprueba explícitamente la exclusión mutua en las dos
  direcciones: durante el espejo, el `<video>` de cast no existe
  siquiera en el DOM (la fase nunca es `casting`); durante el cast, el
  `<video>` de espejo sigue en el DOM pero con
  `getBoundingClientRect() === {width: 0, height: 0}` — oculto de
  verdad, no solo "detrás" de otra cosa.
