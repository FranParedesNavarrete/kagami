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

- TV: open `http://<server>:7421` → "Be a screen" → a code appears.
- Sender: open `https://kagami.your.domain` (behind your proxy), enter
  the code, share or cast.

Behind Caddy with the `casa` CLI: `sudo casa app alta kagami 7421`.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `KAGAMI_PORT` | `7421` | HTTP port (bind it to 127.0.0.1 behind a proxy) |
| `KAGAMI_CAST_MAX_MB` | `4096` | Max size of an uploaded cast file |

That is the whole configuration. Rooms live in memory, files live in a
temp dir with guaranteed cleanup; there is no database.

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
