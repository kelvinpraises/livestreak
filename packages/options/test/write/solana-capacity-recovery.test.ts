import { LiveStreakRuntimeError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { detectSolanaCapacityError } from "../../src/chains/solana/writer.js";

// The Solana engine raises two typed, permissionlessly-recoverable capacity faults on preflight:
// `StateFull` (the protocol-state blob is out of room — fixed by grow_protocol) and
// `VaultBoardBehind` (a vault board has too many elapsed funder boundaries for the implicit
// catch-up — fixed by draining with advance). Anchor formats both as
// `Program log: AnchorError ... Error Code: <Name> ...`, and the kit hangs those preflight lines on
// the error's `context.logs`. The writer folds the name into the wrapped message so the detector
// works on both the raw kit error (name in logs) and the wrapped LiveStreakRuntimeError.
describe("detectSolanaCapacityError", () => {
  it("detects StateFull from a raw kit error's context.logs (anchor line)", () => {
    const error = {
      message: "Transaction simulation failed",
      context: {
        logs: [
          "Program LiveStreakEngine1111111111111111111111111 invoke [1]",
          "Program log: Instruction: Fund",
          "Program log: AnchorError occurred. Error Code: StateFull. Error Number: 6021. Error Message: The engine-state blob is full.",
          "Program LiveStreakEngine1111111111111111111111111 failed: custom program error: 0x1785"
        ]
      }
    };
    expect(detectSolanaCapacityError(error)).toBe("StateFull");
  });

  it("detects VaultBoardBehind from a raw kit error's context.logs (anchor line)", () => {
    const error = {
      message: "Transaction simulation failed",
      context: {
        logs: [
          "Program log: Instruction: SetLanes",
          "Program log: AnchorError occurred. Error Code: VaultBoardBehind. Error Number: 6033. Error Message: The vault board has too many elapsed boundaries for an implicit catch-up.",
          "Program LiveStreakEngine1111111111111111111111111 failed: custom program error: 0x1791"
        ]
      }
    };
    expect(detectSolanaCapacityError(error)).toBe("VaultBoardBehind");
  });

  it("detects StateFull off the wrapped LiveStreakRuntimeError message (send() folds the name in)", () => {
    // send() drops context.logs but appends `(StateFull)` to the thrown message.
    const wrapped = new LiveStreakRuntimeError({
      message: "Solana transaction failed: Transaction simulation failed (StateFull)"
    });
    expect(detectSolanaCapacityError(wrapped)).toBe("StateFull");
  });

  it("detects VaultBoardBehind off the wrapped LiveStreakRuntimeError message", () => {
    const wrapped = new LiveStreakRuntimeError({
      message: "Solana transaction failed: Transaction simulation failed (VaultBoardBehind)"
    });
    expect(detectSolanaCapacityError(wrapped)).toBe("VaultBoardBehind");
  });

  it("finds the capacity name down the error cause chain", () => {
    const cause = new Error(
      "Program log: AnchorError occurred. Error Code: StateFull. Error Number: 6021."
    );
    const wrapped = new LiveStreakRuntimeError({ message: "Solana transaction failed" });
    (wrapped as { cause?: unknown }).cause = cause;
    expect(detectSolanaCapacityError(wrapped)).toBe("StateFull");
  });

  it("returns undefined for unrelated / non-capacity errors", () => {
    expect(
      detectSolanaCapacityError(
        new LiveStreakRuntimeError({ message: "Solana transaction failed: VaultInsufficientUsdc" })
      )
    ).toBeUndefined();
    expect(
      detectSolanaCapacityError({
        context: { logs: ["Program log: AnchorError occurred. Error Code: SettlementPending."] }
      })
    ).toBeUndefined();
    expect(detectSolanaCapacityError(new Error(""))).toBeUndefined();
    expect(detectSolanaCapacityError(undefined)).toBeUndefined();
    expect(detectSolanaCapacityError("plain string with no fault name")).toBeUndefined();
  });

  it("prefers StateFull when both names somehow appear (grow is the cheaper, blob-level fix)", () => {
    const error = {
      context: { logs: ["... Error Code: StateFull ...", "... Error Code: VaultBoardBehind ..."] }
    };
    expect(detectSolanaCapacityError(error)).toBe("StateFull");
  });
});
