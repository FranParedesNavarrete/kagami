# Resolucion fija desde el primer frame, bitrate real, y recuperacion

> Segunda y tercera causa detras del fallo de la puerta de M0 — Safari
> congelandose al subir de calidad (resolucion cambiando a mitad de
> stream) y, ya sin ese problema, el video emborronandose en movimiento
> (techo de bitrate por defecto de Chrome). La causa principal — codec
> sin forzar — esta en `docs/webrtc-codec.md`. Este documento cubre el
> mecanismo de calidad y la recuperacion automatica, en dos rondas: la
> primera fijo resolucion baja y penso que el problema era el caudal; la
> segunda, con datos reales de una corrida de 4.5 min, corrigio eso.

## Ronda 1 — el sintoma original (antes de saber lo del codec)

Con Safari (que si negocia H.264): los primeros ~30 s el espejo se veia
a baja resolucion — arranque conservador tipico de WebRTC — y en el
momento exacto en que subia a la resolucion real (pantalla Retina del
Mac) la tele se congelaba y no volvia. No era degradacion progresiva:
era el salto de calidad el que la mataba.

Dos hipotesis a distinguir:
- (a) el caudal a resolucion completa supera lo que decodifica la tele.
- (b) el CAMBIO de resolucion en mitad del stream mata al decodificador
      **por hardware** de webOS — un patron conocido en teles; incluso
      una resolucion baja fallaria si llega despues de un cambio.

Con el hallazgo del codec (`docs/webrtc-codec.md`) ya sabemos que (b) es
la explicacion real para Safari: su decodificador de hardware H.264 no
digiere la renegociacion de resolucion a mitad de stream. Pero el
mecanismo que se construyo para distinguirlas sigue siendo la forma
correcta de evitarlo, independientemente del diagnostico.

## Que se hizo (ronda 1): resolucion y bitrate fijos, bajos

`apps/web/src/lib/quality.ts` definio tres escalones por
**resolucion** (720p/1.5Mbps, 1080p/2.5Mbps, 1080p/5Mbps):

- `getDisplayMedia` pedia el ancho/alto/fps del escalón elegido **con
  numeros llanos**, no `exact`. Nota tecnica que sigue siendo valida:
  Chromium **rechaza `exact` en `getDisplayMedia` con un `TypeError`
  sincrono** — no es un `OverconstrainedError` recuperable, directamente
  no arranca la captura. Con numeros llanos (o `ideal`, da igual) Chrome
  SI recorta y escala de verdad al valor pedido (`resizeMode:
  "crop-and-scale"` en `track.getSettings()`).
- `applyQualityToSender()` fijaba `scaleResolutionDownBy: 1`,
  `maxBitrate` explicito y `degradationPreference: "maintain-resolution"`
  en el `RTCRtpSender`, aplicado **antes** de crear la oferta.

Esto arreglo el congelamiento de Safari (resolucion constante de
principio a fin), pero el techo de bitrate elegido (1.5–5 Mbps) era
conservador — una suposicion, no una medida.

## Que corrigio la ronda 2: medicion real de una corrida que SI funciono

Chrome, pantalla completa, 4.5 min, sin cortes. Estadisticas de
`getStats()` al final:

| Campo | Valor |
|---|---|
| Codec | VP8, 3024x1964 (nativa, Retina) |
| fps enviados / fuente | 16 / 27 |
| targetBitrate / enviado real | 2.33 Mbps / 1.9 Mbps |
| availableOutgoingBitrate | 5.65 Mbps — **mas del doble sin usar** |
| qualityLimitationReason | `none` (bandwidth 0, cpu 0) |
| qualityLimitationResolutionChanges | 0 |
| qpSum/framesEncoded | 106 — compresion altisima |
| packetsLost / RTT / jitter | 0 / 4 ms / 25 ms |
| totalEncodeTime por frame | 9.6 ms — al encoder le sobra margen |

Diagnostico: **Chrome topa el bitrate de screenshare en ~2.5 Mbps por
defecto**, y eso no es limite de red (`availableOutgoingBitrate` iba
sobrado) ni de CPU (`totalEncodeTime` con margen, `qualityLimitationReason:
none`). El QP medio altisimo con ese techo es lo que emborronaba el
video en movimiento. Y `qualityLimitationResolutionChanges: 0` confirma
que fijar la resolucion (ronda 1) funciono — el problema que quedaba
era puramente de bitrate. El fps bajo (16 de 27) tambien se explica:
`degradationPreference: "maintain-resolution"` sacrifica **framerate**
en vez de resolucion cuando el bitrate objetivo no alcanza — exactamente
lo que se le pidio, solo que el objetivo era demasiado bajo.

### Cambios aplicados

- `apps/web/src/lib/quality.ts`: los escalones pasan a ser de
  **bitrate puro** — 2.5 / 5 / 8 / 12 Mbps, arrancando en **8 Mbps**
  (hay margen de sobra medido, no hace falta partir conservador).
- `getDisplayMedia` deja de pedir ancho/alto: la resolucion nativa
  (Retina incluida) fue la que se probo en la corrida que funciono. Solo
  se pide `frameRate: 30` como numero llano.
- `scaleResolutionDownBy: 1` y `degradationPreference:
  "maintain-resolution"` se mantienen — con bitrate de sobra, ese modo
  ya no cuesta framerate como pasaba a 2.5 Mbps.

### Selector de calidad en la UI del emisor

Cuatro botones en `SenderView` (2.5/5/8/12 Mbps), sin recompilar ni
redesplegar, recordado en `localStorage`. Sirve para encontrar el techo
real de bitrate de una tele por prueba y error desde el sofa —
subiendo esta vez, no bajando.

### Diagnostico SIEMPRE visible (no solo `?debug=1`)

Este bug se diagnostico a ciegas la primera vez (hubo que pedirle a
Fran que midiera `getStats()` a mano). Para que no vuelva a pasar, la
UI del emisor muestra permanentemente mientras comparte: codec,
resolucion, fps, bitrate real (delta de bytes/tiempo), **QP medio**
(delta de `qpSum`/`framesEncoded`) y `qualityLimitationReason` — los
campos exactos que hicieron falta para diagnosticar esto. `?debug=1` +
`DebugOverlay` siguen existiendo, pero solo para el lado de la tele
(`framesDecoded`/`framesDropped`/`bytesReceived`/resolucion recibida y
estado de ICE/conexion — relevante para el mecanismo de recuperacion de
abajo, no para diagnostico rutinario de calidad).

## Recuperacion automatica (nunca una imagen congelada para siempre)

`ScreenView` vigila `framesDecoded` cada segundo mientras comparte
(`STALL_RESTART_MS = 5000`, `STALL_GIVEUP_MS = 15000`, ambos en
`ScreenView.tsx`):

1. Si `connectionState === "connected"` pero `framesDecoded` no avanza
   durante 5 s → manda `{type: "restart-ice"}` al emisor por el canal
   de señalizacion existente (nuevo mensaje en
   `packages/shared/src/schemas.ts`, relayado por
   `apps/server/src/ws/signaling.ts` igual que offer/answer/ice).
2. El emisor, al recibirlo, cierra su `RTCPeerConnection` actual y crea
   una nueva **reutilizando el mismo `MediaStream`** ya capturado (no
   vuelve a pedir `getDisplayMedia`, no hay picker de nuevo) — ver
   `startPeerConnection()` en `SenderView.tsx`.
3. Si a los 15 s totales sigue sin avanzar, la tele se rinde: cierra la
   sesion, avisa al emisor (`leave`, que el emisor ve como
   `peer-left`) y pide una sala nueva — nunca deja la imagen congelada
   sin mas.

**Limitacion conocida, sin verificar todavia**: un `restart-ice`
renegocia la conexion, pero si lo que se cuelga es el **decodificador
de la propia tele** con la conexion viva (no la red ni el
`RTCPeerConnection`), reiniciar el ICE puede no arreglar nada — ahi el
problema no es de conectividad. Este mecanismo no se ha probado contra
un atasco real de decodificador (los tres tests que lo motivaron son
anteriores a su implementacion). Lo que si esta garantizado pase lo que
pase: a los 15 s totales sin avance, `STALL_GIVEUP_MS` saca de la imagen
congelada y vuelve a un codigo nuevo, aunque el restart-ice no haya
servido de nada. Verificado que el protocolo funciona (tests de
`packages/shared` y `apps/server`) y que la mecanica de WebRTC es
correcta; la prueba de fuego de si el restart-ice en si rescata algo es
la proxima corrida de 10 minutos real en la tele.

## Ronda 3 — la causa raiz real no era el bitrate, era la RESOLUCION

Medido a 2.5 Mbps, Chrome + VP8, pantalla completa:

| Campo | Valor |
|---|---|
| fps enviados / fuente | 11 / 27 |
| QP | 106 |
| Resolucion | 3024x1964 (nativa Retina) |
| Encoder | `libvpx` — **software**, no hardware |
| totalPacketSendDelay/packetsSent | 19 ms |
| Lo mismo a 12 Mbps/nativa | 83 ms |
| availableOutgoingBitrate | 5.8 Mbps (sobra ancho de banda) |

**No era el bitrate: era la resolucion.** Codificar 5.9 Mpx por frame en
software no da tiempo, sea cual sea el bitrate permitido — subir el
techo de bitrate (ronda 2) no arregla un encoder que va con retraso por
pura carga de pixeles; de hecho lo empeora (83 ms de retraso a 12 Mbps
frente a 19 ms a 2.5 Mbps, MAS bitrate MAS trabajo por frame). Ese
retraso de codificacion+envio es lo que desincroniza el audio, que sale
del sistema operativo sin pasar por ningun encoder y va instantaneo.

Confirmacion cruzada: Safari, que captura la pantalla a **media
resolucion** (puntos logicos de macOS, no pixeles Retina — ver la
matriz abajo), dio **30 fps y 0.1–0.2 s de delay**, el mejor resultado
de todas las pruebas de esta sesion. No era merito de Safari en si —
era que, sin querer, capturaba menos pixeles.

### Cambios aplicados

- **Resolucion fija, calculada, no en pixeles absolutos**
  (`apps/web/src/lib/resolution.ts`): tres escalones — 720p, 1080p
  (por defecto) y nativa. `scaleResolutionDownBy` se calcula como
  `capturedWidth / targetWidth` (minimo 1, nunca se "subescala")
  **a partir de la resolucion real que devolvio `getDisplayMedia`**, no
  un numero fijo — un Mac con Retina (3024px) y uno sin Retina (1512px)
  necesitan factores de escala distintos para llegar al mismo 1080p. Se
  fija antes de la oferta y no cambia nunca a mitad de stream (sigue
  prohibido, ver arriba).
- **Bitrate por defecto bajado a 5 Mbps** (`apps/web/src/lib/quality.ts`):
  a 1080p sobra de sobra y no satura; los 8/12 Mbps de la ronda 2 solo
  tenian sentido cuando se pensaba que el bitrate era la causa raiz.
- **Limite adaptativo de bitrate**: el efectivo nunca debe superar
  `availableOutgoingBitrate`. Cada segundo (mismo intervalo que las
  estadisticas) se lee ese valor via `getAvailableOutgoingBitrate()` y
  se recorta `maxBitrate` a `min(preset, 85% de disponible)` con
  `capMaxBitrate()` — los presets de la UI son un **techo** deseado, no
  un valor fijo. Aviso en la UI si el bitrate enviado supera al
  disponible, o si el retraso de codificacion+envio pasa de ~20 ms.
- **fps de origen junto a los enviados** en la linea de estadisticas del
  emisor (`27→11`): hace evidente al instante que el encoder no llega,
  sin tener que pedir un volcado de `getStats()` a mano otra vez.
- **`contentHint`** configurable en la pista de video (`'motion'` para
  video en movimiento, `'detail'` para trabajo de escritorio, por
  defecto `'detail'`): pista para el encoder de que priorizar.

### Matriz de navegadores medida (2026-08-29)

| Emisor | Codec | Resultado |
|---|---|---|
| Chrome | VP8 | El que funciona: hasta 4.5 min reales sin cortes (ronda 2). A 2.5 Mbps/nativa, 11 fps y QP 106 por el coste de resolucion (ronda 3). |
| Chrome | H.264 | **Roto en origen**: ~3 fps, 0.0 Mbps — el codificador H.264 de Chrome en Apple Silicon no llega a producir nada utilizable. Si se elige igualmente, la UI avisa y recomienda VP8 (no bloquea). |
| Brave | VP8 o H.264 | **0.0 Mbps con los dos** — no llega a codificar nada, con ningun codec. La UI detecta Brave (`navigator.brave.isBrave()`) y avisa de que puede hacer falta desactivar los Shields para este sitio. |
| Safari | H.264 (unico que ofrece) | Capturaba a **media resolucion** (puntos logicos de macOS, no pixeles Retina) — sin querer, esto le daba el mejor resultado de fps/delay de toda la matriz (ver arriba). Se intenta pedir resolucion nativa via constraints `width`/`height` en `ideal` calculados con `devicePixelRatio`, sin garantia de que Safari lo honre — pendiente de confirmar en real. La UI avisa de la limitacion de resolucion y de que no captura audio de sistema (ver `docs/audio-source.md`). |

Ninguno de los tres avisos (Chrome+H.264, Brave, Safari) bloquea nada —
solo informan, porque son datos medidos sobre ESTA combinacion de
hardware (Apple Silicon) y no necesariamente universales.

## Ronda 4 — la conclusion de la ronda 3 estaba equivocada: no era la resolucion, era el tope que le habiamos puesto

Fran cerro la puerta de M0 (2026-08-29) con una corrida real: Chrome→LG,
VP8/libvpx, **resolucion nativa 3024×1964**, ~17.7 min de captura y
>15 min de conexion continua.

| Campo | Ronda 3 (2.5 Mbps, nativa) | Ronda 4 (sin tope bajo, nativa) |
|---|---|---|
| fps enviados / fuente | 11 / 27 | **26 / 26** |
| `qualityLimitationReason` | (implicito: bandwidth) | **`none`, los 1059 s completos** |
| `qualityLimitationResolutionChanges` | — | **0** |
| QP medio | 106 | **31** |
| Paquetes perdidos (video+audio) | — | **0** |
| PLI / NACK / FIR | — | **0 / 0 / 0** |
| RTT | — | **4 ms** |
| Retraso de codificacion | 19 ms (a 2.5 Mbps) / 83 ms (a 12 Mbps) | **11.7 ms** |
| Retraso de cola de envio | — | **1.25 ms** (al final de la corrida) |
| `availableOutgoingBitrate` | 5.8 Mbps | **53.5 Mbps** |
| Bitrate usado | 1.9–2.33 Mbps | **6.4 Mbps** |
| Latencia extremo a extremo | — | **210 ms** (metodo reloj, muestra unica — ver nota abajo) |

**La conclusion de la ronda 3 ("no era el bitrate, era la resolucion")
estaba mal — o mas precisamente, incompleta.** La resolucion nativa
Retina (5.9 Mpx/frame) **no es** un cuello de botella para libvpx en
este hardware: codificada sin restricciones, da 26 fps de 26 con QP 31
y sin ninguna limitacion reportada. Lo que de verdad pasaba en la ronda
3 era mas simple y mas evitable: **con el tope de bitrate en 2.5 Mbps,
libvpx tenia que comprimir 5.9 Mpx en muy poco caudal**, y ahi si
disparaba el QP a 106 y sacrificaba fps para poder mantener la
resolucion (`degradationPreference: "maintain-resolution"` hacia
exactamente lo que se le pedia — sacrificar framerate, no resolucion —
solo que el objetivo de bitrate era demasiado bajo para el trabajo que
tenia delante).

Hay ademas un efecto secundario que confundio el diagnostico en su
momento: **`availableOutgoingBitrate` solo estima hasta lo que
realmente se esta enviando** — no es una medida independiente de la
capacidad real de la red, es una estimacion basada en el trafico
observado. Con el bitrate topado en 2.5 Mbps, esa metrica marcaba
~5.8 Mbps disponibles; sin topar nada, la misma red (el mismo cable,
el mismo router) marca **53.5 Mbps**. No es que la red mejorara: es que
nunca se le habia dado la oportunidad de demostrar cuanto podia llevar
de verdad. Cualquier lectura de `availableOutgoingBitrate` hecha con un
`maxBitrate` bajo activo subestima la red por diseño de la propia
metrica — hay que tenerlo en cuenta la proxima vez que se diagnostique
algo por esta via.

No era la CPU (el encoder tenia margen de sobra, ronda 3 ya lo media
con `totalEncodeTime`). No era la red (53.5 Mbps disponibles, 4 ms de
RTT, cero paquetes perdidos). Era, literalmente, el numero que el
propio proyecto le habia puesto de techo — dos rondas seguidas
diagnosticando sintomas de una causa que no se cuestiono hasta tener
una corrida sin ese techo con la que comparar.

### ¿Sigue teniendo sentido 1080p por defecto?

**Propuesta, no decision** — la resolucion por defecto es una eleccion
de producto, no algo que el agente deba fijar por su cuenta:

Con esta medicion, la resolucion nativa ya no tiene ninguna desventaja
de calidad medida en esta LG concreta (26/26 fps, QP 31, sin
limitacion) contra un bitrate de 6.4 Mbps de los 53.5 disponibles —
sobra margen para subir el preset de calidad tambien si hiciera falta.
Argumentos a favor de subir el default a "nativa":
- Es la configuracion que efectivamente se midio en la corrida que
  cierra la puerta — cualquier otra cosa (1080p) es, de nuevo, una
  eleccion sin medir tras esta sesion.
- Mas nitidez real en la tele sin coste medido en esta maquina.

Argumentos para dejarlo en 1080p:
- La corrida se hizo en un Mac con GPU/CPU concretos; otro Mac mas
  modesto (o una ventana/pestaña en vez de pantalla completa a mayor
  resolucion aun) podria no tener el mismo margen de encoder.
  `qualityLimitationReason: none` en ESTA maquina no es una garantia
  universal.
- 1080p sigue siendo mas que suficiente para presentar/ver contenido
  (el caso de uso principal de kagami) y deja mas margen de red y CPU
  como colchon para condiciones peores (otra LAN, otro Mac, streaming
  simultaneo de audio).

Sin una segunda medicion en otro hardware, la recomendacion de este
documento es **mantener 1080p por defecto** y dejar "nativa"
seleccionable (como ya lo es) para quien quiera el maximo detalle a
sabiendas — pero es una recomendacion, la decision es de Fran.

## Relacion con la puerta de M0

**Puerta CUMPLIDA (2026-08-29), medida por Fran** — ver ROADMAP.md para
la tabla completa. Con el codec forzado (`docs/webrtc-codec.md`), la
resolucion fija y calculada, el bitrate adaptativo, y los avisos de
navegador puestos, la corrida de cierre dio 210 ms de latencia extremo
a extremo (objetivo ≤ 400 ms) y 15+ minutos sin un solo PLI.
