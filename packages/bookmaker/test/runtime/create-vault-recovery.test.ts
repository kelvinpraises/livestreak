import { describe, expect, it } from "vitest";
import { LiveStreakRuntimeError } from "@livestreak/core";

import {
  createVaultUnconfirmedError,
  receiptTimeoutError
} from "../../src/chains/evm/create-vault-recovery.js";
import { asTxId, asVaultId } from "../../src/chains/types.js";
import { createVaultOnce } from "../../src/runtime/create-vault-once.js";
import { createIdempotencyStore } from "../../src/runtime/idempotency.js";
import { buildCreateVaultIntent } from "../../src/model/write-intent.js";
import { vaultDraft } from "../helpers/fixtures.js";
import { createFakeBookmakerChain } from "../helpers/fake-bookmaker-chain.js";

const settledResult = (txSuffix: string) => ({
  txId: asTxId(`0x${txSuffix.repeat(32)}`),
  vaultId: asVaultId(`0x${"22".repeat(32)}`)
});

const sampleIntent = () => {
  const draft = vaultDraft();
  return buildCreateVaultIntent(draft, 10_000);
};

describe("createVaultOnce receipt-timeout recovery", () => {
  it("submits once then recovers via confirmCreateVault on retry", async () => {
    let submitCalls = 0;
    let confirmCalls = 0;
    const pendingHash = asTxId(`0x${"ee".repeat(32)}`);
    const recovered = settledResult("cc");

    const chain = createFakeBookmakerChain({
      onCreateVault: async () => {
        submitCalls += 1;
        throw receiptTimeoutError(pendingHash);
      },
      onConfirmCreateVault: async (hash) => {
        confirmCalls += 1;
        expect(hash).toBe(pendingHash);
        return recovered;
      }
    });

    const store = createIdempotencyStore();
    const intent = sampleIntent();
    const deps = { store, chain, intent, nowMs: 10_000 };

    await expect(createVaultOnce(deps)).rejects.toMatchObject({
      message: "createVault submitted but unconfirmed; not resubmitting"
    });

    const second = await createVaultOnce(deps);

    expect(submitCalls).toBe(1);
    expect(confirmCalls).toBe(1);
    expect(second.idempotent).toBe(true);
    expect(second.result).toEqual(recovered);
    expect(store.getPendingHash(second.idempotencyKey)).toBeUndefined();
  });

  it("throws unconfirmed again when confirmCreateVault is still pending", async () => {
    let submitCalls = 0;
    const pendingHash = asTxId(`0x${"dd".repeat(32)}`);

    const chain = createFakeBookmakerChain({
      onCreateVault: async () => {
        submitCalls += 1;
        throw receiptTimeoutError(pendingHash);
      },
      onConfirmCreateVault: async () => undefined
    });

    const store = createIdempotencyStore();
    const deps = { store, chain, intent: sampleIntent(), nowMs: 10_000 };

    await expect(createVaultOnce(deps)).rejects.toBeInstanceOf(LiveStreakRuntimeError);
    await expect(createVaultOnce(deps)).rejects.toMatchObject({
      message: "createVault submitted but unconfirmed; not resubmitting"
    });

    expect(submitCalls).toBe(1);
  });

  it("releases the key when createVault fails before producing a hash", async () => {
    let submitCalls = 0;
    const chain = createFakeBookmakerChain({
      onCreateVault: async () => {
        submitCalls += 1;
        if (submitCalls === 1) {
          throw new LiveStreakRuntimeError({ message: "UserOperation send failed: rejected" });
        }

        return settledResult("aa");
      }
    });

    const store = createIdempotencyStore();
    const deps = { store, chain, intent: sampleIntent(), nowMs: 10_000 };

    await expect(createVaultOnce(deps)).rejects.toBeInstanceOf(LiveStreakRuntimeError);
    const retry = await createVaultOnce(deps);

    expect(submitCalls).toBe(2);
    expect(retry.idempotent).toBe(false);
  });

  it("runs only one submit for concurrent same-key calls", async () => {
    let submitCalls = 0;
    const pendingHash = asTxId(`0x${"ff".repeat(32)}`);
    const recovered = settledResult("ab");

    const chain = createFakeBookmakerChain({
      onCreateVault: async () => {
        submitCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw receiptTimeoutError(pendingHash);
      },
      onConfirmCreateVault: async () => recovered
    });

    const store = createIdempotencyStore();
    const deps = { store, chain, intent: sampleIntent(), nowMs: 10_000 };

    const results = await Promise.allSettled([
      createVaultOnce(deps),
      createVaultOnce(deps)
    ]);

    expect(submitCalls).toBe(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const fulfilled = results.find((result) => result.status === "fulfilled");
    if (fulfilled?.status === "fulfilled") {
      expect(fulfilled.value.result).toEqual(recovered);
    }
  });
});

describe("createVaultUnconfirmedError", () => {
  it("carries the pending userOpHash in metadata", () => {
    const hash = asTxId(`0x${"11".repeat(32)}`);
    const error = createVaultUnconfirmedError(hash);
    expect(error.message).toContain("not resubmitting");
    expect(error.metadata?.details).toContain(hash);
  });
});
