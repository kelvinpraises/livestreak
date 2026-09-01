// --- exports ---

export interface VaultResolutionWindow {
  readonly opensAtMs?: number;
  readonly expiresAtMs: number;
}

export interface VaultDraft {
  readonly marketId: string;
  readonly question: string;
  readonly outcomeKind: "binary";
  readonly sides: readonly ["yes", "no"];
  readonly vaultType?: "momentum" | "player" | "threshold" | "timing" | "swing" | string;
  readonly resolutionSource: string;
  readonly resolutionWindow: VaultResolutionWindow;
  readonly fundingToken: string;
  readonly creatorSide?: "yes" | "no";
  readonly creatorStake?: bigint;
  readonly evidenceRefs?: readonly string[];
  readonly observationRef?: string;
}
