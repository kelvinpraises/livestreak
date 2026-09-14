// Shared userOperation inclusion poller (systemic P0: POLL + SUCCESS).
//
// Previously FOUR identical copies polled with maxAttempts=40, delayMs=50 = 2s total and accepted
// success ONLY as boolean. relay-kit returns the hash WITHOUT awaiting inclusion, so on a real bundler
// 2s is far too short (every chain write "times out"); and a bundler returning success as "0x1"/1
// produced false-failures. This is the single source of truth. See scope-foundations.md (C3).
//
// Wallet stays Effect-free: this throws plain `Error`. Effect callers (observe) wrap it in
// `Effect.tryPromise` and map to their LiveStreakRuntimeError; promise callers classify at the call-site.

export interface UserOperationReceiptReader {
  getUserOperationReceipt(hash: string): Promise<unknown>;
}

// Thrown when inclusion polling exhausts its deadline. Carries the userOpHash so callers can
// recognize the timeout via `instanceof` (bookmaker keys its pending-recovery path on this) rather
// than string-matching the message. Message text is unchanged from the previous plain Error.
export class UserOperationPollTimeoutError extends Error {
  readonly userOpHash: string;
  constructor(userOpHash: string, message: string) {
    super(message);
    this.name = "UserOperationPollTimeoutError";
    this.userOpHash = userOpHash;
  }
}

export interface PollUserOperationOptions {
  readonly timeoutMs?: number; // default 60_000 (was effectively 2_000 — the bug)
  readonly intervalMs?: number; // default 1_000 (first delay)
  readonly backoff?: number; // default 1.5 (multiplier, capped)
  readonly maxIntervalMs?: number; // default 5_000
  readonly attemptTimeoutMs?: number; // default 20_000 — per-fetch cap (see ATTEMPT_TIMEOUT below)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A single poll attempt that outran its per-attempt budget. The overall `timeoutMs` only governs the
// SLEEP between attempts — so without this, one `getUserOperationReceipt` call that stalls (the heavy
// first userOp: Safe deploy + mint, with the bundler mid-bundle) blocks the loop forever and the
// deadline check below is never reached. That was the real "first bet hangs" bug. We bound every
// attempt and treat an over-budget one as "not included yet → retry", so the deadline is always honored.
const ATTEMPT_TIMEOUT = Symbol("userop-poll-attempt-timeout");

const withAttemptTimeout = async <T>(
  work: Promise<T>,
  ms: number
): Promise<T | typeof ATTEMPT_TIMEOUT> => {
  // The losing branch (an abandoned, possibly-stalled fetch) may settle later; swallow it so it can't
  // surface as an unhandled rejection after we've moved on.
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof ATTEMPT_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(ATTEMPT_TIMEOUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

// Canonical success reader: accepts boolean | number | hex/decimal/textual string. `undefined` =
// unknown shape (caller throws "missing success").
export const readUserOperationSuccess = (receipt: unknown): boolean | undefined => {
  if (!isRecord(receipt)) {
    return undefined;
  }

  const value = receipt["success"];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "0x1" || lower === "1" || lower === "true") {
      return true;
    }
    if (lower === "0x0" || lower === "0" || lower === "false") {
      return false;
    }
    if (lower.startsWith("0x")) {
      const n = Number(value);
      return Number.isNaN(n) ? undefined : n !== 0;
    }
  }

  return undefined;
};

// Heuristic: does a userOp send failure originate on the paymaster/sponsor side (rather than being a
// plain send/transport failure)? Sniffs the message for paymaster/sponsor/validity-window markers.
// Effect-free — each caller keeps its own error wrapper + wording; this only decides the branch.
export const isPaymasterSideFailure = (error: unknown): boolean => {
  const lower = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    lower.includes("paymaster") ||
    lower.includes("sponsor") ||
    lower.includes("validuntil") ||
    lower.includes("validafter")
  );
};

// Throws on a present-but-reverted receipt or a receipt missing a readable success field.
export const assertUserOperationSucceeded = (receipt: unknown): void => {
  if (!isRecord(receipt)) {
    throw new Error("UserOperation receipt payload is not an object");
  }

  const success = readUserOperationSuccess(receipt);
  if (success === undefined) {
    throw new Error("UserOperation receipt is missing success");
  }
  if (success === false) {
    throw new Error("UserOperation included but reverted");
  }
};

// Polls until the userOp is included & succeeded, then resolves with the receipt (cli reads its
// txHash off the return value). Throws on revert or timeout. Exponential backoff capped at
// maxIntervalMs, polling until cumulative wait reaches timeoutMs.
export const pollUntilUserOperationIncluded = async (
  readOnly: UserOperationReceiptReader,
  userOpHash: string,
  options: PollUserOperationOptions = {}
): Promise<unknown> => {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxIntervalMs = options.maxIntervalMs ?? 5_000;
  const backoff = options.backoff ?? 1.5;
  const attemptTimeoutMs = Math.min(options.attemptTimeoutMs ?? 20_000, timeoutMs);
  let interval = options.intervalMs ?? 1_000;

  const deadline = Date.now() + timeoutMs;

  // Always attempt at least once, then keep polling until the deadline.
  let lastError: unknown;
  for (;;) {
    let receipt: unknown = null;
    try {
      const result = await withAttemptTimeout(
        readOnly.getUserOperationReceipt(userOpHash),
        attemptTimeoutMs
      );
      if (result !== ATTEMPT_TIMEOUT) {
        receipt = result;
      }
    } catch (error) {
      // A throw HERE is a transport/lookup failure (a dropped socket, a transient bundler error) —
      // NOT a revert, which surfaces as receipt.success === false via assert below. On a real bundler
      // these hiccups happen; failing the user's action on one is wrong. Remember it and retry until
      // the deadline, then surface it so the caller sees the real cause rather than a bare timeout.
      lastError = error;
    }

    if (receipt !== null && receipt !== undefined) {
      assertUserOperationSucceeded(receipt);
      return receipt;
    }

    if (Date.now() >= deadline) {
      const base = `Timed out waiting for UserOperation receipt for ${userOpHash}`;
      throw new UserOperationPollTimeoutError(
        userOpHash,
        lastError instanceof Error ? `${base} (last error: ${lastError.message})` : base
      );
    }

    const remaining = deadline - Date.now();
    await sleep(Math.min(interval, Math.max(0, remaining)));
    interval = Math.min(interval * backoff, maxIntervalMs);
  }
};
