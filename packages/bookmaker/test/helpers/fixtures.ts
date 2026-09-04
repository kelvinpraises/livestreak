import type {
  BookmakerMarketContext,
  BookmakerWatchSource,
  Detection,
  SimilarityResult,
  VaultDraft
} from "../../src/index.js";

export const marketContext = (
  overrides: Partial<BookmakerMarketContext> = {}
): BookmakerMarketContext => ({
  marketId: "market-1",
  observeRunId: "run-1",
  observer: "0x0000000000000000000000000000000000000001",
  endpointManifestUri: "ipfs://manifest-1",
  rulesetId: "football-v1",
  startedAtMs: 1_700_000_000_000,
  evidenceRefs: ["evidence-1"],
  ...overrides
});

export const watchSource = (
  overrides: Partial<BookmakerWatchSource> = {}
): BookmakerWatchSource => ({
  marketId: "market-1",
  watchUrl: "https://example.com/watch/market-1",
  webrtcUrl: "whep://example.com/market-1",
  ...overrides
});

export const detection = (overrides: Partial<Detection> = {}): Detection => ({
  detectorId: "momentum",
  confidence: 0.91,
  question: "Will Team A score in the next 10 minutes?",
  vaultType: "momentum",
  durationSeconds: 600,
  suggestedSide: "yes",
  suggestedStake: 5_000_000n,
  observationRef: "obs-1",
  ...overrides
});

export const vaultDraft = (overrides: Partial<VaultDraft> = {}): VaultDraft => ({
  marketId: "market-1",
  question: "Will Team A score in the next 10 minutes?",
  outcomeKind: "binary",
  sides: ["yes", "no"],
  vaultType: "momentum",
  resolutionSource: "football-v1",
  resolutionWindow: {
    opensAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_600_000
  },
  fundingToken: "0x0000000000000000000000000000000000000002",
  creatorSide: "yes",
  creatorStake: 5_000_000n,
  seedRate: 8_333n,
  ...overrides
});

export const similarityResult = (
  overrides: Partial<SimilarityResult> = {}
): SimilarityResult => ({
  marketId: "market-1",
  candidates: [],
  duplicateRisk: "low",
  ...overrides
});
