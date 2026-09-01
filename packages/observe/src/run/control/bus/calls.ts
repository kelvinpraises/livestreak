import type { BoardPatch } from "./types.js";

export interface ControlCallEnvelope {
  readonly callId: string;
  readonly runId: string;
  readonly scope: string;
  readonly payload?: unknown;
  readonly issuedAtMs?: number;
}

export interface ControlArtifact {
  readonly id: string;
  readonly kind: string;
  readonly ownerCell: string;
  readonly function: string;
  readonly createdAtMs: number;
  readonly expiresAtMs?: number;
  readonly payload: unknown;
}

export interface ControlCallResult {
  readonly callId: string;
  readonly runId: string;
  readonly scope: string;
  readonly boardRevision: number;
  readonly changed: boolean;
  readonly artifactId?: string;
  readonly artifact?: ControlArtifact;
  readonly boardPatch?: BoardPatch;
}
