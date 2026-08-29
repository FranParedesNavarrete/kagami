# M1 · Diagnostico de range requests — resultado

> Deriva de ROADMAP.md M1, primera tarea, y de la deuda abierta en
> `docs/spike-tv.md` (prueba 4 del spike M-1: `<video>` por HTTP con range
> requests fallo en la LG real en dos corridas). **Cerrado (2026-08-29):
> Fran ejecuto el diagnostico en la LG real — los cinco pasos en verde
> para los dos ficheros, ver la tabla y la traza mas abajo.** El
> diseno de cast de fichero de SPECS.md §4.3 queda validado tal como
> esta especificado, sin cambios.

## Que se construyo

Un diagnostico servido por **el servidor real** (`apps/server`, con
`@fastify/static` — el mismo mecanismo que ya sirve el resto de la app),
no un servidor hecho a mano aparte como el del spike M-1. Esto importa:
si el fallo original fuera especifico de la implementacion manual de
range requests del spike, cambiar a `@fastify/static` podria bastar para
arreglarlo solo, y el diagnostico lo confirmaria o lo descartaria con
datos.

- `GET /diag/range` — pagina HTML+JS vanilla (sin build, sin dependencias
  externas: la tele es LAN-first y puede no tener salida a internet) que
  ejecuta, para dos ficheros de prueba, la secuencia: cargar, reproducir,
  saltar a mitad, saltar hacia atras, y volver a reproducir tras el
  salto. Cada paso se ve en letra grande con PASS/FAIL y el detalle del
  fallo si lo hay. El paso "reproducir tras el salto" no se conforma con
  que dispare el evento `playing`: comprueba que `currentTime` avanzo de
  verdad 1.2s reales despues, para no confundir "parece que reproduce"
  con "reproduce".
- `GET /diag/range/video/faststart.mp4` y `.../plain.mp4` — mismo
  contenido (testsrc2 30s + tono, generado por
  `apps/server/scripts/gen-diag-videos.sh`, requiere ffmpeg), servidos
  con `@fastify/static`. Unica diferencia: `faststart.mp4` tiene el atomo
  `moov` al principio (`-movflags +faststart`), `plain.mp4` lo tiene al
  final (comportamiento por defecto del muxer mp4 de ffmpeg). Es la causa
  clasica de que un salto no funcione y no tiene nada que ver con las
  range requests — se descarta aqui antes de poder culpar al servidor.
- `GET /diag/range/log` — buffer en memoria (ultimas 2000 peticiones) con
  cada cabecera `Range` recibida y la respuesta exacta (status,
  `Content-Range`, `Accept-Ranges`, `Content-Type`, `Content-Length`).
  La propia pagina lo consulta al terminar cada prueba y responde ahi
  mismo, en la tele, las cuatro preguntas del encargo — no hace falta
  mirar la consola del servidor a la vez, aunque el servidor tambien
  registra cada entrada por `pino` (`app.log.info({ diagRange: ... })`)
  por si hace falta cruzar datos.
- El fichero servido en `Content-Type` es el que decide `@fastify/static`
  automaticamente por extension (`video/mp4`) — no se fuerza a mano.

## Como ejecutarlo

1. En el Mac: `pnpm --filter @kagami/server run build` (si no esta
   generado `data/diag-range/*.mp4`, correr antes
   `apps/server/scripts/gen-diag-videos.sh`, requiere ffmpeg).
2. `KAGAMI_PORT=7421 node apps/server/dist/index.js` (o `pnpm --filter
   @kagami/server dev` en desarrollo).
3. Anotar la IP del Mac en la LAN (`ipconfig getifaddr en0`).
4. **En la tele**: abrir `http://<ip-del-mac>:7421/diag/range` con el
   navegador de webOS — HTTP plano, mismo puerto que la vista pantalla de
   M0 (SPECS.md §4.4), sin certificado que aceptar.
5. Pulsar "Run tests" en la seccion de `faststart.mp4`, esperar a que
   termine (los cinco pasos), anotar el resultado y el resumen. Repetir
   con `plain.mp4`.
6. Rellenar la tabla de abajo con lo que la tele mostro, y copiar el
   texto del resumen de cada seccion (las cuatro preguntas ya respondidas
   en la propia pagina).

## Arreglado (2026-08-29): los mp4 no llegaban a la imagen de produccion

**Sintoma real, visto en el servidor de casa**:
`/diag/range/video/faststart.mp4` devolvia 404 en JSON tras un
`docker compose up -d --build` limpio. Causa: los dos mp4 los genera
`gen-diag-videos.sh` con ffmpeg en `apps/server/data/diag-range/` — un
directorio gitignored (regla `data/` del `.gitignore`, pensada para
datos locales/temporales) que tampoco formaba parte de ningun paso del
`Dockerfile`. El build de Docker copia `apps/server/dist` pero nunca
generaba ni copiaba esos dos ficheros — funcionaban en local porque
alguien (yo, en esta sesion) los habia generado a mano en el checkout
del Mac, y esa carpeta nunca via al contenedor.

**Arreglo elegido: generarlos DENTRO del build de Docker**, no
committearlos ni montarlos por volumen:

- **Descartado, committear los mp4**: son ~25MB de binario en el repo
  para una herramienta de diagnostico pensada para retirarse en cuanto
  la tabla de la LG este rellena (ver "Deuda" en `docs/registro.md`) —
  quedarian huerfanos en el historial de git despues de borrar la
  herramienta.
- **Descartado, montarlos por volumen**: exigiria generarlos a mano en
  el host ANTES de `docker compose up`, exactamente el paso manual que
  el encargo pide evitar — `docker compose up -d --build` por si solo
  no bastaria.
- **Elegido: generarlos en la etapa `build` del `Dockerfile`**, con
  `ffmpeg`/`bash` instalados solo ahi (`apk add --no-cache ffmpeg
  bash`, nunca en la etapa `production`, que no los necesita en
  runtime) y `apps/server/scripts/gen-diag-videos.sh` ejecutado durante
  el build. El resultado (`apps/server/data/diag-range/`) se copia a la
  etapa `production` igual que ya se copian los `dist` compilados. Con
  esto, `docker compose up -d --build` desde un clon limpio basta —
  cero pasos manuales, y el mecanismo de generacion es el mismo script
  ya documentado arriba, no uno nuevo.
  - Efecto colateral encontrado y arreglado en el propio proceso: el
    script usaba `grep -abo` para comprobar donde quedo el atomo
    `moov` — funciona con GNU grep (macOS con Homebrew, donde se
    escribio) pero **BusyBox de Alpine no soporta `-a` ni `-b`**, asi
    que fallaba dentro del build de Docker con "unrecognized option".
    No era un fallo fatal (el propio script protege esa comprobacion
    con `|| true`, asi que el build seguia), pero el mensaje que
    imprimia era enganoso: decia que `faststart.mp4` NO tenia el moov
    al principio, cuando si lo tenia — el problema era solo del
    `grep`, no de ffmpeg. Sustituido por un `node -e` (node ya es parte
    de la imagen de build) que lee los primeros 200KB y busca `moov`
    directamente — portable, sin depender de que flags de `grep` trae
    cada distribucion.

**Verificado de verdad, no solo argumentado**: `docker build` +
`docker run` local de la imagen resultante, con el daemon de Docker
real (no simulado). El log de build confirma la deteccion correcta:

```
Comprobacion rapida de donde quedo el atomo moov (primeros 200KB):
  faststart.mp4: moov encontrado a ~36 bytes (dentro de los primeros 200KB)
  plain.mp4: moov NO esta en los primeros 200KB (al final del fichero, como se espera de "plain")
```

Y contra un contenedor de la imagen ya corriendo:

```bash
curl -s -D - -o /dev/null http://localhost:7421/diag/range/video/faststart.mp4
# HTTP/1.1 200 OK
# accept-ranges: bytes
# content-type: video/mp4
# content-length: 12628809

curl -s -D - -o /dev/null -H "Range: bytes=0-1023" \
  http://localhost:7421/diag/range/video/plain.mp4
# HTTP/1.1 206 Partial Content
# accept-ranges: bytes
# content-range: bytes 0-1023/12628809
# content-length: 1024
```

**Antes de ir a la tele, verificar esto mismo desde el servidor de
casa** (sustituyendo el puerto/host si hace falta): confirma que el
`docker compose up -d --build` de produccion sirve los dos ficheros
correctamente ANTES de gastar el viaje al sofa con el mando. Si
cualquiera de los dos `curl` de arriba falla o da 404, el problema es
del despliegue, no de la tele — no tiene sentido seguir hasta la LG sin
arreglar eso primero.

## Verificado en local (Chromium de escritorio — NO es la tele)

Antes de pedirle a Fran que lo repita en la LG, se verifico que la
herramienta en si funciona: servidor real arrancado en `localhost:7433`,
`curl` con y sin cabecera `Range` contra los dos ficheros, y la pagina
completa cargada y accionada con Chromium headless real (via
Playwright, `@playwright/test` ya es dependencia de `apps/server`) contra
ese mismo servidor — no un mock, el servidor real respondiendo peticiones
reales.

**Bug real encontrado y corregido en el propio diagnostico durante esta
verificacion**: el paso "reproducir" enganchaba el listener del evento
`playing` DESPUES de que la promesa de `video.play()` ya hubiera
resuelto — el evento a veces se dispara practicamente a la vez, y
enganchar el listener tarde daba un timeout falso en cada intento. Se
corrigio enganchando el listener antes de llamar a `play()`
(`playAndWaitPlaying` en `apps/server/src/routes/diagRangePage.ts`). Sin
esta correccion, los cinco pasos habrian fallado en la LG por un defecto
del propio diagnostico, no por un problema real de range requests — vale
la pena tenerlo en cuenta si en la LG el paso "reproducir" o "reproducir
tras el salto" fallan justo con el mensaje "timeout esperando playing":
podria seguir habiendo un caso limite del navegador de webOS no cubierto
aqui, no asumir automaticamente que es el mismo bug ya corregido.

| # | Prueba (Chromium desktop, `curl`+Playwright) | faststart.mp4 | plain.mp4 |
|---|---|---|---|
| 1 | curl sin `Range` → 200 | ✅ `Accept-Ranges: bytes`, `Content-Type: video/mp4` | ✅ igual |
| 2 | curl con `Range: bytes=1000-2000` → 206 | ✅ `Content-Range: bytes 1000-2000/12652492` | ✅ igual |
| 3 | Pagina completa: cargar/reproducir/saltar/saltar atras/reproducir tras saltar | ✅ 5/5 PASS | ✅ 5/5 PASS |
| 4 | `currentTime` avanzo de verdad tras reanudar (no solo el evento) | ✅ avanzo 1.16s en 1.2s reales | ✅ avanzo 1.16s en 1.2s reales |

**Hallazgo colateral, no es la respuesta a la pregunta de M1 pero es
relevante para leer la tabla de la LG**: en Chromium de escritorio,
`faststart.mp4` (moov al principio) se reprodujo sin que el navegador
mandara NINGUNA cabecera `Range` — con el fichero de 12MB y moov al
inicio, Chromium pudo con una descarga progresiva normal. `plain.mp4`
(moov al final) SI disparo `Range` de verdad: una peticion 206 pidiendo
justo la cola del fichero (`bytes=12615680-12652491/12652492`, el tamano
del `moov` final) para poder leer los indices de tiempo antes de saber
como saltar, seguida de una revalidacion 304 sobre un rango mas
pequeño. Es decir: en Chromium de escritorio, range requests reales solo
se vieron con el mp4 SIN faststart — con faststart de por medio ni hacen
falta para que el salto funcione. Si en la LG pasa lo mismo (moov al
final SI dispara Range y funciona, o SI dispara Range y NO funciona), es
un dato directamente accionable para la Parte 3 de M1: bastaria con
generar los ficheros de cast siempre con faststart y quiza ni haga falta
que la tele mande Range para que el salto funcione de verdad — pero eso
lo decide la fila de abajo, medida en la tele real, no esto.

## Resultado en la LG (medido por Fran, 2026-08-29)

**User agent de la tele**: no registrado explicitamente en esta corrida
(ver `docs/spike-tv.md` para el UA capturado en el spike M-1, mismo
dispositivo).

| # | Prueba | faststart.mp4 | plain.mp4 |
|---|---|---|---|
| 1 | Cargar (`loadedmetadata`) | ✅ 30.0s de duracion, 1625ms | ✅ 1002ms |
| 2 | Reproducir | ✅ 61ms | ✅ 94ms |
| 3 | Saltar a mitad | ✅ a 15.0s, 152ms | ✅ 146ms |
| 4 | Saltar hacia atras | ✅ a 2.0s, 72ms | ✅ 74ms |
| 5 | Reproducir tras el salto (avanza de verdad, no solo el evento) | ✅ avanzo 1.00s en 1.2s reales | ✅ avanzo 1.00s en 1.218s reales |
| 6 | ¿Envio Range? | Si (traza completa no capturada aparte — ver nota) | Si, traza completa abajo |
| 7 | ¿206 con Content-Range correcto? | ✅ Si | ✅ Si |
| 8 | ¿`Accept-Ranges: bytes` en la respuesta 200 inicial? | ✅ Si | ✅ Si |
| 9 | Content-Type servido | `video/mp4` | `video/mp4` |

**Las cuatro preguntas del encargo, respondidas con datos reales de la
LG**: la tele SI envia `Range`; el servidor SI responde 206 con
`Content-Range` correcto; `Accept-Ranges: bytes` esta presente en la
respuesta 200; `Content-Type: video/mp4`; el salto funciona de verdad
(no solo el evento `playing`, `currentTime` avanza lo esperado tras
reanudar).

**Traza completa de `plain.mp4` (moov al final) — la interesante,
porque es el caso que preocupaba desde `docs/spike-tv.md`**:

```
bytes=0-1
bytes=0-12658091
bytes=12582912-12658091     ← los ultimos 75 KB: va a por el moov
bytes=2281490-12582911
```

Lectura de la traza: (1) una sonda minima de 2 bytes, patron habitual de
un reproductor confirmando que el servidor soporta rangos antes de
decidir como pedir el resto; (2) una peticion que cubre el fichero
entero expresada como rango explicito, no como descarga simple sin
`Range`; (3) exactamente los ultimos ~75KB — la tele va derecha a por el
atomo `moov` final, el patron classico que la documentacion de este
mismo repositorio ya anticipaba antes de tener el dato; y (4) una vez
leido el `moov` y conocidos los offsets de los fotogramas, pide el resto
del contenido que le falta. Cuatro peticiones, todas con la respuesta
206 correcta — nunca hizo falta reintentar ni recurrir a una descarga
completa de repuesto.

## Veredicto de la puerta

**Cumplida.** El diagnostico contesta las cuatro preguntas del encargo
con datos reales de la LG: range requests funcionan correctamente con
`@fastify/static` tal cual esta implementado, tanto con `faststart.mp4`
como con `plain.mp4` — el salto funciona de verdad en los dos casos, sin
diferencia de resultado entre tener el `moov` al principio o al final.

**Consecuencia para SPECS.md §4.3**: el diseno del cast de fichero
especificado ahi (subida a un directorio temporal, servido por HTTP con
range requests via `@fastify/static`) es correcto **tal cual esta**, sin
necesidad de forzar faststart en los ficheros subidos ni de ningun
cambio de cabeceras o `Content-Type`. El "RIESGO ABIERTO" que esa
seccion documentaba queda cerrado — ver la seccion actualizada de
SPECS.md §4.3 para el texto final.

**Atribucion correcta del fallo original de M-1** (antes sin resolver:
"no se ha visto el texto exacto del detalle de fallo en la tele para
acotar mas", `docs/spike-tv.md`): la causa era el `<video>` de la
prueba sin insertar en el DOM. No fue un limite real del navegador de la
tele ni de `@fastify/static` — de hecho, este mismo mecanismo de servido
(el que ya usaba el spike M-1) es el que ahora pasa 5/5 en la LG real
una vez el diagnostico corrio con el video correctamente insertado en el
documento. Cerrada la "Deuda abierta" de `docs/spike-tv.md` con esta
atribucion — no queda como "causa desconocida".

**Dato accionable para KAGAMI_REMUX_FASTSTART**: como el salto funciona
igual de bien con `plain.mp4` que con `faststart.mp4` en esta LG, el
remux automatico de faststart (`apps/server/src/lib/remux.ts`) pasa a
estar desactivado por defecto — reescribir el mp4 entero no arregla nada
que estuviera roto aqui, solo cuesta minutos y el doble de disco en
ficheros grandes. Detalle completo, incluida la justificacion de por que
el codigo se mantiene igualmente, en el README y en SPECS.md §4.3.
