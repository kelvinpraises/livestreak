import type { CreateVaultResult, TxId } from "../chains/types.js";

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
  readonly getSettled: (key: string) => CreateVaultResult | undefined;
  readonly getPendingHash: (key: string) => TxId | undefined;
  readonly settle: (key: string, result: CreateVaultResult) => void;
  readonly markPending: (key: string, userOpHash: TxId) => void;
  readonly recordFailure: (key: string, error: unknown) => void;
  readonly runExclusive: <T>(key: string, exec: () => Promise<T>) => Promise<T>;
  readonly snapshot: () => ReadonlyMap<string, IdempotencySnapshotEntry>;
  readonly failureSnapshot: () => ReadonlyMap<string, readonly IdempotencyFailureRecord[]>;
}

export const createIdempotencyStore = (): IdempotencyStore => {
  const settled = new Map<string, CreateVaultResult>();
  const pending = new Map<string, TxId>();
  const inFlight = new Map<string, Promise<CreateVaultResult>>();
  const failures = new Map<string, IdempotencyFailureRecord[]>();
  const exclusiveChains = new Map<string, Promise<unknown>>();

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

    getSettled: (key) => settled.get(key),

    getPendingHash: (key) => pending.get(key),

    settle: (key, result) => {
      settled.set(key, result);
      pending.delete(key);
      inFlight.delete(key);
    },

    markPending: (key, userOpHash) => {
      pending.set(key, userOpHash);
      inFlight.delete(key);
    },

    recordFailure,

    runExclusive: async (key, exec) => {
      const previous = exclusiveChains.get(key) ?? Promise.resolve();
      const next = previous.then(() => exec());
      exclusiveChains.set(
        key,
        next.catch(() => undefined)
      );

      try {
        return await next;
      } finally {
        if (exclusiveChains.get(key) === next) {
          exclusiveChains.delete(key);
        }
      }
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
