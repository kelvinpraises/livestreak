import {
  mandateCommitment,
  type ResolutionEvidence,
  type ResolutionRecord,
} from "../../src/index.js";
export const fixtureEvidence = async (
  overrides: Partial<ResolutionEvidence> = {},
): Promise<ResolutionEvidence> => {
  const payload =
    overrides.payload ?? JSON.stringify({ field: "score", units: "points", value: "3" });
  return {
    sourceId: "official-score",
    kind: "record",
    observedAt: 2000000001,
    retrievedAt: 2000000002,
    reference: "official://score/final",
    payload,
    digest: await mandateCommitment(new TextEncoder().encode(payload)),
    complete: true,
    ...overrides,
  };
};
export const fixtureResolution = async (): Promise<ResolutionRecord> => ({
  version: "livestreak-resolution/1",
  chainId: "eip155:31337",
  marketId: "market-1",
  vaultId: "vault-1",
  mandateCommitment: "0x" + "1".repeat(64),
  stewardId: "separate-steward",
  decisionTime: 2000000050,
  outcome: "yes",
  reason: "Final official score 3 exceeds the committed threshold 2.",
  transactionId: null,
  assessmentDigest: null,
  evidence: [await fixtureEvidence()],
});
