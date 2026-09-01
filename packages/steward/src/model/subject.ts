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
