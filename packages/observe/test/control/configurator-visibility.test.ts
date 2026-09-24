import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import type { ControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { projectBoardControls, projectObserveDescriptors } from "#bridge/panel/index.js";
import { isValidFlowPermutation } from "#flows/index.js";
import {
  observationCellId,
  readObservationIndex,
  systemConfigConfigureScope
} from "#run/control/system/config.js";
import { fileCaptureConfigureScope } from "#pipeline/capture/file/commands.js";

const addObservation = (bus: ControlBus, runId: string) =>
  Effect.gen(function* () {
    yield* bus.callFunction({
      callId: `cfg-${runId}`,
      runId,
      scope: systemConfigConfigureScope,
      payload: { title: "Test stream", chain: "eip155:31337" }
    });
    const board = yield* bus.readBoard();
    const obsId = Object.keys(readObservationIndex(board))[0]!;
    return { board, obsId };
  });

describe("board-first configurator visibility", () => {
  it("T0 board exposes only session configure (close and remove hidden while empty)", () => {
    const board = createInitialBoard({ runId: "run_t0", nowMs: 1 });
    const controls = projectBoardControls(board);

    expect(Object.keys(board.cells)).toEqual(["system:config"]);
    expect(controls.cells.map((cell) => cell.id)).toEqual(["system:config"]);
    // A pristine session has nothing to close and nothing to remove.
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

  it("Add observation mounts the family; the session stays visible", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_configure",
          board: createInitialBoard({ runId: "run_configure", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: createObserveControlSurfaces()
        });
        return yield* addObservation(bus, "run_configure");
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { board, obsId } = exit.value;
      expect(board.cells[observationCellId(obsId, "capture")]).toBeDefined();
      expect(board.cells[observationCellId(obsId, "publish")]).toBeDefined();
      expect(board.cells[observationCellId(obsId, "run")]).toBeDefined();
      expect(board.cells[observationCellId(obsId, "market")]).toBeDefined();
      expect(board.cells[observationCellId(obsId, "market")]?.readonly?.title).toBe("Test stream");

      const controls = projectBoardControls(board);
      // The session is permanent — it can add more observations at any time.
      const session = controls.cells.find((cell) => cell.id === "system:config");
      expect(session?.functions.map((fn) => fn.name)).toEqual(["configure", "close", "remove", "publishKind"]);

      // Fresh family pipeline cells expose only configure; close waits for real config.
      const captureCell = controls.cells.find(
        (cell) => cell.id === observationCellId(obsId, "capture")
      );
      expect(captureCell?.functions.map((fn) => fn.name)).toEqual(["configure"]);

      const descriptors = projectObserveDescriptors(controls, board);
      const captureConfigure = descriptors.find(
        (d) => d.id === `observe.obs.${obsId}.capture.configure`
      );
      expect(captureConfigure?.visible).toBe(true);
      expect(captureConfigure?.package).toBe("observe");
      const captureClose = descriptors.find((d) => d.id === `observe.obs.${obsId}.capture.close`);
      expect(captureClose).toBeUndefined();
    }
  });

  it("a family capture cell's own configure reveals its close", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId: "run_close_reveal",
          board: createInitialBoard({ runId: "run_close_reveal", nowMs: 1 }),
          catalog: buildControlCatalog(),
          surfaces: createObserveControlSurfaces()
        });
        const { obsId } = yield* addObservation(bus, "run_close_reveal");

        yield* bus.callFunction({
          callId: "cfg-capture",
          runId: "run_close_reveal",
          cellId: observationCellId(obsId, "capture"),
          scope: fileCaptureConfigureScope,
          payload: { path: "/tmp/livestreak-test/capture.mp4" }
        });

        return { board: yield* bus.readBoard(), obsId };
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const { board, obsId } = exit.value;
      const captureId = observationCellId(obsId, "capture");
      expect(board.cells[captureId]?.readonly?.configured).toBe(true);
      expect(board.cells[captureId]?.settings?.path).toBe("/tmp/livestreak-test/capture.mp4");

      const controls = projectBoardControls(board);
      const captureCell = controls.cells.find((cell) => cell.id === captureId);
      expect(captureCell?.functions.map((fn) => fn.name)).toEqual(["configure", "close"]);
      // The publish cell is still unconfigured — its close stays hidden.
      const publishCell = controls.cells.find(
        (cell) => cell.id === observationCellId(obsId, "publish")
      );
      expect(publishCell?.functions.map((fn) => fn.name)).toEqual(["configure"]);

      const descriptors = projectObserveDescriptors(controls, board);
      expect(
        descriptors.find((d) => d.id === `observe.obs.${obsId}.capture.close`)?.visible
      ).toBe(true);
    }
  });
});
