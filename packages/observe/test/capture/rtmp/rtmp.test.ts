import { spawn } from "node:child_process";
import { Effect, Stream } from "effect";
import { expect, it } from "vitest";
import { createRtmpCaptureDriver } from "#pipeline/capture/rtmp/driver.js";

it("accepts standard FFmpeg RTMP with decoded video and stereo audio, then releases its port", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* createRtmpCaptureDriver().create({
          port: 48783,
          streamName: "proof",
          width: 320,
          height: 240,
          fps: 10,
          audio: true,
        });
        yield* Effect.sleep(500);
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(
              "ffmpeg",
              [
                "-hide_banner",
                "-loglevel",
                "error",
                "-re",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x240:rate=10",
                "-re",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=880:sample_rate=48000",
                "-t",
                "6",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-c:a",
                "aac",
                "-f",
                "flv",
                "rtmp://127.0.0.1:48783/live/proof",
              ],
              { stdio: "ignore" },
            ),
          ),
          (process) =>
            Effect.sync(() => {
              process.kill("SIGKILL");
            }),
        );
        const frames = yield* capture.frames.pipe(
          Stream.take(10),
          Stream.runCollect,
          Effect.timeout("12 seconds"),
        );
        expect(frames.length).toBe(10);
        const first = Array.from(frames)[0]!;
        expect(first.payload.data.length).toBe((320 * 240 * 3) / 2);
        expect(first.payload.audio?.data.length).toBe(4800 * 4);
        expect(first.payload.audio?.data.some((byte) => byte !== 0)).toBe(true);
        expect((yield* capture.live!.pause()).paused).toBe(true);
        yield* Effect.sleep(500);
        expect((yield* capture.live!.resume()).paused).toBe(false);
        const resumed = yield* capture.frames.pipe(
          Stream.take(3),
          Stream.runCollect,
          Effect.timeout("5 seconds"),
        );
        expect(Array.from(resumed)[0]!.cadence.sequence).toBeGreaterThan(
          Array.from(frames)[9]!.cadence.sequence!,
        );
        expect(Array.from(resumed)[0]!.cadence.droppedFrames).toBeGreaterThan(0);
      }),
    ),
  );
  await Effect.runPromise(
    Effect.scoped(
      createRtmpCaptureDriver()
        .create({
          port: 48783,
          streamName: "reuse",
          width: 320,
          height: 240,
          fps: 10,
          audio: false,
        })
        .pipe(Effect.tap(() => Effect.sleep(200))),
    ),
  );
}, 20000);

it("times out quiet input and incomplete handshakes, and releases the real socket", async () => {
  const { connect, createServer } = await import("node:net");
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* createRtmpCaptureDriver().create({
          port: 48784,
          streamName: "quiet",
          width: 16,
          height: 16,
          fps: 10,
          audio: false,
          startupTimeoutMs: 700,
        });
        yield* Effect.sleep(200);
        yield* Effect.acquireRelease(
          Effect.sync(() => connect(48784, "127.0.0.1")),
          (socket) => Effect.sync(() => socket.destroy()),
        );
        const result = yield* Effect.exit(Stream.runDrain(capture.frames));
        expect(result._tag).toBe("Failure");
        expect(String(result)).toContain("startup timed out");
      }),
    ).pipe(Effect.timeout("5 seconds")),
  );
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(48784, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});

it("discovers and configures RTMP through the same public family controls as file capture", async () => {
  const { buildControlCatalog } = await import("#run/control/catalog.js");
  const { createControlBus } = await import("#run/control/bus/index.js");
  const { createInitialBoard } = await import("#run/control/board/index.js");
  const { createObserveControlSurfaces } = await import("#run/control/surfaces.js");
  await Effect.runPromise(
    Effect.gen(function* () {
      const runId = "rtmp-public-config";
      const bus = yield* createControlBus({
        runId,
        board: createInitialBoard({ runId }),
        catalog: buildControlCatalog(),
        surfaces: createObserveControlSurfaces({}),
      });
      yield* bus.callFunction({
        runId,
        callId: "add",
        scope: "system:config:configure",
        payload: { title: "Standard RTMP", chain: "eip155:31337" },
      });
      const index = (yield* bus.readBoard()).cells["system:config"]!.readonly!
        .observations as Record<string, unknown>;
      const obsId = Object.keys(index)[0]!;
      yield* bus.callFunction({
        runId,
        callId: "kind",
        scope: "system:config:captureKind",
        payload: { obsId, kind: "rtmp" },
      });
      yield* bus.callFunction({
        runId,
        callId: "configure",
        cellId: `obs:${obsId}:capture`,
        scope: "capture:rtmp:configure",
        payload: {
          port: 48787,
          width: 320,
          height: 240,
          fps: 10,
          audio: false,
          smuggled: "not allowed",
        },
      });
      const cell = (yield* bus.readBoard()).cells[`obs:${obsId}:capture`]!;
      expect(cell.catalog).toBe("capture:rtmp");
      expect(cell.readonly?.publishUrl).toBe(`rtmp://127.0.0.1:48787/live/${obsId}`);
      expect(cell.settings?.source).toBe("rtmp");
      expect(cell.settings?.audio).toBe(false);
      expect(cell.settings?.smuggled).toBeUndefined();
    }),
  );
});
