import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { applyBoardPatch } from "#run/control/board/index.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";

const baseBoard = createBrowserBoardFixture("run_patch", {
  url: "https://example.com",
  captureFps: 30,
  viewport: { width: 640, height: 360 },
  crop: { x: 0, y: 0, width: 640, height: 360 },
  encoding: "jpeg"
});

describe("applyBoardPatch", () => {
  it("applies set and unset keys and bumps revision when changed", async () => {
    const result = await Effect.runPromise(
      applyBoardPatch(baseBoard, {
        cells: {
          "capture:browser": {
            settings: {
              set: {
                selectedTargetId: "video:0",
                cropSource: "target"
              },
              unset: ["crop"]
            }
          }
        }
      })
    );

    expect(result.changed).toBe(true);
    expect(result.board.revision).toBe(2);
    expect(result.board.cells["capture:browser"]?.settings).toEqual({
      url: "https://example.com",
      captureFps: 30,
      viewport: { width: 640, height: 360 },
      encoding: "jpeg",
      maxPumpMs: 4,
      selectedTargetId: "video:0",
      cropSource: "target"
    });
  });

  it("does not bump revision for a no-op patch", async () => {
    const result = await Effect.runPromise(
      applyBoardPatch(baseBoard, {
        cells: {
          "capture:browser": {
            settings: {
              set: {
                captureFps: 30
              }
            }
          }
        }
      })
    );

    expect(result.changed).toBe(false);
    expect(result.board.revision).toBe(1);
  });

  it("does not bump revision when set values are structurally equal", async () => {
    const result = await Effect.runPromise(
      applyBoardPatch(baseBoard, {
        cells: {
          "capture:browser": {
            settings: {
              set: {
                crop: { x: 0, y: 0, width: 640, height: 360 }
              }
            }
          }
        }
      })
    );

    expect(result.changed).toBe(false);
    expect(result.board.revision).toBe(1);
    expect(result.board).toBe(baseBoard);
  });

  it("fails when the same key appears in set and unset", async () => {
    const exit = await Effect.runPromiseExit(
      applyBoardPatch(baseBoard, {
        cells: {
          "capture:browser": {
            settings: {
              set: { crop: { x: 1, y: 2, width: 3, height: 4 } },
              unset: ["crop"]
            }
          }
        }
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("cannot set and unset the same keys");
    }
  });
});

// Prepared is a derivation of the board: a pipeline config change while prepared demotes the
// run cell (start re-prepares), so start can never run a config the board no longer shows.
describe("applyBoardPatch prepared demotion", () => {
  const preparedBoard = {
    revision: 5,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        catalog: "system:run",
        status: ["prepared", null, 1] as const,
        readonly: { prepared: true },
        functions: ["prepare", "start", "await", "stop"]
      },
      "sink:direct": {
        label: "Direct Stream",
        catalog: "sink:direct",
        status: ["configured", null, 1] as const,
        settings: { streamId: "0xold", port: 48700 },
        functions: ["configure", "close"]
      },
      market: {
        label: "Market",
        catalog: "market",
        status: ["registered", null, 1] as const,
        readonly: { marketId: "0xold" },
        functions: ["register"]
      }
    }
  };

  it("demotes prepared when a sink cell's settings change", async () => {
    const result = await Effect.runPromise(
      applyBoardPatch(preparedBoard, {
        cells: { "sink:direct": { settings: { set: { streamId: "0xnew" } } } }
      })
    );

    expect(result.changed).toBe(true);
    expect(result.board.cells["system:run"]?.readonly?.prepared).toBe(false);
    expect(result.board.cells["system:run"]?.status[0]).toBe("created");
    expect(result.board.cells["system:run"]?.status[1]).toContain("re-prepare");
  });

  it("demotes prepared when the market cell's marketId changes", async () => {
    const result = await Effect.runPromise(
      applyBoardPatch(preparedBoard, {
        cells: { market: { readonly: { set: { marketId: "0xnew" } } } }
      })
    );

    expect(result.board.cells["system:run"]?.readonly?.prepared).toBe(false);
  });

  it("leaves prepared intact for readonly-only pipeline patches", async () => {
    const result = await Effect.runPromise(
      applyBoardPatch(preparedBoard, {
        cells: { "sink:direct": { readonly: { set: { configured: true } } } }
      })
    );

    expect(result.changed).toBe(true);
    expect(result.board.cells["system:run"]?.readonly?.prepared).toBe(true);
  });

  it("leaves prepared intact when the run is not prepared", async () => {
    const unprepared = {
      ...preparedBoard,
      cells: {
        ...preparedBoard.cells,
        "system:run": {
          ...preparedBoard.cells["system:run"],
          readonly: { prepared: false }
        }
      }
    };
    const result = await Effect.runPromise(
      applyBoardPatch(unprepared, {
        cells: { "sink:direct": { settings: { set: { streamId: "0xnew" } } } }
      })
    );

    expect(result.board.cells["system:run"]?.status[0]).not.toBe("created");
    expect(result.board.cells["system:run"]?.readonly?.prepared).toBe(false);
  });
});
