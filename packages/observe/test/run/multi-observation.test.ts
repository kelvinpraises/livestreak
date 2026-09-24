// Two observations, one session: prepares key per obsId, neither vamps the other, and the
// reclaim guard scopes to ITS observation. (True concurrent STREAMS are proven in the live
// drive — this pins the store/keying contract that makes them possible.)
import { beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect, Exit } from "effect";
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
import { createFakeMarketRegistrar } from "#test/helpers/fake-market-registrar.js";

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
