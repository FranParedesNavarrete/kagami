# M-1 · La tele decide — resultado del spike

> Deriva de ROADMAP.md M-1. Esta tabla la rellena quien ejecuta el spike en
> la LG real — el agente no la simula (CODESTYLE.md §4). Hasta que eso
> pase, esto es la plantilla + instrucciones de qué abrir y qué mirar.

## Qué está listo

Servidor Node de un fichero (`spike/server.mjs`) que sirve `spike/public/`
por HTTP plano en el puerto 7421 y hace de señalización WS (`/ws`) para las
seis pruebas. Verificado en local (Chromium headless, dos contextos
simulando tele+emisor con `--use-fake-device-for-media-stream`): las seis
pruebas automatizables pasan. Lo que sigue sin verificar es exactamente lo
que M-1 existe para responder: si el Chromium de webOS hace lo mismo.

## Cómo ejecutarlo

1. En el Mac, dentro de `spike/`:
   ```
   pnpm install        # solo la primera vez
   pnpm run start       # arranca en el puerto 7421
   ```
   (si `public/test-video.mp4` no existe, generarlo antes con
   `./scripts/gen-test-video.sh`, requiere ffmpeg).
2. Anotar la IP del Mac en la LAN (`ipconfig getifaddr en0` o similar).
3. **En la tele**: abrir `http://<ip-del-mac>:7421/` con el navegador de
   webOS. Debe aparecer el user agent en grande y empezar a correr las
   pruebas que no dependen del emisor (WebSocket, vídeo por rango,
   autoplay).
4. **En el Mac**: abrir `http://<ip-del-mac>:7421/sender` en una pestaña
   aparte. Pulsar "Run H.264 test", esperar a que la fila correspondiente
   en la tele se ponga verde (o roja), y solo entonces pulsar "Run VP8
   test". Lanzar los dos casi a la vez confunde la señalización de la
   prueba en curso — no es fallo real de la tele, es del propio spike.
5. En cuanto un codec conecta, la prueba de estabilidad arranca sola:
   dejar los diez minutos corriendo sin tocar nada y mirar el panel de
   detalle (fotogramas perdidos, RTT de WS, picos de RTT).
6. Rellenar la tabla de abajo con lo que la tele mostró.

## Resultado

**User agent de la tele**: _(pendiente — copiar el texto tal cual lo
muestra la pantalla)_

| # | Prueba | Resultado | Detalle |
|---|---|---|---|
| 1 | WebSocket: conectar + eco + reconexión (30 s) | ⬜ Pendiente [humano] | |
| 2 | RTCPeerConnection recvonly — H.264 | ⬜ Pendiente [humano] | |
| 3 | RTCPeerConnection recvonly — VP8 | ⬜ Pendiente [humano] | |
| 4 | `<video>` HTTP con range requests (salto a mitad) | ⬜ Pendiente [humano] | |
| 5 | Autoplay sin interacción | ⬜ Pendiente [humano] | |
| 6 | Estabilidad, 10 min conectado | ⬜ Pendiente [humano] | fotogramas perdidos: _, RTT WS avg/max: _, picos >200ms: _ |

## Veredicto de la puerta

_(pendiente — ver ROADMAP.md M-1: "WebRTC recvonly funciona en la tele y
la estabilidad de 10 minutos es aceptable a ojo". Si falla o tartamudea
sin remedio, SPECS.md se actualiza hacia cast-only ANTES de tocar M0.)_

## Notas para quien lo ejecute

- Si el navegador de webOS pide certificado o se queja de contexto
  inseguro solo para `RTCPeerConnection`/`<video>` (no debería, esa vista
  no usa `getDisplayMedia`), anotarlo aquí: es la señal de que el plan B
  de SPECS §4.4 (CA instalada o aviso aceptado) hace falta.
- Los picos ICMP de ~700 ms medidos el 2026-08-28 (ver ROADMAP.md,
  cabecera) son justo lo que la prueba 6 intenta correlacionar con cortes
  reales de vídeo — merece la pena anotar si coincide algún tartamudeo
  visible con un pico de RTT del WS en el panel.
