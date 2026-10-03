/** Shared, provider-neutral judging terms. Canonical bytes have no vault-ID dependency. */
export const MANDATE_VERSION = "livestreak-mandate/1" as const;
export interface NumericEvaluation {
  readonly kind: "numeric-threshold";
  readonly sourceId: string;
  readonly field: string;
  readonly units: string;
  readonly comparator: ">" | ">=" | "<" | "<=";
  readonly threshold: string;
  readonly tie: "yes" | "no";
}
export interface VaultMandate {
  readonly version: typeof MANDATE_VERSION;
  readonly chainId: string;
  readonly marketId: string;
  readonly question: string;
  readonly yesMeaning: string;
  readonly noMeaning: string;
  readonly method: "deterministic" | "discretionary" | "mixed";
  readonly evaluation: NumericEvaluation | { readonly kind: "rubric"; readonly rubric: string } |
    { readonly kind: "mixed"; readonly rubric: string; readonly checks: readonly NumericEvaluation[] };
  readonly evidence: readonly { readonly sourceId: string; readonly kind: "data" | "video" | "record" | "testimony"; readonly description: string }[];
  readonly authority: "market-designated-steward";
  readonly authorityChanges: "registry-authority-may-change";
  readonly fundingClose: number;
  readonly decisionStart: number;
  readonly decisionEnd: number;
  readonly missingEvidence: { readonly deadline: number; readonly treatment: "unresolved-escalate-no-guaranteed-refund"; readonly procedure: string };
  readonly ambiguityProcedure: string;
}
export interface BoundVaultTerms {
  readonly chainId: string;
  readonly marketId: string;
  readonly vaultId: string;
  readonly question: string;
  readonly commitment: string;
  readonly fundingClose: number;
}
export interface VerifiedVaultMandate {
  readonly terms: BoundVaultTerms;
  readonly mandate: VaultMandate;
}
const object = (v: unknown): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("Mandate must contain objects");
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, expected: readonly string[]): void => {
  if (Object.keys(v).length !== expected.length || expected.some(k => !Object.hasOwn(v, k))) throw new Error("Mandate fields missing or unknown");
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim() || v.length > 4096) throw new Error("Mandate requires bounded nonempty text");
  // Reject unpaired surrogates: UTF-8 replacement would collapse distinct input strings.
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = v.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Invalid Unicode in mandate");
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error("Invalid Unicode in mandate");
  }
  return v;
};
const time = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0 || v > 0xffffffff) throw new Error("Mandate time must be uint32 Unix seconds");
  return v;
};
const numeric = (input: unknown, sources: Set<string>): void => {
  const v = object(input); keys(v, ["kind", "sourceId", "field", "units", "comparator", "threshold", "tie"]);
  if (v.kind !== "numeric-threshold" || !sources.has(text(v.sourceId)) || typeof v.comparator !== "string" || ![">", ">=", "<", "<="].includes(v.comparator) || typeof v.tie !== "string" || !["yes", "no"].includes(v.tie)) throw new Error("Invalid numeric evaluation");
  text(v.field); text(v.units);
  if (typeof v.threshold !== "string" || !/^(?:0|-?[1-9]\d*)$/.test(v.threshold) || v.threshold.length > 80) throw new Error("Threshold must be a canonical integer string");
};
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])])) : v;
export const canonicalMandateBytes = (input: unknown): Uint8Array => {
  const v = object(input);
  keys(v, ["version", "chainId", "marketId", "question", "yesMeaning", "noMeaning", "method", "evaluation", "evidence", "authority", "authorityChanges", "fundingClose", "decisionStart", "decisionEnd", "missingEvidence", "ambiguityProcedure"]);
  if (v.version !== MANDATE_VERSION || v.authority !== "market-designated-steward" || v.authorityChanges !== "registry-authority-may-change") throw new Error("Unsupported mandate version or authority");
  if (!/^(eip155|solana|sui):[^\s]+$/.test(text(v.chainId))) throw new Error("Invalid mandate chain identity");
  text(v.marketId);text(v.question);text(v.yesMeaning);text(v.noMeaning);text(v.ambiguityProcedure);
  if (v.yesMeaning === v.noMeaning) throw new Error("YES and NO must differ");
  if (!(time(v.fundingClose) <= time(v.decisionStart) && time(v.decisionStart) < time(v.decisionEnd))) throw new Error("Invalid mandate window ordering");
  const missing = object(v.missingEvidence); keys(missing, ["deadline", "treatment", "procedure"]);
  if (time(missing.deadline) < time(v.decisionEnd) || missing.treatment !== "unresolved-escalate-no-guaranteed-refund") throw new Error("Unsupported missing-evidence treatment");text(missing.procedure);
  if (!Array.isArray(v.evidence) || v.evidence.length < 1 || v.evidence.length > 16) throw new Error("Mandate evidence required (maximum 16)");
  const sources = new Set<string>();
  for (const item of v.evidence) {
    const e = object(item);keys(e,["sourceId","kind","description"]); const id = text(e.sourceId);
    if (sources.has(id) || typeof e.kind !== "string" || !["data","video","record","testimony"].includes(e.kind)) throw new Error("Invalid or duplicate evidence source"); sources.add(id);text(e.description);
  }
  const evaluation = object(v.evaluation);
  if (v.method === "deterministic") numeric(evaluation, sources);
  else if (v.method === "discretionary") { keys(evaluation,["kind","rubric"]);if (evaluation.kind !== "rubric") throw new Error("Rubric required");text(evaluation.rubric); }
  else if (v.method === "mixed") { keys(evaluation,["kind","rubric","checks"]);text(evaluation.rubric);if (evaluation.kind !== "mixed" || !Array.isArray(evaluation.checks) || evaluation.checks.length < 1 || evaluation.checks.length > 16) throw new Error("Mixed checks required"); for (const check of evaluation.checks) numeric(check,sources); }
  else throw new Error("Unsupported decision method");
  const bytes = new TextEncoder().encode(JSON.stringify(sorted(v)));
  if (bytes.length > 32768) throw new Error("Mandate exceeds 32 KiB");return bytes;
};
export const mandateCommitment = async (bytes: Uint8Array): Promise<`0x${string}`> => {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return `0x${Array.from(hash, b => b.toString(16).padStart(2,"0")).join("")}`;
};
export const verifyMandate = async (input: unknown, terms: BoundVaultTerms): Promise<VaultMandate> => {
  const bytes = canonicalMandateBytes(input);const v = JSON.parse(new TextDecoder().decode(bytes)) as VaultMandate;
  if (!/^0x[0-9a-f]{64}$/.test(terms.commitment) || /^0x0{64}$/.test(terms.commitment) || await mandateCommitment(bytes) !== terms.commitment || v.chainId !== terms.chainId || v.marketId !== terms.marketId || v.question !== terms.question || v.fundingClose !== terms.fundingClose) throw new Error("Vault mandate commitment or binding mismatch");
  return v;
};
