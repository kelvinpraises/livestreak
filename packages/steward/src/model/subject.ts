// --- exports ---

export type StewardSubjectKind =
  | "market"
  | "vault"
  | "observer"
  | "bookmaker"
  | "steward"
  | "evidence"
  | "resolution";

export interface StewardSubject {
  readonly kind: StewardSubjectKind;
  readonly id: string;
  readonly marketId?: string;
  readonly vaultId?: string;
}

// S5: scope by (kind, id), never id alone — an observer "alice" and a steward "alice", or a vault and a
// market sharing an id, must never collide. Used by rule evaluation, finding ids, and the bridge match.
export const sameSubject = (a: StewardSubject, b: StewardSubject): boolean =>
  a.kind === b.kind && a.id === b.id;
