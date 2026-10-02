import { Cause, Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { Board } from "#run/control/board/index.js";
import type { ControlArtifact } from "#run/control/bus/calls.js";
import type { ArtifactSubscription, BoardSubscription, WakeSubscription } from "./types.js";

export type WakeListener = () => Effect.Effect<void, LiveStreakError, never>;

export const createWakeSubscriptionRegistry = (): {
  readonly subscribe: (listener: WakeListener) => WakeSubscription;
  readonly notifyAll: () => Effect.Effect<void, never, never>;
  readonly size: () => number;
} => {
  // Independent registration identity per receipt: unsubscribing one receipt removes only its
  // own registration, even when the same callback was registered twice.
  let nextId = 0;
  const listeners = new Map<number, WakeListener>();

  return {
    subscribe: (listener) => {
      nextId += 1;
      const id = nextId;
      listeners.set(id, listener);
      return {
        unsubscribe: () =>
          Effect.sync(() => {
            listeners.delete(id);
          })
      };
    },
    // Fan-out to every lifetime-bound subscriber. Each listener runs exit-captured: a typed
    // failure, synchronous throw or defect is contained and peers still fire. Genuine caller
    // cancellation is NOT swallowed — an interrupted notifier still interrupts the fan-out.
    notifyAll: () =>
      Effect.forEach(
        Array.from(listeners.values()),
        (listener) =>
          Effect.exit(Effect.suspend(() => listener())).pipe(
            Effect.flatMap((exit) =>
              exit._tag === "Failure" && Cause.isInterruptedOnly(exit.cause)
                ? Effect.interrupt
                : Effect.void
            )
          ),
        { discard: true }
      ).pipe(Effect.asVoid),
    size: () => listeners.size
  };
};

export const createBoardSubscriptionRegistry = (): {
  readonly subscribe: (listener: (board: Board) => void) => BoardSubscription;
  readonly notify: (board: Board) => void;
} => {
  const listeners = new Set<(board: Board) => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return {
        unsubscribe: () =>
          Effect.sync(() => {
            listeners.delete(listener);
          })
      };
    },
    notify: (board) => {
      // O8: listeners are arbitrary consumer callbacks (registered via the
      // bridge). A throw here runs inside the committing fiber (commitBoard /
      // applyPatch) and would defect that fiber AND skip the remaining
      // subscribers. Isolate each listener so one bad subscriber can do neither.
      for (const listener of listeners) {
        try {
          listener(board);
        } catch {
          // swallow: a misbehaving subscriber must not affect peers or the committer.
        }
      }
    }
  };
};

export const createArtifactSubscriptionRegistry = (): {
  readonly subscribe: (listener: (artifact: ControlArtifact) => void) => ArtifactSubscription;
  readonly notify: (artifact: ControlArtifact) => void;
} => {
  const listeners = new Set<(artifact: ControlArtifact) => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return {
        unsubscribe: () =>
          Effect.sync(() => {
            listeners.delete(listener);
          })
      };
    },
    notify: (artifact) => {
      // O8: isolate each artifact subscriber (see board notify above).
      for (const listener of listeners) {
        try {
          listener(artifact);
        } catch {
          // swallow: a misbehaving subscriber must not affect peers or the committer.
        }
      }
    }
  };
};
