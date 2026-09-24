// Prepared is a DISPOSABLE DERIVATION of the board — the operator can always steer back.
//
// Pins the option-D invariants from the 2026-07-17 live console drive:
//   1. prepare REUSES the run's T0 bus — board subscriptions survive (the console rail used to
//      freeze because prepare created a fresh bus and severed every listener), and the pipeline
//      configurators stay callable (reconfigure-after-prepare used to die with "No live surface
//      advertises …" while the console still rendered the forms).
//   2. A pipeline config change while prepared DEMOTES the run cell (start can never run a
//      config the board no longer shows) and a re-prepare derives the NEW config.
//   3. The console start branch auto-prepares an unprepared run instead of failing at the
//      operator with "must be prepared before start".
import { beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect, Exit } from "effect";
import {
  createObserveBridge,
  createObserveRuntime,
  makeObserveRun,
  mountObserveT0Bus,
  shellRunConfig,
  type BridgeCaller,
  type ObserveRuntime
} from "#index.js";
import { readBoardRunPrepared, runCellIdOf, type Board } from "#run/control/board/index.js";
import {
  observationCellId,
  readObservationIndex,
  systemConfigConfigureScope
} from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";
import { liveSinkConfigureScope } from "#pipeline/publish/sinks/live/commands.js";
import { marketRegisterScope } from "#market/control.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult
} from "#test/helpers/fake-market-registrar.js";

const capturePath = "/tmp/livestreak-prepared-derivation/capture.mp4";
const capturePathV2 = "/tmp/livestreak-prepared-derivation/capture-v2.mp4";
const hostBaseUrl = "http://127.0.0.1:8787";
const trustedCaller: BridgeCaller = { id: "trusted-local", trusted: true };

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
  await mkdir("/tmp/livestreak-prepared-derivation", { recursive: true });
  await writeFile(capturePath, "stub"); // validate() only checks readability; decode happens at start
  await writeFile(capturePathV2, "stub");
});

// Console-shaped runtime: shell run + T0 bus (with a fake market registrar) in the store —
// the same mount the gateway's openObserveConsoleRuntime performs.
const openConsoleRuntime = (
  runId: string
): Effect.Effect<ObserveRuntime, unknown, import("effect").Scope.Scope> =>
  Effect.gen(function* () {
    const runtime = yield* createObserveRuntime({ sessionInit });
    const run = yield* makeObserveRun(shellRunConfig(runId));
    const mounted = yield* mountObserveT0Bus(run, {
      sessionInit,
      market: {
        resolveRegistrar: () =>
          Effect.succeed(
            createFakeMarketRegistrar({
              result: defaultFakeRegisterResult({ runId, title: "demo" })
            })
          )
      }
    });
    yield* runtime.store.put(mounted);
    return runtime;
  });

let callSeq = 0;
const call = (
  runtime: ObserveRuntime,
  runId: string,
  scope: string,
  payload: Record<string, unknown>,
  cellId?: string
) =>
  runtime.callFunction({
    callId: `${scope}-${++callSeq}`,
    runId,
    ...(cellId === undefined ? {} : { cellId }),
    scope,
    payload
  });

const addObservation = (runtime: ObserveRuntime, runId: string) =>
  Effect.gen(function* () {
    yield* call(runtime, runId, systemConfigConfigureScope, {
      title: "demo",
      chain: "eip155:31337"
    });
    const board = yield* runtime.readBoard(runId);
    return Object.keys(readObservationIndex(board))[0]!;
  });

const configureLivePermutation = (runtime: ObserveRuntime, runId: string) =>
  Effect.gen(function* () {
    const obsId = yield* addObservation(runtime, runId);
    // streamId is board-derived (obsId → streamId → marketId) — configure carries no fields.
    yield* call(runtime, runId, liveSinkConfigureScope, {}, observationCellId(obsId, "publish"));
    yield* call(
      runtime,
      runId,
      fileCaptureConfigureScope,
      { path: capturePath },
      observationCellId(obsId, "capture")
    );
    // Register takes NO title — the board carries it from Add observation.
    yield* call(runtime, runId, marketRegisterScope, {}, observationCellId(obsId, "market"));
    return obsId;
  });

describe("prepared is a disposable derivation of the board", () => {
  it("prepare reuses the T0 bus: subscriptions survive and configurators stay callable", async () => {
    const runId = "run_prepared_reuse";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openConsoleRuntime(runId);
          const seen: Board[] = [];
          yield* runtime.subscribeBoard(runId, (board) => seen.push(board));

          const obsId = yield* configureLivePermutation(runtime, runId);
          const busBefore = (yield* runtime.store.require(runId)).bus;

          const prepared = yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl });
          expect(prepared.prepared).toBe(true);
          // Same bus object — prepare derived on the run's live bus instead of replacing it.
          expect(prepared.bus).toBe(busBefore);
          // The subscription (bound pre-prepare) observed the prepared status — no severed rail.
          expect(
            seen.some((b) => {
              const id = runCellIdOf(b);
              return id !== undefined && b.cells[id]?.status[0] === "prepared";
            })
          ).toBe(true);

          // Reconfigure AFTER prepare: the configurator must still be live on the bus.
          yield* call(
            runtime,
            runId,
            fileCaptureConfigureScope,
            { path: capturePathV2 },
            observationCellId(obsId, "capture")
          );
          const board = yield* runtime.readBoard(runId);
          expect(board.cells[observationCellId(obsId, "capture")]?.settings?.path).toBe(
            capturePathV2
          );
          return true;
        })
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("a pipeline config change demotes prepared; re-prepare derives the new config", async () => {
    const runId = "run_prepared_demote";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openConsoleRuntime(runId);
          const obsId = yield* configureLivePermutation(runtime, runId);
          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl });

          yield* call(
            runtime,
            runId,
            fileCaptureConfigureScope,
            { path: capturePathV2 },
            observationCellId(obsId, "capture")
          );
          const demoted = yield* runtime.readBoard(runId);
          const demotedRunId = runCellIdOf(demoted)!;
          expect(readBoardRunPrepared(demoted)).toBe(false);
          expect(demoted.cells[demotedRunId]?.status[0]).toBe("created");
          expect(demoted.cells[demotedRunId]?.status[1]).toContain("re-prepare");

          const reprepared = yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl });
          expect(reprepared.prepared).toBe(true);
          // The re-derived config carries the NEW capture path — prepare read the changed board.
          expect((reprepared.config.capture.config as { path?: string }).path).toBe(capturePathV2);
          const board = yield* runtime.readBoard(runId);
          expect(readBoardRunPrepared(board)).toBe(true);
          return true;
        })
      )
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("console start auto-prepares an unprepared run (fails on the REAL gate, not 'must be prepared')", async () => {
    const runId = "run_prepared_autostart";
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* openConsoleRuntime(runId);
          const bridge = createObserveBridge({ runtime, sessionInit, hostBaseUrl });
          // Add the observation but leave the CAPTURE unset and do NOT prepare: start's
          // auto-prepare must run and surface prepare's own gate error. (Registration is
          // auto-satisfied at prepare now — the capture gate is the first real one.)
          const obsId = yield* addObservation(runtime, runId);
          yield* call(runtime, runId, liveSinkConfigureScope, {}, observationCellId(obsId, "publish"));

          return yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            id: `observe.obs.${obsId}.run.start`,
            action: "start",
            args: {}
          });
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const message = String(exit.cause);
      // The auto-prepare path ran runConfigFromBoard (its gate fired) — the operator never sees
      // the dead-end "must be prepared before start".
      expect(message).toContain("capture media file");
      expect(message).not.toContain("must be prepared");
    }
  });
});
