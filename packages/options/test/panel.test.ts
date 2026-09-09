import { describe, expect, it } from "vitest";

import { asMarketId, asTokenId, asVaultId, priceOf } from "../src/model/index.js";
import { projectOptionsPanel } from "../src/bridge/panel/project.js";
import { readUserOptionsSnapshot } from "../src/flows/snapshot.js";
import {
  createFakeOptionsReader,
  fixtureNft,
  fixtureResolvedVault,
  fixtureSeed,
  fixtureShareTotals,
  fixtureUser
} from "./helpers/fake-chain.js";

describe("projectOptionsPanel", () => {
  it("includes total pool per vault and market", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.pools.totalUSDC).toBe("279000000");
    expect(vault?.pools.sharePriceYes).toBe(priceOf(94_000_000n).toString());
    expect(vault?.pools.sharePriceNo).toBe(priceOf(185_000_000n).toString());
    expect(panel.markets[0]?.totals.pooledUSDC).toBe("279000000");
  });

  it("exposes live pool above settled when board sideRate is accruing", async () => {
    const user = fixtureUser();
    const nowMs = Date.now();
    const transport = createFakeOptionsReader({
      ...fixtureSeed(user),
      vaults: [
        {
          ...fixtureSeed(user).vaults![0]!,
          pools: { yes: 0n, no: 0n }
        }
      ],
      boards: {
        "vault_01:yes": {
          pool: 0n,
          sideRate: 1_000_000n,
          g: 0n,
          lastAdvanceMs: nowMs - 30_000
        },
        "vault_01:no": {
          pool: 0n,
          sideRate: 0n,
          g: 0n,
          lastAdvanceMs: nowMs - 30_000
        }
      }
    });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);
    const vault = panel.markets[0]?.vaults[0];

    expect(vault?.pools.settledPoolUSDC).toBe("0");
    expect(BigInt(vault?.pools.livePoolUSDC ?? "0")).toBeGreaterThan(0n);
    expect(BigInt(panel.markets[0]?.totals.livePooledUSDC ?? "0")).toBeGreaterThan(0n);
  });

  it("projects NFT lane rates and accrued shares", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const nft = panel.nfts[0];
    expect(nft?.tokenId).toBe("1");
    expect(nft?.laneCount).toBe(2);
    expect(nft?.lanes[0]?.side).toBe("yes");
    expect(nft?.lanes[0]?.rate).toBe("800000");
    expect(nft?.lanes[0]?.sharesAccrued).toBe("34000000");
    expect(nft?.lanes[1]?.side).toBe("no");
    expect(nft?.lanes[1]?.rate).toBe("0");
    expect(nft?.lanes[1]?.sharesAccrued).toBe("6000000");
  });

  it("includes vault share totals from snapshot enrichment", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.shareTotals.yes).toBe("34000000");
    expect(vault?.shareTotals.no).toBe("6000000");
  });

  it("includes LVST balance, staked amount, and pending dividends", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.lvst.balanceLVST).toBe("1000000000000000000");
    expect(panel.lvst.stakedLVST).toBe("250000000000000000");
    expect(panel.lvst.pendingDividendsUSDC).toBe("12500000");
    expect(panel.lvst.actions.canStake).toBe(true);
    expect(panel.lvst.actions.canClaimDividends).toBe(true);
  });

  it("includes market creator on market panel", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.markets[0]?.creator).toBe("0xcreator");
  });

  it("projects resolved vault status and outcome", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader({
      ...fixtureSeed(user),
      vaults: [fixtureResolvedVault()],
      shareTotals: {
        vault_01: fixtureShareTotals()
      }
    });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.status).toBe("resolved");
    expect(vault?.outcome).toBe("yes");
    expect(vault?.pools.totalUSDC).toBe("597000000");
  });

  it("does not leak transport objects or unrelated domain fields", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);
    const serialized = JSON.stringify(panel);

    expect(serialized).not.toContain("FakeTransportInMemory");
    expect(serialized).not.toContain("stewardDecision");
    expect(serialized).not.toContain("observeWorker");
    expect(serialized).not.toContain("forumThread");
    expect(serialized).not.toMatch(/"abi"\s*:/);
    expect(panel).not.toHaveProperty("transport");
  });

  it("projects depleted lane flag from NFT lanes", async () => {
    const user = fixtureUser();
    const nft = fixtureNft(user, {
      lanes: [
        {
          tokenId: fixtureNft(user).tokenId,
          vaultId: fixtureNft(user).lanes[0]!.vaultId,
          side: "yes",
          rate: 0n,
          gPaid: 0n,
          sharesAccrued: 0n,
          depleted: true
        }
      ],
      laneCount: 1
    });
    const transport = createFakeOptionsReader({
      ...fixtureSeed(user),
      nfts: [nft]
    });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.nfts[0]?.lanes[0]?.depleted).toBe(true);
  });
});
