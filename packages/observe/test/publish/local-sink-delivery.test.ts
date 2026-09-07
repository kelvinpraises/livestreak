import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { createLocalSinkDriver } from "#pipeline/publish/sinks/local/driver.js";
import {
  createLocalSignalingHub,
  createLoopbackNetwork
} from "#pipeline/publish/sinks/local/signaling.js";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";

const makeVideoItem = (sequence: number, bytes: Uint8Array): SinkDeliveryItem => ({
  kind: "video",
  sinkId: "local-preview",
  trackId: "publish.video.rendered",
  role: "publish.video.rendered",
  sequence,
  epoch: 0,
  mediaTimeMs: sequence * 40,
  wallTimeMs: Date.now(),
  payloadBytes: bytes.byteLength,
  payload: {
    width: 4,
    height: 4,
    data: bytes,
    byteFormat: "jpeg",
    expectedFps: 25
  }
});

describe("local WebRTC sink delivery", () => {
  it("delivers a video frame to a connected local peer over WebRTC", async () => {
    const hub = createLocalSignalingHub();
    const network = createLoopbackNetwork();
    const received: Uint8Array[] = [];
    let resolveFirstFrame!: () => void;
    const firstFrame = new Promise<void>((resolve) => {
      resolveFirstFrame = resolve;
    });

    // Consumer side: answer the sink's offer and collect delivered frames.
    const consumer = Effect.runPromise(
      Effect.gen(function* () {
        const offer = yield* hub.consumer.awaitOffer;
        const peer = network.factory();
        peer.ondatachannel = (event) => {
          event.channel.onmessage = (message) => {
            received.push(message.data);
            resolveFirstFrame();
          };
        };
        yield* Effect.promise(() => peer.setRemoteDescription(offer));
        const answer = yield* Effect.promise(() => peer.createAnswer());
        yield* hub.consumer.publishAnswer(answer);
      })
    );

    const frameBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    const health = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createLocalSinkDriver();
          const attachment = yield* driver.attach({
            signaling: hub.sink,
            peerConnectionFactory: network.factory
          });

          yield* attachment.deliver(makeVideoItem(0, frameBytes));
          yield* Effect.promise(() => firstFrame);
          return yield* attachment.health;
        })
      )
    );

    await consumer;

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(Array.from(received[0]!)).toEqual(Array.from(frameBytes));
    expect(health.deliveredItems).toBe(1);
    expect(health.status).toBe("running");
  });

  it("ignores marker deliveries without sending a frame", async () => {
    const hub = createLocalSignalingHub();
    const network = createLoopbackNetwork();

    const consumer = Effect.runPromise(
      Effect.gen(function* () {
        const offer = yield* hub.consumer.awaitOffer;
        const peer = network.factory();
        yield* Effect.promise(() => peer.setRemoteDescription(offer));
        const answer = yield* Effect.promise(() => peer.createAnswer());
        yield* hub.consumer.publishAnswer(answer);
      })
    );

    const deliveredItems = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createLocalSinkDriver();
          const attachment = yield* driver.attach({
            signaling: hub.sink,
            peerConnectionFactory: network.factory
          });

          yield* attachment.deliver({
            kind: "marker",
            sinkId: "local-preview",
            trackId: "publish.video.rendered",
            role: "publish.video.rendered",
            sequence: 0,
            epoch: 0,
            wallTimeMs: Date.now(),
            marker: { kind: "pause-start", wallClockMs: Date.now() }
          });

          const result = yield* attachment.finalize;
          return result.deliveredItems;
        })
      )
    );

    await consumer;
    expect(deliveredItems).toBe(0);
  });

  it("rejects a config without a signaling channel", async () => {
    const driver = createLocalSinkDriver();
    const exit = await Effect.runPromiseExit(
      driver.validate({ signaling: undefined as never })
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
