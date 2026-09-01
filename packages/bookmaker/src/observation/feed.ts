// --- exports ---

export interface ObservationEvent {
  readonly marketId: string;
  readonly observationId: string;
  readonly observedAtMs: number;
  readonly kind?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface ObservationSnapshot {
  readonly marketId: string;
  readonly events: readonly ObservationEvent[];
  readonly capturedAtMs: number;
}

export interface ObservationFeed {
  readonly marketId: string;
  readonly snapshot?: () => Promise<ObservationSnapshot>;
  readonly subscribe?: (handler: (event: ObservationEvent) => void) => () => void;
}
