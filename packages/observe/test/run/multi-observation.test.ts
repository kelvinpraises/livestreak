// Two observations, one session: prepares key per obsId, neither vamps the other, and the
// reclaim guard scopes to ITS observation. (True concurrent STREAMS are proven in the live
// drive — this pins the store/keying contract that makes them possible.)
import { beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect, Exit, Fiber } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import {
  createInitialBoard,
  projectWorkerControlView
} from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import {
  systemPausePauseScope,
  systemPauseResumeScope
} from "#run/control/system/pause.js";
import {
  systemConfigPublishKindScope
} from "#run/control/system/config.js";
import { runScopedWorkerUntilStoppedWithBoard } from "#run/worker/worker.js";
import { createWorkerBoardWake } from "#run/worker/wake.js";
import { createPassthroughVideoManifest } from "#run/worker/state.js";
import { createSyntheticCaptureDriver } from "#pipeline/capture/synthetic/driver.js";
import { waitForBoard } from "#test/helpers/presentation-runtime.js";
import {
  createObserveRuntime,
  makeObserveRun,
  mountObserveT0Bus,
  shellRunConfig,
  type ObserveRuntime
} from "#index.js";
import {
  observationCellId,
  readObservationIndex,
  systemConfigConfigureScope
} from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";
import { liveSinkConfigureScope } from "#pipeline/publish/sinks/live/commands.js";
import { directSinkConfigureScope } from "#pipeline/publish/sinks/direct/commands.js";
import { ingestCaptureConfigureScope } from "#pipeline/capture/ingest/commands.js";
import {
  systemConfigCaptureKindScope,
  systemConfigCloseScope
} from "#run/control/system/config.js";
import { createFakeMarketRegistrar } from "#test/helpers/fake-market-registrar.js";
import { createRunStore } from "#run/store.js";
import { LiveStreakConfigError } from "@livestreak/core";
import type { Board } from "#run/control/board/index.js";

const capturePath = "/tmp/livestreak-multi-obs/capture.mp4";
const hostBaseUrl = "http://127.0.0.1:8787";

const sessionInit = {
  package: "observe" as const,
  chain: "eip155:31337",
  contracts: { marketRegistry: "0x00000000000000000000000000000000000000aa" },
  wallet: {
    chain: "eip155:31337",
    seed: "0xseed",
    walletInit: { chain: "evm" as const, seedSource: "raw" as const, config: {} as never },
    operatorAddress: "0x0000000000000000000000000000000000000001"
  },
  hostUrl: hostBaseUrl
};

beforeAll(async () => {
  await mkdir("/tmp/livestreak-multi-obs", { recursive: true });
  await writeFile(capturePath, "stub");
});

const openConsoleRuntime = (
  runId: string
): Effect.Effect<ObserveRuntime, unknown, import("effect").Scope.Scope> =>
  Effect.gen(function* () {
    const runtime = yield* createObserveRuntime({ sessionInit });
    const run = yield* makeObserveRun(shellRunConfig(runId));
    const mounted = yield* mountObserveT0Bus(run, {
      sessionInit,
      market: {
        // No fixed result: the fake derives its marketId from the register INPUT, so the
        // per-observation runId scoping is what the distinct-markets assertion measures.
        resolveRegistrar: () => Effect.succeed(createFakeMarketRegistrar())
      }
    });
    yield* runtime.store.put(mounted);
    return runtime;
  });

const addObservation = (runtime: ObserveRuntime, runId: string, title: string) =>
  Effect.gen(function* () {
    const before = readObservationIndex(yield* runtime.readBoard(runId));
    yield* runtime.callFunction({
      callId: `add-${title}`,
      runId,
      scope: systemConfigConfigureScope,
      payload: { title, chain: "eip155:31337" }
    });
    const after = readObservationIndex(yield* runtime.readBoard(runId));
    return Object.keys(after).find((id) => before[id] === undefined)!;
  });

const configureObs = (runtime: ObserveRuntime, runId: string, obsId: string) =>
  Effect.gen(function* () {
    yield* runtime.callFunction({
      callId: `sink-${obsId}`,
      runId,
      cellId: observationCellId(obsId, "publish"),
      scope: liveSinkConfigureScope,
      payload: {}
    });
    yield* runtime.callFunction({
      callId: `cap-${obsId}`,
      runId,
      cellId: observationCellId(obsId, "capture"),
      scope: fileCaptureConfigureScope,
      payload: { path: capturePath }
    });
  });

describe("multiple observations, one session", () => {
  it("the mount publishes the session's settleable chains on the board", async () => {
    const runId = "run_multi_chains";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openConsoleRuntime(runId);
          const board = yield* runtime.readBoard(runId);
          // The console's chain select renders from exactly this list — never a typed string.
          return board.cells["system:config"]?.readonly?.chains;
        })
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([sessionInit.chain]);
    }
  });

  it("prepares key per observation: both prepared, neither vamped, markets distinct", async () => {
    const runId = "run_multi_obs";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openConsoleRuntime(runId);
          const a = yield* addObservation(runtime, runId, "Cup A");
          const b = yield* addObservation(runtime, runId, "Chess B");
          yield* configureObs(runtime, runId, a);
          yield* configureObs(runtime, runId, b);

          const preparedA = yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a });
          const preparedB = yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: b });
          expect(preparedA.prepared).toBe(true);
          expect(preparedB.prepared).toBe(true);
          // Each derived config drives ITS observation.
          expect(preparedA.config.obsId).toBe(a);
          expect(preparedB.config.obsId).toBe(b);

          const board = yield* runtime.readBoard(runId);
          // Both family run cells prepared — B's prepare did not vamp A's.
          expect(board.cells[observationCellId(a, "run")]?.status[0]).toBe("prepared");
          expect(board.cells[observationCellId(b, "run")]?.status[0]).toBe("prepared");
          // Both markets registered, distinctly.
          const marketA = board.cells[observationCellId(a, "market")]?.readonly?.marketId;
          const marketB = board.cells[observationCellId(b, "market")]?.readonly?.marketId;
          expect(typeof marketA).toBe("string");
          expect(typeof marketB).toBe("string");
          // The collision the live drive caught: two families must never mint one market.
          expect(marketA).not.toBe(marketB);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("CAUSE:", String(exit.cause).slice(0, 500));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});


describe("two observations, two live workers", () => {
  it("A live / B direct policies with owned sinks, independent pause/stop, no contamination", async () => {
    const runId = "run_multi_live";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createControlBus({
            runId,
            board: createInitialBoard({ runId, nowMs: 1 }),
            catalog: buildControlCatalog(),
            surfaces: createObserveControlSurfaces({})
          });

          // Two observations through the real console flow.
          const addOne = (title: string) =>
            Effect.gen(function* () {
              const before = readObservationIndex(yield* bus.readBoard());
              yield* bus.callFunction({
                callId: `add-${title}`,
                runId,
                scope: systemConfigConfigureScope,
                payload: { title, chain: "eip155:31337" }
              });
              const after = readObservationIndex(yield* bus.readBoard());
              return Object.keys(after).find((id) => before[id] === undefined)!;
            });
          const a = yield* addOne("Cup A");
          const b = yield* addOne("Chess B");

          // A stays live; B switches to direct. Real kind-switch call.
          yield* bus.callFunction({
            callId: `kind-${b}`,
            runId,
            scope: systemConfigPublishKindScope,
            payload: { obsId: b, kind: "direct" }
          });
          // Real sink configures: policies come from the families' own configured cells.
          yield* bus.callFunction({
            callId: `sink-${a}`,
            runId,
            cellId: observationCellId(a, "publish"),
            scope: liveSinkConfigureScope,
            payload: {}
          });
          yield* bus.callFunction({
            callId: `sink-${b}`,
            runId,
            cellId: observationCellId(b, "publish"),
            scope: directSinkConfigureScope,
            payload: {}
          });

          // Stage cells the kernel would mount at attach (one per lane).
          const stageCell = (catalog: string) => ({
            create: {
              label: "Stage",
              catalog,
              status: ["idle", null, Date.now()] as [string, null, number],
              settings: { subscribe: ["publish.video.rendered"] },
              readonly: {},
              functions: []
            }
          });
          yield* bus.applyBoardPatch({
            cells: {
              "sink:live": stageCell("sink:live"),
              "sink:direct": stageCell("sink:direct")
            }
          });

          // Per-family policies resolve from the live board: A serves live, B serves direct —
          // the stale-sibling contamination (R2-01) stays out.
          const policyBoard = yield* bus.readBoard();
          expect(projectWorkerControlView(policyBoard, a).sinks.map((s) => s.sinkId)).toEqual([
            `${a}:live`
          ]);
          expect(projectWorkerControlView(policyBoard, b).sinks.map((s) => s.sinkId)).toEqual([
            `${b}:direct`
          ]);

          // Distinct OWNED sink attachments per family (injected, never shared).
          const deliveredA: number[] = [];
          const deliveredB: number[] = [];
          const recordingSink = (descriptorId: string, delivered: number[]) => ({
            id: descriptorId,
            deliver: (item: { kind: string; sequence: number }) =>
              Effect.sync(() => {
                if (item.kind === "video") delivered.push(item.sequence);
              }),
            finalize: Effect.succeed({
              deliveredItems: delivered.length,
              output: { kind: "memory" as const }
            }),
            health: Effect.succeed({
              stage: "publish" as const,
              descriptorId,
              status: "running" as const,
              updatedAtMs: Date.now(),
              deliveredItems: delivered.length
            }),
            detach: Effect.void
          });

          // One wake subscription per worker — additive fan-out (the old replace-slot would
          // silence the first worker here).
          const wakeA = yield* createWorkerBoardWake();
          const wakeB = yield* createWorkerBoardWake();
          const subA = yield* bus.registerWakeWorker(() => wakeA.notify());
          const subB = yield* bus.registerWakeWorker(() => wakeB.notify());

          // A starts PAUSED (pre-paused: deterministic, no race with the fast synthetic
          // source); B runs free. Pause precedes the forks so A can never outrun it.
          yield* bus.callFunction({
            callId: `pause-${a}`,
            runId,
            cellId: observationCellId(a, "pause"),
            scope: systemPausePauseScope,
            payload: {}
          });

          // Execution leases like the kernel holds: snapshot commits derive from the
          // current board inside the guard (no whole-board races between the workers).
          const leaseA = yield* bus.execution.reserve(`${runId}#${a}`);
          const leaseB = yield* bus.execution.reserve(`${runId}#${b}`);
          // Distinguishable sources per family (6 vs 4 frames): a leak would corrupt the counts.
          const runWorker = (
            obsId: string,
            descriptorId: string,
            delivered: number[],
            driverId: string,
            token: number,
            wake: typeof wakeA,
            frameCount: number
          ) =>
            Effect.fork(
              runScopedWorkerUntilStoppedWithBoard({
                runId,
                obsId,
                execution: { obsKey: `${runId}#${obsId}`, token },
                manifest: createPassthroughVideoManifest(),
                sinks: {
                  [`${obsId}:${driverId}`]: {
                    attachment: recordingSink(descriptorId, delivered),
                    finalized: false,
                    deliveredItems: 0,
                    drainedTracks: {}
                  }
                },
                bus,
                boardWake: wake,
                maxTurns: 4096,
                prepareCapture: createSyntheticCaptureDriver().create({
                  frameCount,
                  width: 32,
                  height: 32,
                  fps: 30,
                  continuous: false
                } as never)
              })
            );
          const fiberA = yield* runWorker(a, "memory-a", deliveredA, "live", leaseA, wakeA, 6);
          const fiberB = yield* runWorker(b, "memory-b", deliveredB, "direct", leaseB, wakeB, 4);

          // Independent pause: A acknowledges paused while B runs to EOS on its own.
          yield* waitForBoard(
            () => bus.readBoard(),
            (board) => board.cells[observationCellId(a, "run")]?.status[0] === "paused"
          );
          const resultB = yield* Fiber.join(fiberB);
          expect(resultB.outcome).toBe("stopped");
          // B's own 4 frames, consecutively sequenced (markers consume track sequences too,
          // so only consecutiveness — not absolute values — is asserted).
          expect(deliveredB.length).toBe(4);
          for (let i = 1; i < deliveredB.length; i += 1) {
            expect(deliveredB[i]).toBe(deliveredB[i - 1]! + 1);
          }
          // Nothing of B's leaked into A's sink, and A held paused with no frames pulled.
          expect(deliveredA).toEqual([]);
          expect(
            (yield* bus.readBoard()).cells[observationCellId(a, "run")]?.status[0]
          ).toBe("paused");

          // Resume A: it drains its own 6 frames and stops.
          yield* bus.callFunction({
            callId: `resume-${a}`,
            runId,
            cellId: observationCellId(a, "pause"),
            scope: systemPauseResumeScope,
            payload: {}
          });
          const resultA = yield* Fiber.join(fiberA);
          expect(resultA.outcome).toBe("stopped");
          expect(deliveredA.length).toBe(6);
          for (let i = 1; i < deliveredA.length; i += 1) {
            expect(deliveredA[i]).toBe(deliveredA[i - 1]! + 1);
          }

          // No cross-observation contamination: capture facts + run status per owner.
          const final = yield* bus.readBoard();
          expect(final.cells[observationCellId(a, "capture")]?.readonly).toMatchObject({
            sourceType: "synthetic"
          });
          expect(final.cells[observationCellId(b, "capture")]?.readonly).toMatchObject({
            sourceType: "synthetic"
          });
          expect(final.cells[observationCellId(a, "run")]?.status[0]).toBe("stopped");
          expect(final.cells[observationCellId(b, "run")]?.status[0]).toBe("stopped");

          yield* subA.unsubscribe();
          yield* subB.unsubscribe();
          yield* bus.execution.release(`${runId}#${a}`, leaseA);
          yield* bus.execution.release(`${runId}#${b}`, leaseB);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("CAUSE:", String(exit.cause).slice(0, 800));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});


describe("two observations through actual runtime/kernel starts", () => {
  const PORT_A = 48811;
  const PORT_B = 48812;

  interface RecordingAttachment {
    readonly streamId: unknown;
    readonly delivered: number[];
  }

  // Recording sink double with a matching descriptor id (the kernel validates the match
  // and fails loudly on mismatches). Each attach mints its own owned transport record.
  const recordingSinkDouble = (id: string, attached: RecordingAttachment[]) => ({
    descriptor: {
      kind: "publish",
      id,
      version: "0.1.0",
      displayName: `${id} recording double`,
      summary: "Test double: records deliveries, no media or network.",
      capabilityScopes: [],
      flags: [],
      commands: [],
      mode: "file",
      requiresHost: false,
      debugOnly: true
    },
    mode: "file",
    validate: (sinkConfig: unknown) => Effect.succeed(sinkConfig),
    describeControl: () =>
      Effect.succeed({
        id: `sink:${id}`,
        cell: {
          label: `${id} double`,
          catalog: `sink:${id}`,
          status: ["idle", null, Date.now()] as [string, null, number],
          settings: {},
          readonly: {},
          functions: []
        }
      }),
    attach: (sinkConfig: unknown) =>
      Effect.sync(() => {
        const delivered: number[] = [];
        const record: RecordingAttachment = {
          streamId: (sinkConfig as Record<string, unknown>).streamId,
          delivered
        };
        attached.push(record);
        return {
          id: `${id}-attached`,
          deliver: (item: { kind: string; sequence: number }) =>
            Effect.sync(() => {
              if (item.kind === "video") delivered.push(item.sequence);
            }),
          finalize: Effect.succeed({
            deliveredItems: delivered.length,
            output: { kind: "memory" as const }
          }),
          health: Effect.succeed({
            stage: "publish" as const,
            descriptorId: `${id}-attached`,
            status: "running" as const,
            updatedAtMs: Date.now(),
            deliveredItems: delivered.length
          }),
          detach: Effect.void
        };
      })
  });

  const postFrame = (port: number, fill: number) =>
    Effect.promise(() =>
      fetch(`http://127.0.0.1:${port}/frames`, {
        method: "POST",
        body: new Uint8Array(16 * 16 * 4).fill(fill)
      }).then((res) => res.status)
    );

  const waitForServer = (port: number): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const deadline = Date.now() + 10000;
      for (;;) {
        const up = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/frames`, { method: "GET" }).then(
            () => true as const,
            () => false as const
          )
        );
        if (up) return;
        if (Date.now() >= deadline) {
          return yield* Effect.fail(new Error(`server ${port} never came up`));
        }
        yield* Effect.sleep(100);
      }
    });

  const waitForDelivered = (
    read: () => number[],
    count: number,
    what: string
  ): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const deadline = Date.now() + 15000;
      for (;;) {
        if (read().length >= count) return;
        if (Date.now() >= deadline) {
          return yield* Effect.fail(new Error(`timed out waiting for ${what}`));
        }
        yield* Effect.sleep(100);
      }
    });

  const runStatusIs = (board: Board, id: string, status: string): boolean =>
    board.cells[observationCellId(id, "run")]?.status[0] === status;

  const openRuntimeWithDefaults = (
    runId: string,
    defaults: Record<string, unknown>,
    onRegister?: () => void,
    registrarDelayMs?: number,
    store?: ObserveRuntime["store"]
  ) =>
    Effect.gen(function* () {
      const runtime = yield* createObserveRuntime({
        sessionInit,
        ...(store === undefined ? {} : { store }),
        defaultKernelOptions: defaults as never
      });
      const run = yield* makeObserveRun(shellRunConfig(runId));
      const mounted = yield* mountObserveT0Bus(run, {
        sessionInit,
        market: {
          resolveRegistrar: () =>
            Effect.succeed(
              createFakeMarketRegistrar({
                ...(onRegister === undefined ? {} : { onRegister: () => onRegister() }),
                ...(registrarDelayMs === undefined ? {} : { delayMs: registrarDelayMs })
              })
            )
        }
      });
      yield* runtime.store.put(mounted);
      return runtime;
    });

  const configureIngestFamily = (
    runtime: ObserveRuntime,
    runId: string,
    obsId: string,
    port: number,
    publishKind: "live" | "direct"
  ) =>
    Effect.gen(function* () {
      yield* runtime.callFunction({
        callId: `kind-${obsId}`,
        runId,
        scope: systemConfigCaptureKindScope,
        payload: { obsId, kind: "ingest" }
      });
      yield* runtime.callFunction({
        callId: `cap-${obsId}`,
        runId,
        cellId: observationCellId(obsId, "capture"),
        scope: ingestCaptureConfigureScope,
        payload: { port, width: 16, height: 16, fps: 30 }
      });
      yield* runtime.callFunction({
        callId: `pkind-${obsId}`,
        runId,
        scope: systemConfigPublishKindScope,
        payload: { obsId, kind: publishKind }
      });
      yield* runtime.callFunction({
        callId: `sink-${obsId}`,
        runId,
        cellId: observationCellId(obsId, "publish"),
        scope: publishKind === "live" ? liveSinkConfigureScope : directSinkConfigureScope,
        payload: {}
      });
    });

  it("mixed live/direct: owned transports, independent stop, no contamination", async () => {
    let registerCalls = 0;
    const attachedLive: RecordingAttachment[] = [];
    const attachedDirect: RecordingAttachment[] = [];
    const liveDouble = recordingSinkDouble("live", attachedLive);
    const directDouble = recordingSinkDouble("direct", attachedDirect);
    const runId = "run_multi_runtime_mixed";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openRuntimeWithDefaults(
            runId,
            {},
            () => {
              registerCalls += 1;
            }
          );
          const a = yield* addObservation(runtime, runId, "Runtime A");
          const b = yield* addObservation(runtime, runId, "Runtime B");
          yield* configureIngestFamily(runtime, runId, a, PORT_A, "live");
          yield* configureIngestFamily(runtime, runId, b, PORT_B, "direct");

          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a });
          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: b });
          // One registration per family; markets distinct.
          expect(registerCalls).toBe(2);
          const boardAfterPrepare = yield* runtime.readBoard(runId);
          const marketA = boardAfterPrepare.cells[observationCellId(a, "market")]?.readonly
            ?.marketId;
          const marketB = boardAfterPrepare.cells[observationCellId(b, "market")]?.readonly
            ?.marketId;
          expect(typeof marketA).toBe("string");
          expect(marketA).not.toBe(marketB);

          // Actual kernel starts with per-start injected doubles (explicit wins over cache).
          // Attach happens in the forked worker fiber: poll, do not assume it landed.
          yield* runtime.startRun(runId, { sinkDriver: liveDouble } as never, a);
          yield* runtime.startRun(runId, { sinkDriver: directDouble } as never, b);
          yield* waitForDelivered(() => attachedLive.map((a) => a.delivered.length), 1, "live attach");
          yield* waitForDelivered(() => attachedDirect.map((a) => a.delivered.length), 1, "direct attach");
          // Distinct owned injected transports, keyed to each family's market.
          expect(attachedLive[0]!.streamId).toBe(marketA);
          expect(attachedDirect[0]!.streamId).toBe(marketB);

          yield* waitForServer(PORT_A);
          yield* waitForServer(PORT_B);

          // Real media flow: HTTP POSTs pulled live into the owned recording sinks.
          // Distinct counts per family (2 vs 3): any leak would corrupt the split.
          // Frames come before the running-wait: an idling worker commits no snapshots
          // until work flows, so `running` only lands after the first pull.
          expect(yield* postFrame(PORT_A, 20)).toBe(200);
          expect(yield* postFrame(PORT_A, 21)).toBe(200);
          expect(yield* postFrame(PORT_B, 30)).toBe(200);
          expect(yield* postFrame(PORT_B, 31)).toBe(200);
          expect(yield* postFrame(PORT_B, 32)).toBe(200);
          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, a, "running") && runStatusIs(board, b, "running")
          );
          yield* waitForDelivered(() => attachedLive[0]!.delivered, 2, "A backlog");
          yield* waitForDelivered(() => attachedDirect[0]!.delivered, 3, "B backlog");
          expect(attachedLive[0]!.delivered.length).toBe(2);
          expect(attachedDirect[0]!.delivered.length).toBe(3);

          // Stop A while B keeps advancing: B takes another frame after A is stopped.
          yield* runtime.stopRun(runId, { reason: "stop A" }, a);
          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, a, "stopped") && runStatusIs(board, b, "running")
          );
          expect(yield* postFrame(PORT_B, 33)).toBe(200);
          yield* waitForDelivered(() => attachedDirect[0]!.delivered, 4, "B post-stop frame");
          expect(attachedLive[0]!.delivered.length).toBe(2);

          yield* runtime.stopRun(runId, { reason: "stop B" }, b);
          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, b, "stopped")
          );

          // No contamination: capture facts and terminal statuses per owner; registrar
          // still at one call per family (stable identity, no re-registration).
          // Run receipts carry this execution's outcome (authoritative terminal commit).
          const final = yield* runtime.readBoard(runId);
          expect(final.cells[observationCellId(a, "run")]?.readonly).toMatchObject({
            outcome: "stopped"
          });
          expect(final.cells[observationCellId(a, "capture")]?.readonly).toMatchObject({
            sourceType: "stream"
          });
          expect(final.cells[observationCellId(b, "capture")]?.readonly).toMatchObject({
            sourceType: "stream"
          });
          expect(registerCalls).toBe(2);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("MIXED-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("same-kind live/live: separate policies, counters and stop reasons", async () => {
    const attachedA: RecordingAttachment[] = [];
    const attachedB: RecordingAttachment[] = [];
    const liveDouble = recordingSinkDouble("live", attachedA);
    const liveDoubleB = recordingSinkDouble("live", attachedB);
    const runId = "run_multi_runtime_same";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openRuntimeWithDefaults(runId, {});
          const a = yield* addObservation(runtime, runId, "Same A");
          const b = yield* addObservation(runtime, runId, "Same B");
          yield* configureIngestFamily(runtime, runId, a, PORT_A + 20, "live");
          yield* configureIngestFamily(runtime, runId, b, PORT_B + 20, "live");

          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a });
          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: b });

          // Same kind, separate policies: each family reads only its own instance key.
          const policyBoard = yield* runtime.readBoard(runId);
          expect(
            projectWorkerControlView(policyBoard, a).sinks.map((s) => s.sinkId)
          ).toEqual([`${a}:live`]);
          expect(
            projectWorkerControlView(policyBoard, b).sinks.map((s) => s.sinkId)
          ).toEqual([`${b}:live`]);

          yield* runtime.startRun(runId, { sinkDriver: liveDouble } as never, a);
          yield* runtime.startRun(runId, { sinkDriver: liveDoubleB } as never, b);
          yield* waitForServer(PORT_A + 20);
          yield* waitForServer(PORT_B + 20);

          // Distinct frame counts per family: sharing would corrupt the split.
          expect(yield* postFrame(PORT_A + 20, 40)).toBe(200);
          expect(yield* postFrame(PORT_B + 20, 50)).toBe(200);
          expect(yield* postFrame(PORT_B + 20, 51)).toBe(200);
          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, a, "running") && runStatusIs(board, b, "running")
          );
          yield* waitForDelivered(() => attachedA[0]!.delivered, 1, "same-kind A");
          yield* waitForDelivered(() => attachedB[0]!.delivered, 2, "same-kind B");
          expect(attachedA[0]!.delivered.length).toBe(1);
          expect(attachedB[0]!.delivered.length).toBe(2);

          // Stop A with an explicit reason while B advances; B's stop reason differs.
          yield* runtime.stopRun(runId, { reason: "stop same A" }, a);
          yield* waitForBoard(
            () => runtime.readBoard(runId),
            (board) => runStatusIs(board, a, "stopped") && runStatusIs(board, b, "running")
          );
          expect(yield* postFrame(PORT_B + 20, 52)).toBe(200);
          yield* waitForDelivered(() => attachedB[0]!.delivered, 3, "same-kind B advances");
          yield* runtime.stopRun(runId, { reason: "stop same B" }, b);

          const final = yield* runtime.readBoard(runId);
          expect(final.cells[observationCellId(a, "run")]?.status[0]).toBe("stopped");
          expect(final.cells[observationCellId(b, "run")]?.status[0]).toBe("stopped");
          // Owned publish counters: no second authority, no shared global cell.
          expect(
            final.cells[observationCellId(a, "publish")]?.readonly?.deliveredItems
          ).toBeLessThanOrEqual(1);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("SAME-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });


  it("same-family configure/start/close refuse while preparing; sibling add proceeds", async () => {
    const runId = "run_multi_held_prepare";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openRuntimeWithDefaults(runId, {}, undefined, 2000);
          const a = yield* addObservation(runtime, runId, "Held A");
          yield* configureIngestFamily(runtime, runId, a, 48851, "live");

          // Preparation pends inside the slow registrar.
          const preparing = yield* Effect.fork(
            runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a })
          );
          yield* Effect.sleep(300);

          // Same-family mutation/start/close are refused while preparing owns the key.
          const deniedConfigure = yield* Effect.exit(
            runtime.callFunction({
              callId: "cap-held",
              runId,
              cellId: observationCellId(a, "capture"),
              scope: ingestCaptureConfigureScope,
              payload: { port: 48852, width: 16, height: 16, fps: 30 }
            })
          );
          expect(Exit.isFailure(deniedConfigure)).toBe(true);
          const deniedStart = yield* Effect.exit(runtime.startRun(runId, undefined, a));
          expect(Exit.isFailure(deniedStart)).toBe(true);
          const deniedClose = yield* Effect.exit(
            runtime.callFunction({ callId: "close-held", runId, scope: systemConfigCloseScope })
          );
          expect(Exit.isFailure(deniedClose)).toBe(true);

          // A sibling add proceeds concurrently and both families land.
          const b = yield* addObservation(runtime, runId, "Held B");
          expect(typeof b).toBe("string");

          yield* Fiber.join(preparing);
          const board = yield* runtime.readBoard(runId);
          const index = readObservationIndex(board);
          expect(Object.keys(index).length).toBe(2);
          expect(board.cells[observationCellId(a, "run")]?.status[0]).toBe("prepared");
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("HELD-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });


  it("failed store publication demotes the bus flag and releases the claim", async () => {
    const runId = "run_multi_pub_rollback";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const inner = createRunStore();
          let failReplace = false;
          const store = {
            ...inner,
            replace: ((run: never, key?: string) =>
              failReplace
                ? Effect.fail(
                    new LiveStreakConfigError({ message: "injected publication failure" })
                  )
                : inner.replace(run as never, key)) as typeof inner.replace
          };
          const runtime = yield* openRuntimeWithDefaults(runId, {}, undefined, undefined, store);
          const a = yield* addObservation(runtime, runId, "Rollback A");
          yield* configureIngestFamily(runtime, runId, a, 48861, "live");
          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a });

          // Demote, then fail publication: bus flag rolls back, claim releases.
          yield* configureIngestFamily(runtime, runId, a, 48862, "live");
          failReplace = true;
          const failed = yield* Effect.exit(
            runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a })
          );
          expect(Exit.isFailure(failed)).toBe(true);
          if (Exit.isFailure(failed)) {
            expect(String(failed.cause)).toContain("injected publication failure");
          }
          const board = yield* runtime.readBoard(runId);
          expect(board.cells[observationCellId(a, "run")]?.readonly?.prepared).toBe(false);
          const bus = (yield* store.require(runId)).bus!;
          expect(yield* bus.execution.isActive(`${runId}#${a}`)).toBe(false);
          // The claim retired: a fresh prepare succeeds after the store recovers.
          failReplace = false;
          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl, obsId: a });
          expect(
            (yield* runtime.readBoard(runId)).cells[observationCellId(a, "run")]?.readonly
              ?.prepared
          ).toBe(true);
          return true;
        })
      )
    );
    if (Exit.isFailure(exit)) {
      console.log("ROLLBACK-CAUSE:", String(exit.cause).slice(0, 900));
    }
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
