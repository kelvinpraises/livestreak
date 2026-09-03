import { describe, expect, it } from "vitest";

import { asMarketId, asTokenId, asVaultId } from "../src/model/index.js";
import { isAccrualFrozen, projectStreamAccrual } from "../src/model/accrual.js";
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

describe("stream accrual projector", () => {
  const board = {
    pool: 20_000_000n,
    sideRate: 1_000_000n,
    g: 5_000_000_000_000_000_000n,
    lastAdvanceMs: 1_700_000_000_000
  };

  const position = {
    rate: 250_000n,
    gPaid: 1_000_000_000_000_000_000n,
    depleted: false
  };

  const pools = { yes: 100_000_000n, no: 50_000_000n };
  const shareTotals = { yes: 10_000_000n, no: 5_000_000n };

  it("projects pending shares, value, and share price from board state", () => {
    const pendingShares = 1_500_000n;
    const view = projectStreamAccrual({
      board,
      position,
      pendingShares,
      pools,
      shareTotals,
      side: "yes",
      atMs: board.lastAdvanceMs + 5_000
    });

    expect(BigInt(view.pendingShares)).toBeGreaterThan(0n);
    expect(BigInt(view.valueUSDC)).toBeGreaterThan(0n);
    expect(view.sharesPerSec).toMatch(/^\d+$/);
    expect(view.sharePriceNow).toBeTruthy();
  });

  it("freezes after resolvedAt", () => {
    const pendingShares = 2_000_000n;
    const resolvedAtMs = board.lastAdvanceMs + 1_000;
    const frozen = projectStreamAccrual({
      board,
      position,
      pendingShares,
      pools,
      shareTotals,
      side: "yes",
      atMs: resolvedAtMs + 60_000,
      resolvedAtMs
    });

    expect(frozen.pendingShares).toBe(pendingShares.toString());
    expect(frozen.sharesPerSec).toBe("0");
    expect(
      isAccrualFrozen({
        board,
        position,
        pendingShares,
        pools,
        shareTotals,
        side: "yes",
        atMs: resolvedAtMs + 60_000,
        resolvedAtMs
      })
    ).toBe(true);
  });

  it("re-anchors on the next pendingShares read when frozen", () => {
    const atMs = board.lastAdvanceMs + 3_000;
    const resolvedAtMs = atMs;
    const firstRead = 1_000_000n;
    const secondRead = 1_200_000n;

    const first = projectStreamAccrual({
      board,
      position,
      pendingShares: firstRead,
      pools,
      shareTotals,
      side: "yes",
      atMs,
      resolvedAtMs
    });

    const second = projectStreamAccrual({
      board,
      position,
      pendingShares: secondRead,
      pools,
      shareTotals,
      side: "yes",
      atMs: atMs + 60_000,
      resolvedAtMs
    });

    expect(first.pendingShares).toBe(firstRead.toString());
    expect(second.pendingShares).toBe(secondRead.toString());
    expect(BigInt(second.pendingShares)).toBeGreaterThan(BigInt(first.pendingShares));
  });
});

describe("claim panel projection", () => {
  it("surfaces claim amounts and flags on resolved lanes", async () => {
    const user = fixtureUser();
    const tokenId = asTokenId(1n);
    const vaultId = asVaultId("vault_01");

    const nft = fixtureNft(user, {
      lanes: [
        {
          tokenId,
          vaultId,
          side: "yes",
          rate: 0n,
          gPaid: 0n,
          sharesAccrued: 34_000_000n,
          depleted: false,
          claimable: 50_000_000n,
          lossClaimable: 0n,
          won: true
        },
        {
          tokenId,
          vaultId,
          side: "no",
          rate: 0n,
          gPaid: 0n,
          sharesAccrued: 6_000_000n,
          depleted: false,
          claimable: 0n,
          lossClaimable: 12_000_000n,
          won: false
        }
      ],
      laneCount: 2
    });

    const transport = createFakeOptionsReadTransport({
      ...fixtureSeed(user),
      vaults: [fixtureResolvedVault()],
      nfts: [nft],
      winningSide: { vault_01: "yes" },
      pot: { vault_01: 597_000_000n },
      collected: { vault_01: true }
    });

    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);
    const yesLane = panel.nfts[0]?.lanes[0];
    const noLane = panel.nfts[0]?.lanes[1];

    expect(yesLane?.claimableUSDC).toBe("50000000");
    expect(yesLane?.canClaimWin).toBe(true);
    expect(yesLane?.won).toBe(true);
    expect(yesLane?.canClaimLoss).toBe(false);

    expect(noLane?.lossClaimableLVST).toBe("12000000");
    expect(noLane?.canClaimLoss).toBe(true);
    expect(noLane?.won).toBe(false);
    expect(noLane?.canClaimWin).toBe(false);
  });
});
