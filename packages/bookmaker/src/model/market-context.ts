// --- exports ---

export interface BookmakerMarketContext {
  readonly marketId: string;
  readonly observeRunId: string;
  readonly observer: string;
  readonly endpointManifestUri?: string;
  readonly subjectRef?: string;
  readonly category?: string;
  readonly title?: string;
  readonly rulesetId?: string;
  readonly startedAtMs?: number;
  readonly evidenceRefs?: readonly string[];
}
