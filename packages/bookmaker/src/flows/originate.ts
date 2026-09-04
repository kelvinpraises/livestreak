import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerMarketContext } from "../model/market-context.js";
import type { BookmakerDetectionEvaluation } from "../detection/types.js";
import type { BookmakerVaultPolicy } from "../decision/choose.js";
import { chooseVaultAction } from "../decision/choose.js";
import { buildVaultDraft } from "../draft/build.js";
import type { BookmakerDecision } from "../model/decision.js";
import type { Detection } from "../model/detection.js";
import type { VaultDraft } from "../model/vault-draft.js";
import { buildCreateVaultIntent, type CreateVaultIntent } from "../model/write-intent.js";
import type { SimilarityResult } from "../model/similarity.js";
import type { BookmakerSimilarityClient } from "../similarity/client.js";
import { findSimilar } from "../similarity/find.js";
import type { CreateVaultOnceResult } from "../runtime/create-vault-once.js";
import { validateVaultDraftForCreate } from "../validate/vault-draft.js";

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

  const draftValidated = validateVaultDraftForCreate(draft, input.nowMs);
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
