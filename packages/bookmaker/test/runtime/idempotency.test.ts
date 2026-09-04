import { describe, expect, it } from "vitest";
import { LiveStreakRuntimeError } from "@livestreak/core";

import { asTxId, asVaultId } from "../../src/chains/types.js";
import { createIdempotencyStore } from "../../src/runtime/idempotency.js";

describe("createIdempotencyStore", () => {
  const settledResult = {
    txId: asTxId(`0x${"aa".repeat(32)}`),
    vaultId: asVaultId(`0x${"bb".repeat(32)}`)
  };

  it("calls exec once when the same key runs twice", async () => {
    const store = createIdempotencyStore();
    let calls = 0;

    const first = await store.run("key-1", async () => {
      calls += 1;
      return settledResult;
    });
    const second = await store.run("key-1", async () => {
      calls += 1;
      return {
        txId: asTxId(`0x${"cc".repeat(32)}`),
        vaultId: asVaultId(`0x${"dd".repeat(32)}`)
      };
    });

    expect(calls).toBe(1);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.result).toEqual(first.result);
  });

  it("awaits a single in-flight exec for concurrent runs", async () => {
    const store = createIdempotencyStore();
    let calls = 0;

    const exec = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return settledResult;
    };

    const [first, second] = await Promise.all([
      store.run("key-2", exec),
      store.run("key-2", exec)
    ]);

    expect(calls).toBe(1);
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
    expect(first.result).toEqual(second.result);
  });

  it("releases the key when exec throws so a later run can retry", async () => {
    const store = createIdempotencyStore();
    let calls = 0;

    await expect(
      store.run("key-3", async () => {
        calls += 1;
        throw new LiveStreakRuntimeError({ message: "send failed" });
      })
    ).rejects.toBeInstanceOf(LiveStreakRuntimeError);

    const retry = await store.run("key-3", async () => {
      calls += 1;
      return settledResult;
    });

    expect(calls).toBe(2);
    expect(retry.idempotent).toBe(false);
    expect(store.failureSnapshot().get("key-3")).toEqual([{ message: "send failed" }]);
  });

  it("uses different keys for different exec paths", async () => {
    const store = createIdempotencyStore();
    let calls = 0;

    await store.run("key-a", async () => {
      calls += 1;
      return settledResult;
    });
    await store.run("key-b", async () => {
      calls += 1;
      return settledResult;
    });

    expect(calls).toBe(2);
    expect(store.snapshot().size).toBe(2);
  });
});
