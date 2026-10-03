import { mandateCommitment } from "./mandate.js";

export interface ResolutionEvidence {
  readonly sourceId: string;
  readonly kind: "data" | "video" | "record" | "testimony";
  readonly observedAt: number;
  readonly retrievedAt: number;
  /** Durable origin/reference, not a request for the platform to fetch an arbitrary URL. */
  readonly reference: string;
  readonly payload: string;
  readonly digest: string;
  readonly complete: boolean;
}
export interface ResolutionRecord {
  readonly version: "livestreak-resolution/1";
  readonly chainId: string;
  readonly marketId: string;
  readonly vaultId: string;
  readonly mandateCommitment: string;
  /** Claimed author; content addressing alone does not authenticate this identity. */
  readonly stewardId: string;
  readonly decisionTime: number;
  readonly outcome: "yes" | "no" | "pending";
  readonly reason: string;
  readonly evidence: readonly ResolutionEvidence[];
  readonly transactionId: string | null;
  readonly assessmentDigest: string | null;
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Resolution requires an object");
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, expected: readonly string[]) => {
  if (
    Object.keys(v).length !== expected.length ||
    expected.some((k) => !Object.hasOwn(v, k))
  )
    throw new Error("Resolution fields missing or unknown");
};
const text = (v: unknown, max = 4096): string => {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)
  )
    throw new Error("Resolution requires bounded valid text");
  return v;
};
const time = (v: unknown) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 0xffffffff)
    throw new Error("Invalid evidence time");
};
const digest = (v: unknown) => {
  if (typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v) || /^0x0{64}$/.test(v))
    throw new Error("Invalid evidence/mandate digest");
};
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
        )
      : v;
export const canonicalResolutionBytes = (input: unknown): Uint8Array => {
  const v = object(input);
  keys(v, [
    "version",
    "chainId",
    "marketId",
    "vaultId",
    "mandateCommitment",
    "stewardId",
    "decisionTime",
    "outcome",
    "reason",
    "evidence",
    "transactionId",
    "assessmentDigest",
  ]);
  if (
    v.version !== "livestreak-resolution/1" ||
    !["yes", "no", "pending"].includes(String(v.outcome))
  )
    throw new Error("Unsupported resolution record");
  if (!/^(eip155|solana|sui):[^\s]+$/.test(text(v.chainId)))
    throw new Error("Invalid resolution chain");
  text(v.marketId);
  text(v.vaultId);
  text(v.stewardId);
  text(v.reason);
  digest(v.mandateCommitment);
  time(v.decisionTime);
  if (
    !Array.isArray(v.evidence) ||
    v.evidence.length > 16 ||
    (v.outcome !== "pending" && v.evidence.length === 0)
  )
    throw new Error("Resolution evidence required (maximum 16)");
  for (const item of v.evidence) {
    const e = object(item);
    keys(e, [
      "sourceId",
      "kind",
      "observedAt",
      "retrievedAt",
      "reference",
      "payload",
      "digest",
      "complete",
    ]);
    text(e.sourceId);
    text(e.reference);
    text(e.payload, 16384);
    digest(e.digest);
    time(e.observedAt);
    time(e.retrievedAt);
    if (
      !["data", "video", "record", "testimony"].includes(String(e.kind)) ||
      typeof e.complete !== "boolean" ||
      Number(e.retrievedAt) < Number(e.observedAt) ||
      Number(e.retrievedAt) > Number(v.decisionTime)
    )
      throw new Error("Invalid evidence provenance");
  }
  if (v.transactionId !== null) text(v.transactionId, 256);
  if (v.assessmentDigest !== null) digest(v.assessmentDigest);
  if ((v.transactionId === null) !== (v.assessmentDigest === null))
    throw new Error("Confirmation must reference its assessment and transaction together");
  const bytes = new TextEncoder().encode(JSON.stringify(sorted(v)));
  if (bytes.length > 65536) throw new Error("Resolution exceeds 64 KiB");
  return bytes;
};
export const resolutionDigest = async (record: unknown): Promise<string> =>
  mandateCommitment(canonicalResolutionBytes(record));
export const verifyResolutionRecord = async (
  input: unknown,
  expectedDigest?: string,
): Promise<ResolutionRecord> => {
  const bytes = canonicalResolutionBytes(input);
  const record = JSON.parse(new TextDecoder().decode(bytes)) as ResolutionRecord;
  if (expectedDigest !== undefined && (await mandateCommitment(bytes)) !== expectedDigest)
    throw new Error("Resolution digest mismatch");
  for (const evidence of record.evidence)
    if (
      (await mandateCommitment(new TextEncoder().encode(evidence.payload))) !==
      evidence.digest
    )
      throw new Error("Evidence payload digest mismatch");
  return record;
};
