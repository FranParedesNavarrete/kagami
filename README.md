# kagami

Screen mirroring and casting for any TV with a browser. Self-hosted,
no cables, no store apps, no accounts.

kagami (鏡) means *mirror*. Open the web app on your TV, get a 4-character
code, enter it on your laptop or phone — and share your screen or cast a
video. The video travels peer-to-peer over your LAN; the server only
introduces the two devices.

## What it does

- **Mirror** — share your full screen, a window or a tab from any desktop
  browser (Chrome, Safari, Firefox, Edge) to the TV in real time.
- **Cast a URL** — paste a video link; the TV plays it natively at full
  quality, with remote play/pause/seek from your device.
- **Cast a file** — pick a video from your phone or computer; it streams
  to the TV even if you lock your phone. Files are stored temporarily on
  your server and deleted when the session ends.

## What it honestly does not do

- **No full-screen mirroring from iPhone/iPad.** iOS does not let any web
  page capture the system screen — that is AirPlay's exclusive. Use cast
  instead: for playing content it is actually better.
- **No DRM content.** Mirroring Netflix/Prime/Disney+ shows a black
  square. That is DRM working as designed, not a bug. Use the TV's own
  apps for those.
- **No internet relay.** kagami is LAN-first. For remote use, put it
  behind your VPN (it works over Tailscale out of the box).
- **No AirPlay receiver (yet).** A design proposal for kagami acting as
  an AirPlay receiver exists in `docs/airplay.md` — comparison of two
  architectures, no implementation, nothing verified.
- **Fullscreen on the TV view is not verified on real hardware yet.** It
  tries three fallbacks in order: `requestFullscreen()` (the standard
  path — expected to work on desktop and Android Chrome, not yet tested
  on webOS), `video.webkitEnterFullscreen()` on the `<video>` element
  itself (iOS Safari's only fullscreen entry point — not yet tested on a
  real iPhone/iPad), and a `display: standalone` manifest so "Add to Home
  Screen" opens without browser chrome (static config, not yet verified
  on a real device either). None of this is claimed to work until it has
  been checked on the actual TV and an actual phone.
- **Pasting a YouTube/Vimeo/Twitch link casts nothing.** Those are pages,
  not video files — kagami detects the known domains and says so instead
  of failing with a confusing "unsupported format" error. It does not,
  and will not, play those platforms itself; use the TV's own app.

## Requirements

- Docker on a home server.
- A TV (or any screen) with a web browser.
- For senders, HTTPS with a certificate their browser trusts — screen
  capture requires a secure context. A reverse proxy like Caddy with an
  internal CA works perfectly; the TV view runs over plain HTTP on the
  same port, so the TV needs no certificate at all.

## Quick start

```bash
git clone <repo> kagami && cd kagami
docker compose up -d
```

- TV: open `http://<server>:7421` → "Be the screen" → a code appears.
- Sender: open `https://kagami.your.domain` (behind your proxy), enter
  the code, share or cast.

Behind Caddy with the `casa` CLI: `sudo casa app alta kagami 7421`.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `KAGAMI_PORT` | `7421` | HTTP port (bind it to 127.0.0.1 behind a proxy) |
| `KAGAMI_CAST_MAX_MB` | `4096` | Max size of an uploaded cast file |
| `KAGAMI_REMUX_FASTSTART` | `false` | Re-mux an uploaded mp4 with the `moov` atom at the end before serving it |

That is the whole configuration. Rooms live in memory, files live in a
temp dir with guaranteed cleanup; there is no database.

`KAGAMI_REMUX_FASTSTART` is off by default because it isn't needed here:
measured against a real LG TV (2026-08-29, see `docs/spike-range.md`),
its browser resolves a trailing `moov` atom with a single range request
for the last ~75KB of the file, then seeks correctly — remuxing would
mean rewriting the whole file (minutes of wait and double the disk for
a multi-GB upload) to fix something that isn't broken on this TV. The
remux code and its tests stay in the codebase for receivers that do
need it; set this to `true` if yours turns out to be one of them.

## System audio on Safari and Firefox

`getDisplayMedia({ audio: true })` only captures system audio on
Chromium-based browsers. Safari ignores it entirely and Firefox doesn't
support it, so sharing from either comes out silent unless you route
system audio through an input device instead:

1. Install [BlackHole](https://existential.audio/blackhole/) (the 2ch
   build is enough).
2. In **Audio MIDI Setup** (macOS, ships with the OS), create a
   **Multi-Output Device** that includes both BlackHole and your real
   speakers/headphones — without this you go silent locally while
   sharing.
3. In **System Settings → Sound → Output**, pick that Multi-Output
   Device.
4. In kagami's sender view, choose **"Input device"** as the audio
   source and pick **BlackHole 2ch** from the list.

The Multi-Output Device does not appear, and cannot appear, in kagami's
selector — that selector lists audio *inputs*, and a Multi-Output
Device is an output. Also: the browser hides real device names until it
has granted microphone permission to the page at least once (Safari
asks again on every page load, Chrome remembers it) — kagami requests
that permission when you click "Input device", never silently.

## How it works

The server (Fastify + WebSocket) hosts the pages and relays the WebRTC
handshake between sender and screen. The media itself flows directly
between the two devices — on a LAN that means minimal latency and zero
load on the server. The one exception is file casting, where the server
holds the file temporarily so the TV can stream it natively with range
requests (which is what makes seeking work, and what makes it work from
an iPhone).

UI in English, Spanish and Portuguese.

## License

MIT. Use it, fork it, ship it.
