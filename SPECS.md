# kagami — SPECS v0.1

> Espejo y cast de pantalla entre dispositivos a través del navegador,
> autohospedado en el servidor de casa. Sin cables, sin apps de tienda,
> sin depender del sistema operativo de nadie.
>
> kagami (鏡) = espejo. Hermano de hibiki (響, eco).

---

## 1 · Qué es y qué problema resuelve

Una web servida desde el servidor (`https://kagami.example.com`) con dos papeles:
la **pantalla** (la tele u otro monitor, que abre la web y espera) y el
**emisor** (el Mac, el iPhone o cualquier dispositivo, que abre la misma
web y comparte). El caso que lo motiva: una LG OLED cuyo AirPlay no es
fiable, y ningunas ganas de comprar un cable HDMI de 3 metros.

Principio de diseño: **el servidor solo presenta; el vídeo no pasa por él**
siempre que sea posible. La señalización (quién habla con quién) va por
WebSocket al servidor; el vídeo viaja por WebRTC directamente del emisor a
la pantalla, que en una LAN significa latencia mínima y cero carga para el
server. La única excepción es el cast de ficheros (§4.3).

## 2 · Los dos modos

### Espejo (mirror)
El emisor captura su pantalla con `getDisplayMedia` y la transmite en vivo.
- **Desde Mac/PC (Chrome, Safari, Firefox, Edge): pantalla completa,
  ventana o pestaña.** Este es el modo estrella para el portátil.
- **Desde iPhone/iPad: NO existe espejo completo.** iOS no expone la
  captura de pantalla del sistema a ninguna web — eso es de AirPlay y
  punto. Como mucho, compartir la propia pestaña donde corre kagami.
  Documentado sin rodeos en la UI: al detectar iOS, la app ofrece cast y
  explica por qué no hay espejo.

### Cast
El emisor no comparte su pantalla: envía **contenido** para que la
pantalla lo reproduzca por sí misma, a calidad completa y con audio, sin
depender de la pantalla del emisor (puede hasta bloquear el teléfono).
- **Cast de URL**: pegar un enlace a un vídeo (mp4/webm/HLS accesible);
  la pantalla lo abre en su `<video>` nativo. Sin selector de modo de
  aspecto (siempre `contain`) — ver §7 para el porqué: no es una
  omisión, es que no tiene arreglo posible con vídeo H.264 nativo.
- **Cast de fichero**: elegir un vídeo/imagen local; ver §4.3.

  > **Implementado en M1 (2026-08-29) para cast de URL** — el cast de
  > fichero sigue bloqueado por §4.3. El bloqueo de teléfono sin cortar
  > la tele no es un efecto colateral que haya que mantener con cuidado:
  > es consecuencia directa de que el `<video>` de la pantalla reproduce
  > su propia copia desde la URL de origen, sin que el WS del emisor
  > tenga que seguir vivo — verificado con un test e2e que cierra del
  > todo el contexto del emisor y comprueba que la reproducción sigue.
  >
  > **Corrección posterior (2026-08-29, misma sesión de cast, parte E):**
  > este párrafo decía que el control remoto se perdía para siempre al
  > desconectarse el emisor, hasta un código nuevo. Eso quedó desmentido
  > a propósito el mismo día: era justo la deuda más importante que
  > dejaba esta implementación, porque bloquear el iPhone durante un
  > cast —la razón de ser del cast en primer lugar— disparaba
  > exactamente ese caso. Ver §6 para la regla real: durante un cast, el
  > mismo código reconecta y recupera el control con el estado real
  > durante una ventana de 30 minutos; solo si la pantalla se
  > desconecta, o si esa ventana expira sin reconectar, la sala muere de
  > verdad.

## 3 · Flujo de uso

1. En la tele: abrir la web → "Ser pantalla" → aparece un **código de
   sala** de 4 caracteres alfanuméricos en grande (y un QR con la URL
   del emisor).
2. En el emisor: abrir la web (o escanear el QR) → meter el código →
   elegir Espejo o Cast.
3. La conexión WebRTC se negocia vía el servidor y el vídeo empieza.
4. Cualquiera de los dos lados puede cortar; la pantalla vuelve al código.

Sin cuentas, sin registro: es la LAN de casa (o el tailnet). El código de
sala es la única llave, y muere al usarse o a los 10 minutos.

## 4 · Arquitectura

### 4.1 Piezas
- **apps/server**: Fastify + WebSocket. Sirve la SPA, gestiona salas y
  señalización (oferta/respuesta/ICE de WebRTC), y el endpoint de subida
  temporal del cast de ficheros. Estado en memoria: las salas son
  efímeras por diseño — un reinicio las borra y no pasa nada.
- **apps/web**: SPA (React + Vite + Tailwind + lucide). Tres vistas:
  pantalla, emisor, y "qué puede hacer tu dispositivo" (detección de
  capacidades honesta al entrar).
- Sin base de datos. Sin Redis. Un solo contenedor.

### 4.2 Red y WebRTC
- Solo LAN/tailnet: **sin STUN ni TURN** — los candidatos ICE de host
  bastan cuando emisor y pantalla se ven directamente. Si algún día
  hiciera falta fuera de casa, Tailscale ya resuelve el "fuera".
- Codecs: **VP8 en el emisor por defecto** (la tele lo decodifica bien,
  medido); H.264 disponible como respaldo para pantallas que no acepten
  VP8. VP9/AV1 excluidos del todo, nunca negociables.

  > **Implementado en M0 (2026-08-29), corregido el mismo día.** Esta
  > línea decía "preferir H.264 por aceleración hardware" desde v0.1,
  > sin forzarse nunca: `getDisplayMedia` en Chrome/Brave negocia VP9
  > (a veces AV1) por defecto para compartir pantalla, la LG no lo
  > decodifica, y el resultado medido en producción fue **pantalla
  > negra total, sin ningún aviso**. Se forzó con
  > `RTCRtpTransceiver.setCodecPreferences` en
  > `apps/web/src/lib/codec.ts`, y el primer intento puso **H.264
  > primero** siguiendo la suposición original de esta línea (aceleración
  > por hardware). Esa suposición quedó **desmentida por la medición en
  > esta LG concreta**, no solo sin confirmar: el único emisor que
  > negociaba H.264 (Safari) era el que se congelaba, mientras que Chrome
  > con VP8 corrió 4.5 minutos reales sin cortes, sin cambios de
  > resolución y sin pérdida de paquetes (`docs/webrtc-quality.md`). Se
  > invirtió el orden a VP8 primero — la configuración con prueba real,
  > no la que sonaba mejor en teoría — dejando H.264 como respaldo para
  > el día en que una pantalla distinta no acepte VP8. Es **configurable
  > desde la UI del emisor** (VP8 / H.264 / automático) para poder medir
  > en cualquier momento si H.264 con resolución fija (el fix de
  > `maintain-resolution`) también llega a funcionar, sin recompilar ni
  > redesplegar — la respuesta a esa pregunta sigue pendiente de
  > medición, no se da por buena ni por mala sin datos. Si el navegador
  > no ofrece ninguno de los dos, VP8 ni H.264, se rechaza compartir con
  > un mensaje en vez de dejar la tele en negro. Ver
  > `docs/webrtc-codec.md`.
- Audio del espejo: depende del navegador emisor (Chrome captura el audio
  de la pestaña; pantalla completa con audio varía por SO). La UI dice
  qué está capturando en cada momento. El cast siempre lleva audio.

### 4.3 Cast de ficheros: por el server, a propósito
Reproducir un fichero local del emisor en la tele tiene dos caminos:
capturar un `<video>` oculto y mandarlo por WebRTC (frágil en iOS), o
**subirlo temporalmente al server y que la tele lo reproduzca por HTTP
con range requests** (funciona desde cualquier dispositivo, la tele usa
su decodificador nativo, y pausar/saltar funciona de verdad). Elegimos
lo segundo. Reglas: los ficheros van a un directorio temporal propio,
se borran al cerrar la sala o a las 24 h como máximo, límite de tamaño
configurable (`KAGAMI_CAST_MAX_MB`, por defecto 4096), y nunca se listan
entre salas.

> **RIESGO ABIERTO (medido en el spike M-1, 2026-08-28):** la LG real NO
> sirvió correctamente el `<video>` por range requests — el test
> correspondiente falló en dos corridas contra `spike/server.mjs`
> (implementación de range requests casi idéntica a la que tendría
> `apps/server`), incluso después de corregir un problema de adjuntar el
> elemento al DOM que sí lo arreglaba en Chromium headless y WebKit de
> escritorio. No se determinó aún si la causa es el server (cabeceras,
> MIME), el propio Chromium de webOS, o algo intermedio (proxy/red). Toda
> esta sección asume que ese mecanismo funciona — **es exactamente la
> asunción que quedó desmentida**. M1 no debe empezar a construir sobre
> ella sin diagnosticar primero (ver ROADMAP.md M1, primera tarea); si no
> tiene arreglo, esta sección se replantea (alternativas: servir con un
> Content-Type/cabeceras distintas, probar sin range y aceptar que no se
> pueda saltar, o volver al camino WebRTC pese a su fragilidad en iOS).
>
> **Herramienta de diagnostico lista (2026-08-29), resultado en la LG aun
> sin medir.** `/diag/range`, servida por `apps/server` con
> `@fastify/static` (el mismo mecanismo que ya sirve el resto de la app,
> no un server hecho a mano aparte como el del spike M-1), sirve dos mp4
> identicos salvo por la posicion del atomo `moov` (`faststart.mp4` al
> principio, `plain.mp4` al final — la causa clasica de que un salto no
> funcione, a descartar antes de culpar al servidor) y registra cada
> cabecera `Range` recibida junto a la respuesta exacta. Verificado en
> local contra el servidor real con `curl` y con Chromium real (no un
> mock): `@fastify/static` responde 200 con `Accept-Ranges: bytes` y 206
> con `Content-Range` correcto en ambos ficheros, y la secuencia completa
> (cargar/reproducir/saltar/saltar atras/reproducir tras el salto, con
> verificacion real de que `currentTime` avanza y no solo de que el
> evento se dispara) pasa 5/5 en Chromium de escritorio. Dato colateral
> de esa verificacion, no concluyente para la LG: en Chromium de
> escritorio, `plain.mp4` SI disparo `Range` real (para leer el `moov`
> final) y `faststart.mp4` no necesito ninguna — ver `docs/spike-range.md`
> para el detalle y la tabla, que sigue en blanco para la fila de la LG.
>
> **RIESGO CERRADO (medido por Fran en la LG real, 2026-08-29).** Los
> cinco pasos pasan en verde para los DOS ficheros
> (`docs/spike-range.md` tiene la tabla completa y la traza de
> peticiones): la tele SI envia `Range`, el server SI responde 206 con
> `Content-Range` correcto, `Accept-Ranges: bytes` esta presente en el
> 200 inicial, `Content-Type: video/mp4`, y el salto funciona de verdad
> con `plain.mp4` exactamente igual que con `faststart.mp4` — la traza
> muestra a la tele pidiendo los ultimos ~75KB del fichero para leer el
> `moov` final y despues el resto del contenido, sin ningun reintento ni
> caida a descarga completa. **El diseno de esta seccion es correcto tal
> cual esta especificado**: no hace falta forzar faststart en los
> ficheros subidos, ni cambiar cabeceras, ni el `Content-Type`, ni
> replantear nada de lo anterior — la asuncion que el parrafo de arriba
> daba por desmentida queda, con datos reales, confirmada. Se deja el
> razonamiento anterior sin borrar porque documenta bien por que la duda
> era razonable con la informacion que habia entonces.
>
> **Causa real del fallo original del spike M-1, ahora atribuida
> correctamente** (antes: "no se determino aun si la causa es el
> server... el propio Chromium de webOS, o algo intermedio"): era el
> `<video>` de aquella prueba sin insertar correctamente en el DOM, no
> un limite de la tele ni del mecanismo de servido — ver
> `docs/spike-tv.md` (Deuda cerrada) y `docs/spike-range.md` para el
> detalle completo. `/diag/range` cumplio su funcion y se retira de
> produccion (`apps/server/src/app.ts`); el codigo se mantiene sin
> borrar por si hace falta reconstruirlo para otro televisor.
>
> **Consecuencia para el remux automatico de faststart**: como el salto
> funciona igual de bien con el `moov` al final que al principio en esta
> LG, `KAGAMI_REMUX_FASTSTART` (ver `packages/shared/src/schemas.ts`)
> pasa a estar desactivado por defecto — el codigo y los tests del remux
> se mantienen para receptores que si lo necesiten, pero no se ejecuta
> de serie por una tele que no lo necesita. Ver README.md.

### 4.4 TLS y el problema de la tele
`getDisplayMedia` exige contexto seguro → **los emisores entran por
HTTPS** (`https://kagami.example.com`, con una CA propia ya confiada en
Mac e iPhone). La tele es distinta: no confía en esa CA, pero su papel
no usa ninguna API que exija contexto seguro (solo `RTCPeerConnection` +
`<video>`), así que **la vista de pantalla se sirve también por HTTP
plano** en un puerto propio para esquivar el aviso de certificado.
Caddy publica ambos; el server es el mismo. Verificarlo en el navegador
de webOS es parte de la puerta de M-1 — si su Chromium exigiera HTTPS
para WebRTC, el plan B es instalar la CA en la tele o aceptar el aviso
una vez, y se documenta lo que resulte.

## 5 · Stack

Lo mismo que ya funciona en hibiki, sin piezas nuevas que aprender:
TypeScript, Node 22, pnpm monorepo (`apps/server`, `apps/web`,
`packages/shared` para los mensajes de señalización tipados con zod),
Fastify, React + Vite, Tailwind + lucide-react, Vitest + Playwright,
Biome. CODESTYLE.md de hibiki aplica entero (UI en inglés con i18n
en/es/pt, comentarios en español, camelCase, capas). Docker: un
contenedor, publicado en `127.0.0.1` y expuesto detrás de un reverse
proxy.

### Licencia
**MIT.** Es una herramienta pequeña y util; si le sirve a alguien mas,
mejor. Sin CLA ni copyleft: kagami no persigue comercializarse (esa
conversacion es de hibiki, no de aqui). El fichero `LICENSE` entra en el
repo desde el primer commit.

## 6 · Seguridad

- Nada escucha fuera de `127.0.0.1`; Caddy es la única puerta, como
  todo en el server.
- Código de sala: 4 caracteres alfanuméricos en mayúsculas, tomados de
  un alfabeto sin ambiguas visuales (sin O/0, I/1/L, S/5, B/8) porque se
  leen de lejos en una tele; un solo uso, caduca a los 10 minutos sin
  emparejar. Emparejada la sala, no admite más emisores. El alfabeto
  queda en 27 caracteres (`234679ACDEFGHJKMNPQRTUVWXYZ`): 531.441
  combinaciones, de sobra para una casa con salas que viven minutos.

  > **Excepción a proposito, implementada en M1 (2026-08-29): el cast no
  > sigue la misma regla que el espejo al desconectarse el emisor.** En
  > el espejo, el emisor ES la fuente del vídeo — que se vaya sigue
  > matando la sala entera, sin cambios. En el cast, el emisor es solo
  > un mando a distancia: el vídeo ya vive en la propia pantalla (una
  > URL externa o un fichero subido), así que perder al emisor —
  > exactamente lo que pasa al bloquear el iPhone, el flujo principal
  > de M1 — no tiene por qué apagar nada. Mientras la fase sea
  > "casting" y **la pantalla siga conectada**, la sala entra en un
  > estado de "pantalla sola" hasta 30 minutos (`SCREEN_ALONE_TTL_MS`),
  > durante el cual el **mismo código** puede reconectar y recuperar el
  > control — no un código nuevo, la sala no ha muerto. Al reconectar,
  > el server manda la posición/pausa/volumen reales (nunca datos
  > inventados). Si nadie reconecta a tiempo, o si es la **pantalla**
  > la que se desconecta (con o sin cast en marcha), la sala muere
  > igual que siempre — sin pantalla no hay dónde reproducir nada, ahí
  > no hay asimetría posible. Ver `apps/server/src/services/
  > roomService.ts` y `docs/registro.md` para el detalle.
- Subidas de cast: tamaño limitado, extensiones de vídeo/imagen
  solamente, directorio temporal aislado, borrado garantizado, y el
  server las sirve solo a la sala que las subió.
- Sin cuentas y sin datos personales: no hay nada que exportar ni
  proteger más allá del fichero temporal.

## 7 · Límites conocidos (honestidad por delante)

- **iPhone: sin espejo de sistema.** Límite de iOS, no de kagami. El
  cast lo cubre para el 90 % del caso real (ver contenido en la tele).
- **DRM: pantalla negra.** Espejar Netflix/Prime/Disney desde el
  navegador produce negro — el DRM bloquea la captura. No es un bug y
  la UI lo avisa. Para eso están las apps nativas de la tele.
- **El navegador de webOS manda.** Toda la viabilidad depende de lo que
  el Chromium de LG sepa hacer; por eso M-1 existe y va primero.
- **El decodificador de la tele es por hardware y no digiere cambios de
  resolución a mitad de stream.** Medido en Safari (unico navegador de
  Mac que si negociaba H.264 antes del fix de codec, ver §4.2 y
  `docs/webrtc-codec.md`): el arranque conservador de WebRTC (empieza a
  baja resolución, sube cuando estima que hay ancho de banda) provocaba
  un cambio de resolución a mitad de stream que congelaba la tele sin
  recuperación. Mitigado fijando resolución y bitrate desde el primer
  frame (`docs/webrtc-quality.md`), con recuperación automática
  (restart ICE, y si no basta, sala nueva) como red de seguridad.
- **Latencia del espejo**: objetivo ≤ 400 ms en LAN — sobra para ver
  contenido y presentar; no es para jugar.
- **Los modos de aspecto no funcionan con vídeo decodificado por
  hardware — y eso incluye TODO el cast, sin excepción.** Medido en la
  LG (2026-08-29, ver `docs/webrtc-codec.md`, "Segundo hallazgo"): un
  decodificador de vídeo por hardware (H.264 en esta tele) no pinta el
  fotograma en el árbol de render normal de la página — lo pinta en un
  plano de vídeo superpuesto que gestiona el propio escalador de
  hardware de la tele, con su tamaño y posición decididos por el
  firmware, no por el CSS. El `<video>` del DOM pasa a ser, a efectos
  visuales, solo un hueco que le dice al firmware dónde colocar el
  overlay — `object-fit` y el tamaño del contenedor dejan de tener
  efecto alguno. Por eso, a ojo, solo el modo `expanded` "funcionaba":
  el overlay por defecto de esta tele ya escala a pantalla completa
  recortando lo que sobra, que es justo lo que `expanded` pide — pura
  coincidencia de resultado, no de causa; los otros cuatro modos piden
  geometrías que el overlay no ofrece nunca.
  - **En el espejo** esto se evita entero: VP8 se decodifica por
    software en esta tele, así que se pinta en el plano normal de
    composición y el CSS vuelve a aplicarse. Por eso VP8 es el códec
    por defecto real de la UI (`DEFAULT_CODEC_PREFERENCE` en
    `apps/web/src/lib/codec.ts`) — no una casualidad de qué codec
    aparece primero en una lista. El emisor avisa explícitamente en
    cuanto el códec negociado es H.264 (elegido a mano, o vía el modo
    "automático" si el navegador emisor prefiere H.264 de forma
    nativa — el caso medido de Safari): que los modos de aspecto no
    tendrán efecto visible y que `expanded` es el único comportamiento
    posible en una tele con decodificador por hardware.
  - **En el cast, este límite no tiene solución posible, ni parcial.**
    El cast de URL y el cast de fichero (§4.3) reproducen el contenido
    en el `<video>` **nativo** de la tele, nunca vía WebRTC — no hay
    ningún `setCodecPreferences` que aplicar a un `<video src=...>`, el
    códec lo trae ya decidido el propio fichero de vídeo. Un mp4 o webm
    reales llevan casi siempre H.264, así que el plano de vídeo
    superpuesto entra en juego **siempre**, sin ninguna forma de
    evitarlo sin recodificar el vídeo — y kagami no recodifica nada
    (§4.3). **Conclusión de diseño, no bug pendiente de arreglar en
    ninguna versión futura**: el cast no ofrece selector de modo de
    aspecto (siempre se reproduce con `object-fit: contain`, sin
    recortar ni deformar nada) porque cualquier otro modo sería, en la
    inmensa mayoría de los vídeos casteados, indistinguible de no tener
    ningún efecto — y ofrecer un control que no hace nada es peor que
    no ofrecerlo. Esto debe darse por sentado al diseñar la Parte 3
    (cast de fichero): no añadir un selector de aspecto para cast sin
    releer este párrafo primero.

## 8 · Milestones y puertas

- **M-1 · La tele decide** (spike, sin app): página estática de prueba
  servida desde el server que la LG abre y que verifica: WebSocket,
  `RTCPeerConnection` recvonly con H.264 y con VP8, `<video>` por HTTP
  con range requests, y autoplay. Resultado en una tabla. *Puerta: si
  WebRTC no funciona en la tele, el proyecto pivota (¿cast-only?) antes
  de escribir la app.*
- **M0 · Espejo Mac → tele**: salas, código, señalización, espejo desde
  navegador de escritorio. *Puerta: 10 minutos de vídeo espejado sin
  cortes y latencia medida ≤ 400 ms.*
- **M1 · Cast**: URL + fichero con subida temporal, controles de
  reproducción (pausa/salto) desde el emisor. *Puerta: cast de un mp4 de
  2 GB desde el iPhone con salto a mitad, y borrado verificado.*
- **M2 · Pulido**: QR, i18n completa, reconexión limpia si la tele se
  duerme, multi-pantalla (una sala por pantalla), publicación detrás de
  un reverse proxy.
