import { Effect } from "effect";
import type { Board } from "#run/control/board/index.js";
import type { ControlArtifact } from "#run/control/bus/calls.js";
import type { ArtifactSubscription, BoardSubscription } from "./types.js";

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
