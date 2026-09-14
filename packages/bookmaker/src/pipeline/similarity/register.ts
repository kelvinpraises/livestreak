import type { VaultDraft } from "../../model/vault-draft.js";
import type { BookmakerSimilarityClient } from "./client.js";

// --- exports ---

export interface RegisterCreatedVaultInput {
  readonly similarityClient: BookmakerSimilarityClient;
  readonly draft: VaultDraft;
  readonly vaultId: string;
  /** Precomputed deterministic dedup key (= the create's idempotencyKey). */
  readonly vaultKey: string;
  /** Optional observer for fail-open discovery-index errors (never throws). */
  readonly onIndexError?: (error: unknown) => void;
}

// B2: register a just-created vault in the host discovery index so the next origination for the same
// opportunity FINDS it (the real duplicate-vault fix) — carrying the precomputed `vaultKey`
// (= idempotencyKey) so the deterministic exact-match (B1) fires too. Fail-OPEN: a discovery hiccup
// must never fail or roll back a created vault. Shared by the autonomous originate flow and the
// bridge/runtime console path.
export const registerCreatedVaultFailOpen = async (
  input: RegisterCreatedVaultInput
): Promise<void> => {
  const indexVault = input.similarityClient.indexVault;
  if (indexVault === undefined) {
    return;
  }

  try {
    await indexVault({
      vaultId: input.vaultId,
      marketId: input.draft.marketId,
      draft: input.draft,
      vaultKey: input.vaultKey
    });
  } catch (error) {
    // Fail-open: swallow so a discovery-index failure never fails the create.
    input.onIndexError?.(error);
  }
};
