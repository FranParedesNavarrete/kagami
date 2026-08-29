# M-1 · La tele decide — resultado del spike

> Deriva de ROADMAP.md M-1. Esta tabla la rellena quien ejecuta el spike en
> la LG real — el agente no la simula (CODESTYLE.md §4). Hasta que eso
> pase, esto es la plantilla + instrucciones de qué abrir y qué mirar.

## Qué está listo

Servidor Node de un fichero (`spike/server.mjs`) que sirve `spike/public/`
por HTTP plano en el puerto 7421 y hace de señalización WS (`/ws`) para las
seis pruebas. Verificado primero en local (Chromium headless, dos contextos
simulando tele+emisor con `--use-fake-device-for-media-stream`), despues en
campo (Mac + iPhone), y finalmente en la LG real con Fran delante. Puerta
cumplida — ver veredicto abajo.

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
| 4 | `<video>` HTTP con range requests (salto a mitad) | ❌ Fail | sigue en rojo tras el fix de adjuntar el video al DOM (commit `1792b78`); mismo resultado en dos corridas. Ver "Deuda abierta" abajo — no bloquea esta puerta, sí a M1. |
| 5 | Autoplay sin interacción | ✅ Pass | |
| 6 | Estabilidad, 10 min conectado | ✅ Pass | Corrida 1: 3942/5871 fotogramas perdidos (67%), RTT WS avg/max 8/35ms, 0 picos. Corrida 2 (pestaña del emisor en primer plano): 3998/17427 (23%), RTT WS avg/max 8/37ms, 0 picos. Juicio a ojo de Fran: **"se ve perfecto no noto delay"**. |

**Nota sobre la prueba 6**: la señal de red (RTT del WS) es excelente y
sin picos en ambas corridas — descarta, para estas corridas, que los
picos ICMP de ~700ms (ver cabecera de ROADMAP.md) afecten al vídeo. Los
fotogramas perdidos varían mucho entre corridas (67% → 23%) y coinciden
con tener la pestaña del emisor en primer plano o no — apunta a
`requestAnimationFrame` throttled en segundo plano en el Mac, no a un
límite de la tele. Con la pestaña activa, el resultado se ve y siente
bien: veredicto a ojo de quien lo probó, sin tartamudeo perceptible.

## Veredicto de la puerta

**Cumplida.** WebRTC recvonly funciona en la tele con H.264 y VP8, y la
estabilidad de 10 minutos es aceptable a ojo (ver cita arriba). El
proyecto sigue adelante hacia M0 tal cual está en SPECS.md — no hace
falta pivotar a cast-only.

### Deuda cerrada (2026-08-29, ver `docs/spike-range.md`)

`<video>` por HTTP range requests fallaba en la tele en este spike (y
falló igual en el iPhone antes del fix de M-1), y el intento de fix de
adjuntar el video oculto al DOM (commit `1792b78`) no lo resolvió en su
momento — ver la fila 4 de la tabla de arriba. **Causa real, confirmada
por el diagnóstico dedicado de M1**: el `<video>` de esta prueba seguía
sin estar insertado de verdad en el árbol del documento de forma
correcta — no un límite del navegador de la tele ni de cómo el servidor
sirve range requests. La prueba: `/diag/range`
(`apps/server/src/routes/diagRange.ts`), que sirve los mismos ficheros
por el mismo `@fastify/static` que ya usaba este spike pero con el
`<video>` insertado correctamente en la página, pasó **5/5 en la LG
real** para los dos ficheros de prueba (con y sin faststart) — ver
`docs/spike-range.md` para la tabla completa y la traza de peticiones
`Range`. Queda descartado que hiciera falta ningún cambio de cabeceras,
`Content-Type`, ni el mecanismo de servido en sí: era, de principio a
fin, un defecto de cómo esta prueba concreta montaba el `<video>`, ya
corregido — no una "causa desconocida".

## Notas para quien lo ejecute

- Si el navegador de webOS pide certificado o se queja de contexto
  inseguro solo para `RTCPeerConnection`/`<video>` (no debería, esa vista
  no usa `getDisplayMedia`), anotarlo aquí: es la señal de que el plan B
  de SPECS §4.4 (CA instalada o aviso aceptado) hace falta.
- Los picos ICMP de ~700 ms medidos el 2026-08-28 (ver ROADMAP.md,
  cabecera) son justo lo que la prueba 6 intenta correlacionar con cortes
  reales de vídeo — merece la pena anotar si coincide algún tartamudeo
  visible con un pico de RTT del WS en el panel.
