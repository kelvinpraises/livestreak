// Pristine-board OPERATOR FLOW — the regression guard for the live-operator remote console.
//
// Drives the SAME control surface the observe console edge wraps, on a pristine T0 board, in the
// FAMILY world: Add observation (title + chain) mints the family, cell configures carry details,
// register takes its title from the board, and the prepare gate derives a valid live run config
// from ONLY what a rendered form could supply.
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import type { FunctionDescriptor } from "@livestreak/schema";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import type { ControlBus, ControlPanel } from "#run/control/bus/index.js";
import { createInitialBoard, type Board } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { projectControlPanelControls, projectObserveDescriptors } from "#bridge/panel/index.js";
import {
  observationCellId,
  observationPublishKindPatch,
  readObservationIndex,
  systemConfigConfigureScope
} from "#run/control/system/config.js";
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

const addObservation = (bus: ControlBus, runId: string) =>
  Effect.gen(function* () {
    yield* bus.callFunction({
      callId: `add-${runId}`,
      runId,
      scope: systemConfigConfigureScope,
      payload: { title: "demo", chain: "eip155:31337" }
    });
    const board = yield* bus.readBoard();
    return Object.keys(readObservationIndex(board))[0]!;
  });

describe("pristine-board operator flow", () => {
  it("every visible configure descriptor exposes its validator's required fields", async () => {
    const runId = "run_flow_fields";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);

        // Add observation renders its own fields at T0 (title + chain).
        const t0 = yield* describeConsole(bus);
        const t0Config = t0.find((d) => d.id === "observe.system.config.configure");
        expect(t0Config?.visible).toBe(true);
        expect(fieldNames(t0Config)).toEqual(["title", "chain"]);

        const obsId = yield* addObservation(bus, runId);
        // Flip the family publish kind to file-export (the console's kind switch).
        yield* bus.applyBoardPatch(observationPublishKindPatch(obsId, "file-export", 2));

        const after = yield* describeConsole(bus);
        const captureConfigure = after.find(
          (d) => d.id === `observe.obs.${obsId}.capture.configure`
        );
        const sinkConfigure = after.find(
          (d) => d.id === `observe.obs.${obsId}.publish.configure`
        );

        // The regression guard: a form can satisfy each validator — no fieldless dead end.
        expect(sinkConfigure?.visible).toBe(true);
        expect(fieldNames(sinkConfigure)).toEqual(["path"]);
        expect(fieldNames(captureConfigure)).toEqual(["path"]);

        return true;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("the live publish configure takes NO fields — streamId is board-derived, never typed", async () => {
    const runId = "run_flow_live_field";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);
        const obsId = yield* addObservation(bus, runId);

        const descriptors = yield* describeConsole(bus);
        const liveConfigure = descriptors.find(
          (d) => d.id === `observe.obs.${obsId}.publish.configure`
        );
        expect(liveConfigure?.visible).toBe(true);
        expect(fieldNames(liveConfigure)).toEqual([]);
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
        const obsId = yield* addObservation(bus, runId);
        yield* bus.applyBoardPatch(observationPublishKindPatch(obsId, "file-export", 2));

        // Capture first — this previously hard-failed with "At least one sink policy is required".
        yield* bus.callFunction({
          callId: "cfg-cap",
          runId,
          cellId: observationCellId(obsId, "capture"),
          scope: fileCaptureConfigureScope,
          payload: { path: "/tmp/livestreak-flow/capture.mp4" }
        });
        yield* bus.callFunction({
          callId: "cfg-sink",
          runId,
          cellId: observationCellId(obsId, "publish"),
          scope: fileSinkConfigureScope,
          payload: { path: "/tmp/livestreak-flow/out.mp4" }
        });

        const board = yield* bus.readBoard();
        expect(board.cells[observationCellId(obsId, "capture")]?.readonly?.configured).toBe(true);
        expect(board.cells[observationCellId(obsId, "publish")]?.readonly?.configured).toBe(true);
        return true;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("full live sequence derives a valid live run config from the family board", async () => {
    const runId = "run_flow_full";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus(runId);
        const obsId = yield* addObservation(bus, runId);

        yield* bus.callFunction({
          callId: "cfg-sink",
          runId,
          cellId: observationCellId(obsId, "publish"),
          scope: liveSinkConfigureScope,
          payload: {}
        });
        yield* bus.callFunction({
          callId: "cfg-cap",
          runId,
          cellId: observationCellId(obsId, "capture"),
          scope: fileCaptureConfigureScope,
          payload: { path: "/tmp/livestreak-flow/capture.mp4" }
        });
        // Register takes NO title — the board carries it from Add observation.
        yield* bus.callFunction({
          callId: "cfg-market",
          runId,
          cellId: observationCellId(obsId, "market"),
          scope: marketRegisterScope,
          payload: {}
        });

        const board = yield* bus.readBoard();
        return yield* runConfigFromBoard({
          runId,
          board,
          hostBaseUrl: "http://127.0.0.1:8787",
          obsId
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
        defaultFakeRegisterResult({ runId: "run_flow_full", title: "demo" }).marketId
      );
    }
  });
});
