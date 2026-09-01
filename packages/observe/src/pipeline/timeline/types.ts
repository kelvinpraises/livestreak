import type { PausePresentation } from "#pipeline/capture/index.js";

export type TimelineMarkerKind =
  | "eos"
  | "pause-start"
  | "pause-end"
  | "discontinuity"
  | "presentation-slate";

export interface TimelineMarkerPayload {
  readonly reason?: string;
  readonly whilePaused?: PausePresentation;
  readonly slateAssetId?: string;
  readonly epoch?: number;
}

export interface TimelineMarker {
  readonly kind: TimelineMarkerKind;
  readonly mediaTimeMs?: number;
  readonly wallClockMs: number;
  readonly payload?: TimelineMarkerPayload;
}
