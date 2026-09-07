import { describe, expect, it } from "vitest";
import { bridgeActionScope } from "@livestreak/options";
import { buildClaimLossEnvelope, buildWithdrawEnvelope } from "../src/commands/settle.js";

const vault = `0x${"cc".repeat(32)}`;
const to = "0x00000000000000000000000000000000000000dd";

describe("settle withdraw envelope", () => {
  it("builds a withdraw action carrying tokenId/vaultId/to", () => {
    const envelope = buildWithdrawEnvelope(7n, vault, to);
    expect(envelope.scope).toBe(bridgeActionScope);
    expect(envelope.action).toBe("withdraw");
    const args = envelope.args as { tokenId: bigint; vaultId: string; to: string };
    expect(args.tokenId).toBe(7n);
    expect(args.vaultId).toBe(vault);
    expect(args.to).toBe(to);
  });
});

describe("settle claim-loss envelope", () => {
  it("builds a claimLossLvst action carrying tokenId/vaultId/side/to", () => {
    const envelope = buildClaimLossEnvelope(7n, vault, "no", to);
    expect(envelope.action).toBe("claimLossLvst");
    const args = envelope.args as { side: string; vaultId: string };
    expect(args.side).toBe("no");
    expect(args.vaultId).toBe(vault);
  });

  it("rejects an invalid side", () => {
    expect(() => buildClaimLossEnvelope(7n, vault, "perhaps", to)).toThrow();
  });
});
