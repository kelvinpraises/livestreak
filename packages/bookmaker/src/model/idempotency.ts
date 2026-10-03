import { canonicalMandateBytes, type VaultMandate } from "@livestreak/schema";
import { createHash } from "node:crypto";

import type { VaultDraft } from "./vault-draft.js";

// --- exports ---

export type VaultIdempotencyFields = {
  readonly marketId: string;
  readonly question: string;
  readonly resolutionSource: string;
  readonly resolutionWindowExpiresAtMs: number;
  readonly creatorSide: "yes" | "no";
  readonly operationId?: string;
  readonly creatorStake?: bigint;
  readonly seedRate?: bigint;
  readonly ruleHash?: string;
};

export const normalizeVaultQuestion = (question: string): string =>
  question.trim().replace(/\s+/g, " ").toLowerCase();

export const idempotencyKeyFor = (fields: VaultIdempotencyFields): string => {
  if (fields.operationId !== undefined) return fields.operationId;
  const payload = [
    fields.marketId.trim(),
    normalizeVaultQuestion(fields.question),
    fields.resolutionSource.trim(),
    String(fields.resolutionWindowExpiresAtMs),
    fields.creatorSide,
    ...(fields.ruleHash === undefined ? [] : [fields.ruleHash])
  ].join("\0");

  return createHash("sha256").update(payload).digest("hex");
};

export const idempotencyKeyFromDraft = (draft: VaultDraft): string =>
  idempotencyKeyFor({
    marketId: draft.marketId,
    question: draft.question,
    resolutionSource: draft.resolutionSource,
    resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs,
    creatorSide: draft.creatorSide ?? "yes",
    ...(((draft as { readonly ruleHash?: string }).ruleHash === undefined)
      ? {}
      : { ruleHash: (draft as { readonly ruleHash?: string }).ruleHash })
  });

export const idempotencyKeyFromCreateIntent = (intent: {
  readonly marketId: string; readonly question: string; readonly resolutionSource: string;
  readonly resolutionWindowExpiresAtMs: number; readonly creatorSide: "yes" | "no";
  readonly creatorStake?: bigint; readonly seedRate?: bigint;
  readonly operationId?: string; readonly mandate?: VaultMandate; readonly ruleHash?: string;
}): string => {
  if (intent.mandate && intent.operationId) return `0x${createHash("sha256").update(JSON.stringify([
    intent.operationId, intent.marketId, intent.question, intent.creatorSide,
    String(intent.creatorStake), String(intent.seedRate), new TextDecoder().decode(canonicalMandateBytes(intent.mandate))
  ])).digest("hex")}`;
  return idempotencyKeyFor(intent);
};
