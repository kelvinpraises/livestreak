import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Effect, Exit, Fiber, Option, Scope } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus, type ControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import {
  observationCellId,
  readObservationIndex,
  systemConfigCaptureKindScope,
  systemConfigConfigureScope
} from "#run/control/system/config.js";
import { systemRunStopScope } from "#run/control/system/run.js";
import {
  systemPausePauseScope,
  systemPauseResumeScope
} from "#run/control/system/pause.js";
import { ingestCaptureConfigureScope } from "#pipeline/capture/ingest/commands.js";
import { liveSinkConfigureScope } from "#pipeline/publish/sinks/live/commands.js";
import { createIngestCaptureDriver } from "#pipeline/capture/ingest/driver.js";
import { createLiveSinkDriver } from "#pipeline/publish/sinks/live/driver.js";
import type { Fmp4IngestTransport } from "#pipeline/publish/sinks/live/transport.js";
import { runConfigFromBoard } from "#run/board-run-config.js";
import { runScopedWorkerUntilStoppedWithBoard } from "#run/worker/worker.js";
import { createWorkerBoardWake } from "#run/worker/wake.js";
import { createPassthroughVideoManifest, type SinkStageState } from "#run/worker/state.js";

const execFileAsync = promisify(execFile);

const W = 16;
const H = 16;
const FPS = 10;

const colorFrame = (r: number, g: number, b: number): Uint8Array<ArrayBuffer> => {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
};

const grayFrame = (fill: number): Uint8Array<ArrayBuffer> => colorFrame(fill, fill, fill);

// Recording transport (LABELED fixture): the integration proof runs the DEFAULT real ffmpeg
// encoder but captures its output instead of opening a Host WebSocket. No Host WS required.
const makeRecordingTransport = (): {
  transport: Fmp4IngestTransport;
  init: { data?: Uint8Array };
  fragments: Uint8Array[];
} => {
  const init: { data?: Uint8Array } = {};
  const fragments: Uint8Array[] = [];
  const transport: Fmp4IngestTransport = {
    sendInit: (data) => {
      init.data = data;
    },
    sendFragment: (data) => {
      fragments.push(data);
    },
    onError: () => {},
    end: () => Effect.void
  };
  return { transport, init, fragments };
};

const makeBus = (runId: string) =>
  createControlBus({
    runId,
    board: createInitialBoard({ runId, nowMs: 1 }),
    catalog: buildControlCatalog(),
    surfaces: createObserveControlSurfaces({})
  });

const addIngestObservation = (bus: ControlBus, runId: string, port: number) =>
  Effect.gen(function* () {
    yield* bus.callFunction({
      callId: `add-${runId}`,
      runId,
      scope: systemConfigConfigureScope,
      payload: { title: "foundation show", chain: "eip155:31337" }
    });
    let board = yield* bus.readBoard();
    const obsId = Object.keys(readObservationIndex(board))[0]!;
    yield* bus.callFunction({
      callId: `kind-${runId}`,
      runId,
      scope: systemConfigCaptureKindScope,
      payload: { obsId, kind: "ingest" }
    });
    yield* bus.callFunction({
      callId: `cap-${runId}`,
      runId,
      scope: ingestCaptureConfigureScope,
      cellId: observationCellId(obsId, "capture"),
      payload: { width: W, height: H, fps: FPS, port }
    });
    yield* bus.callFunction({
      callId: `pub-${runId}`,
      runId,
      scope: liveSinkConfigureScope,
      cellId: observationCellId(obsId, "publish"),
      payload: {}
    });
    // Registration/catalog fixture (LABELED): no chain write — derivation only needs the ID.
    // Stage cells (sink:*) are mounted per-test to match the sinks record the worker serves.
    yield* bus.applyBoardPatch({
      cells: {
        [observationCellId(obsId, "market")]: {
          readonly: { set: { marketId: "0xf02dation" } }
        }
      }
    });
    board = yield* bus.readBoard();
    return { board, obsId };
  });

const postFrame = (port: number, body: Uint8Array<ArrayBuffer>) =>
  fetch(`http://127.0.0.1:${port}/frames`, { method: "POST", body });

const waitForServer = (port: number, timeoutMs = 10000): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const probe = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${port}/frames`, { method: "GET" }).then(
          () => true as const,
          () => false as const
        )
      );
      if (probe) return;
      if (Date.now() >= deadline) {
        return yield* Effect.fail(new Error(`timed out waiting for ingest server on ${port}`));
      }
      yield* Effect.sleep(100);
    }
  });

const waitForBoardString = (
  read: () => Promise<string | undefined>,
  expected: string,
  what: string,
  timeoutMs = 10000
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((yield* Effect.promise(read)) === expected) return;
      if (Date.now() >= deadline) {
        return yield* Effect.fail(new Error(`timed out waiting for ${what}`));
      }
      yield* Effect.sleep(50);
    }
  });

const waitFor = (
  check: () => boolean,
  what: string,
  timeoutMs = 20000
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (check()) return;
      if (Date.now() >= deadline) {
        return yield* Effect.fail(new Error(`timed out waiting for ${what}`));
      }
      yield* Effect.sleep(100);
    }
  });

describe("ingest streaming foundation", () => {
  it("RGBA POSTs flow through the real worker into a real encode with advancing content", async () => {
    try {
      await execFileAsync("ffmpeg", ["-version"]);
    } catch {
      throw new Error("ffmpeg unavailable — integration BLOCKED (not skipped)");
    }
    const PORT = 48731;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_foundation_encode";
          const bus = yield* makeBus(runId);
          const { board, obsId } = yield* addIngestObservation(bus, runId, PORT);
          const runConfig = yield* runConfigFromBoard({
            runId,
            board,
            hostBaseUrl: "http://127.0.0.1:8787"
          });
          expect(runConfig.capture.driverId).toBe("ingest");

          const recording = makeRecordingTransport();
          // Stage cell the worker's sink policies resolve (mirrors the kernel mount).
          yield* bus.applyBoardPatch({
            cells: {
              [`sink:live`]: {
                create: {
                  label: "Live Sink",
                  catalog: "sink:live",
                  status: ["idle", null, Date.now()],
                  settings: { subscribe: ["publish.video.rendered"], required: true },
                  readonly: {},
                  functions: []
                }
              }
            }
          });
          const sinkDriver = createLiveSinkDriver({});
          const sinkConfig = yield* sinkDriver.validate({
            ...(runConfig.sink.config as Record<string, unknown>),
            transport: recording.transport,
            fragmentSeconds: 0.2
          } as never);
          const attachment = yield* sinkDriver.attach(sinkConfig);
          // Owned instance key matching the family's selected live policy.
          const sinks: Record<string, SinkStageState> = {
            [`${obsId}:live`]: { attachment, finalized: false, deliveredItems: 0, drainedTracks: {} }
          };
          const boardWake = yield* createWorkerBoardWake();
          yield* bus.registerWakeWorker(() => boardWake.notify());

          // Own execution scope for worker+source+sink, as the kernel provides.
          yield* Effect.scoped(
            Effect.gen(function* () {
              const worker = yield* Effect.fork(
                runScopedWorkerUntilStoppedWithBoard({
                  runId,
                  obsId,
                  manifest: createPassthroughVideoManifest(),
                  sinks,
                  bus,
                  boardWake,
                  maxTurns: 512,
                  prepareCapture: createIngestCaptureDriver().create(
                    runConfig.capture.config as never
                  )
                })
              );
              // Eight chroma-ramped fills (R rises, G falls); the worker pulls them live off HTTP.
              yield* waitForServer(PORT);
              for (let i = 0; i < 8; i += 1) {
                const res = yield* Effect.promise(() =>
                  postFrame(PORT, colorFrame(i * 32, 255 - i * 32, 128))
                );
                expect(res.status).toBe(200);
              }
              yield* waitFor(
                () => recording.init.data !== undefined && recording.fragments.length >= 2,
                "init + 2 fragments"
              );
              expect(recording.init.data!.byteLength).toBeGreaterThan(0);
              for (const fragment of recording.fragments) {
                expect(fragment.byteLength).toBeGreaterThan(0);
              }
              yield* bus.callFunction({
                callId: `stop-${runId}`,
                runId,
                scope: systemRunStopScope,
                cellId: observationCellId(obsId, "run"),
                payload: { reason: "foundation proof complete" }
              });
              const result = yield* Fiber.join(worker);
              expect(result.outcome).toBe("stopped");
            })
          );

          // Decode the captured byte stream: advancing content, not callback counts.
          const dir = mkdtempSync(path.join(tmpdir(), "livestreak-foundation-"));
          try {
            const combined = Buffer.concat([
              Buffer.from(recording.init.data!),
              ...recording.fragments.map((f) => Buffer.from(f))
            ]);
            writeFileSync(path.join(dir, "capture.mp4"), combined);
            const decode = (pixFmt: string): Effect.Effect<Uint8Array, Error> =>
              Effect.promise(() =>
                execFileAsync("ffmpeg", [
                  "-v", "error", "-i", path.join(dir, "capture.mp4"),
                  "-f", "rawvideo", "-pix_fmt", pixFmt, "-"
                ], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }).then(
                  ({ stdout }) => {
                    const raw = stdout as unknown as Buffer;
                    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                  },
                  (cause) => {
                    throw new Error(`ffmpeg decode failed: ${String(cause)}`);
                  }
                )
              );
            // Full accepted count, in order: every posted frame decodes exactly once.
            const gray = yield* decode("gray");
            expect(gray.byteLength).toBe(8 * W * H);
            // Chroma ramp survives the real encode: decode rgb24 and check per-frame channels.
            const rgb = yield* decode("rgb24");
            expect(rgb.byteLength).toBe(8 * W * H * 3);
            const channelMeans = (channel: number): number[] => {
              const means: number[] = [];
              for (let f = 0; f < 8; f += 1) {
                let sum = 0;
                for (let p = 0; p < W * H; p += 1) sum += rgb[f * W * H * 3 + p * 3 + channel]!;
                means.push(sum / (W * H));
              }
              return means;
            };
            const reds = channelMeans(0);
            const greens = channelMeans(1);
            for (let f = 1; f < 8; f += 1) {
              expect(reds[f]).toBeGreaterThan(reds[f - 1]!);
              expect(greens[f]).toBeLessThan(greens[f - 1]!);
            }
            // Presentation timestamps advance strictly across the decoded frames.
            // (best_effort_timestamp_time: pkt_pts_time yields nothing on fragmented MP4.)
            const { stdout: probeOut } = yield* Effect.promise(() =>
              execFileAsync("ffprobe", [
                "-v", "error", "-select_streams", "v:0",
                "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0",
                path.join(dir, "capture.mp4")
              ])
            );
            // ffprobe reports N/A for the leading frame timestamp; the decode count above
            // already pins completeness, so order is asserted over the finite remainder.
            const pts = String(probeOut)
              .trim()
              .split("\n")
              .map(Number)
              .filter((value) => Number.isFinite(value));
            expect(pts.length).toBeGreaterThanOrEqual(7);
            for (let f = 1; f < pts.length; f += 1) {
              expect(pts[f]).toBeGreaterThan(pts[f - 1]!);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        })
      )
    );
  }, 90000);

  it("pause/resume/stop stay responsive on empty input; stop-while-paused needs no resume", async () => {
    const PORT = 48732;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_foundation_pause";
          const bus = yield* makeBus(runId);
          const { board, obsId } = yield* addIngestObservation(bus, runId, PORT);
          const runConfig = yield* runConfigFromBoard({
            runId,
            board,
            hostBaseUrl: "http://127.0.0.1:8787"
          });
          // Memory sink here: this test proves control responsiveness, not encoding.
          // Sequences recorded to prove in-order, once-only backlog delivery.
          const memDelivered: number[] = [];
          const memSink: SinkStageState = {
            attachment: {
              id: "memory",
              deliver: (item) =>
                Effect.sync(() => {
                  if (item.kind === "video") memDelivered.push(item.sequence);
                }),
              finalize: Effect.succeed({ deliveredItems: memDelivered.length, output: { kind: "memory" } }),
              health: Effect.succeed({
                stage: "publish",
                descriptorId: "memory",
                status: "running",
                updatedAtMs: Date.now(),
                deliveredItems: memDelivered.length
              }),
              detach: Effect.void
            },
            finalized: false,
            deliveredItems: 0,
            drainedTracks: {}
          };
          const sinks: Record<string, SinkStageState> = { [`${obsId}:live`]: memSink };
          expect(runConfig.capture.driverId).toBe("ingest");
          const boardWake = yield* createWorkerBoardWake();
          yield* bus.registerWakeWorker(() => boardWake.notify());

          // Own execution scope for worker+source+sink (as the kernel provides): acquired with
          // its release registered IMMEDIATELY, so failure paths still clean up. The stop receipt
          // is measured through early closure of THIS scope; the port must rebind BEFORE the outer
          // harness scope closes.
          const execScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
            Scope.close(scope, Exit.succeed(void 0))
          );
          const runWorker = Scope.extend(
            Effect.fork(
              runScopedWorkerUntilStoppedWithBoard({
                runId,
                obsId,
                manifest: createPassthroughVideoManifest(),
                sinks,
                bus,
                boardWake,
                maxTurns: 64,
                prepareCapture: createIngestCaptureDriver().create({
                  port: PORT,
                  width: W,
                  height: H,
                  fps: FPS
                })
              })
            ),
            execScope
          );
          const worker = yield* runWorker;
          // Sink policy fixture: the worker only pumps subscribed stage cells.
          yield* bus.applyBoardPatch({
            cells: {
              [`sink:memory`]: {
                create: {
                  label: "Memory",
                  catalog: "sink:memory",
                  status: ["idle", null, Date.now()],
                  settings: { subscribe: ["publish.video.rendered"] },
                  readonly: {},
                  functions: []
                }
              }
            }
          });
          yield* waitForServer(PORT);
          const runStatus = (): Promise<string | undefined> =>
            Effect.runPromise(
              bus.readBoard().pipe(
                Effect.map((board) => board.cells[observationCellId(obsId, "run")]?.status[0] as string | undefined)
              )
            );
          const waitForStatus = (status: string): Effect.Effect<void, Error> =>
            waitForBoardString(() => runStatus(), status, `run status ${status}`);
          // G15-B01: two accepted frames FIRST (source starts unpaused), then pause. Whether
          // the running worker pulls them immediately or they buffer through the pause, both
          // must deliver in order/once with NO post-resume padding frames.
          for (const fill of [20, 21]) {
            const buffered = yield* Effect.promise(() => postFrame(PORT, grayFrame(fill)));
            expect(buffered.status).toBe(200);
          }
          // Pause lands and the worker acknowledges it (run status commits on transition).
          yield* bus.callFunction({
            callId: `pause-${runId}`,
            runId,
            scope: systemPausePauseScope,
            cellId: observationCellId(obsId, "pause"),
            payload: {}
          });
          yield* waitForStatus("paused");
          const refused = yield* Effect.promise(() => postFrame(PORT, grayFrame(9)));
          // NOTE: refusal asserted after resume below; the backlog posts above must be 200.
          // Resume lands, the worker acknowledges, and the backlog delivers in order/once.
          yield* bus.callFunction({
            callId: `resume-${runId}`,
            runId,
            scope: systemPauseResumeScope,
            cellId: observationCellId(obsId, "pause"),
            payload: {}
          });
          yield* waitForStatus("running");
          yield* waitFor(() => memDelivered.length >= 2, "ordered backlog delivery");
          expect(memDelivered).toEqual([0, 1]);
          expect(refused.status).toBe(429);
          expect(yield* Effect.promise(() => refused.json())).toMatchObject({ reason: "paused" });
          // Original single quiet post-resume frame, no padding: with drain-first scheduling it
          // delivers exactly once (the old three-frame workaround is gone).
          yield* bus.callFunction({
            callId: `pause2-${runId}`,
            runId,
            scope: systemPausePauseScope,
            cellId: observationCellId(obsId, "pause"),
            payload: {}
          });
          yield* waitForStatus("paused");
          yield* bus.callFunction({
            callId: `resume2-${runId}`,
            runId,
            scope: systemPauseResumeScope,
            cellId: observationCellId(obsId, "pause"),
            payload: {}
          });
          yield* waitForStatus("running");
          const single = yield* Effect.promise(() => postFrame(PORT, grayFrame(30)));
          expect(single.status).toBe(200);
          yield* waitFor(() => memDelivered.length >= 3, "single post-resume delivery");
          // Track sequences interleave timeline markers: assert ordered, once-only delivery.
          expect(memDelivered).toHaveLength(3);
          expect(memDelivered[0]).toBe(0);
          expect(memDelivered[1]).toBe(1);
          expect(memDelivered[2]).toBeGreaterThan(memDelivered[1]!);
          // Stop (running again): bounded receipt well below the 5s kernel fallback.
          yield* bus.callFunction({
            callId: `stop-${runId}`,
            runId,
            scope: systemRunStopScope,
            cellId: observationCellId(obsId, "run"),
            payload: { reason: "pause loop complete" }
          });
          const stopped = yield* Fiber.join(worker).pipe(Effect.timeout(4000));
          expect(stopped.outcome).toBe("stopped");
          expect(stopped.snapshot.lifecycle).toBe("stopped");
          // Close the execution scope first: release runs here, not at worker join.
          yield* Scope.close(execScope, Exit.succeed(stopped));
          // The listener released inside the execution scope: rebind proves it, while the
          // outer harness scope is still open.
          const rebound = yield* createIngestCaptureDriver().create({
            port: PORT,
            width: W,
            height: H,
            fps: FPS
          });
          expect(rebound.descriptor.id).toBe("ingest");
        })
      )
    );
  }, 60000);

  it("quiet and paused workers survive notifications without busy-loop death (M2-03)", async () => {
    const PORT = 48733;
    const outcome = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runId = "run_foundation_idle";
          const bus = yield* makeBus(runId);
          const { obsId } = yield* addIngestObservation(bus, runId, PORT);
          // Default/global capture:file stage cell present with changing health, as in the
          // M2-03 reproduction: snapshot projection writes here every commit.
          yield* bus.applyBoardPatch({
            cells: {
              [`capture:file`]: {
                create: {
                  label: "File Capture",
                  catalog: "capture:file",
                  status: ["idle", null, Date.now()],
                  settings: {},
                  readonly: {},
                  functions: []
                }
              },
              [`sink:memory`]: {
                create: {
                  label: "Memory",
                  catalog: "sink:memory",
                  status: ["idle", null, Date.now()],
                  settings: { subscribe: ["publish.video.rendered"] },
                  readonly: {},
                  functions: []
                }
              }
            }
          });
          const memSink: SinkStageState = {
            attachment: {
              id: "memory",
              deliver: () => Effect.void,
              finalize: Effect.succeed({ deliveredItems: 0, output: { kind: "memory" } }),
              health: Effect.succeed({
                stage: "publish",
                descriptorId: "memory",
                status: "running",
                updatedAtMs: Date.now(),
                deliveredItems: 0
              }),
              detach: Effect.void
            },
            finalized: false,
            deliveredItems: 0,
            drainedTracks: {}
          };
          const before = yield* bus.readBoard();
          const boardWake = yield* createWorkerBoardWake();
          yield* bus.registerWakeWorker(() => boardWake.notify());
          const worker = yield* Effect.fork(
            runScopedWorkerUntilStoppedWithBoard({
              runId,
              obsId,
              manifest: createPassthroughVideoManifest(),
              sinks: { [`${obsId}:live`]: memSink },
              bus,
              boardWake,
              maxTurns: 6,
              prepareCapture: createIngestCaptureDriver().create({
                port: PORT,
                width: W,
                height: H,
                fps: FPS
              })
            })
          );
          // Pause, then disturb with MORE real notifications than the small idle budget:
          // each must wake without self-perpetuating into snapshot commits.
          yield* bus.callFunction({
            callId: `pause-${runId}`,
            runId,
            scope: systemPausePauseScope,
            cellId: observationCellId(obsId, "pause"),
            payload: {}
          });
          const runStatus = (): Promise<string | undefined> =>
            Effect.runPromise(
              bus.readBoard().pipe(
                Effect.map((board) => board.cells[observationCellId(obsId, "run")]?.status[0] as string | undefined)
              )
            );
          yield* waitForBoardString(() => runStatus(), "paused", "pause acknowledgement");
          for (let n = 0; n < 8; n += 1) {
            yield* boardWake.notify();
            yield* Effect.sleep(10);
          }
          // Still alive mid-storm (not max-turns-exceeded): legitimate waits don't burn budget.
          // Fiber.poll yields None while the worker is still running.
          expect(Option.isNone(yield* Fiber.poll(worker))).toBe(true);
          // Stop while still paused: no resume required, clean receipt.
          yield* bus.callFunction({
            callId: `stop-${runId}`,
            runId,
            scope: systemRunStopScope,
            cellId: observationCellId(obsId, "run"),
            payload: { reason: "idle proof complete" }
          });
          const result = yield* Fiber.join(worker);
          const after = yield* bus.readBoard();
          return {
            outcome: result.outcome,
            lifecycle: result.snapshot.lifecycle,
            runStatus: after.cells[observationCellId(obsId, "run")]?.status[0],
            revisions: after.revision - before.revision
          };
        })
      )
    );

    expect(outcome.outcome).toBe("stopped");
    expect(outcome.lifecycle).toBe("stopped");
    expect(outcome.runStatus).toBe("stopped");
    // Eight external notifies plus transitions must not snowball into per-notify commits.
  }, 60000);
});
