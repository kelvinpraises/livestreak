import type { Board } from "#run/control/board/model.js";
import { incrementBoardRevision } from "#run/control/board/model.js";
import type { BoardPatch } from "#run/control/bus/types.js";
import type { MarketLifecycleState } from "./types.js";

// The full universe of `readonly` keys the market cell may carry across all
// lifecycle states. A cell-scoped patch (O2) sets the keys for the new state and
// unsets the rest, reproducing the full-replacement semantics of
// `applyMarketLifecycleToBoard` while only ever touching the `market` cell.
const ALL_MARKET_READONLY_KEYS = [
  "registrationState",
  "startedAtMs",
  "marketId",
  "streamId",
  "userOpHash",
  "registeredAtMs",
  "scheme",
  "pointerId",
  "liveAtMs",
  "endedAtMs",
  "reason",
  "phase",
  "failedAtMs"
] as const;

/**
 * O2: build a BoardPatch that mutates ONLY the `market` cell's status + readonly.
 * Because the market-registration fiber writes through this disjoint cell-scoped
 * patch (merge reducer) instead of a full-board `commitBoard`, it can never
 * clobber the worker fiber's other cells regardless of interleave — the
 * lost-update race is designed out at the source.
 */
export const marketLifecyclePatch = (
  lifecycle: MarketLifecycleState,
  nowMs: number = Date.now()
): BoardPatch => {
  const nextReadonly = marketReadonlyFromLifecycle(lifecycle);
  const presentKeys = new Set(Object.keys(nextReadonly));
  const unset = ALL_MARKET_READONLY_KEYS.filter((key) => !presentKeys.has(key));

  return {
    cells: {
      market: {
        status: [lifecycle.status, lifecycleReason(lifecycle), nowMs],
        readonly: {
          set: nextReadonly,
          ...(unset.length > 0 ? { unset } : {})
        }
      }
    }
  };
};

export const applyMarketLifecycleToBoard = (
  board: Board,
  lifecycle: MarketLifecycleState,
  nowMs: number = Date.now()
): Board => {
  const cell = board.cells["market"];
  if (cell === undefined) {
    return board;
  }

  const nextStatus = lifecycle.status;
  const nextReason = lifecycleReason(lifecycle);
  const nextReadonly = marketReadonlyFromLifecycle(lifecycle);

  if (
    cell.status[0] === nextStatus &&
    cell.status[1] === nextReason &&
    jsonEqual(cell.readonly ?? {}, nextReadonly)
  ) {
    return board;
  }

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      market: {
        ...cell,
        status: [nextStatus, nextReason, nowMs],
        readonly: nextReadonly
      }
    }
  });
};

// --- helpers ---

const lifecycleReason = (lifecycle: MarketLifecycleState): string | null => {
  switch (lifecycle.status) {
    case "none": {
      return null;
    }
    case "pending": {
      return "market registration in flight";
    }
    case "registered": {
      return `registered ${lifecycle.marketId}`;
    }
    case "live": {
      return `live ${lifecycle.marketId}`;
    }
    case "ended": {
      return `ended ${lifecycle.marketId}`;
    }
    case "failed": {
      return lifecycle.reason;
    }
  }
};

const marketReadonlyFromLifecycle = (
  lifecycle: MarketLifecycleState
): Record<string, unknown> => {
  switch (lifecycle.status) {
    case "none": {
      return { registrationState: "none" };
    }
    case "pending": {
      return { registrationState: "pending", startedAtMs: lifecycle.startedAtMs };
    }
    case "registered": {
      return {
        registrationState: "registered",
        marketId: lifecycle.marketId,
        streamId: lifecycle.streamId,
        userOpHash: lifecycle.userOpHash,
        registeredAtMs: lifecycle.registeredAtMs
      };
    }
    case "live": {
      return {
        registrationState: "live",
        marketId: lifecycle.marketId,
        scheme: lifecycle.scheme,
        pointerId: lifecycle.pointerId,
        userOpHash: lifecycle.userOpHash,
        liveAtMs: lifecycle.liveAtMs
      };
    }
    case "ended": {
      return {
        registrationState: "ended",
        marketId: lifecycle.marketId,
        scheme: lifecycle.scheme,
        pointerId: lifecycle.pointerId,
        userOpHash: lifecycle.userOpHash,
        endedAtMs: lifecycle.endedAtMs
      };
    }
    case "failed": {
      return {
        registrationState: "failed",
        reason: lifecycle.reason,
        phase: lifecycle.phase,
        failedAtMs: lifecycle.failedAtMs
      };
    }
  }
};

const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (left === null || right === null || typeof left !== typeof right) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);

    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every(
        (key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key])
      )
    );
  }

  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
