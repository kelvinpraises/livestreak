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
import { readBoardRunPrepared, type Board } from "#run/control/board/index.js";
import { systemConfigConfigureScope } from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";
import { liveSinkConfigureScope } from "#pipeline/publish/sinks/live/commands.js";
import { marketRegisterScope } from "#market/control.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult
} from "#test/helpers/fake-market-registrar.js";

const capturePath = "/tmp/livestreak-prepared-derivation/capture.mp4";
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

const call = (
  runtime: ObserveRuntime,
  runId: string,
  scope: string,
  payload: Record<string, unknown>
) => runtime.callFunction({ callId: `${scope}-${payload.streamId ?? "x"}`, runId, scope, payload });

const configureLivePermutation = (runtime: ObserveRuntime, runId: string) =>
  Effect.gen(function* () {
    yield* call(runtime, runId, systemConfigConfigureScope, {
      chain: "eip155:31337",
      capture: "file",
      process: null,
      publish: "live"
    });
    yield* call(runtime, runId, liveSinkConfigureScope, { streamId: "stream-v1" });
    yield* call(runtime, runId, fileCaptureConfigureScope, { path: capturePath });
    yield* call(runtime, runId, marketRegisterScope, { title: "demo" });
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

          yield* configureLivePermutation(runtime, runId);
          const busBefore = (yield* runtime.store.require(runId)).bus;

          const prepared = yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl });
          expect(prepared.prepared).toBe(true);
          // Same bus object — prepare derived on the run's live bus instead of replacing it.
          expect(prepared.bus).toBe(busBefore);
          // The subscription (bound pre-prepare) observed the prepared status — no severed rail.
          expect(seen.some((b) => b.cells["system:run"]?.status[0] === "prepared")).toBe(true);

          // Reconfigure AFTER prepare: the configurator must still be live on the bus.
          yield* call(runtime, runId, liveSinkConfigureScope, { streamId: "stream-v2" });
          const board = yield* runtime.readBoard(runId);
          expect(board.cells["sink:live"]?.settings?.streamId).toBe("stream-v2");
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
          yield* configureLivePermutation(runtime, runId);
          yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl });

          yield* call(runtime, runId, liveSinkConfigureScope, { streamId: "stream-v2" });
          const demoted = yield* runtime.readBoard(runId);
          expect(readBoardRunPrepared(demoted)).toBe(false);
          expect(demoted.cells["system:run"]?.status[0]).toBe("created");
          expect(demoted.cells["system:run"]?.status[1]).toContain("re-prepare");

          const reprepared = yield* runtime.prepareConfiguredRun(runId, { hostBaseUrl });
          expect(reprepared.prepared).toBe(true);
          // The market cell owns the live streamId (streamId := marketId), so pin the sink
          // settings path instead: the re-derived board carries the v2 sink config.
          const board = yield* runtime.readBoard(runId);
          expect(board.cells["sink:live"]?.settings?.streamId).toBe("stream-v2");
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
          // Configure the permutation but do NOT register a market and do NOT prepare: start's
          // auto-prepare must run and surface prepare's own gate error.
          yield* call(runtime, runId, systemConfigConfigureScope, {
            chain: "eip155:31337",
            capture: "file",
            process: null,
            publish: "live"
          });
          yield* call(runtime, runId, liveSinkConfigureScope, { streamId: "stream-v1" });
          yield* call(runtime, runId, fileCaptureConfigureScope, { path: capturePath });

          return yield* bridge.callConsoleAction({
            caller: trustedCaller,
            runId,
            id: "observe.system.run.start",
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
      expect(message).toContain("Register a market");
      expect(message).not.toContain("must be prepared");
    }
  });
});
