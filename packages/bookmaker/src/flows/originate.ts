import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerMarketContext } from "../model/market-context.js";
import type { BookmakerDetectionEvaluation } from "../pipeline/detection/types.js";
import type { BookmakerVaultPolicy } from "../pipeline/decision/choose.js";
import { chooseVaultAction } from "../pipeline/decision/choose.js";
import { buildVaultDraft } from "../pipeline/draft/build.js";
import type { BookmakerDecision } from "../model/decision.js";
import type { Detection } from "../model/detection.js";
import type { VaultDraft } from "../model/vault-draft.js";
import { buildCreateVaultIntent, type CreateVaultIntent } from "../model/write-intent.js";
import type { BookmakerSimilarityClient } from "../pipeline/similarity/client.js";
import { findSimilar } from "../pipeline/similarity/find.js";
import type { CreateVaultOnceResult } from "../runtime/create-vault-once.js";
import { validateVaultDraftForCreate } from "../model/validate.js";

// --- exports ---

export type GuardedCreateVault = (
  intent: CreateVaultIntent,
  nowMs: number
) => Promise<CreateVaultOnceResult>;

export interface OriginateVaultInput {
  readonly evaluation: BookmakerDetectionEvaluation;
  readonly marketContext: BookmakerMarketContext;
  readonly fundingToken: string;
  readonly policy: BookmakerVaultPolicy;
  readonly similarityClient: BookmakerSimilarityClient;
  readonly nowMs: number;
  readonly guardedCreateVault: GuardedCreateVault;
  /** Optional observer for fail-open discovery-index errors (never throws). */
  readonly onIndexError?: (error: unknown) => void;
  /**
   * Chain streaming minimum seed rate (resolved per-chain from config, never a
   * constant). A create whose seed rate would fall below this is rejected with a
   * clear error so funding can't round to zero per cycle. Defaults to 1n.
   */
  readonly minSeedRate?: bigint;
}

export type OriginateVaultResult =
  | {
      readonly action: "skipped";
      readonly reason: string;
      readonly detection: Detection;
    }
  | {
      readonly action: "joined";
      readonly vaultId: string;
      readonly draft: VaultDraft;
      readonly detection: Detection;
    }
  | {
      readonly action: "created";
      readonly draft: VaultDraft;
      readonly detection: Detection;
      readonly intent: CreateVaultIntent;
      readonly result: CreateVaultOnceResult["result"];
      readonly idempotent: boolean;
      readonly idempotencyKey: string;
    };

export const originateVault = async (input: OriginateVaultInput): Promise<OriginateVaultResult> => {
  if (input.evaluation.action !== "detected") {
    throw new LiveStreakConfigError({
      message: "originateVault requires a detected evaluation"
    });
  }

  const detection = input.evaluation.detection;
  const draft = buildVaultDraft(detection, input.marketContext, {
    fundingToken: input.fundingToken,
    nowMs: input.nowMs
  });

  const similarity = await findSimilar(draft, input.similarityClient);
  const decision = chooseVaultAction(draft, similarity, {
    ...input.policy,
    detection
  });

  return finalizeOriginateDecision(input, detection, draft, decision);
};

// --- helpers ---

const finalizeOriginateDecision = async (
  input: OriginateVaultInput,
  detection: Detection,
  draft: VaultDraft,
  decision: BookmakerDecision
): Promise<OriginateVaultResult> => {
  if (decision.action === "skip") {
    return {
      action: "skipped",
      reason: decision.reason,
      detection
    };
  }

  if (decision.action === "joinVault") {
    return {
      action: "joined",
      vaultId: decision.vaultId,
      draft,
      detection
    };
  }

  const draftValidated = validateVaultDraftForCreate(draft, input.nowMs, {
    ...(input.minSeedRate === undefined ? {} : { minSeedRate: input.minSeedRate })
  });
  if (draftValidated.ok === false) {
    throw new LiveStreakConfigError({
      message: draftValidated.issues.join("; "),
      metadata: { details: JSON.stringify(draftValidated.issues) }
    });
  }

  const intent = buildCreateVaultIntent(draftValidated.value);
  const { result, idempotent, idempotencyKey } = await input.guardedCreateVault(
    intent,
    input.nowMs
  );

  // B2: register the just-created vault in the host discovery index so the next
  // origination for the same opportunity FINDS it (the real duplicate-vault fix)
  // — carrying the precomputed `vaultKey` (= idempotencyKey) so the deterministic
  // exact-match (B1) fires too. Fail-OPEN: a discovery hiccup must never fail or
  // roll back a created vault. Skip idempotent re-creates (already indexed).
  if (idempotent === false) {
    await registerCreatedVaultFailOpen(input, draftValidated.value, result.vaultId, idempotencyKey);
  }

  return {
    action: "created",
    draft,
    detection,
    intent,
    result,
    idempotent,
    idempotencyKey
  };
};

const registerCreatedVaultFailOpen = async (
  input: OriginateVaultInput,
  draft: VaultDraft,
  vaultId: string,
  vaultKey: string
): Promise<void> => {
  const indexVault = input.similarityClient.indexVault;
  if (indexVault === undefined) {
    return;
  }

  try {
    await indexVault({
      vaultId,
      marketId: draft.marketId,
      draft,
      vaultKey
    });
  } catch (error) {
    // Fail-open: swallow so a discovery-index failure never fails the create.
    input.onIndexError?.(error);
  }
};
