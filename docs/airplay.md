# AirPlay receiver — propuesta (documentación, nada implementado)

> Deriva del encargo M1 parte G y del límite ya documentado en SPECS.md
> §7 ("iPhone: sin espejo de sistema" — límite de iOS, no de kagami: solo
> AirPlay puede capturar la pantalla del sistema en iOS, y kagami no lo
> implementa). Este documento propone dos formas de que el propio server
> de kagami actúe como receptor AirPlay, para que un iPhone pueda
> espejar de verdad en vez de recurrir siempre al cast de una URL o un
> fichero. **No hay código, no hay pasos de instalación, y nada de esto
> está probado.** Unos pasos que parecen oficiales sin haberse
> verificado son exactamente el tipo de mentira que este proyecto no
> comete — lo que sigue es una comparación de costes para que se decida
> con datos, no una guía.

## Por qué esto no es trivial

AirPlay es un protocolo cerrado de Apple. No hay soporte nativo en
Node/navegador para *recibir* una sesión AirPlay — hace falta un
proceso externo que hable el protocolo (RAOP + streaming de vídeo) y
haga de puente hacia lo que kagami ya sabe hacer. La pieza candidata es
**UxPlay** (open source, basado en el trabajo de inversión de ingeniería
de AirPlay de proyectos como `shairport-sync`/`RPiPlay`): un binario
que se anuncia por Bonjour/mDNS como receptor AirPlay, acepta la
conexión del iPhone, y decodifica el vídeo H.264 que este manda.
Cualquier alternativa (`RPiPlay` y similares) comparte la misma forma:
un proceso nativo aparte, no una librería de Node.

## Lo que las dos opciones comparten, y que rompe con SPECS.md §6

- **Bonjour/mDNS real en la LAN.** UxPlay tiene que anunciarse por
  multicast (UDP 5353) para que el iPhone lo vea en el selector de
  AirPlay — eso exige acceso a la interfaz de red real de la máquina
  donde corra, no solo a `127.0.0.1`.
- **El propio UxPlay tiene que escuchar en la interfaz de red real**
  (puertos RAOP/AirPlay, típicamente TCP 7000/7100 y un rango UDP para
  RTP), para que el iPhone le hable directamente. Esto **contradice
  frontalmente** la regla actual de SPECS.md §6 ("nada escucha fuera de
  `127.0.0.1`; Caddy es la única puerta"): UxPlay no puede vivir detrás
  de Caddy como el resto de kagami, porque el protocolo que habla no es
  HTTP. Cualquier versión de esto que se apruebe necesita una excepción
  explícita a esa regla, acotada al proceso de UxPlay y a los puertos
  que de verdad necesita — no una relajación general.
- **Dependencia de sistema nueva y no trivial.** UxPlay necesita
  compilarse o empaquetarse (no es un paquete de un solo binario
  disponible en los repos de Alpine, la base de la imagen Docker
  actual), con sus propias dependencias de vídeo (GStreamer). Esto es
  bastante más pesado que ffmpeg (ya asumido en M1 parte D) — hay que
  evaluar si compensa frente al beneficio.
- **El límite del plano de vídeo por hardware sigue intacto, en las dos
  opciones.** AirPlay manda H.264 (es lo único que un iPhone real
  transmite por este protocolo). SPECS.md §7 ya documenta, medido en la
  LG real, que un decodificador de vídeo por hardware pinta el
  fotograma en un plano superpuesto que el CSS de la página no controla
  — el mismo problema que ya afecta a todo el cast actual. Nada de lo
  que sigue lo evita: **si algún día se implementa AirPlay, los modos de
  aspecto tampoco funcionarán ahí**, por el mismo motivo exacto, no uno
  nuevo.

## Opción A — UxPlay → WebRTC

UxPlay decodifica el H.264 que manda el iPhone y, en vez de pintarlo en
una ventana local (su modo por defecto), se reenvía por WebRTC a la
pantalla — reusando el camino que ya existe para el espejo de
Mac/PC.

**Lo que hace falta:**
- Que **el propio server de kagami sea un peer WebRTC real** (hoy no lo
  es: WebRTC en kagami es siempre emisor↔pantalla, el server solo hace
  de señalización — SPECS.md §1, "el servidor solo presenta; el vídeo
  no pasa por él"). Esto exige una librería WebRTC nativa en Node
  (candidatas: `werift`, `node-webrtc`/`@roamhq/wrtc`, o directamente
  `mediasoup` si hiciera falta más control) para empaquetar el vídeo
  que sale de UxPlay como un stream WebRTC hacia la pantalla.
- Recodificar o reempaquetar el H.264 de UxPlay al formato que ese peer
  WebRTC necesite mandar — trabajo de CPU adicional en el server, no
  solo un pase de bytes.

**Costes reales:**
- **Rompe el principio de diseño central de SPECS.md §1** ("el server
  solo presenta"): aquí el server pasa a estar en la ruta del vídeo de
  verdad, con su propio coste de CPU por cada sesión de AirPlay activa
  — el mismo tipo de coste que kagami evita a propósito en todo lo
  demás.
- Cambio arquitectónico grande: una librería WebRTC nativa en Node no es
  una dependencia ligera (compilación nativa, superficie de fallos
  nueva), y "server como peer WebRTC" es una pieza que hoy no existe en
  ningún punto del código.
- A cambio, la latencia sería la más baja de las dos opciones —
  comparable al espejo de Mac/PC hoy (medido ≤400 ms en LAN, ver
  `docs/webrtc-quality.md`), aunque **sin medir para este caso
  concreto**: nada garantiza que UxPlay→reencapsulado WebRTC llegue a
  esa cifra sin probarlo.

## Opción B — UxPlay → HLS por el camino de cast que ya existe

UxPlay decodifica el H.264 del iPhone y lo vuelve a empaquetar como un
stream HLS (segmentos `.ts` + playlist `.m3u8`, generados con ffmpeg —
ya una dependencia de runtime desde M1 parte D). La pantalla lo
reproduce por el mecanismo de **cast** que ya existe (`<video>` nativo
con una URL servida por el server), no por el de espejo.

**Lo que hace falta:**
- ffmpeg generando segmentos HLS en tiempo real a partir de lo que
  entrega UxPlay (comando de shell adicional, con su propio manejo de
  proceso — parecido en espíritu al remux de faststart de M1 parte D,
  pero corriendo en continuo mientras dura la sesión de AirPlay, no una
  vez).
- Servir esos segmentos con el mismo `@fastify/static` que ya sirve el
  cast de ficheros, con una playlist que se actualiza mientras entran
  segmentos nuevos.
- El `<video>` de la pantalla necesita soporte HLS. Los navegadores
  basados en WebKit (Safari, y el propio Chromium de webOS si está
  basado en él) lo soportan de forma nativa; Chrome de escritorio no —
  irrelevante aquí porque el consumidor de este flujo es siempre la
  pantalla (la tele), nunca el emisor.

**Costes reales:**
- **No rompe nada de SPECS.md §1**: el vídeo sigue sin pasar por WebRTC
  del server, solo cambia qué HTTP estático sirve — mismo patrón que ya
  existe para el cast de ficheros, casi ninguna pieza nueva de
  arquitectura.
- Latencia de varios segundos (HLS segmenta y bufferea por diseño,
  típicamente 2-10s según el tamaño de segmento) — **inaceptable para
  presentar en vivo o para cualquier uso interactivo**, pero razonable
  para "ver contenido del iPhone en la tele", que es el caso de uso real
  que motiva todo el cast actual.
- Sigue exigiendo el proceso UxPlay con acceso de red real (ver arriba,
  el coste que comparten las dos opciones) y ffmpeg corriendo en
  continuo durante toda la sesión — coste de CPU no despreciable,
  aunque menor y más contenido que mantener un peer WebRTC completo.

## Comparación rápida

| | A: UxPlay → WebRTC | B: UxPlay → HLS |
|---|---|---|
| Latencia | Baja (sin medir), comparable al espejo | Segundos — solo vale para contenido, no para presentar |
| Rompe SPECS.md §1 (server solo presenta) | Sí, de raíz | No |
| Piezas nuevas | UxPlay + librería WebRTC nativa en Node + recodificación continua | UxPlay + ffmpeg en modo streaming HLS |
| Reusa código existente | Poco (nada de "server como peer" existe hoy) | Mucho (mismo `@fastify/static` que ya sirve cast de ficheros) |
| Excepción a "nada escucha fuera de 127.0.0.1" | Sí, para UxPlay | Sí, para UxPlay (igual) |
| Modos de aspecto en la tele | Siguen rotos (H.264, plano de hardware) | Siguen rotos (igual) |

## Lo que este documento NO decide

Ninguna de las dos opciones está aprobada ni descartada. Ambas exigen,
como mínimo, una excepción explícita a la regla de red de SPECS.md §6
que hoy no existe, y ninguna de las dos se ha probado ni siquiera en un
prototipo de un solo fichero. Si en algún momento se decide seguir
adelante, el primer paso honesto es un spike aislado (como el que ya
existe para range requests en `docs/spike-range.md`) que mida UxPlay
solo, sin integrarlo con nada de kagami todavía, antes de comprometerse
a ninguna de las dos arquitecturas de arriba.
