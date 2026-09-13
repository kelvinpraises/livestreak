# Local preview sink (real-time WebRTC media track)

Streams rendered video to a local peer over a WebRTC **media track** — real-time RTP, not a data channel.

- `driver.ts` — a `SinkDriver` (`mode: "local"`, id `local`) that mints a peer, adds an outbound video
  track (`addVideoTrack`), performs a local SDP handshake (it emits an offer carrying the video m-line; a
  consumer answers), and then pushes each decoded **I420** frame into the track as it arrives. No data
  channel, no encode-at-finalize — frames go out live over RTP and the viewer receives a `MediaStreamTrack`.
- `node-peer.ts` — the Node producer factory: wraps `@roamhq/wrtc`, implementing `addVideoTrack` via
  `nonstandard.RTCVideoSource` (+ `peer.addTrack`), pushing frames through `source.onFrame`.
- `signaling.ts` — the WebRTC abstractions (`RtcPeerConnectionLike`, the `addVideoTrack`/`ontrack` media
  seam, `RtcVideoFrame`/`RtcVideoTrackHandle`), the in-process `LocalSignalingHub` (the local SDP exchange),
  a signaling-only `createLoopbackNetwork()` peer for tests, and `resolveDefaultPeerFactory()` which wraps a
  real `RTCPeerConnection` when one is on the global scope.

The capture stage decodes the source directly to I420 (`yuv420p`) at native frame rate (ffmpeg `-re`) so
frames feed the track with no color conversion, paced at wall-clock FPS (see the file capture
`pixelFormat`/`realtime` config). Signaling is a **local in-process SDP exchange** (sink emits offer,
consumer answers); host-mediated signaling relays the same SDP cross-process.

See `test/publish/local-sink-track-delivery.test.ts` for the verify path: two `@roamhq/wrtc` peers exchange
a live video track in one process and assert frames arrive via an `RTCVideoSink`.
