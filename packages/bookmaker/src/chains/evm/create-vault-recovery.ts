import { LiveStreakRuntimeError } from "@livestreak/core";

import type { TxId } from "../types.js";
import { asTxId } from "../types.js";

// --- exports ---

export const RECEIPT_TIMEOUT_PHASE = "receipt-timeout";

export const readReceiptTimeoutUserOpHash = (error: unknown): TxId | undefined => {
  if (!(error instanceof LiveStreakRuntimeError)) {
    return undefined;
  }

  const details = error.metadata?.details;
  if (typeof details !== "string" || details.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(details) as { userOpHash?: string; phase?: string };
    if (parsed.phase !== RECEIPT_TIMEOUT_PHASE) {
      return undefined;
    }

    if (typeof parsed.userOpHash !== "string" || parsed.userOpHash.startsWith("0x") === false) {
      return undefined;
    }

    return asTxId(parsed.userOpHash);
  } catch {
    return undefined;
  }
};

export const createVaultUnconfirmedError = (userOpHash: TxId): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: "createVault submitted but unconfirmed; not resubmitting",
    metadata: {
      details: JSON.stringify({ userOpHash, phase: "unconfirmed" }),
      retryable: true
    }
  });

export const receiptTimeoutError = (userOpHash: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message: `Timed out waiting for UserOperation receipt for ${userOpHash}`,
    metadata: {
      details: JSON.stringify({ userOpHash, phase: RECEIPT_TIMEOUT_PHASE }),
      retryable: true
    }
  });
