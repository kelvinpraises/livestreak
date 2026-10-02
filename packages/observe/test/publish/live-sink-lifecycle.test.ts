import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber } from "effect";
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
  it("owns an encoder when cancellation arrives during acquisition", async () => {
    const { transport } = makeFakeTransport();
    let finalized = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const encoderFactory: Fmp4EncoderFactory = () => Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(gate);
        return { writeFrame: () => Effect.void, finalize: Effect.sync(() => { finalized++; }) };
      });
      const attachment = yield* createLiveSinkDriver({ encoderFactory }).attach({ transport, streamId: "cancel-owned" });
      const delivery = yield* Effect.forkScoped(attachment.deliver(makeI420Item(0)));
      yield* Deferred.await(entered);
      const cancellation = yield* Effect.forkScoped(Fiber.interrupt(delivery));
      yield* Effect.yieldNow();
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(cancellation);
    })));
    expect(finalized).toBe(1);
  });

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

  it("normalizes RGBA through the shared boundary and pins the encoder layout", async () => {
    const seen: number[] = [];
    const recordingFactory: Fmp4EncoderFactory = () =>
      Effect.sync(() => ({
        writeFrame: (data: Uint8Array) =>
          Effect.sync(() => {
            seen.push(data.byteLength);
          }),
        finalize: Effect.void
      }));
    const rgba = new Uint8Array(W * H * 4);
    rgba.fill(200);
    const attempt = (payload: unknown): Promise<string> =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { transport } = makeFakeTransport();
            const attachment = yield* createLiveSinkDriver({
              encoderFactory: recordingFactory
            }).attach({ transport, streamId: "s4" });
            yield* attachment.deliver({ ...makeI420Item(0), payload } as SinkDeliveryItem);
            return "ok";
          })
        )
      ).then(
        () => "ok",
        () => "failed"
      );

    // RGBA normalizes to I420 bytes the encoder accepts.
    expect(await attempt({ data: rgba, width: W, height: H, byteFormat: "rgba", encoding: "raw", expectedFps: 30 })).toBe("ok");
    expect(seen).toEqual([(W * H * 3) / 2]);
    // Non-raw bytes are rejected even with a supported label.
    expect(await attempt({ data: rgba, width: W, height: H, byteFormat: "rgba", encoding: "jpeg", expectedFps: 30 })).toBe("failed");
  });

  it("rejects video after finalize without resurrecting the encoder", async () => {
    let creations = 0;
    let writes = 0;
    const countingFactory: Fmp4EncoderFactory = () =>
      Effect.sync(() => {
        creations += 1;
        return {
          writeFrame: () =>
            Effect.sync(() => {
              writes += 1;
            }),
          finalize: Effect.void
        };
      });
    // Empty finalize first: a later frame must fail and create nothing.
    const emptyResult = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { transport } = makeFakeTransport();
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: countingFactory
          }).attach({ transport, streamId: "s7" });
          yield* attachment.finalize;
          return yield* attachment.deliver(makeI420Item(0)).pipe(
            Effect.map(() => "ok"),
            Effect.catchAll(() => Effect.succeed("failed"))
          );
        })
      )
    );
    expect(emptyResult).toBe("failed");
    // Ordinary finalize after frames: the drained tail stays delivered, late video fails.
    const lateResult = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { transport } = makeFakeTransport();
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: countingFactory
          }).attach({ transport, streamId: "s8" });
          yield* attachment.deliver(makeI420Item(0));
          yield* attachment.deliver(eosItem());
          return yield* attachment.deliver(makeI420Item(1)).pipe(
            Effect.map(() => "ok"),
            Effect.catchAll(() => Effect.succeed("failed"))
          );
        })
      )
    );
    expect(lateResult).toBe("failed");
    // Exactly one encoder (the ordinary run); the empty run created none and wrote nothing.
    expect(creations).toBe(1);
    expect(writes).toBe(1);
  });

  it("rejects a same-byte-count dimension change and an FPS change mid-stream", async () => {
    // 480x160 I420 is exactly as many bytes as 320x240 — the encoder length check alone
    // would silently feed a different layout to the running encode.
    const otherShape = new Uint8Array((W * H * 3) / 2);
    const wide: Record<string, unknown> = { data: otherShape, width: 480, height: 160, byteFormat: "yuv420p", encoding: "raw", expectedFps: 30 };
    const fastFps: Record<string, unknown> = { data: grayI420(), width: W, height: H, byteFormat: "yuv420p", encoding: "raw", expectedFps: 60 };
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { transport } = makeFakeTransport();
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: syntheticEncoderFactory
          }).attach({ transport, streamId: "s5" });
          yield* attachment.deliver(makeI420Item(0));
          const shape = yield* attachment.deliver({ ...makeI420Item(1), payload: wide } as SinkDeliveryItem).pipe(
            Effect.map(() => "ok"),
            Effect.catchAll(() => Effect.succeed("failed"))
          );
          return shape;
        })
      )
    );
    expect(result).toBe("failed");
    const fpsResult = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { transport } = makeFakeTransport();
          const attachment = yield* createLiveSinkDriver({
            encoderFactory: syntheticEncoderFactory
          }).attach({ transport, streamId: "s6" });
          yield* attachment.deliver(makeI420Item(0));
          return yield* attachment.deliver({ ...makeI420Item(1), payload: fastFps } as SinkDeliveryItem).pipe(
            Effect.map(() => "ok"),
            Effect.catchAll(() => Effect.succeed("failed"))
          );
        })
      )
    );
    expect(fpsResult).toBe("failed");
  });
});
