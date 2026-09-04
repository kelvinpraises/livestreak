import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerChain, CreateVaultResult } from "../chains/types.js";
import { idempotencyKeyFromCreateIntent } from "../model/idempotency.js";
import type { CreateVaultIntent } from "../model/write-intent.js";
import { validateCreateVaultIntent } from "../validate/write-intent.js";
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

  const { result, idempotent } = await deps.store.run(idempotencyKey, () =>
    deps.chain.writer.createVault({
      marketId: intent.marketId,
      question: intent.question,
      creatorSide: intent.creatorSide,
      creatorStake: intent.creatorStake,
      seedRate: intent.seedRate
    })
  );

  return {
    result,
    idempotent,
    idempotencyKey
  };
};
