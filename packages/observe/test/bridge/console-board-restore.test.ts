// Board restore must reach the WIRE. The console rail reads readStoredRunBoard → bus.readBoard, and the
// bus closes over the board it was CONSTRUCTED with — so a saved board has to seed the bus at mount
// time (init.ts ensureObserveShellRun), not replace the store record afterward. These pin that: a board
// configured in "boot A", persisted through the gateway's exact disk serialization, comes back on the
// bus in "boot B" — including when a cell setting was a bigint (money-adjacent boards carry them; JSON
// does not, so the port stringifies, and the restore must not choke on the string form).
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { openObserveConsoleRuntime } from "#index.js";
import { readObservationIndex, systemConfigConfigureScope } from "#run/control/system/config.js";
import type { Board } from "#run/control/board/index.js";

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

// The gateway's file-backed port persists boards with a bigint→string replacer (JSON has no bigint).
const throughDisk = (board: Board): Board =>
  JSON.parse(JSON.stringify(board, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Board;

describe("console board restore reaches the wire (the control bus)", () => {
  it("a board configured in boot A comes back on the bus in boot B for the same runId", async () => {
    const runId = "remote-restore-1";
    const { pristineCount, restoredTitles } = await Effect.runPromise(
      Effect.gen(function* () {
        // Boot A: configure an observation, then capture the board the wire actually serves.
        const a = yield* openObserveConsoleRuntime({ sessionInit, runId });
        yield* a.runtime.callFunction({
          callId: "cfg-a",
          runId,
          scope: systemConfigConfigureScope,
          payload: { title: "restored-observation", chain: "eip155:31337" }
        });
        const savedBoard = yield* a.runtime.readBoard(runId);
        yield* a.close;

        // Negative control: a fresh runtime with NO persistence is pristine (zero observations).
        const pristine = yield* openObserveConsoleRuntime({ sessionInit, runId: "remote-pristine" });
        const pristineBoard = yield* pristine.runtime.readBoard("remote-pristine");
        yield* pristine.close;

        // Boot B: a brand-new runtime for the SAME runId, seeded with the persisted board.
        const b = yield* openObserveConsoleRuntime({
          sessionInit,
          runId,
          boardPersistence: { initial: { [runId]: throughDisk(savedBoard) } }
        });
        const restored = yield* b.runtime.readBoard(runId);
        yield* b.close;

        return {
          pristineCount: Object.keys(readObservationIndex(pristineBoard)).length,
          restoredTitles: Object.values(readObservationIndex(restored)).map((o) => o.title)
        };
      })
    );

    expect(pristineCount).toBe(0);
    expect(restoredTitles).toContain("restored-observation");
  });

  it("restores a board whose cell settings held a bigint (persisted as a string)", async () => {
    const runId = "remote-restore-bigint";
    const restored = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* openObserveConsoleRuntime({ sessionInit, runId });
        yield* a.runtime.callFunction({
          callId: "cfg-big",
          runId,
          scope: systemConfigConfigureScope,
          payload: { title: "big-observation", chain: "eip155:31337" }
        });
        const savedBoard = yield* a.runtime.readBoard(runId);
        yield* a.close;

        // Inject a bigint into a cell's settings the way an options/bookmaker board would carry one,
        // then persist exactly as the port does (bigint → decimal string).
        const configCell = savedBoard.cells["system:config"]!;
        const withBigint = {
          ...savedBoard,
          cells: {
            ...savedBoard.cells,
            "system:config": {
              ...configCell,
              settings: { ...(configCell.settings as Record<string, unknown>), atomicUsdc: 1_000_000n }
            }
          }
        } as Board;

        const b = yield* openObserveConsoleRuntime({
          sessionInit,
          runId,
          boardPersistence: { initial: { [runId]: throughDisk(withBigint) } }
        });
        const board = yield* b.runtime.readBoard(runId);
        yield* b.close;
        return board;
      })
    );

    // The restore reached the bus without choking on the stringified bigint, and the observation is intact.
    const settings = restored.cells["system:config"]!.settings as Record<string, unknown>;
    expect(settings["atomicUsdc"]).toBe("1000000");
    expect(Object.values(readObservationIndex(restored)).map((o) => o.title)).toContain("big-observation");
  });
});
