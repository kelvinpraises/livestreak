import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { projectBoardControls, projectObserveDescriptors } from "#bridge/panel/index.js";
import { isValidFlowPermutation } from "#flows/index.js";
import { systemConfigConfigureScope } from "#run/control/system/config.js";

describe("board-first configurator visibility", () => {
  it("T0 board exposes only system:config configure/close", () => {
    const board = createInitialBoard({ runId: "run_t0", nowMs: 1 });
    const controls = projectBoardControls(board);

    expect(Object.keys(board.cells)).toEqual(["system:config"]);
    expect(controls.cells.map((cell) => cell.id)).toEqual(["system:config"]);
    expect(controls.cells[0]?.functions.map((fn) => fn.name)).toEqual(["configure", "close"]);
  });

  it("v0 permutation table accepts file×file-export and file×local only", () => {
    expect(isValidFlowPermutation({ capture: "file", publish: "file-export", process: null })).toBe(
      true
    );
    expect(isValidFlowPermutation({ capture: "file", publish: "local", process: null })).toBe(true);
    expect(isValidFlowPermutation({ capture: "browser", publish: "local", process: null })).toBe(
      false
    );
    expect(isValidFlowPermutation({ capture: "file", publish: "local", process: "transcode" })).toBe(
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

      const descriptors = projectObserveDescriptors(controls, board);
      const rootConfigure = descriptors.find((d) => d.id === "observe.system.config.configure");
      expect(rootConfigure).toBeUndefined();
      const captureConfigure = descriptors.find((d) => d.id === "observe.capture.file.configure");
      expect(captureConfigure?.visible).toBe(true);
      expect(captureConfigure?.package).toBe("observe");
    }
  });
});
