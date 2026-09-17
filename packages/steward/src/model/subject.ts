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

/** The console watch-set: the steward self plus the configured market/vault subjects. */
export const stewardWatchSubjects = (input: {
  readonly stewardId: string;
  readonly marketId?: string;
  readonly vaultId?: string;
}): readonly StewardSubject[] => {
  const subjects: StewardSubject[] = [{ kind: "steward", id: input.stewardId }];
  if (input.marketId !== undefined && input.marketId.length > 0) {
    subjects.push({ kind: "market", id: input.marketId, marketId: input.marketId });
  }
  if (input.vaultId !== undefined && input.vaultId.length > 0) {
    subjects.push({
      kind: "vault",
      id: input.vaultId,
      vaultId: input.vaultId,
      ...(input.marketId === undefined || input.marketId.length === 0
        ? {}
        : { marketId: input.marketId })
    });
  }
  return subjects;
};
