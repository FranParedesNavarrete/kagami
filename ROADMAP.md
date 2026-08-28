# kagami — ROADMAP

> Deriva de SPECS.md v0.1. Cada milestone tiene una puerta: no se pasa al
> siguiente sin cumplirla. Lo marcado **[humano]** exige la tele real o a
> una persona delante — el agente lo deja sin marcar y lo dice en su
> informe, nunca lo simula.
>
> Contexto de red conocido (medido el 2026-08-28): la LG OLED, incluso por
> ethernet, muestra picos de latencia ICMP de ~700 ms cada pocos segundos
> con ~4% de perdida ocasional, y persisten tras desactivar los modos eco.
> Puede ser ICMP despriorizado (inofensivo para el video) o real. M-1
> existe para responder exactamente eso.

## M-1 · La tele decide (spike, sin app todavia)

- [ ] Servidor minimo (un fichero) que sirve `spike/` por HTTP plano en
      el puerto 7421 y hace de señalizacion WS para la prueba.
- [ ] Pagina receptora para la tele: muestra en grande el user agent de
      webOS y el resultado de cada prueba (verde/rojo, letra enorme).
- [ ] Pagina emisora para el Mac: genera un stream de prueba (canvas con
      reloj en ms) y lo manda por WebRTC.
- [ ] Pruebas que ejecuta la pagina de la tele:
      - [ ] WebSocket: conectar, eco, reconexion tras 30 s de pausa.
      - [ ] RTCPeerConnection recvonly con H.264.
      - [ ] RTCPeerConnection recvonly con VP8.
      - [ ] `<video>` reproduciendo un mp4 por HTTP con range requests
            (saltar a mitad debe funcionar).
      - [ ] Autoplay: ¿arranca el video sin toque, o exige interaccion?
      - [ ] Estabilidad 10 minutos: latencia percibida (reloj del emisor
            visible en la tele) y cortes contados. Esta prueba responde a
            si los picos ICMP afectan al video real o no.
- [ ] `docs/spike-tv.md` con la tabla de resultados y el user agent.
- [ ] **[humano]** Ejecutar el spike en la LG con Fran delante.

**Puerta**: WebRTC recvonly funciona en la tele y la estabilidad de 10
minutos es aceptable a ojo. Si WebRTC falla o tartamudea sin remedio, el
proyecto pivota a cast-only (o a receptor no-navegador) y SPECS se
actualiza ANTES de construir nada mas.

## M0 · Espejo de escritorio → tele

- [ ] Monorepo pnpm (`apps/server`, `apps/web`, `packages/shared`) segun
      CODESTYLE; mensajes de señalizacion tipados con zod en shared.
- [ ] Salas en memoria: codigo de 4 caracteres alfanumericos del alfabeto
      sin ambiguas `234679ACDEFGHJKMNPQRTUVWXYZ` (SPECS §6), un solo uso,
      caduca a los 10 min sin emparejar; emparejada no admite mas emisores.
- [ ] Señalizacion WS completa (join/offer/answer/ice/leave) con tests.
- [ ] Vista pantalla (HTTP plano, sin APIs de contexto seguro): codigo en
      grande + QR con la URL del emisor; video a pantalla completa al
      conectar; vuelve al codigo al cortar.
- [ ] Vista emisor (HTTPS): getDisplayMedia con seleccion de pantalla/
      ventana/pestaña; indicador de que se esta compartiendo y de si va
      audio; boton de cortar.
- [ ] Deteccion honesta de capacidades: en iOS, la vista emisor explica
      que no hay espejo de sistema y ofrece cast (M1).
- [ ] Sin STUN/TURN: solo candidatos host (LAN/tailnet).
- [ ] e2e Playwright: dos contextos (emisor con captura fingida via flags
      de Chromium, pantalla) contra el server real — sala, espejo, corte.
- [ ] Compose de produccion publicando SOLO en 127.0.0.1:7421 +
      documentacion de publicarlo con `casa app alta kagami 7421`.
- [ ] **[humano]** Puerta: 10 minutos de video espejado Mac→tele sin
      cortes, latencia medida ≤ 400 ms (metodo: reloj en ms en el emisor,
      foto a ambas pantallas, restar).

## M1 · Cast

- [ ] Cast de URL: el emisor pega un enlace (mp4/webm/HLS), la tele lo
      abre en su `<video>` nativo. Validacion de esquema http(s).
- [ ] Controles remotos desde el emisor via WS: play/pausa/salto/volumen,
      con estado reflejado (posicion actual visible en el emisor).
- [ ] Cast de fichero: subida en streaming al server (nunca en memoria),
      directorio temporal propio, `KAGAMI_CAST_MAX_MB` (defecto 4096),
      solo extensiones de video/imagen, servido con range requests SOLO a
      la sala que lo subio.
- [ ] Limpieza garantizada: al cerrar la sala y barrido a las 24 h; test
      que demuestra el borrado en ambos casos.
- [ ] Flujo iPhone: selector de fichero de Safari, progreso de subida,
      y poder bloquear el telefono sin que la tele se detenga.
- [ ] **[humano]** Puerta: cast de un mp4 de ~2 GB desde el iPhone con
      salto a mitad de pelicula, y verificacion del borrado posterior.

## M2 · Pulido y puesta en produccion

- [ ] Reconexion limpia: si la tele se duerme y vuelve, la sala se
      recupera o muere con mensaje claro (nunca pantalla colgada).
- [ ] Multi-pantalla: varias salas simultaneas, una por pantalla.
- [ ] UI apta para tele: tipografia enorme, alto contraste, nada que
      dependa de un raton en la vista pantalla.
- [ ] i18n completa en/es/pt con comprobacion en CI (como hibiki).
- [ ] Aviso de DRM en la UI del emisor (espejar Netflix y familia sale
      negro: limite del DRM, no bug).
- [ ] `LICENSE` con el texto MIT (decidido en SPECS §5) y cabecera de
      licencia en el README antes de hacer publico el repo.
- [ ] Tag v0.1.0. **[humano]** `sudo casa app alta kagami 7421` y probar
      desde el sofa.

## Reglas para el agente (las de siempre)

Commits incrementales con mensajes que citen el milestone. Lo que exige
tele real queda sin marcar y se dice en el informe — no se simula nunca.
Nada de mover tags publicados ni reescribir historia. Ninguna clave ni
endpoint inventado. Registro de sesion en `docs/registro.md`. Al terminar
cada milestone: HANDOFF.md estilo hibiki (estado real, mediciones,
desviaciones, deuda) para el traspaso.
