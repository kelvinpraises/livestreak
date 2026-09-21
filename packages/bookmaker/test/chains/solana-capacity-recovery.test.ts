import { LiveStreakRuntimeError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { detectSolanaCapacityError } from "../../src/chains/solana/writer.js";

// A full protocol-state blob rejects a NEW vault with the typed, permissionlessly-recoverable
// `StateFull` fault. Anchor formats it as `Program log: AnchorError ... Error Code: StateFull ...`
// and the kit hangs those preflight lines on the error's `context.logs`. createVault recovers by
// sending the permissionless grow_protocol ix and retrying once. The detector reads the anchor error
// NAME from the message/cause chain plus any context.logs.
describe("detectSolanaCapacityError (bookmaker)", () => {
  it("detects StateFull from a raw kit error's context.logs (anchor line)", () => {
    const error = {
      message: "Transaction simulation failed",
      context: {
        logs: [
          "Program LiveStreakEngine1111111111111111111111111 invoke [1]",
          "Program log: Instruction: CreateVaultSeeded",
          "Program log: AnchorError occurred. Error Code: StateFull. Error Number: 6021. Error Message: The engine-state blob is full.",
          "Program LiveStreakEngine1111111111111111111111111 failed: custom program error: 0x1785"
        ]
      }
    };
    expect(detectSolanaCapacityError(error)).toBe("StateFull");
  });

  it("detects StateFull off the wrapped LiveStreakRuntimeError message chain", () => {
    const cause = new Error(
      "Program log: AnchorError occurred. Error Code: StateFull. Error Number: 6021."
    );
    const wrapped = new LiveStreakRuntimeError({ message: "Solana createVault failed" });
    (wrapped as { cause?: unknown }).cause = cause;
    expect(detectSolanaCapacityError(wrapped)).toBe("StateFull");
  });

  it("detects VaultBoardBehind (recognised for symmetry) from context.logs", () => {
    const error = {
      context: {
        logs: ["Program log: AnchorError occurred. Error Code: VaultBoardBehind. Error Number: 6033."]
      }
    };
    expect(detectSolanaCapacityError(error)).toBe("VaultBoardBehind");
  });

  it("returns undefined for unrelated / non-capacity errors", () => {
    expect(
      detectSolanaCapacityError(
        new LiveStreakRuntimeError({ message: "Solana createVault failed: WrongMarket" })
      )
    ).toBeUndefined();
    expect(
      detectSolanaCapacityError({
        context: { logs: ["Program log: AnchorError occurred. Error Code: VaultAlreadyExists."] }
      })
    ).toBeUndefined();
    expect(detectSolanaCapacityError(new Error(""))).toBeUndefined();
    expect(detectSolanaCapacityError(undefined)).toBeUndefined();
    expect(detectSolanaCapacityError("plain string with no fault name")).toBeUndefined();
  });
});
