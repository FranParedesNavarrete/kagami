# Fuente de audio: por que hace falta elegir, y como montar BlackHole

> `getDisplayMedia({ audio: true })` solo captura audio de **sistema**
> en navegadores basados en Chromium. Safari lo ignora por completo,
> Firefox no lo soporta, y en Linux depende del compositor. Sin esto,
> compartir desde Safari o Firefox sale sin sonido y sin ninguna
> explicacion — de ahi el selector de fuente de audio en la UI del
> emisor (`apps/web/src/lib/audioSource.ts`).

## Las tres opciones

1. **Audio del sistema** (`getDisplayMedia`) — solo se ofrece si el
   navegador la soporta de verdad (`supportsSystemAudioCapture()`:
   cualquiera menos Safari y Firefox). Es la opcion mas simple cuando
   funciona.
2. **Dispositivo de entrada** (`getUserMedia` + `enumerateDevices()`) —
   funciona en cualquier navegador, pero solo envia lo que ese
   dispositivo "oye". Para mandar audio de SISTEMA por esta via hace
   falta un dispositivo de audio virtual que reciba la salida del
   sistema como si fuera una entrada de microfono: **BlackHole** en
   macOS, **Loopback** (de rogue amoeba, de pago) tambien en macOS, o el
   **monitor de PulseAudio/Pipewire** en Linux (ya viene integrado, sin
   instalar nada).
3. **Sin audio** — para compartir solo imagen a proposito, o mientras
   no haga falta sonido.

En las dos vias con audio, las constraints llevan
`echoCancellation: false`, `noiseSuppression: false` y
`autoGainControl: false` (`RAW_AUDIO_CONSTRAINTS`). Es audio de sistema
— musica, un video, un juego — no una voz en videollamada: el AGC en
concreto es precisamente lo que sube y baja el volumen solo. Confirmado
con un volcado real de las constraints aplicadas: sin desactivarlo,
`echoReturnLoss` quedaba en -30, señal de que el procesado seguia activo
pese a pedir audio "en bruto".

## Montar BlackHole en macOS (para Safari, o para Chrome si se prefiere
esta via)

1. Instalar [BlackHole](https://existential.audio/blackhole/) (version
   de 2 canales basta). Es gratis y de codigo abierto.
2. Abrir **Audio MIDI Setup** (Configuracion de Audio MIDI, viene con
   macOS). Crear un **dispositivo de salida multiple** ("Multi-Output
   Device") que incluya a la vez BlackHole y los altavoces/auriculares
   reales — sin esto, seleccionar BlackHole como salida del sistema deja
   de oirse nada en directo mientras se comparte.
3. En **Preferencias del Sistema → Sonido → Salida**, elegir ese
   dispositivo multiple como salida por defecto.
4. En kagami, elegir **"Dispositivo de entrada"** como fuente de audio y
   seleccionar **BlackHole** en la lista — es lo que aparece como
   entrada de "microfono" aunque en realidad es la salida del sistema.
5. Al terminar de compartir, volver a elegir los altavoces/auriculares
   reales como salida por defecto (o dejar el dispositivo multiple
   puesto de forma permanente, funciona igual de bien).

## Linux

PulseAudio (y Pipewire con `pipewire-pulse`) ya expone un dispositivo
tipo `Monitor of <salida>` como entrada — no hace falta instalar nada.
En kagami, elegir "Dispositivo de entrada" y buscar el que empiece por
"Monitor of" en la lista.

## El selector solo lista entradas — el dispositivo de salida multiple no aparece ahi

El "Multi-Output Device" que se crea en Audio MIDI Setup es una salida,
no una entrada, y `enumerateDevices()` con `kind === 'audioinput'` nunca
puede devolverlo. Es esperado, no un fallo: el dispositivo multiple se
elige en Sonido → Salida (para que se siga oyendo en directo), y en
kagami se elige BlackHole 2ch (la entrada que ese dispositivo alimenta).

## Fix: permiso de microfono antes de enumerar (obligatorio, no opcional)

Sin permiso de microfono concedido en este sitio, `enumerateDevices()`
**no da una lista vacia**: da una unica entrada anonima por tipo de
dispositivo, con `deviceId` y `label` vacios. `apps/web/src/lib/
audioSource.ts` (`requestMicrophoneAccess`, `deriveAudioDeviceSelection`)
pide permiso con `getUserMedia({ audio: true })` desde el manejador de
clic del boton "Input device" — nunca desde un efecto — para no depender
de que el usuario abra la consola.

Diferencia real entre navegadores medida en esta sesion: **Chrome
recuerda el permiso concedido a un sitio y da los labels reales en
cargas siguientes sin volver a pedirlo**; **Safari no** — vuelve a
ocultar los `deviceId` en cada carga del documento, asi que sin este fix
Safari no puede usarse nunca sin abrir la consola y llamar a
`getUserMedia` a mano. La lista tambien se refresca sola al recibir el
evento `devicechange` (activar BlackHole repuebla la lista sin recargar)
y al volver a elegir "Input device" tras haber pasado por otro modo.

## El volumen del sistema no toca la señal que recibe la tele (medido, 2026-08-29, Fran)

Medido en el Mac con el dispositivo de salida múltiple activo: subir o
bajar el volumen del sistema no altera lo que se transmite. BlackHole
toma la señal antes de la etapa de volumen del sistema, así que el
nivel enviado es independiente del que suena por los altavoces. Esto
no es un fallo ni una limitación: es el funcionamiento normal de un
dispositivo de bucle, que copia la señal antes de que el sistema la
atenúe. Lo que sí controla el volumen de la retransmisión es el
control de la interfaz de kagami y el volumen del propio dispositivo
receptor.
