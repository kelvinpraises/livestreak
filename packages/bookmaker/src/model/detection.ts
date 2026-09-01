// --- exports ---

export interface Detection {
  readonly detectorId: string;
  readonly confidence: number;
  readonly question: string;
  readonly vaultType: string;
  readonly durationSeconds: number;
  readonly suggestedSide?: "yes" | "no";
  readonly suggestedStake?: bigint;
  readonly observationRef?: string;
}
