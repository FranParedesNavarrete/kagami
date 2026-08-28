# M-1 · La tele decide — resultado del spike

> Deriva de ROADMAP.md M-1. Esta tabla la rellena quien ejecuta el spike en
> la LG real — el agente no la simula (CODESTYLE.md §4). Hasta que eso
> pase, esto es la plantilla + instrucciones de qué abrir y qué mirar.

## Qué está listo

Servidor Node de un fichero (`spike/server.mjs`) que sirve `spike/public/`
por HTTP plano en el puerto 7421 y hace de señalización WS (`/ws`) para las
seis pruebas. Verificado primero en local (Chromium headless, dos contextos
simulando tele+emisor con `--use-fake-device-for-media-stream`) y despues
en campo (Mac + iPhone). Ejecutado ya en la LG real — ver resultados
abajo: cinco de seis pruebas en verde, falta cerrar el diagnostico de la
sexta y el juicio a ojo de la estabilidad.

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

**User agent de la tele**:
```
Mozilla/5.0 (Linux; NetCast; U) AppleWebKit/537.36 (KHTML, like Gecko)
Chrome/120.0.0.0 Safari/537.36 SmartTV/10.0 Colt/2.0
```
(El token "NetCast" es un resto legacy que LG mantiene en el UA incluso
en TVs webOS actuales — Chrome/120 confirma que el motor es un Chromium
razonablemente moderno, no el NetCast real de antes de 2014.)

| # | Prueba | Resultado | Detalle |
|---|---|---|---|
| 1 | WebSocket: conectar + eco + reconexión (30 s) | ✅ Pass | connect 17ms, reconnect+echo 5ms |
| 2 | RTCPeerConnection recvonly — H.264 | ✅ Pass | |
| 3 | RTCPeerConnection recvonly — VP8 | ✅ Pass | |
| 4 | `<video>` HTTP con range requests (salto a mitad) | ❌ Fail | sigue en rojo tras el fix de adjuntar el video al DOM (commit `1792b78`) — pendiente ver el texto exacto del detalle para diagnosticar mejor |
| 5 | Autoplay sin interacción | ✅ Pass | |
| 6 | Estabilidad, 10 min conectado | ✅ Pass (dato) / ⬜ Pendiente juicio a ojo | fotogramas perdidos: 3942/5871 (67%), RTT WS avg/max: 8ms/35ms, picos >200ms: 0 |

**Nota sobre la prueba 6**: la señal de red (RTT del WS) es excelente y
sin picos — contradice, para esta corrida, la hipótesis de que los picos
ICMP de ~700ms (ver cabecera de ROADMAP.md) afectan al vídeo. El 67% de
fotogramas perdidos es otra cosa: apunta a que el decodificador/renderer
de la tele no da abasto con el stream WebRTC, no a la red. Falta el
juicio a ojo (¿se vio fluido o iba a tirones?) para saber si es aceptable.

## Veredicto de la puerta

_(pendiente el juicio a ojo de la prueba 6 — ver arriba. El núcleo de la
puerta, "WebRTC recvonly funciona en la tele", está cumplido: H.264 y
VP8 conectan y hay vídeo. Lo que falta decidir es si el 67% de
fotogramas perdidos es "tartamudea sin remedio" o no.)_

## Notas para quien lo ejecute

- Si el navegador de webOS pide certificado o se queja de contexto
  inseguro solo para `RTCPeerConnection`/`<video>` (no debería, esa vista
  no usa `getDisplayMedia`), anotarlo aquí: es la señal de que el plan B
  de SPECS §4.4 (CA instalada o aviso aceptado) hace falta.
- Los picos ICMP de ~700 ms medidos el 2026-08-28 (ver ROADMAP.md,
  cabecera) son justo lo que la prueba 6 intenta correlacionar con cortes
  reales de vídeo — merece la pena anotar si coincide algún tartamudeo
  visible con un pico de RTT del WS en el panel.
