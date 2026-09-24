import type { BoardPatch } from "./types.js";

export interface ControlCallEnvelope {
  readonly callId: string;
  readonly runId: string;
  /** Target cell. Families reuse one catalog under many cells, so scope alone cannot route
   *  there. Absent = singleton cell, derived from the scope (`system:run:stop` → `system:run`). */
  readonly cellId?: string;
  readonly scope: string;
  readonly payload?: unknown;
  readonly issuedAtMs?: number;
}

/** The singleton-cell default: a scope's cell is the scope minus its function segment. */
export const cellIdForScope = (scope: string): string => scope.split(":").slice(0, -1).join(":");

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
