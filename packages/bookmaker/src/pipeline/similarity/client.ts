import type { SimilarityQuery, SimilarityResult } from "../../model/similarity.js";
import type { VaultDraft } from "../../model/vault-draft.js";

// --- exports ---

/** A vault to register in the host discovery index after a successful create. */
export interface VaultIndexRecord {
  readonly vaultId: string;
  readonly marketId: string;
  readonly draft: VaultDraft;
  /** Precomputed deterministic dedup key (bookmaker owns the hash). */
  readonly vaultKey: string;
}

export interface BookmakerSimilarityClient {
  readonly findSimilar: (query: SimilarityQuery) => Promise<SimilarityResult>;
  /**
   * Register a newly created vault in the host discovery index so the next
   * origination for the same opportunity finds it (the real duplicate-vault
   * fix). Optional so existing find-only clients/tests keep compiling; callers
   * must treat its absence and its failures as fail-open (never block a create).
   */
  readonly indexVault?: (record: VaultIndexRecord) => Promise<void>;
}
