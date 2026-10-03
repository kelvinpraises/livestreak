import {
  canonicalMandateBytes,
  verifyResolutionRecord,
  type ResolutionEvidence,
  type VaultMandate,
} from "@livestreak/schema";

export const assessResolution = async (
  mandate: VaultMandate,
  evidence: readonly ResolutionEvidence[],
  decisionTime: number,
  requestedOutcome: unknown,
  reason: unknown,
): Promise<{ outcome: "yes" | "no" | "pending"; reason: string }> => {
  canonicalMandateBytes(mandate);
  const pending = (detail: string) => ({ outcome: "pending" as const, reason: detail });
  if (!Number.isSafeInteger(decisionTime) || decisionTime < mandate.decisionStart)
    return pending("Decision window has not opened.");
  if (decisionTime > mandate.decisionEnd)
    return pending(
      `Decision window expired. ${mandate.missingEvidence.procedure} No guaranteed refund.`,
    );
  if (typeof reason !== "string" || !reason.trim() || reason.length > 4096)
    throw new Error("A bounded, explicit Steward reason is required");
  if (!Array.isArray(evidence) || evidence.length === 0)
    return pending(`Evidence missing. ${mandate.missingEvidence.procedure}`);
  await verifyResolutionRecord({
    version: "livestreak-resolution/1",
    chainId: mandate.chainId,
    marketId: mandate.marketId,
    vaultId: "validation",
    mandateCommitment: "0x" + "1".repeat(64),
    stewardId: "validation",
    decisionTime,
    outcome: "yes",
    reason,
    evidence,
    transactionId: null,
    assessmentDigest: null,
  });
  for (const e of evidence) {
    const source = mandate.evidence.find((s) => s.sourceId === e.sourceId);
    if (!source || source.kind !== e.kind)
      throw new Error("Evidence source is not permitted by the committed mandate");
    if (!e.complete) return pending(`Incomplete evidence. ${mandate.ambiguityProcedure}`);
    if (e.observedAt < mandate.decisionStart || e.observedAt > mandate.decisionEnd)
      return pending("Evidence event time is outside the committed decision window.");
  }
  // Two different claims for one declared source require attention, never last-write-wins.
  for (const id of new Set(evidence.map((e) => e.sourceId))) {
    if (new Set(evidence.filter((e) => e.sourceId === id).map((e) => e.digest)).size > 1)
      return pending(`Conflicting evidence for ${id}. ${mandate.ambiguityProcedure}`);
  }
  const evaluate = (
    check: Extract<VaultMandate["evaluation"], { kind: "numeric-threshold" }>,
  ): "yes" | "no" | "pending" => {
    const e = evidence.find((e) => e.sourceId === check.sourceId);
    if (!e) return "pending";
    if (e.kind !== "data" && e.kind !== "record")
      throw new Error("Numeric check requires data or record evidence");
    let payload: unknown;
    try {
      payload = JSON.parse(e.payload);
    } catch {
      throw new Error("Numeric evidence must be a JSON sample");
    }
    const p = payload as { field?: unknown; units?: unknown; value?: unknown };
    if (
      !p ||
      Array.isArray(p) ||
      typeof p !== "object" ||
      Object.keys(p).length !== 3 ||
      p.field !== check.field ||
      p.units !== check.units ||
      typeof p.value !== "string" ||
      p.value.length > 80 ||
      !/^(?:0|-?[1-9]\d*)$/.test(p.value)
    )
      throw new Error("Numeric sample field, units or canonical integer mismatch");
    const value = BigInt(p.value),
      threshold = BigInt(check.threshold);
    if (value === threshold) return check.tie;
    const yes =
      check.comparator === ">" || check.comparator === ">="
        ? value > threshold
        : value < threshold;
    return yes ? "yes" : "no";
  };
  if (mandate.evaluation.kind === "numeric-threshold") {
    const computed = evaluate(mandate.evaluation);
    if (computed === "pending") return pending("Required numeric evidence missing.");
    if (requestedOutcome !== computed)
      throw new Error(`Submitted outcome disagrees with deterministic result ${computed}`);
    return { outcome: computed, reason };
  }
  if (
    mandate.evaluation.kind === "mixed" &&
    mandate.evaluation.checks.some((check) => evaluate(check) === "pending")
  )
    return pending("Required mixed evidence missing.");
  if (requestedOutcome !== "yes" && requestedOutcome !== "no")
    throw new Error("Discretionary/mixed resolution requires explicit YES or NO");
  return { outcome: requestedOutcome, reason };
};
