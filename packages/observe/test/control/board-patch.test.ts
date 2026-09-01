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
