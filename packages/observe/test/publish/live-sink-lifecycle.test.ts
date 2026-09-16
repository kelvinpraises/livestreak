import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";
import type { TimelineMarker } from "#pipeline/timeline/index.js";
import { createLiveSinkDriver, type Fmp4EncoderFactory } from "#pipeline/publish/sinks/live/driver.js";
import type { Fmp4Encoder } from "#pipeline/publish/encoder/fmp4.js";
import type { Fmp4IngestTransport } from "#pipeline/publish/sinks/live/transport.js";

/**
 * fMP4 live sink lifecycle against a FAKE transport + synthetic encoder (no ffmpeg). Asserts: the init
 * segment ships first, fragments ship in order, and an `eos` marker flushes the encode and ends the feed.
 */

const W = 320;
const H = 240;

const grayI420 = (): Uint8Array => {
  const frame = new Uint8Array((W * H * 3) / 2);
  frame.fill(128);
  return frame;
};

const makeI420Item = (sequence: number): SinkDeliveryItem => ({
  kind: "video",
  sinkId: "live-fmp4",
  trackId: "publish.video.rendered",
  role: "publish.video.rendered",
  sequence,
  epoch: 0,
  mediaTimeMs: sequence * 33,
  wallTimeMs: Date.now(),
  payloadBytes: grayI420().byteLength,
  payload: { data: grayI420(), width: W, height: H, byteFormat: "yuv420p", encoding: "raw", expectedFps: 30 }
});

const eosItem = (): SinkDeliveryItem => ({
  kind: "marker",
  sinkId: "live-fmp4",
  trackId: "publish.video.rendered",
  role: "publish.video.rendered",
  sequence: 999,
  epoch: 0,
  wallTimeMs: Date.now(),
  marker: { kind: "eos", wallClockMs: Date.now() } satisfies TimelineMarker
});

// A fake transport recording the exact send order.
const makeFakeTransport = (): {
  transport: Fmp4IngestTransport;
  log: string[];
  ended: { count: number; reason?: string };
} => {
  const log: string[] = [];
  const ended = { count: 0, reason: undefined as string | undefined };
  const transport: Fmp4IngestTransport = {
    sendInit: () => void log.push("init"),
    sendFragment: () => void log.push("fragment"),
    onError: () => {},
    end: (reason) =>
      Effect.sync(() => {
        ended.count += 1;
        ended.reason = reason;
      })
  };
  return { transport, log, ended };
};

// A synthetic encoder: on first frame emits init + a fragment; each subsequent frame emits a fragment; on
// finalize emits a trailing fragment (the drained tail). Drives the sink WITHOUT ffmpeg.
const syntheticEncoderFactory: Fmp4EncoderFactory = (config) =>
  Effect.sync(() => {
    let started = false;
    const encoder: Fmp4Encoder = {
      writeFrame: () =>
        Effect.sync(() => {
          if (!started) {
            started = true;
            config.onChunk({ kind: "init", data: new Uint8Array([1]) });
          }
          config.onChunk({ kind: "fragment", data: new Uint8Array([2]) });
        }),
      finalize: Effect.sync(() => {
        config.onChunk({ kind: "fragment", data: new Uint8Array([3]) });
      })
    };
    return encoder;
  });

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe("live fMP4 sink lifecycle", () => {
  it("ships init first, then fragments in order", async () => {
    const { transport, log } = makeFakeTransport();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: syntheticEncoderFactory
          }).attach({ transport, streamId: "s1" });
          yield* attachment.deliver(makeI420Item(0));
          yield* attachment.deliver(makeI420Item(1));
          yield* Effect.promise(tick); // let fire-and-forget sends flush
          yield* attachment.finalize;
          yield* Effect.promise(tick);
        })
      )
    );
    // init before any fragment; two frames + a drained tail fragment.
    expect(log[0]).toBe("init");
    expect(log.slice(1)).toEqual(["fragment", "fragment", "fragment"]);
  });

  it("flushes the encode and ends the feed on an eos marker", async () => {
    const { transport, log, ended } = makeFakeTransport();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: syntheticEncoderFactory
          }).attach({ transport, streamId: "s2" });
          yield* attachment.deliver(makeI420Item(0));
          yield* attachment.deliver(eosItem());
          yield* Effect.promise(tick);
        })
      )
    );
    expect(log[0]).toBe("init");
    expect(ended.count).toBe(1);
    expect(ended.reason).toBe("stream_ended");
  });

  it("rejects a non-I420 frame", async () => {
    const { transport } = makeFakeTransport();
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: syntheticEncoderFactory
          }).attach({ transport, streamId: "s3" });
          return yield* attachment
            .deliver({
              ...makeI420Item(0),
              payload: { data: grayI420(), width: W, height: H, byteFormat: "rgb", encoding: "raw", expectedFps: 30 }
            } as SinkDeliveryItem)
            .pipe(Effect.map(() => "ok"), Effect.catchAll(() => Effect.succeed("failed")));
        })
      )
    );
    expect(result).toBe("failed");
  });
});
