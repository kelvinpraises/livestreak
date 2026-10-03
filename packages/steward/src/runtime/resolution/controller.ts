import {
  resolutionDigest,
  type VerifiedVaultMandate,
  type ResolutionEvidence,
  type ResolutionRecord,
} from "@livestreak/schema";
import { assessResolution } from "../../workflow/resolution/evaluate.js";

export interface ResolutionAttempt {
  vaultId: string;
  recordDigest: string;
  outcome: "yes" | "no";
  status: "prepared" | "unknown" | "confirmed";
  txId?: string;
  record?: ResolutionRecord;
  confirmationDigest?: string;
}
export interface ResolutionPorts {
  readonly stewardId: string;
  readMandate(vaultId: string): Promise<VerifiedVaultMandate>;
  readState(
    vaultId: string,
  ): Promise<{ outcome: "pending" | "yes" | "no"; disputed: boolean; chainTime: number }>;
  publish(record: ResolutionRecord): Promise<string>;
  load(vaultId: string): Promise<ResolutionAttempt | null>;
  save(attempt: ResolutionAttempt): Promise<void>;
  execute(
    vaultId: string,
    outcome: "yes" | "no",
    submitted: (hash: string) => Promise<void>,
  ): Promise<string>;
}
export const createResolutionController = (ports: ResolutionPorts) => {
  const busy = new Set<string>();
  const recover = async (vaultId: string) => {
    const attempt = await ports.load(vaultId);
    if (!attempt) throw new Error("No resolution attempt to recover");
    const state = await ports.readState(vaultId);
    if (state.outcome !== "pending") {
      if (state.disputed || state.outcome !== attempt.outcome)
        throw new Error(
          "Resolution differs from this attempt or is disputed; attention required",
        );
      let confirmationDigest = attempt.confirmationDigest;
      if (!confirmationDigest && attempt.txId && attempt.record) {
        confirmationDigest = await ports.publish({
          ...attempt.record,
          transactionId: attempt.txId,
          assessmentDigest: attempt.recordDigest,
        });
      }
      const confirmed = {
        ...attempt,
        status: "confirmed" as const,
        ...(confirmationDigest ? { confirmationDigest } : {}),
      };
      await ports.save(confirmed);
      return confirmed;
    }
    return attempt; // Pending inclusion or unknowable send: no automatic resubmission.
  };
  return {
    recover: async (vaultId: string) => {
      if (busy.has(vaultId)) throw new Error("Resolution is already running");
      busy.add(vaultId);
      try {
        return await recover(vaultId);
      } finally {
        busy.delete(vaultId);
      }
    },
    submit: async (input: {
      vaultId: string;
      outcome: unknown;
      reason: unknown;
      evidence: readonly ResolutionEvidence[];
    }) => {
      if (busy.has(input.vaultId)) throw new Error("Resolution is already running");
      busy.add(input.vaultId);
      try {
        const old = await ports.load(input.vaultId);
        if (old && old.status !== "prepared") {
          const result = await recover(input.vaultId);
          if (result.status !== "confirmed")
            throw new Error(
              "An earlier resolution is pending/unknown. Recover it before any retry.",
            );
          if (input.outcome !== result.outcome)
            throw new Error("A different outcome cannot overwrite this resolution");
          return result;
        }
        const [verified, state] = await Promise.all([
          ports.readMandate(input.vaultId),
          ports.readState(input.vaultId),
        ]);
        if (verified.terms.vaultId !== input.vaultId)
          throw new Error("Wrong mandate vault binding");
        if (state.outcome !== "pending")
          throw new Error("Vault is already resolved; no new write");
        const assessment = state.disputed
          ? {
              outcome: "pending" as const,
              reason: `Disputed judgement. ${verified.mandate.ambiguityProcedure}`,
            }
          : await assessResolution(
              verified.mandate,
              input.evidence,
              state.chainTime,
              input.outcome,
              input.reason,
            );
        const record: ResolutionRecord = {
          version: "livestreak-resolution/1",
          chainId: verified.terms.chainId,
          marketId: verified.terms.marketId,
          vaultId: input.vaultId,
          mandateCommitment: verified.terms.commitment,
          stewardId: ports.stewardId,
          decisionTime: state.chainTime,
          outcome: assessment.outcome,
          reason: assessment.reason,
          evidence: input.evidence,
          transactionId: null,
          assessmentDigest: null,
        };
        const digest = await ports.publish(record);
        if (digest !== (await resolutionDigest(record)))
          throw new Error("Published resolution digest mismatch");
        if (assessment.outcome === "pending")
          return {
            status: "attention" as const,
            recordDigest: digest,
            reason: assessment.reason,
          };
        let attempt: ResolutionAttempt = {
          vaultId: input.vaultId,
          recordDigest: digest,
          outcome: assessment.outcome,
          status: "prepared",
          record,
        };
        await ports.save(attempt);
        // Re-read terms/time immediately before signing: publication may have crossed the window.
        const [again, current] = await Promise.all([
          ports.readMandate(input.vaultId),
          ports.readState(input.vaultId),
        ]);
        if (
          again.terms.commitment !== verified.terms.commitment ||
          current.disputed ||
          current.outcome !== "pending" ||
          current.chainTime < verified.mandate.decisionStart ||
          current.chainTime > verified.mandate.decisionEnd
        )
          throw new Error("Eligibility changed before signing; no resolution sent");
        attempt = { ...attempt, status: "unknown" };
        await ports.save(attempt);
        const hash = await ports.execute(
          input.vaultId,
          assessment.outcome,
          async (txId) => {
            attempt = { ...attempt, txId };
            await ports.save(attempt);
          },
        );
        attempt = { ...attempt, txId: hash };
        await ports.save(attempt);
        const confirmed = await recover(input.vaultId);
        if (confirmed.status !== "confirmed")
          throw new Error("Resolution submitted; chain confirmation still needed");
        return confirmed;
      } finally {
        busy.delete(input.vaultId);
      }
    },
  };
};
