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
      for (const listener of listeners) {
        listener(board);
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
      for (const listener of listeners) {
        listener(artifact);
      }
    }
  };
};
