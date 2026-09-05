import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerChain, CreateVaultResult } from "../chains/types.js";
import { idempotencyKeyFromCreateIntent } from "../model/idempotency.js";
import type { CreateVaultIntent } from "../model/write-intent.js";
import { validateCreateVaultIntent } from "../model/validate.js";
import {
  createVaultUnconfirmedError,
  readReceiptTimeoutUserOpHash
} from "../chains/evm/create-vault-recovery.js";
import type { IdempotencyStore } from "./idempotency.js";

// --- exports ---

export type CreateVaultOnceResult = {
  readonly result: CreateVaultResult;
  readonly idempotent: boolean;
  readonly idempotencyKey: string;
};

export const createVaultOnce = async (
  deps: {
    readonly store: IdempotencyStore;
    readonly chain: BookmakerChain;
    readonly intent: CreateVaultIntent;
    readonly nowMs: number;
  }
): Promise<CreateVaultOnceResult> => {
  const validated = validateCreateVaultIntent(deps.intent, deps.nowMs);
  if (validated.ok === false) {
    throw new LiveStreakConfigError({
      message: validated.issues.join("; "),
      metadata: { details: JSON.stringify(validated.issues) }
    });
  }

  const intent = validated.value;
  const idempotencyKey = idempotencyKeyFromCreateIntent(intent);

  return deps.store.runExclusive(idempotencyKey, async () => {
    const settled = deps.store.getSettled(idempotencyKey);
    if (settled !== undefined) {
      return {
        result: settled,
        idempotent: true,
        idempotencyKey
      };
    }

    const pendingHash = deps.store.getPendingHash(idempotencyKey);
    if (pendingHash !== undefined) {
      const confirmed = await deps.chain.writer.confirmCreateVault(pendingHash);
      if (confirmed !== undefined) {
        deps.store.settle(idempotencyKey, confirmed);
        return {
          result: confirmed,
          idempotent: true,
          idempotencyKey
        };
      }

      throw createVaultUnconfirmedError(pendingHash);
    }

    try {
      const result = await deps.chain.writer.createVault({
        marketId: intent.marketId,
        question: intent.question,
        creatorSide: intent.creatorSide,
        creatorStake: intent.creatorStake,
        seedRate: intent.seedRate
      });

      deps.store.settle(idempotencyKey, result);
      return {
        result,
        idempotent: false,
        idempotencyKey
      };
    } catch (error) {
      const userOpHash = readReceiptTimeoutUserOpHash(error);
      if (userOpHash !== undefined) {
        deps.store.markPending(idempotencyKey, userOpHash);
        deps.store.recordFailure(idempotencyKey, error);
        throw createVaultUnconfirmedError(userOpHash);
      }

      deps.store.recordFailure(idempotencyKey, error);
      throw error;
    }
  });
};
