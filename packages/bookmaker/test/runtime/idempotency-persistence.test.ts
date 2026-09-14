import { describe, expect, it } from "vitest";

import {
  createIdempotencyStore,
  type IdempotencyPersistedState
} from "../../src/runtime/idempotency.js";
import { asTxId } from "../../src/chains/types.js";
import type { CreateVaultResult, VaultId } from "../../src/chains/types.js";

const result = (n: string): CreateVaultResult => ({
  txId: asTxId(`0x${n.repeat(32)}`),
  vaultId: `0x${n.repeat(32)}` as VaultId
});

describe("idempotency store persistence port", () => {
  it("fires onChange with the durable slice on settle and markPending", async () => {
    const writes: IdempotencyPersistedState[] = [];
    const store = createIdempotencyStore({ onChange: (state) => writes.push(state) });

    store.markPending("key-a", asTxId(`0x${"11".repeat(32)}`));
    store.settle("key-a", result("aa"));

    expect(writes.length).toBe(2);
    expect(writes[0]?.pending["key-a"]).toBe(`0x${"11".repeat(32)}`);
    // settle clears pending and records the result
    expect(writes[1]?.pending["key-a"]).toBeUndefined();
    expect(writes[1]?.settled["key-a"]?.vaultId).toBe(`0x${"aa".repeat(32)}`);
  });

  it("rehydrates settled + pending from initial state (restart recovery)", () => {
    const initial: IdempotencyPersistedState = {
      settled: { "key-done": result("bb") },
      pending: { "key-live": asTxId(`0x${"22".repeat(32)}`) }
    };
    const store = createIdempotencyStore({ initial });

    expect(store.getSettled("key-done")?.vaultId).toBe(`0x${"bb".repeat(32)}`);
    expect(store.getPendingHash("key-live")).toBe(`0x${"22".repeat(32)}`);
  });

  it("round-trips through a serialized snapshot", () => {
    const writes: IdempotencyPersistedState[] = [];
    const first = createIdempotencyStore({ onChange: (state) => writes.push(state) });
    first.settle("k", result("cc"));

    const snapshot = JSON.parse(
      JSON.stringify(writes.at(-1))
    ) as IdempotencyPersistedState;
    const second = createIdempotencyStore({ initial: snapshot });

    expect(second.getSettled("k")?.txId).toBe(`0x${"cc".repeat(32)}`);
  });
});
