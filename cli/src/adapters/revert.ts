// Revert decoding [e2e harness gap #4]. Chain writes (esp. via the AA bundler) surface as an opaque
// wrapper — e.g. `ExecutionFailed()` (0xacfdb444) hiding the INNER `Error(string)` reason like
// "MarketRegistry: market exists". A user must see WHY a call failed, so this best-effort decoder digs
// the inner reason out of whatever shape the error arrives in (viem BaseError, a raw revert hex blob,
// or a plain Error message) and returns a human string. Used by produce + steward resolve and reusable
// by the other write commands.

import { BaseError, ContractFunctionRevertedError, decodeErrorResult } from "viem";

// Known wrapper selectors that carry no useful reason on their own.
const WRAPPER_SELECTORS: Record<string, string> = {
  "0xacfdb444": "ExecutionFailed()"
};

const errorStringAbi = [
  { type: "error", name: "Error", inputs: [{ type: "string" }] }
] as const;

/** Pull the first `Error(string)` (selector 0x08c379a0) reason out of an arbitrary error blob. */
const decodeErrorStringFrom = (text: string): string | undefined => {
  const match = text.match(/0x08c379a0[0-9a-fA-F]+/);
  if (match === null) {
    return undefined;
  }
  // Trim to an even-length hex word boundary before decoding.
  let data = match[0];
  if (data.length % 2 !== 0) {
    data = data.slice(0, -1);
  }
  try {
    const decoded = decodeErrorResult({ abi: errorStringAbi, data: data as `0x${string}` });
    const reason = decoded.args?.[0];
    return typeof reason === "string" ? reason : undefined;
  } catch {
    return undefined;
  }
};

const wrapperNote = (text: string): string | undefined => {
  for (const [selector, name] of Object.entries(WRAPPER_SELECTORS)) {
    if (text.includes(selector)) {
      return name;
    }
  }
  return undefined;
};

/** Best-effort: return the most specific human-readable reason for a chain-write failure. */
export const describeChainError = (error: unknown): string => {
  const text =
    error instanceof Error ? `${error.message}\n${(error as { stack?: string }).stack ?? ""}` : String(error);

  // 1) viem rich errors: walk to the contract revert and prefer its decoded reason / errorName.
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const reason = revert.reason ?? revert.data?.errorName;
      if (reason !== undefined && reason.length > 0) {
        return reason;
      }
    }
  }

  // 2) Inner Error(string) hidden inside a wrapper / userOp revert blob.
  const inner = decodeErrorStringFrom(text);
  const wrapper = wrapperNote(text);
  if (inner !== undefined) {
    return wrapper === undefined ? inner : `${inner} (wrapped in ${wrapper})`;
  }
  if (wrapper !== undefined) {
    return `${wrapper} — no inner reason recoverable`;
  }

  // 3) viem short message, else the raw message.
  if (error instanceof BaseError && error.shortMessage.length > 0) {
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
};
