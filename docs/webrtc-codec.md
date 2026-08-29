# Hallazgo: la tele necesita H.264 o VP8, a la fuerza

> Deriva de la puerta de M0 (10 min de espejo Mac→tele), que fallo dos
> veces con síntomas distintos. Este documento es el porqué; la solución
> vive en `apps/web/src/lib/codec.ts`. Relacionado:
> `docs/webrtc-quality.md` (resolucion/bitrate — segunda causa, la que
> explica por que Safari se congelaba en vez de quedarse en negro).

## Las tres pruebas reales (2026-08-29)

| Navegador emisor | Modo | Resultado |
|---|---|---|
| Safari | Pantalla completa | Se ve ~30 s a baja resolucion; se congela justo al subir de calidad. No se recupera. |
| Safari | Una ventana | Igual, pero se congela antes (~10 s). |
| Chrome / Brave | Pantalla completa | El Mac dice que esta compartiendo correctamente. La tele muestra **negro total desde el primer segundo** — nunca llega a pintar nada. No se congela: nunca empezo. |

## Por que

M-1 (`docs/spike-tv.md`) ya midio que el Chromium de la LG **solo
decodifica H.264 y VP8**. Eso no cambio; lo que cambio es entender que
**el codec que se negocia depende del navegador emisor, no de lo que
pida la tele**, y por defecto:

- **Safari** solo ofrece H.264 para `getDisplayMedia` → por eso al menos
  se veia algo. El congelamiento posterior es un problema aparte (ver
  `docs/webrtc-quality.md`): el decodificador H.264 **por hardware** de
  la tele no digiere un cambio de resolucion a mitad de stream, y el
  arranque conservador de WebRTC (baja resolucion → sube a la real)
  provoca exactamente ese cambio.
- **Chrome y Brave prefieren VP9 (a veces AV1) para compartir pantalla**
  por defecto, sin que el emisor lo pida ni lo sepa. La tele no puede
  decodificar ninguno de los dos → pantalla negra. El emisor no tiene
  forma de detectarlo por si solo: su propio `RTCPeerConnection` reporta
  que todo va bien, porque desde su lado *va* todo bien — el problema es
  que codifica en un formato que el otro extremo no entiende.

Es la misma causa raiz para los dos sintomas: **no se estaba forzando
ningun codec**, pese a que SPECS.md §4.2 ya decia "preferir H.264 en el
emisor, VP8 como respaldo" desde el principio — quedo escrito como
intencion y nunca se implemento hasta ahora.

## Que se hizo (y una correccion el mismo dia)

`apps/web/src/lib/codec.ts` — `applyCodecPreferences(transceiver,
preference)`, llamado en `SenderView` antes de crear la oferta:

- Filtra `RTCRtpSender.getCapabilities("video").codecs` a **solo**
  H.264 y VP8 (mas rtx/red/ulpfec, que son infraestructura de
  retransmision/corrección de errores, no codecs de video en si) y se
  los pasa a `transceiver.setCodecPreferences()`. VP9, AV1 y cualquier
  otro **no aparecen en la lista en absoluto** — no es una
  reordenación con VP9 relegado al final, es una exclusión real: el
  emisor no puede terminar negociando algo que no esta en la lista.
- Si el navegador no ofrece ni H.264 ni VP8, lanza `UnsupportedCodecError`
  **antes** de crear la oferta. `SenderView` lo atrapa y muestra un
  mensaje claro (`sender.codecUnsupported`) en vez de dejar que la
  conexion se establezca y la tele se quede en negro sin explicacion.
- El emisor muestra el codec **realmente negociado** (leido de
  `RTCPeerConnection.getStats()`, no el que se pidio) de forma
  permanente en su UI mientras comparte — no solo con `?debug=1`. Es
  a proposito: este bug se diagnostico "a ciegas" la primera vez, y no
  tenia por que volver a pasar.

**Correccion el mismo dia**: el primer intento puso H.264 primero,
siguiendo la suposicion original de SPECS.md ("aceleracion por
hardware"). Eso invertia la evidencia real disponible en ese momento:
el unico emisor que negociaba H.264 (Safari) era el que se congelaba, y
Chrome con VP8 no se habia probado todavia sin forzar nada — la
suposicion nunca tuvo una corrida limpia a su favor. Cuando si se probo
(ver `docs/webrtc-quality.md`): **Chrome con VP8, 4.5 minutos reales,
sin cortes, sin cambios de resolucion, cero paquetes perdidos**. Se
invirtio el orden a **VP8 primero, H.264 de respaldo** — la
configuracion con prueba real, no la que sonaba mejor en teoria. Sigue
siendo `preference` configurable desde la UI del emisor (VP8 / H.264 /
automatico, VP8 por defecto) precisamente para poder confirmar por
medicion — no por suposicion, otra vez — si H.264 con resolucion fija
tambien acaba funcionando.

## Que sigue pendiente

La puerta de M0 (10 minutos de espejo real, latencia medida) **sigue
sin marcarse**: las tres pruebas de esta tabla son anteriores al fix de
codec, y la correccion de H.264→VP8 es posterior incluso a la primera
version del fix. Falta repetir los 10 minutos con `apps/web` actualizado
del todo: VP8 forzado por defecto y resolucion fija desde el primer
frame (ver `docs/webrtc-quality.md`) para lo que le tocaba a Safari. Si
se prueba H.264 desde el selector de la UI y tambien aguanta, vale la
pena anotarlo — pero solo si se mide, no antes.

Vale para M1/M2 y para cualquiera que use kagami con una tele con el
mismo perfil de decodificador (H.264/VP8 por hardware, nada mas): sin
forzar el codec en el emisor, el resultado observable no es "se ve mal"
— es "no se ve nada, y el emisor no se entera".

## Segundo hallazgo (2026-08-29): H.264 anula los modos de aspecto — no es un bug de CSS, es el plano de vídeo

Se investigo un reporte de que los cinco modos de aspecto habian dejado
de funcionar en la LG (ver `docs/screen-aspect.md` para la investigacion
completa por descarte: comparacion de DOM/estilos computados entre el
commit verificado y el actual, byte a byte identicos — no era el
codigo). Fran confirmo la causa real midiendo en la tele:

**Un televisor con decodificador H.264 por hardware no pinta el vídeo
decodificado en el mismo plano que el resto de la página web — lo pinta
en un plano de vídeo superpuesto (a veces llamado "video overlay" u
"overlay plane") que gestiona el propio escalador de hardware de la
tele.** Ese plano tiene su propio tamaño y posicion, calculados por el
firmware de la tele — no por el motor de layout del navegador. El CSS
de la pagina (`containerStyleForAspect`, `object-fit` en
`videoObjectFitForAspect`) sigue aplicandose sin error al elemento
`<video>` del DOM, pero ese elemento pasa a ser, a efectos visuales,
solo un hueco transparente que dice al firmware donde colocar el
overlay — el contenido real que se ve no pasa por ese layout en
absoluto.

**Por que solo `expanded` "funcionaba" a ojo**: el overlay de la tele,
por su cuenta y sin que la pagina se lo pida, escala el vídeo
decodificado para llenar toda la pantalla recortando lo que sobre —
exactamente el comportamiento de `expanded`
(`object-fit: cover` a pantalla completa). Coincidencia de
comportamiento, no de causa: el overlay ni sabe que existe un modo
`expanded`, simplemente su unico modo de escalado por defecto es "cubrir
la pantalla entera" — y ese es tambien el unico de los cinco modos de
kagami cuyo resultado visual coincide con lo que el overlay hace de
serie. Los otros cuatro (`auto`, `16:9`, `21:9`, `4:3`) piden geometrias
que el overlay de esta tele no ofrece, asi que no se ven nunca,
independientemente de lo que diga el CSS.

**Con VP8 el problema desaparece**: VP8 en esta tele se decodifica por
software (no tiene aceleracion de hardware para VP8), y un decodificador
por software pinta su resultado como contenido normal del `<canvas>`/
`<video>` del navegador, en el mismo plano de composicion que el resto
de la pagina — el CSS se aplica de verdad. **Medido**: forzando
`codecPref: "vp8"` en Safari, los cinco modos de aspecto dan la
geometria correcta en la LG.

**Como se distingue** (para cualquiera que vuelva a toparse con esto en
otra tele): si cambiar el modo de aspecto no cambia nada visualmente
salvo que el modo elegido sea el que "llena la pantalla recortando", es
señal de un plano de vídeo superpuesto por hardware — no busques el bug
en `aspect.ts` ni en `ScreenView.tsx`, comprueba primero el codec
negociado (visible siempre en la UI del emisor, `sender.codecLabel`).
Si es H.264 (o cualquier otro codec con decodificador por hardware en
esa tele en concreto), cambia a un codec sin aceleracion de hardware en
esa tele (VP8 aqui) y repite la prueba antes de sospechar de la capa de
CSS.

**Mitigacion implementada**: `codecPref` ya defaultea a `"vp8"`
(`DEFAULT_CODEC_PREFERENCE` en `codec.ts`) para cualquier sesion nueva
— no es un accidente de que "vp8" sea el primero en un objeto, es el
valor de fallback real de `loadCodecPreference()` y el parametro por
defecto de `applyCodecPreferences()`. El riesgo que queda es el modo
`"auto"` (util a proposito para poder medir si H.264 tambien acaba
funcionando, ver mas arriba): en `auto`, `applyCodecPreferences` sigue
excluyendo VP9/AV1 pero dentro de {H.264, VP8} respeta el orden nativo
del navegador — y el orden nativo de Safari para `getDisplayMedia`
aparentemente favorece H.264, que es exactamente el camino por el que
esta regresion aparecio (ver el código de `applyCodecPreferences` en
`codec.ts`: la rama `preference === "auto"` usa `allowed` tal cual, sin
reordenar). No se ha quitado la opcion `auto` ni `h264` del selector —
siguen siendo utiles para medir — pero ahora, mientras se comparte, la
UI del emisor avisa explicitamente en cuanto el codec negociado es
H.264: que los modos de aspecto no van a tener efecto visible y que
`expanded` es el unico comportamiento posible en una tele con
decodificador por hardware (`sender.h264AspectWarning`, junto al
diagnostico de codec que ya existia).

**Consecuencia para el cast (M1 parte 2, y bloqueante para diseñar la
parte 3)**: el cast de URL y el cast de fichero reproducen el contenido
en el `<video>` **nativo** de la tele, no vía WebRTC — y un vídeo
casteado (mp4/webm) casi siempre lleva H.264 (es el códec de vídeo más
común con diferencia en ficheros mp4 reales). Eso significa que el
mismo plano de vídeo superpuesto entra en juego **siempre que el
fichero casteado sea H.264**, sin que kagami tenga ningún control sobre
ello — no hay `setCodecPreferences` que aplicar a un `<video src=...>`
nativo, el códec lo decide el propio fichero. A diferencia del espejo
(donde SPECS.md §4.2 y este documento explican cómo forzar VP8), el
cast no tiene ningún equivalente: no existe manera de forzar el códec
de un fichero de vídeo ya codificado sin recodificarlo, y kagami no
recodifica nada (ver SPECS.md §4.3). Ver SPECS.md §7 para el límite tal
cual queda documentado.
