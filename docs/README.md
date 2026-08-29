# kagami — documentation

The main [README](../README.md) is the project's public face. Everything here
goes one level deeper: the reasoning and the real measurements behind
specific decisions — including the ones that turned out to be wrong.

> These documents are written in Spanish; only the main README is in
> English (see [`CODESTYLE.md`](../CODESTYLE.md) §1).

| Document | What it covers |
|---|---|
| [`spike-tv.md`](spike-tv.md) | The M-1 spike result: whether the TV's browser actually does WebRTC and range-request video at all. |
| [`spike-range.md`](spike-range.md) | Diagnosing whether the TV can seek a file served with HTTP range requests — the mechanism file casting depends on. |
| [`webrtc-codec.md`](webrtc-codec.md) | Why the TV needs H.264 or VP8 specifically, and why VP8 became the sender's default. |
| [`webrtc-quality.md`](webrtc-quality.md) | Fixing a hardware-decoder freeze: pinning resolution and bitrate from the first frame, plus automatic recovery. |
| [`screen-aspect.md`](screen-aspect.md) | Two real bugs in how aspect modes render on the TV, and why they only work with software-decoded video. |
| [`audio-source.md`](audio-source.md) | Why system-audio capture needs an explicit choice, and how to route it through BlackHole on macOS. |
| [`airplay.md`](airplay.md) | A documented proposal for an AirPlay receiver — not implemented. |

`media/` holds the screenshots referenced by the main README.
