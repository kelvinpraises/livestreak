import type { CreateVaultResult } from "../chains/types.js";

// --- exports ---

export type IdempotencyRunResult = {
  readonly result: CreateVaultResult;
  readonly idempotent: boolean;
};

export type IdempotencyFailureRecord = {
  readonly message: string;
};

export type IdempotencySnapshotEntry = {
  readonly result: CreateVaultResult;
};

export interface IdempotencyStore {
  readonly run: (
    key: string,
    exec: () => Promise<CreateVaultResult>
  ) => Promise<IdempotencyRunResult>;
  readonly snapshot: () => ReadonlyMap<string, IdempotencySnapshotEntry>;
  readonly failureSnapshot: () => ReadonlyMap<string, readonly IdempotencyFailureRecord[]>;
}

export const createIdempotencyStore = (): IdempotencyStore => {
  const settled = new Map<string, CreateVaultResult>();
  const inFlight = new Map<string, Promise<CreateVaultResult>>();
  const failures = new Map<string, IdempotencyFailureRecord[]>();

  const recordFailure = (key: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    const existing = failures.get(key) ?? [];
    failures.set(key, [...existing, { message }]);
  };

  return {
    run: async (key, exec) => {
      const cached = settled.get(key);
      if (cached !== undefined) {
        return { result: cached, idempotent: true };
      }

      const existing = inFlight.get(key);
      if (existing !== undefined) {
        const result = await existing;
        return { result, idempotent: true };
      }

      const promise = (async () => {
        try {
          const result = await exec();
          settled.set(key, result);
          return result;
        } catch (error) {
          inFlight.delete(key);
          recordFailure(key, error);
          throw error;
        } finally {
          if (settled.has(key)) {
            inFlight.delete(key);
          }
        }
      })();

      inFlight.set(key, promise);
      const result = await promise;
      return { result, idempotent: false };
    },

    snapshot: () => {
      const entries = new Map<string, IdempotencySnapshotEntry>();
      for (const [key, result] of settled.entries()) {
        entries.set(key, { result });
      }
      return entries;
    },

    failureSnapshot: () => new Map(failures)
  };
};
