import { describe, expect, it } from "vitest";
import { createInitialBoard } from "#run/control/board/index.js";
import { extendBoardForMarketTests } from "#test/helpers/board.js";
import { applyMarketLifecycleToBoard } from "#market/board.js";

describe("market board reducer", () => {
  it("projects none -> pending -> registered lifecycle transitions", () => {
    const initial = extendBoardForMarketTests(
      createInitialBoard({ runId: "run_board", nowMs: 1_000 }),
      "run_board"
    );
    expect(initial.cells["market"]?.status[0]).toBe("none");

    const pending = applyMarketLifecycleToBoard(
      initial,
      {
        status: "pending",
        startedAtMs: 2_000
      },
      2_000
    );
    expect(pending.cells["market"]?.status).toEqual([
      "pending",
      "market registration in flight",
      2_000
    ]);
    expect(pending.revision).toBe(2);

    const registered = applyMarketLifecycleToBoard(
      pending,
      {
        status: "registered",
        marketId: "0x01",
        streamId: "0xstream",
        userOpHash: "0xuserop",
        registeredAtMs: 3_000
      },
      3_000
    );
    expect(registered.cells["market"]?.readonly).toMatchObject({
      registrationState: "registered",
      marketId: "0x01",
      streamId: "0xstream",
      userOpHash: "0xuserop"
    });
    expect(registered.cells["market"]?.status[2]).toBe(3_000);
  });

  it("projects failed lifecycle with reason and phase", () => {
    const initial = extendBoardForMarketTests(
      createInitialBoard({ runId: "run_board_fail", nowMs: 1_000 }),
      "run_board_fail"
    );
    const failed = applyMarketLifecycleToBoard(initial, {
      status: "failed",
      reason: "paymaster refused sponsorship",
      phase: "paymaster",
      failedAtMs: 4_000
    });

    expect(failed.cells["market"]?.status[0]).toBe("failed");
    expect(failed.cells["market"]?.readonly).toMatchObject({
      registrationState: "failed",
      phase: "paymaster"
    });
  });
});
