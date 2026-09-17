import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { projectBoardControls, projectObserveDescriptors } from "#bridge/panel/index.js";
import { isValidFlowPermutation } from "#flows/index.js";
import { systemConfigConfigureScope } from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";
import { fileSinkConfigureScope } from "#pipeline/publish/sinks/file/commands.js";

describe("board-first configurator visibility", () => {
  it("T0 board exposes only system:config configure (close hidden until configured)", () => {
    const board = createInitialBoard({ runId: "run_t0", nowMs: 1 });
    const controls = projectBoardControls(board);

    expect(Object.keys(board.cells)).toEqual(["system:config"]);
    expect(controls.cells.map((cell) => cell.id)).toEqual(["system:config"]);
    // A pristine (idle) config cell was never configured, so `close` — which tears down mounted
    // configurators — is nonsensical and stays hidden. Only `configure` is offered at T0.
    expect(controls.cells[0]?.functions.map((fn) => fn.name)).toEqual(["configure"]);
  });

  it("v0 permutation table accepts file×file-export and file×live only", () => {
    expect(isValidFlowPermutation({ capture: "file", publish: "file-export", process: null })).toBe(
      true
    );
    expect(isValidFlowPermutation({ capture: "file", publish: "live", process: null })).toBe(true);
    expect(isValidFlowPermutation({ capture: "browser", publish: "live", process: null })).toBe(
      false
    );
    expect(isValidFlowPermutation({ capture: "file", publish: "live", process: "transcode" })).toBe(
      false
    );
  });

  it("configure mounts pipeline cells and hides root configurator from live set", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_configure",
          board: createInitialBoard({ runId: "run_configure", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: createObserveControlSurfaces()
        });

        yield* bus.callFunction({
          callId: "cfg-1",
          runId: "run_configure",
          scope: systemConfigConfigureScope,
          payload: {
            chain: "eip155:31337",
            capture: "file",
            process: null,
            publish: "file-export"
          }
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const board = exit.value;
      expect(board.cells["capture:file"]).toBeDefined();
      expect(board.cells["sink:file-export"]).toBeDefined();
      expect(board.cells["system:run"]).toBeDefined();
      expect(board.cells.market).toBeDefined();
      expect(board.cells["system:config"]?.readonly?.liveConfigurators).not.toContain(
        "observe.system.config"
      );

      const controls = projectBoardControls(board);
      expect(controls.cells.some((cell) => cell.id === "system:config")).toBe(false);

      // Freshly mounted pipeline cells (readonly.configured === false) expose only `configure`; their
      // `close` (which removes the cell) stays hidden until the cell carries real config.
      const captureCell = controls.cells.find((cell) => cell.id === "capture:file");
      expect(captureCell?.functions.map((fn) => fn.name)).toEqual(["configure"]);
      const sinkCell = controls.cells.find((cell) => cell.id === "sink:file-export");
      expect(sinkCell?.functions.map((fn) => fn.name)).toEqual(["configure"]);

      const descriptors = projectObserveDescriptors(controls, board);
      const rootConfigure = descriptors.find((d) => d.id === "observe.system.config.configure");
      expect(rootConfigure).toBeUndefined();
      const captureConfigure = descriptors.find((d) => d.id === "observe.capture.file.configure");
      expect(captureConfigure?.visible).toBe(true);
      expect(captureConfigure?.package).toBe("observe");
      // `close` is filtered out of the ControlsView before projection, so no close descriptor exists on
      // an unconfigured pipeline cell (nothing to render).
      const captureClose = descriptors.find((d) => d.id === "observe.capture.file.close");
      expect(captureClose).toBeUndefined();
    }
  });

  it("a pipeline cell's own configure reveals its close", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_close_reveal",
          board: createInitialBoard({ runId: "run_close_reveal", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: createObserveControlSurfaces()
        });

        yield* bus.callFunction({
          callId: "cfg-root",
          runId: "run_close_reveal",
          scope: systemConfigConfigureScope,
          payload: { chain: "eip155:31337", capture: "file", process: null, publish: "file-export" }
        });

        // Configure the sink first (the bus requires a configured sink policy), then the capture cell.
        yield* bus.callFunction({
          callId: "cfg-sink",
          runId: "run_close_reveal",
          scope: fileSinkConfigureScope,
          payload: { path: "/tmp/livestreak-test/out.mp4" }
        });

        yield* bus.callFunction({
          callId: "cfg-capture",
          runId: "run_close_reveal",
          scope: fileCaptureConfigureScope,
          payload: { path: "/tmp/livestreak-test/capture.mp4" }
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const board = exit.value;
      expect(board.cells["capture:file"]?.readonly?.configured).toBe(true);
      expect(board.cells["sink:file-export"]?.readonly?.configured).toBe(true);

      const controls = projectBoardControls(board);
      const captureCell = controls.cells.find((cell) => cell.id === "capture:file");
      // Now configured, both configure and close are offered — the operator can tear the cell back down.
      expect(captureCell?.functions.map((fn) => fn.name)).toEqual(["configure", "close"]);
      const sinkCell = controls.cells.find((cell) => cell.id === "sink:file-export");
      expect(sinkCell?.functions.map((fn) => fn.name)).toEqual(["configure", "close"]);

      const descriptors = projectObserveDescriptors(controls, board);
      expect(descriptors.find((d) => d.id === "observe.capture.file.close")?.visible).toBe(true);
      expect(descriptors.find((d) => d.id === "observe.sink.file-export.close")?.visible).toBe(true);
    }
  });
});
