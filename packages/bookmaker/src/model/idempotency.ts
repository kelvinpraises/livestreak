import { createHash } from "node:crypto";

import type { VaultDraft } from "./vault-draft.js";

// --- exports ---

export type VaultIdempotencyFields = {
  readonly marketId: string;
  readonly question: string;
  readonly resolutionSource: string;
  readonly resolutionWindowExpiresAtMs: number;
  readonly creatorSide: "yes" | "no";
};

export const normalizeVaultQuestion = (question: string): string =>
  question.trim().replace(/\s+/g, " ").toLowerCase();

export const idempotencyKeyFor = (fields: VaultIdempotencyFields): string => {
  const payload = [
    fields.marketId.trim(),
    normalizeVaultQuestion(fields.question),
    fields.resolutionSource.trim(),
    String(fields.resolutionWindowExpiresAtMs),
    fields.creatorSide
  ].join("\0");

  return createHash("sha256").update(payload).digest("hex");
};

export const idempotencyKeyFromDraft = (draft: VaultDraft): string =>
  idempotencyKeyFor({
    marketId: draft.marketId,
    question: draft.question,
    resolutionSource: draft.resolutionSource,
    resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs,
    creatorSide: draft.creatorSide ?? "yes"
  });

export const idempotencyKeyFromCreateIntent = (intent: {
  readonly marketId: string;
  readonly question: string;
  readonly resolutionSource: string;
  readonly resolutionWindowExpiresAtMs: number;
  readonly creatorSide: "yes" | "no";
}): string =>
  idempotencyKeyFor({
    marketId: intent.marketId,
    question: intent.question,
    resolutionSource: intent.resolutionSource,
    resolutionWindowExpiresAtMs: intent.resolutionWindowExpiresAtMs,
    creatorSide: intent.creatorSide
  });
