import { describe, expect, it } from "vitest";
import { validateOptionsVaultSide, bridgeActionScope } from "@livestreak/options";
import { buildCallActionEnvelope } from "../src/adapters/options.js";
import { routeClaimAction } from "../src/commands/vaults.js";
import { renderOptionsBoard } from "../src/render/output.js";

describe("edges/options", () => {
  it("builds the bridge callAction envelope", () => {
    const envelope = buildCallActionEnvelope("fund", {
      tokenId: 1n,
      vaultId: "0x" + "11".repeat(32),
      side: "yes",
      rate: 1n,
      deposit: 100n
    });

    expect(envelope).toEqual({
      scope: bridgeActionScope,
      action: "fund",
      args: {
        tokenId: 1n,
        vaultId: "0x" + "11".repeat(32),
        side: "yes",
        rate: 1n,
        deposit: 100n
      }
    });
  });
});

describe("claim routing", () => {
  it("routes win claims to withdraw", () => {
    expect(routeClaimAction(false)).toBe("withdraw");
  });

  it("routes loss claims to claimLossLvst", () => {
    expect(routeClaimAction(true)).toBe("claimLossLvst");
  });

  it("rejects invalid vault sides", () => {
    expect(() => validateOptionsVaultSide("maybe")).toThrow();
  });
});

describe("render/options board", () => {
  it("renders vault and LVST panels from the board", () => {
    const output = renderOptionsBoard({
      revision: 1,
      panel: {
        account: "0x00000000000000000000000000000000000000aa",
        markets: [
          {
            marketId: "0x" + "11".repeat(32),
            title: "Demo market",
            creator: "0x00000000000000000000000000000000000000aa",
            status: "open",
            vaultIds: ["0x" + "22".repeat(32)],
            totals: {
              pooledUSDC: "100",
              totalPooledUSDC: "100",
              activeVaults: 1,
              resolvedVaults: 0
            },
            vaults: [
              {
                vaultId: "0x" + "22".repeat(32),
                marketId: "0x" + "11".repeat(32),
                question: "Will it rain?",
                type: "momentum",
                creator: "0x00000000000000000000000000000000000000aa",
                status: "open",
                outcome: "pending",
                pools: { yesUSDC: "50", noUSDC: "50", totalUSDC: "100" },
                shareTotals: { yes: "1", no: "1" },
                odds: {
                  yesMultiplier: 2,
                  noMultiplier: 2,
                  yesProbabilityBps: 5000,
                  noProbabilityBps: 5000
                },
                timing: { createdAtMs: 0, expiresAtMs: 1 },
                steward: { hot: false }
              }
            ]
          }
        ],
        nfts: [],
        lvst: {
          account: "0x00000000000000000000000000000000000000aa",
          balanceLVST: "10",
          stakedLVST: "5",
          unstakedLVST: "5",
          pendingDividendsUSDC: "0",
          actions: {
            canStake: true,
            canUnstake: true,
            canClaimDividends: false
          }
        },
        user: { account: "0x00000000000000000000000000000000000000aa" }
      },
      snapshot: {} as never
    });

    expect(output).toContain("Demo market");
    expect(output).toContain("Will it rain?");
    expect(output).toContain("balance=10");
  });
});
