# Local preview sink (direct WebRTC delivery)

Delivers rendered video frames to a local peer over a WebRTC data channel.

- `driver.ts` — a `SinkDriver` (`mode: "local"`, id `local`) that mints a peer,
  creates a data channel, performs a local SDP handshake (it emits an offer; a
  consumer answers), and then forwards each rendered video frame's bytes over
  the channel.
- `signaling.ts` — the WebRTC abstractions (`RtcPeerConnectionLike`,
  `RtcDataChannelLike`), the in-process `LocalSignalingHub` (the local SDP
  exchange), an in-process `createLoopbackNetwork()` peer transport for tests,
  and `resolveDefaultPeerFactory()` which wraps a real `RTCPeerConnection` when
  one is on the global scope.

Signaling design choice: a **local in-process SDP exchange** (sink emits offer,
consumer answers) — the simplest thing a test peer can drive, fully
self-contained with no signaling server. Host-mediated signaling is a later
option. Frames are sent as the rendered payload bytes (jpeg/png/rgb); this is a
working local delivery + verify, not an SFU.

See `test/publish/local-sink-delivery.test.ts` for the verify path: a peer
connects and asserts at least one frame arrives.
