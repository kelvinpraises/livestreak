import { describe, expect, it } from "vitest";

import { asMarketId } from "../src/model/index.js";
import { projectOptionsPanel } from "../src/panel/project.js";
import { readUserOptionsSnapshot } from "../src/read/snapshot.js";
import {
  createFakeOptionsReadTransport,
  fixtureNft,
  fixtureResolvedVault,
  fixtureSeed,
  fixtureShareTotals,
  fixtureUser
} from "./helpers/fake-transport.js";

describe("projectOptionsPanel", () => {
  it("includes total pool per vault and market", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.pools.totalUSDC).toBe("279000000");
    expect(panel.markets[0]?.totals.pooledUSDC).toBe("279000000");
  });

  it("projects NFT lane rates and accrued shares", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
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
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.shareTotals.yes).toBe("34000000");
    expect(vault?.shareTotals.no).toBe("6000000");
  });

  it("includes LVST balance, staked amount, and pending dividends", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
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
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.markets[0]?.creator).toBe("0xcreator");
  });

  it("projects resolved vault status and outcome", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport({
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
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
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
    const transport = createFakeOptionsReadTransport({
      ...fixtureSeed(user),
      nfts: [nft]
    });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.nfts[0]?.lanes[0]?.depleted).toBe(true);
  });
});
