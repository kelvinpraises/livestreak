import { describe, expect, it } from "vitest";
import { LiveStreakRuntimeError } from "@livestreak/core";
import {
  asTxId,
  asVaultId,
  createIdempotencyStore,
  type BookmakerChain,
  type CreateVaultIntent,
  type CreateVaultResult
} from "@livestreak/bookmaker";
import { createVaultViaBookmaker } from "../src/adapters/bookmaker.js";

const TIMEOUT_HASH = "0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca";

const intent: CreateVaultIntent = {
  action: "createVault",
  marketId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  question: "Will it rain?",
  creatorSide: "yes",
  creatorStake: 1_000_000n,
  seedRate: 10n,
  resolutionSource: "operator-cli",
  resolutionWindowExpiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000
};

const result: CreateVaultResult = {
  txId: asTxId(TIMEOUT_HASH),
  vaultId: asVaultId("vault_1")
};

const receiptTimeoutError = (): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: "Timed out waiting for UserOperation receipt",
    metadata: {
      details: JSON.stringify({ userOpHash: TIMEOUT_HASH, phase: "receipt-timeout" }),
      retryable: true
    }
  });

describe("commands/vault — createVault via bookmaker", () => {
  it("returns {vaultId, txId} on the happy path (non-idempotent)", async () => {
    const chain: BookmakerChain = {
      reader: { marketExists: async () => true },
      writer: {
        createVault: async () => result,
        confirmCreateVault: async () => undefined
      }
    };

    const out = await createVaultViaBookmaker({
      chain,
      intent,
      store: createIdempotencyStore()
    });

    expect(out.result.vaultId).toBe(asVaultId("vault_1"));
    expect(out.result.txId).toBe(asTxId(TIMEOUT_HASH));
    expect(out.idempotent).toBe(false);
  });

  it("recovers a receipt-timeout: retry confirms the pending userOp (idempotent)", async () => {
    let createCalls = 0;
    const chain: BookmakerChain = {
      reader: { marketExists: async () => true },
      writer: {
        // First submit times out (records the pending hash); it must NOT be resubmitted.
        createVault: async () => {
          createCalls += 1;
          throw receiptTimeoutError();
        },
        confirmCreateVault: async (hash) => (hash === asTxId(TIMEOUT_HASH) ? result : undefined)
      }
    };

    const out = await createVaultViaBookmaker({
      chain,
      intent,
      store: createIdempotencyStore()
    });

    expect(createCalls).toBe(1); // submitted once, never resubmitted
    expect(out.result.vaultId).toBe(asVaultId("vault_1"));
    expect(out.idempotent).toBe(true);
  });

  it("propagates a non-retryable createVault failure", async () => {
    const chain: BookmakerChain = {
      reader: { marketExists: async () => true },
      writer: {
        createVault: async () => {
          throw new LiveStreakRuntimeError({ message: "UserOperation included but reverted" });
        },
        confirmCreateVault: async () => undefined
      }
    };

    await expect(
      createVaultViaBookmaker({ chain, intent, store: createIdempotencyStore() })
    ).rejects.toThrow(/reverted/iu);
  });
});
