import type { BookmakerRuntimeState } from "./store.js";

// --- exports ---

export const createSnapshotSubscriptionRegistry = () => {
  const listeners = new Set<(state: BookmakerRuntimeState) => void>();

  return {
    notify: (state: BookmakerRuntimeState) => {
      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe: (listener: (state: BookmakerRuntimeState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
};
