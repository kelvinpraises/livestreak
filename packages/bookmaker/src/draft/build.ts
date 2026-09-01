import type { BookmakerMarketContext } from "../model/market-context.js";
import type { Detection } from "../model/detection.js";
import type { VaultDraft } from "../model/vault-draft.js";

// --- exports ---

export interface BuildVaultDraftOptions {
  readonly fundingToken: string;
  readonly nowMs: number;
  readonly rulesetId?: string;
}

export const buildVaultDraft = (
  detection: Detection,
  marketContext: BookmakerMarketContext,
  options: BuildVaultDraftOptions
): VaultDraft => {
  const nowMs = options.nowMs;
  const resolutionSource =
    options.rulesetId ??
    marketContext.rulesetId ??
    marketContext.endpointManifestUri ??
    `observe:${marketContext.observeRunId}`;

  return {
    marketId: marketContext.marketId,
    question: detection.question,
    outcomeKind: "binary",
    sides: ["yes", "no"],
    vaultType: detection.vaultType,
    resolutionSource,
    resolutionWindow: {
      opensAtMs: nowMs,
      expiresAtMs: nowMs + detection.durationSeconds * 1_000
    },
    fundingToken: options.fundingToken,
    ...(detection.suggestedSide === undefined ? {} : { creatorSide: detection.suggestedSide }),
    ...(detection.suggestedStake === undefined ? {} : { creatorStake: detection.suggestedStake }),
    ...(marketContext.evidenceRefs === undefined ? {} : { evidenceRefs: marketContext.evidenceRefs }),
    ...(detection.observationRef === undefined ? {} : { observationRef: detection.observationRef })
  };
};
