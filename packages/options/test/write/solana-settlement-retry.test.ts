import { LiveStreakRuntimeError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { parseSettlementReadyAt, settlementRetryWaitMs } from "../../src/chains/solana/writer.js";

// The Solana program logs `settlement pending: ready_at=<unix seconds>` (protocol.rs
// `require_settled`) when a withdraw races ahead of the settlement boundary. The writer's retry
// parses that value to wait exactly until the vault becomes deliverable, falling back to a fixed
// one-cycle sleep when no ready_at is present.
describe("parseSettlementReadyAt", () => {
  it("extracts the unix-seconds value from a realistic program-log message", () => {
    expect(parseSettlementReadyAt("settlement pending: ready_at=1784356000")).toBe(1784356000);
  });

  it("extracts ready_at when embedded in a wrapped send-error message", () => {
    const message =
      "Solana transaction failed: Transaction simulation failed; settlement pending: ready_at=1784356000";
    expect(parseSettlementReadyAt(message)).toBe(1784356000);
  });

  it("returns undefined for unrelated messages", () => {
    expect(parseSettlementReadyAt("Solana transaction failed: VaultInsufficientUsdc")).toBeUndefined();
    expect(parseSettlementReadyAt("")).toBeUndefined();
    expect(parseSettlementReadyAt("ready_at=")).toBeUndefined();
  });

  it("rejects a zero or non-numeric ready_at", () => {
    expect(parseSettlementReadyAt("ready_at=0")).toBeUndefined();
  });
});

describe("settlementRetryWaitMs", () => {
  const FALLBACK = 11_000;

  it("falls back to the fixed one-cycle sleep when no ready_at is present", () => {
    const err = new LiveStreakRuntimeError({
      message: "Solana transaction failed: Transaction simulation failed"
    });
    expect(settlementRetryWaitMs(err, Date.now(), FALLBACK)).toBe(FALLBACK);
  });

  it("picks the parsed ready_at: sleeps until ready_at + 500ms", () => {
    const nowMs = 1_784_355_990_000; // 10s before ready_at
    const readyAt = 1_784_356_000; // unix seconds
    const err = new LiveStreakRuntimeError({
      message: `Solana transaction failed: settlement pending: ready_at=${readyAt}`
    });
    // (readyAt * 1000 - nowMs) = 10_000ms, + 500ms buffer = 10_500ms, within the 15s clamp.
    expect(settlementRetryWaitMs(err, nowMs, FALLBACK)).toBe(10_500);
  });

  it("finds ready_at down the error cause chain", () => {
    const cause = new Error("settlement pending: ready_at=1784356000");
    const err = new LiveStreakRuntimeError({ message: "Solana transaction failed" });
    (err as { cause?: unknown }).cause = cause;
    const nowMs = 1_784_356_000 * 1000 - 3_000; // 3s before ready_at
    expect(settlementRetryWaitMs(err, nowMs, FALLBACK)).toBe(3_500);
  });

  it("clamps to 0 when ready_at has already passed", () => {
    const readyAt = 1_784_356_000;
    const err = new LiveStreakRuntimeError({
      message: `settlement pending: ready_at=${readyAt}`
    });
    expect(settlementRetryWaitMs(err, readyAt * 1000 + 5_000, FALLBACK)).toBe(0);
  });

  it("clamps to 15s when ready_at is far in the future", () => {
    const readyAt = 1_784_356_000;
    const err = new LiveStreakRuntimeError({
      message: `settlement pending: ready_at=${readyAt}`
    });
    expect(settlementRetryWaitMs(err, readyAt * 1000 - 60_000, FALLBACK)).toBe(15_000);
  });
});
