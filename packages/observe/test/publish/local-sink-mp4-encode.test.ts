import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createLocalSinkDriver } from "#pipeline/publish/sinks/local/driver.js";
import {
  createLocalSignalingHub,
  createLoopbackNetwork
} from "#pipeline/publish/sinks/local/signaling.js";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";

// The runtime capture stage decodes the source to RAW RGB24 frames; a browser `<video>` cannot decode those.
// `deliverAs: "mp4"` re-encodes the delivered frames into a single MP4 and streams the complete file over the
// data channel. This proves the bytes on the wire are a valid MP4 (not raw pixels, not a truncated header).

const WIDTH = 32;
const HEIGHT = 32;
const FRAME_BYTES = WIDTH * HEIGHT * 3;

const makeRgbFrame = (sequence: number): SinkDeliveryItem => {
  const data = new Uint8Array(FRAME_BYTES);
  // A shifting solid color so successive frames actually differ (gives the encoder real motion to encode).
  data.fill((sequence * 23) % 256);
  return {
    kind: "video",
    sinkId: "local-preview",
    trackId: "publish.video.rendered",
    role: "publish.video.rendered",
    sequence,
    epoch: 0,
    mediaTimeMs: sequence * 40,
    wallTimeMs: Date.now(),
    payloadBytes: data.byteLength,
    payload: { width: WIDTH, height: HEIGHT, data, byteFormat: "rgb", encoding: "raw", expectedFps: 25 }
  };
};

// A valid MP4 begins with an `ftyp` box: 4-byte size then the type tag "ftyp" at offset 4.
const startsWithMp4Ftyp = (bytes: Uint8Array): boolean =>
  bytes.byteLength > 12 &&
  bytes[4] === 0x66 &&
  bytes[5] === 0x74 &&
  bytes[6] === 0x79 &&
  bytes[7] === 0x70;

describe("local WebRTC sink — MP4 encode mode", () => {
  it("encodes delivered RGB frames into a complete MP4 streamed over the channel", async () => {
    const hub = createLocalSignalingHub();
    const network = createLoopbackNetwork();
    const received: Uint8Array[] = [];

    // Consumer side: answer the sink's offer and collect every delivered chunk. (The loopback channel's
    // close is local-only — unlike real WebRTC's SCTP close it does not propagate to the partner — so the
    // test asserts on the chunks delivered by the time the sink finalizes rather than on an onclose event.)
    const consumer = Effect.runPromise(
      Effect.gen(function* () {
        const offer = yield* hub.consumer.awaitOffer;
        const peer = network.factory();
        peer.ondatachannel = (event) => {
          event.channel.onmessage = (message) => {
            received.push(message.data);
          };
        };
        yield* Effect.promise(() => peer.setRemoteDescription(offer));
        const answer = yield* Effect.promise(() => peer.createAnswer());
        yield* hub.consumer.publishAnswer(answer);
      })
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createLocalSinkDriver();
          const attachment = yield* driver.attach({
            signaling: hub.sink,
            peerConnectionFactory: network.factory,
            deliverAs: "mp4",
            streamId: "test-market"
          });

          for (let sequence = 0; sequence < 12; sequence += 1) {
            yield* attachment.deliver(makeRgbFrame(sequence));
          }

          yield* attachment.finalize;
        })
      )
    );

    await consumer;
    // The sink streams + fully drains the channel inside finalize, so all chunks are delivered by now; one
    // more macrotask turn lets any trailing loopback microtask deliveries land before we assemble.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received.length).toBeGreaterThan(0);

    const total = received.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const assembled = new Uint8Array(total);
    let offset = 0;
    for (const chunk of received) {
      assembled.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // A real MP4 (ftyp + moov + encoded frames), not the raw pixels and not a truncated header.
    expect(startsWithMp4Ftyp(assembled)).toBe(true);
    expect(total).toBeGreaterThan(512);
  }, 20000);
});
