import type {
  HostSimilarityIndexRequest,
  HostSimilarityRequest,
  HostSimilarityResult,
  HostSimilarVaultCandidate
} from "@livestreak/host";

// --- exports ---

export type IndexedVault = HostSimilarityIndexRequest;

export interface DiscoveryStore {
  readonly indexVault: (vault: IndexedVault) => void;
  readonly findSimilar: (query: HostSimilarityRequest) => HostSimilarityResult;
}

export const createDiscoveryStore = (): DiscoveryStore => {
  const vaults: IndexedVault[] = [];

  return {
    indexVault(vault) {
      vaults.push(vault);
    },
    findSimilar(query) {
      const draftTokens = [
        ...tokenize(query.vaultDraft.title),
        ...tokenize(query.vaultDraft.summary),
        ...query.vaultDraft.tags.flatMap((tag) => tokenize(tag))
      ];

      const candidates = vaults
        .filter((vault) => vault.marketId === query.marketId)
        .map((vault) => {
          const vaultTokens = [
            ...tokenize(vault.title),
            ...tokenize(vault.summary),
            ...vault.tags.flatMap((tag) => tokenize(tag))
          ];
          const score = overlapScore(draftTokens, vaultTokens);
          return {
            kind: "vault" as const,
            vaultId: vault.vaultId,
            marketId: vault.marketId,
            score,
            reason: score > 0 ? "token overlap within market" : "no overlap",
            suggestedAction:
              score >= 0.5 ? ("join-existing" as const) : ("create-new" as const)
          } satisfies HostSimilarVaultCandidate;
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);

      return {
        marketId: query.marketId,
        candidates,
        duplicateRisk:
          candidates.length > 0 && candidates[0]!.score >= 0.75 ? "high" : "low"
      };
    }
  };
};

// --- helpers ---

const tokenize = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);

const overlapScore = (left: readonly string[], right: readonly string[]): number => {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token)).length;
  return shared / Math.max(left.length, right.length);
};
