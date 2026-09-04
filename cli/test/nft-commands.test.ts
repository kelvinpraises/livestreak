import { describe, expect, it } from "vitest";
import { bridgeActionScope } from "@livestreak/options";
import { buildSetLanesEnvelope, buildStopFundingEnvelope, buildWithdrawManyEnvelope } from "../src/commands/lanes.js";
import { buildCallActionEnvelope } from "../src/edges/options.js";

const vaultA = `0x${"aa".repeat(32)}`;
const vaultB = `0x${"bb".repeat(32)}`;

describe("stop-funding envelope", () => {
  it("builds stopFunding action + args", () => {
    const envelope = buildCallActionEnvelope("stopFunding", {
      tokenId: 1n,
      vaultId: vaultA,
      side: "yes"
    });

    expect(envelope).toEqual({
      scope: bridgeActionScope,
      action: "stopFunding",
      args: { tokenId: 1n, vaultId: vaultA, side: "yes" }
    });
  });

  it("builds stopAllFunding action + args", () => {
    const envelope = buildCallActionEnvelope("stopAllFunding", { tokenId: 2n });
    expect(envelope.action).toBe("stopAllFunding");
  });
});

describe("withdraw-many envelope", () => {
  it("builds withdrawMany with vault id list", () => {
    const envelope = buildWithdrawManyEnvelope(1n, [vaultA, vaultB], "0x00000000000000000000000000000000000000cc");
    expect(envelope.action).toBe("withdrawMany");
    expect((envelope.args as { vaultIds: string[] }).vaultIds).toHaveLength(2);
  });
});

describe("nft envelopes", () => {
  it("builds transferNft action + args", () => {
    const envelope = buildCallActionEnvelope("transferNft", {
      tokenId: 1n,
      from: "0x00000000000000000000000000000000000000aa",
      to: "0x00000000000000000000000000000000000000bb"
    });
    expect(envelope.action).toBe("transferNft");
  });

  it("builds approveNft action + args", () => {
    const envelope = buildCallActionEnvelope("approveNft", {
      tokenId: 1n,
      operator: "0x00000000000000000000000000000000000000cc"
    });
    expect(envelope.action).toBe("approveNft");
  });

  it("builds setApprovalForAll action + args", () => {
    const envelope = buildCallActionEnvelope("setApprovalForAll", {
      operator: "0x00000000000000000000000000000000000000cc",
      approved: true
    });
    expect(envelope.action).toBe("setApprovalForAll");
  });
});

describe("stop helper", () => {
  it("wraps stopFunding via helper", () => {
    const envelope = buildStopFundingEnvelope(1n, vaultA, "no");
    expect(envelope.action).toBe("stopFunding");
    expect((envelope.args as { side: string }).side).toBe("no");
  });
});
