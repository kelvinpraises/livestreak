// Pristine-board OPERATOR FLOW — the regression guard for the live-operator remote console.
//
// This drives the SAME control surface the observe console edge wraps (createControlBus + the surfaces,
// then projectControlPanelControls → projectObserveDescriptors, and bus.callFunction for dispatch) on a
// pristine T0 board. It pins the invariant that following ONLY what the console renders leads to a
// successful go-live derivation:
//
//   1. Every VISIBLE `configure` descriptor exposes the input fields its own validator demands — a form can
//      supply them. (Catches the catalog-key regression where sink:file-export.configure lost its `path`
//      field because the catalog is keyed by cell id but the projector looked up by cell.catalog.)
//   2. Configure cells in ANY order — capture BEFORE sink — without hard-failing. (Catches the ≥1-sink
//      "At least one sink policy is required" rule firing on every settings write and trapping the operator.)
//   3. The full live sequence (system:config → sink:live → capture:file → market → prepare) derives a valid
//      live run config via runConfigFromBoard, the console prepare gate — using only form-suppliable values.
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import type { FunctionDescriptor } from "@livestreak/schema";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import type { ControlBus, ControlPanel } from "#run/control/bus/index.js";
import { createInitialBoard, type Board } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { projectControlPanelControls, projectObserveDescriptors } from "#bridge/panel/index.js";
import { systemConfigConfigureScope } from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";
import { fileSinkConfigureScope } from "#pipeline/publish/sinks/file/commands.js";
import { liveSinkConfigureScope } from "#pipeline/publish/sinks/live/commands.js";
import { marketRegisterScope } from "#market/control.js";
import { runConfigFromBoard } from "#run/board-run-config.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult
} from "#test/helpers/fake-market-registrar.js";

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
  hostUrl: "http://127.0.0.1:8787"
};

const makeBus = (runId: string): Effect.Effect<ControlBus, unknown> =>
  createControlBus({
    runId,
    board: createInitialBoard({ runId, nowMs: 1 }),
    catalog: buildControlCatalog(),
    surfaces: createObserveControlSurfaces({
      sessionInit,
      market: {
        resolveRegistrar: () =>
          Effect.succeed(
            createFakeMarketRegistrar({
              result: defaultFakeRegisterResult({ runId, title: "demo" })
            })
          )
      }
    })
  });

// Descriptors the operator's console would render, built exactly like the edge's describeFunctions.
const describeConsole = (bus: ControlBus): Effect.Effect<readonly FunctionDescriptor[], unknown> =>
  Effect.gen(function* () {
    const board: Board = yield* bus.readBoard();
    const catalog = yield* bus.readCatalog();
    const panel: ControlPanel = { board, catalog };
    return projectObserveDescriptors(projectControlPanelControls(panel), board);
  });

const fieldNames = (descriptor: FunctionDescriptor | undefined): readonly string[] =>
  (descriptor?.inputSchema?.type === "object"
    ? descriptor.inputSchema.properties ?? []
    : []
  ).map((property) => property.name);

const configure = (
  bus: ControlBus,
  callId: string,
  runId: string,
  scope: string,
  payload: Record<string, unknown>
) => bus.callFunction({ callId, runId, scope, payload });

describe("pristine-board operator flow", () => {
  it("every visible configure descriptor exposes its validator's required fields", async () => {
    const runId = "run_flow_fields";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);

        // system:config configure renders its own fields at T0 (chain/capture/process/publish).
        const t0 = yield* describeConsole(bus);
        const t0Config = t0.find((d) => d.id === "observe.system.config.configure");
        expect(t0Config?.visible).toBe(true);
        expect(fieldNames(t0Config)).toContain("publish");

        // Mount the FILE-EXPORT permutation — the surface the broken operator hit.
        yield* configure(bus, "cfg-fe", runId, systemConfigConfigureScope, {
          chain: "eip155:31337",
          capture: "file",
          process: null,
          publish: "file-export"
        });

        const afterFileExport = yield* describeConsole(bus);
        const captureConfigure = afterFileExport.find((d) => d.id === "observe.capture.file.configure");
        const sinkConfigure = afterFileExport.find((d) => d.id === "observe.sink.file-export.configure");

        // The regression: the file-export sink's configure must expose its `path` field so a form can
        // satisfy "sink:file-export:configure path must be a non-empty string" — no fieldless dead end.
        expect(sinkConfigure?.visible).toBe(true);
        expect(fieldNames(sinkConfigure)).toEqual(["path"]);
        expect(fieldNames(captureConfigure)).toEqual(["path"]);

        return true;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("sink:live configure exposes its streamId field on the live permutation", async () => {
    const runId = "run_flow_live_field";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);
        yield* configure(bus, "cfg-live", runId, systemConfigConfigureScope, {
          chain: "eip155:31337",
          capture: "file",
          process: null,
          publish: "live"
        });

        const descriptors = yield* describeConsole(bus);
        const liveConfigure = descriptors.find((d) => d.id === "observe.sink.live.configure");
        expect(liveConfigure?.visible).toBe(true);
        expect(fieldNames(liveConfigure)).toEqual(["streamId"]);

        // sink:file-export must NOT be reachable on the live permutation (only one publish sink mounts).
        expect(descriptors.some((d) => d.id === "observe.sink.file-export.configure")).toBe(false);
        return true;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("configures capture BEFORE any sink without the sink-policy loop", async () => {
    const runId = "run_flow_order";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);
        yield* configure(bus, "cfg-fe", runId, systemConfigConfigureScope, {
          chain: "eip155:31337",
          capture: "file",
          process: null,
          publish: "file-export"
        });

        // Capture first — this previously hard-failed with "At least one sink policy is required".
        yield* configure(bus, "cfg-cap", runId, fileCaptureConfigureScope, {
          path: "/tmp/livestreak-flow/capture.mp4"
        });
        // Then the sink — both orders must be legal now.
        yield* configure(bus, "cfg-sink", runId, fileSinkConfigureScope, {
          path: "/tmp/livestreak-flow/out.mp4"
        });

        const board = yield* bus.readBoard();
        expect(board.cells["capture:file"]?.readonly?.configured).toBe(true);
        expect(board.cells["sink:file-export"]?.readonly?.configured).toBe(true);
        return true;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("full live sequence (config → sink:live → capture → market) derives a valid live run config", async () => {
    const runId = "run_flow_full";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);

        // Only values a rendered form could supply, dispatched in the order the console presents.
        yield* configure(bus, "cfg-live", runId, systemConfigConfigureScope, {
          chain: "eip155:31337",
          capture: "file",
          process: null,
          publish: "live"
        });
        yield* configure(bus, "cfg-sink", runId, liveSinkConfigureScope, {
          streamId: "market-abc"
        });
        yield* configure(bus, "cfg-cap", runId, fileCaptureConfigureScope, {
          path: "/tmp/livestreak-flow/capture.mp4"
        });
        yield* bus.callFunction({
          callId: "cfg-market",
          runId,
          scope: marketRegisterScope,
          payload: { title: "demo" }
        });

        const board = yield* bus.readBoard();
        // The console prepare gate (prepareConfiguredRun → runConfigFromBoard). Succeeding here is exactly
        // what "prepare succeeds" means for the operator — a valid live run config off the configured board.
        return yield* runConfigFromBoard({
          runId,
          board,
          hostBaseUrl: "http://127.0.0.1:8787"
        });
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const config = exit.value;
      expect(config.capture.driverId).toBe("file");
      expect(config.sink.driverId).toBe("live");
      expect((config.capture.config as { path?: string }).path).toBe(
        "/tmp/livestreak-flow/capture.mp4"
      );
      expect((config.sink.config as { streamId?: string }).streamId).toBe(
        defaultFakeRegisterResult({ runId, title: "demo" }).marketId
      );
    }
  });
});
