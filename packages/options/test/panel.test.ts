import { describe, expect, it } from "vitest";

import { asMarketId } from "../src/model/index.js";
import { projectOptionsPanel } from "../src/panel/project.js";
import { readUserOptionsSnapshot } from "../src/read/snapshot.js";
import {
  createFakeOptionsReadTransport,
  fixtureResolvedPosition,
  fixtureResolvedVault,
  fixtureSeed,
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

  it("includes user deposited/streamed amounts on both sides", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const userPanel = panel.markets[0]?.vaults[0]?.user;
    expect(userPanel?.positions.yes.streamedUSDC).toBe("25000000");
    expect(userPanel?.positions.no.streamedUSDC).toBe("5000000");
    expect(userPanel?.totals.streamedUSDC).toBe("30000000");
  });

  it("includes funding rates and marks zero rate as paused", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const userPanel = panel.markets[0]?.vaults[0]?.user;
    expect(userPanel?.positions.yes.fundingRatePerMinuteUSDC).toBe("800000");
    expect(userPanel?.positions.yes.streamPaused).toBe(false);
    expect(userPanel?.positions.no.fundingRatePerMinuteUSDC).toBe("0");
    expect(userPanel?.positions.no.streamPaused).toBe(true);
    expect(userPanel?.activeFunding.allPaused).toBe(false);
  });

  it("includes FLOW balance, staked amount, pending dividends, and loss claims", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.lvst.balanceLVST).toBe("1000000000000000000");
    expect(panel.lvst.stakedLVST).toBe("250000000000000000");
    expect(panel.lvst.pendingDividendsUSDC).toBe("12500000");
    expect(panel.lvst.lossClaims.claimableLVST).toBe("500000000000000000");
  });

  it("projects resolved vault claimable winnings and per-side loss claims", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReadTransport({
      ...fixtureSeed(user),
      vaults: [fixtureResolvedVault()],
      positions: [fixtureResolvedPosition(user)]
    });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.status).toBe("resolved");
    expect(vault?.outcome).toBe("yes");
    expect(vault?.user?.positions.yes.claimableUSDC).toBe("58000000");
    expect(vault?.user?.positions.no.lossClaimableLVST).toBe("2500000");
    expect(vault?.user?.positions.yes.isWinningSide).toBe(true);
    expect(vault?.user?.positions.no.isWinningSide).toBe(false);
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
});
