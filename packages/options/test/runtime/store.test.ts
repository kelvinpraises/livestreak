import { describe, expect, it } from "vitest";

import type { OptionsMarketSnapshot, OptionsVaultSnapshot } from "../../src/model/snapshot.js";
import { createOptionsRuntimeStore } from "../../src/runtime/store.js";
import { fixtureMarket, fixtureVault } from "../helpers/fake-chain.js";

// setMarketSnapshot must MERGE into an existing rich vault snapshot (a market-level read carries only
// the vault entity), never clobber the accrual state a full vault read stored — clobbering collapsed
// g/sideRate/percentOfSide to zero on the live board until the next user refresh.
describe("OptionsRuntimeStore setMarketSnapshot merge", () => {
  const richSnapshot = (vault = fixtureVault()): OptionsVaultSnapshot => ({
    vault,
    pools: vault.pools,
    shareTotals: { yes: 34_000_000n, no: 6_000_000n },
    boards: {
      yes: { pool: vault.pools.yes, sideRate: 12n, g: 500n, lastAdvanceMs: 1_730_000_100_000 },
      no: { pool: vault.pools.no, sideRate: 7n, g: 250n, lastAdvanceMs: 1_730_000_100_000 }
    },
    pendingBoundaries: { yes: 3n, no: 4n },
    boundaries: {
      yes: [{ maxEndMs: 1_730_000_900_000, rate: 12n }],
      no: [{ maxEndMs: 1_730_000_800_000, rate: 7n }]
    },
    hot: vault.steward,
    dispute: { active: false, disputeId: undefined },
    winningSide: "yes",
    pot: 9_000_000n,
    collected: false
  });

  const marketSnapshotWith = (
    vault: ReturnType<typeof fixtureVault>
  ): OptionsMarketSnapshot => ({
    market: fixtureMarket(),
    vaults: [vault]
  });

  it("preserves boards/shareTotals/boundaries and updates the vault entity fields", () => {
    const store = createOptionsRuntimeStore("store-merge");
    const rich = richSnapshot();
    store.setVaultSnapshot(rich);

    // The market-level refresh sees the same vault with FRESH entity state (newer pools + resolved).
    const refreshed = fixtureVault({
      status: "resolved",
      outcome: "yes",
      pools: { yes: 120_000_000n, no: 200_000_000n },
      steward: { hot: true, disputeId: "dispute-1" }
    });
    store.setMarketSnapshot(marketSnapshotWith(refreshed));

    const stored = store.readState().vaults.find((v) => v.vault.vaultId === rich.vault.vaultId)!;

    // Market-level fields the read genuinely carries are updated.
    expect(stored.vault.status).toBe("resolved");
    expect(stored.vault.outcome).toBe("yes");
    expect(stored.pools).toEqual({ yes: 120_000_000n, no: 200_000_000n });
    expect(stored.hot).toEqual({ hot: true, disputeId: "dispute-1" });
    expect(stored.dispute).toEqual({ active: true, disputeId: "dispute-1" });

    // The richer accrual state from the full vault read is PRESERVED verbatim.
    expect(stored.shareTotals).toEqual(rich.shareTotals);
    expect(stored.boards).toEqual(rich.boards);
    expect(stored.pendingBoundaries).toEqual(rich.pendingBoundaries);
    expect(stored.boundaries).toEqual(rich.boundaries);
    expect(stored.winningSide).toBe("yes");
    expect(stored.pot).toBe(9_000_000n);
    expect(stored.collected).toBe(false);
  });

  it("synthesizes zeroed defaults for a vault never seen before (unchanged behavior)", () => {
    const store = createOptionsRuntimeStore("store-fresh");
    const vault = fixtureVault();
    store.setMarketSnapshot(marketSnapshotWith(vault));

    const stored = store.readState().vaults.find((v) => v.vault.vaultId === vault.vaultId)!;

    expect(stored.shareTotals).toEqual({ yes: 0n, no: 0n });
    expect(stored.boards.yes).toEqual({
      pool: vault.pools.yes,
      sideRate: 0n,
      g: 0n,
      lastAdvanceMs: vault.timing.createdAtMs
    });
    expect(stored.pendingBoundaries).toEqual({ yes: 0n, no: 0n });
    expect(stored.boundaries).toEqual({ yes: [], no: [] });
    expect(stored.winningSide).toBeUndefined();
  });

  it("a full vault read after a market read replaces the entry wholesale (rich wins)", () => {
    const store = createOptionsRuntimeStore("store-order");
    const vault = fixtureVault();
    store.setMarketSnapshot(marketSnapshotWith(vault));

    const rich = richSnapshot(vault);
    store.setVaultSnapshot(rich);

    const stored = store.readState().vaults.find((v) => v.vault.vaultId === vault.vaultId)!;
    expect(stored.boards).toEqual(rich.boards);
    expect(stored.shareTotals).toEqual(rich.shareTotals);
    expect(stored.boundaries).toEqual(rich.boundaries);
  });
});
