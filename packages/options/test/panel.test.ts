import { describe, expect, it } from "vitest";

import { asMarketId, priceOf, usdcToNumber } from "../src/model/index.js";
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
    expect(vault?.pools.totalUSDC).toBe(279);
    expect(vault?.pools.sharePriceYes).toBe(usdcToNumber(priceOf(94_000_000n)));
    expect(vault?.pools.sharePriceNo).toBe(usdcToNumber(priceOf(185_000_000n)));
    expect(panel.markets[0]?.totals.pooledUSDC).toBe(279);
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

    expect(vault?.pools.settledPoolUSDC).toBe(0);
    expect(vault?.pools.livePoolUSDC ?? 0).toBeGreaterThan(0);
    expect(panel.markets[0]?.totals.livePooledUSDC ?? 0).toBeGreaterThan(0);
    // Growth rate surfaced from the real board sideRate (yes accrues at 1_000_000/sec, no at 0).
    expect(vault?.pools.poolRatePerSecUSDC ?? 0).toBeGreaterThan(0);
    expect(panel.markets[0]?.totals.livePooledRatePerSecUSDC ?? 0).toBeGreaterThan(0);
  });

  it("projects NFT lane rates and accrued shares", async () => {
    const user = fixtureUser();
    // YES streams from a live shared balance, so the idle NO leg reads `paused` (money to resume from).
    const transport = createFakeOptionsReader({ ...fixtureSeed(user), nfts: [fixtureNft(user, { balance: 50_000_000n })] });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const nft = panel.nfts[0];
    expect(nft?.tokenId).toBe("1");
    expect(nft?.laneCount).toBe(2);
    expect(nft?.lanes[0]?.side).toBe("yes");
    expect(nft?.lanes[0]?.status).toBe("streaming");
    expect(nft?.lanes[0]?.stream.ratePerSecRaw).toBe("800000");
    expect(nft?.lanes[0]?.shares.accruedRaw).toBe("34000000");
    // Sole funder of the side ⇒ owns 100% of its shares (item 2: percentage exposed from the SDK).
    expect(nft?.lanes[0]?.shares.percentOfSide).toBe(100);
    // NO leg: banked shares, no active stream, but the shared balance is live ⇒ paused (rule: one leg
    // streaming ⇒ the other pauses, resumable; it would only read `depleted` once the money is gone).
    expect(nft?.lanes[1]?.side).toBe("no");
    expect(nft?.lanes[1]?.status).toBe("paused");
    expect(nft?.lanes[1]?.stream.ratePerSecRaw).toBe("0");
    expect(nft?.lanes[1]?.shares.accruedRaw).toBe("6000000");
  });

  it("includes vault share totals from snapshot enrichment", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    const vault = panel.markets[0]?.vaults[0];
    expect(vault?.shareTotals.yes).toBe(34);
    expect(vault?.shareTotals.no).toBe(6);
  });

  it("includes LVST balance, staked amount, and pending dividends", async () => {
    const user = fixtureUser();
    const transport = createFakeOptionsReader(fixtureSeed(user));
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.lvst.balanceLVST).toBe(1);
    expect(panel.lvst.stakedLVST).toBe(0.25);
    expect(panel.lvst.pendingDividendsUSDC).toBe(12.5);
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
    expect(vault?.pools.totalUSDC).toBe(597);
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
          committedRate: 800_000n,
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

    expect(panel.nfts[0]?.lanes[0]?.status).toBe("depleted");
  });

  it("caps live pool at the contract's funder boundary instead of extrapolating sideRate", async () => {
    // A funder past its runway is still summed into board.sideRate until the chain settles the
    // boundary. The canonical schedule (Vault.getBoundaries → readBoundaries) must cap the projection
    // at the run-dry instant — else the live pool climbs past the funded amount forever. The boundary
    // comes straight from the contract, so this holds for ANY viewer (no per-user NFT reconstruction).
    const user = fixtureUser();
    const nowMs = Date.now();
    const seed = fixtureSeed(user);
    const transport = createFakeOptionsReader({
      ...seed,
      vaults: [{ ...seed.vaults![0]!, pools: { yes: 0n, no: 0n } }],
      boards: {
        "vault_01:yes": { pool: 0n, sideRate: 1_000_000n, g: 0n, lastAdvanceMs: nowMs - 60_000 },
        "vault_01:no": { pool: 0n, sideRate: 0n, g: 0n, lastAdvanceMs: nowMs - 60_000 }
      },
      boundaries: {
        "vault_01:yes": [{ maxEndMs: nowMs - 30_000, rate: 1_000_000n }], // ran dry 30s after advance
        "vault_01:no": []
      }
    });
    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);
    const vault = panel.markets[0]?.vaults[0];

    // Capped at 30s × 1_000_000/s = $30 (the funded amount), NOT 60s × = $60 and climbing.
    expect(vault?.pools.liveYesUSDC).toBe(usdcToNumber(30_000_000n));
    expect(vault?.pools.poolRatePerSecUSDC).toBe(0);
  });
});
