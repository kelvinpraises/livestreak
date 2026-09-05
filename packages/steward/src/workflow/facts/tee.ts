// --- exports ---

export interface TeeAttestationRef {
  readonly quoteRef?: string;
  readonly reportRef?: string;
  readonly enclaveId?: string;
  readonly signedAtMs?: number;
}

export const isTeeAttestationRef = (value: unknown): value is TeeAttestationRef => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if ("quoteRef" in record && record.quoteRef !== undefined && !isNonEmptyString(record.quoteRef)) {
    return false;
  }

  if ("reportRef" in record && record.reportRef !== undefined && !isNonEmptyString(record.reportRef)) {
    return false;
  }

  if ("enclaveId" in record && record.enclaveId !== undefined && !isNonEmptyString(record.enclaveId)) {
    return false;
  }

  if (
    "signedAtMs" in record &&
    record.signedAtMs !== undefined &&
    !isFiniteNumber(record.signedAtMs)
  ) {
    return false;
  }

  return (
    isNonEmptyString(record.quoteRef) ||
    isNonEmptyString(record.reportRef) ||
    isNonEmptyString(record.enclaveId)
  );
};

// --- helpers ---

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
