import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";
import type { TimelineMarker } from "#pipeline/timeline/index.js";
import type { Fmp4Encoder } from "#pipeline/publish/encoder/fmp4.js";
import {
  createDirectSinkDriver,
  type DirectSinkDriverOptions,
  type ReachabilityProber
} from "#pipeline/publish/sinks/direct/driver.js";
import type { DirectViewerFrame } from "#pipeline/publish/sinks/direct/fanout.js";
import type { DirectServerFactory } from "#pipeline/publish/sinks/direct/transport.js";
import type { DirectSignalClient } from "#pipeline/publish/sinks/direct/signal.js";

/**
 * Direct sink lifecycle against fakes (no ffmpeg, no sockets, no router). Asserts the go-live gate
 * (unreachable/unverified fails attach and closes what was opened), the announce/withdraw signaling,
 * and the encode → fan-out flow to an admitted viewer.
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
  sinkId: "direct-fmp4",
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
  sinkId: "direct-fmp4",
  trackId: "publish.video.rendered",
  role: "publish.video.rendered",
  sequence: 999,
  epoch: 0,
  wallTimeMs: Date.now(),
  marker: { kind: "eos", wallClockMs: Date.now() } satisfies TimelineMarker
});

const syntheticEncoderFactory: DirectSinkDriverOptions["encoderFactory"] = (config) =>
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

interface Fakes {
  readonly options: DirectSinkDriverOptions;
  readonly serverClosed: { value: boolean };
  readonly probeClosed: { value: boolean };
  readonly announces: string[];
  readonly withdraws: string[];
  readonly viewerFrames: DirectViewerFrame[];
}

const makeFakes = (probe: {
  grade: "upnp" | "punch" | "unreachable";
  verified: boolean;
  ip?: string;
}): Fakes => {
  const serverClosed = { value: false };
  const probeClosed = { value: false };
  const announces: string[] = [];
  const withdraws: string[] = [];
  const viewerFrames: DirectViewerFrame[] = [];

  const serverFactory: DirectServerFactory = async (input) => {
    // Admit one fake viewer immediately so encode output has an observer.
    input.fanout.admit({
      id: "fake-viewer",
      write: async (frame) => void viewerFrames.push(frame),
      close: () => {}
    });
    return {
      port: input.port,
      close: async () => {
        serverClosed.value = true;
      }
    };
  };

  const prober: ReachabilityProber = async (input) => ({
    grade: probe.grade,
    ...(probe.ip === undefined ? {} : { publicIp: probe.ip, publicPort: input.port }),
    verified: probe.verified,
    detail: `fake ${probe.grade}`,
    close: async () => {
      probeClosed.value = true;
    }
  });

  const signal: DirectSignalClient = {
    verifyReachable: async () => probe.verified,
    announce: async (_streamId, watchUrl) => {
      announces.push(watchUrl);
      return { status: "ok", key: "announce-key-1" };
    },
    withdraw: async (streamId, key) => void withdraws.push(`${streamId}:${key}`)
  };

  return {
    options: {
      encoderFactory: syntheticEncoderFactory,
      serverFactory,
      prober,
      signalFactory: () => signal
    },
    serverClosed,
    probeClosed,
    announces,
    withdraws,
    viewerFrames
  };
};

const attachConfig = {
  streamId: "m1",
  hostBaseUrl: "http://127.0.0.1:8787",
  port: 48700,
  maxViewers: 3
};

describe("direct sink lifecycle", () => {
  it("gates go-live: unreachable fails attach and closes the server", async () => {
    const fakes = makeFakes({ grade: "unreachable", verified: false });
    const exit = await Effect.runPromiseExit(
      Effect.scoped(createDirectSinkDriver(fakes.options).attach(attachConfig))
    );
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("Not eligible to go live");
    expect(fakes.serverClosed.value).toBe(true);
    expect(fakes.announces).toEqual([]);
  });

  it("gates go-live: an open-looking door the host cannot dial back fails attach", async () => {
    const fakes = makeFakes({ grade: "upnp", verified: false, ip: "84.12.9.3" });
    const exit = await Effect.runPromiseExit(
      Effect.scoped(createDirectSinkDriver(fakes.options).attach(attachConfig))
    );
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("could not dial it back");
    expect(fakes.serverClosed.value).toBe(true);
    expect(fakes.probeClosed.value).toBe(true);
  });

  it("announces the public watch URL, streams init+fragments, withdraws on eos", async () => {
    const fakes = makeFakes({ grade: "upnp", verified: true, ip: "84.12.9.3" });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const attachment = yield* createDirectSinkDriver(fakes.options).attach(attachConfig);
          yield* attachment.deliver(makeI420Item(0));
          yield* attachment.deliver(makeI420Item(1));

          const health = yield* attachment.health;
          expect(health.status).toBe("running");
          expect(health.message).toContain("ws://84.12.9.3:48700/live/watch/m1");
          expect(health.message).toContain("[upnp]");
          expect(health.message).toContain("viewers=1/3");

          yield* attachment.deliver(eosItem());
        })
      )
    );

    expect(fakes.announces).toEqual(["ws://84.12.9.3:48700/live/watch/m1"]);
    // init first, then fragments in order, then the end signal.
    expect(fakes.viewerFrames[0]?.kind).toBe("init");
    expect(fakes.viewerFrames.at(-1)).toEqual({ kind: "end", reason: "stream_ended" });
    // The withdraw carries the announce ownership key minted at attach.
    expect(fakes.withdraws).toEqual(["m1:announce-key-1"]);
    expect(fakes.serverClosed.value).toBe(true);
    expect(fakes.probeClosed.value).toBe(true);
  });

  it("gates go-live: an announce CONFLICT fails attach (another broadcaster owns the stream)", async () => {
    const fakes = makeFakes({ grade: "upnp", verified: true, ip: "84.12.9.3" });
    const conflictSignal: DirectSignalClient = {
      verifyReachable: async () => true,
      announce: async () => ({ status: "conflict" }),
      withdraw: async () => {}
    };
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        createDirectSinkDriver({ ...fakes.options, signalFactory: () => conflictSignal }).attach(attachConfig)
      )
    );
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("already announced by another broadcaster");
    expect(fakes.serverClosed.value).toBe(true);
    expect(fakes.probeClosed.value).toBe(true);
  });

  it("serves the local network without probing in lan mode", async () => {
    const fakes = makeFakes({ grade: "unreachable", verified: false });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const attachment = yield* createDirectSinkDriver(fakes.options).attach({
            ...attachConfig,
            reachability: "lan"
          });
          const health = yield* attachment.health;
          expect(health.message).toContain("[lan]");
          yield* attachment.finalize;
        })
      )
    );
    // lan mode still announces (viewers on the same network resolve through the host) but never probes.
    expect(fakes.announces).toHaveLength(1);
    expect(fakes.probeClosed.value).toBe(false);
  });

  it("requires hostBaseUrl unless lan mode is explicit", async () => {
    const driver = createDirectSinkDriver();
    const bad = await Effect.runPromiseExit(driver.validate({ streamId: "m1" }));
    expect(bad._tag).toBe("Failure");
    const lan = await Effect.runPromiseExit(driver.validate({ streamId: "m1", reachability: "lan" }));
    expect(lan._tag).toBe("Success");
  });
});
