import {
  createBookmakerChain,
  createIdempotencyStore,
  createVaultOnce,
  type BookmakerChain,
  type BookmakerContractAddresses,
  type CreateVaultIntent,
  type CreateVaultResult
} from "@livestreak/bookmaker";
import type { WalletInit } from "@livestreak/schema";

// F1: vault creation is owned by @livestreak/bookmaker. The bookmaker chain approves
// USDC internally and `createVaultOnce` is idempotent — a receipt-timeout records the
// pending userOpHash and a retry re-confirms via confirmCreateVault instead of
// resubmitting (no double-spend). The CLI only builds the chain + intent and relays.

export type IdempotencyStore = ReturnType<typeof createIdempotencyStore>;

export interface BuildBookmakerChainInput {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: BookmakerContractAddresses;
  readonly readRpcUrl?: string;
}

export const buildBookmakerChain = (input: BuildBookmakerChainInput): BookmakerChain =>
  createBookmakerChain({
    walletInit: input.walletInit,
    seed: input.seed,
    addresses: input.addresses,
    ...(input.readRpcUrl === undefined ? {} : { readRpcUrl: input.readRpcUrl })
  });

export interface CreateVaultViaBookmakerResult {
  readonly result: CreateVaultResult;
  readonly idempotent: boolean;
}

// The "unconfirmed" error is retryable: the second createVaultOnce with the same intent
// hits the stored pending hash and confirms it.
const isUnconfirmedRetryable = (error: unknown): boolean =>
  error instanceof Error && /unconfirmed/iu.test(error.message);

export const createVaultViaBookmaker = async (input: {
  readonly chain: BookmakerChain;
  readonly intent: CreateVaultIntent;
  readonly nowMs?: number;
  readonly store?: IdempotencyStore;
}): Promise<CreateVaultViaBookmakerResult> => {
  const store = input.store ?? createIdempotencyStore();
  const nowMs = input.nowMs ?? Date.now();

  const attempt = (): Promise<{ result: CreateVaultResult; idempotent: boolean }> =>
    createVaultOnce({ store, chain: input.chain, intent: input.intent, nowMs });

  try {
    const first = await attempt();
    return { result: first.result, idempotent: first.idempotent };
  } catch (error) {
    if (!isUnconfirmedRetryable(error)) {
      throw error;
    }

    // Retry once — re-confirms the pending userOp rather than resubmitting.
    const second = await attempt();
    return { result: second.result, idempotent: second.idempotent };
  }
};
