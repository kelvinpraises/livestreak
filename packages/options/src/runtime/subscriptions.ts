// --- exports ---

import type { OptionsBoard } from "./board.js";

export interface BoardSubscriptionRegistry {
  readonly subscribe: (listener: (board: OptionsBoard) => void) => () => void;
  readonly notify: (board: OptionsBoard) => void;
}

export const createBoardSubscriptionRegistry = (): BoardSubscriptionRegistry => {
  const listeners = new Set<(board: OptionsBoard) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(board) {
      for (const listener of listeners) {
        listener(board);
      }
    }
  };
};
