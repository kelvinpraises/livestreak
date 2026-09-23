import { describe, expect, it } from "vitest";

import { LiveStreakConfigError } from "@livestreak/core";

import { asMarketId, asTokenId, asVaultId } from "../src/model/ids.js";
import type { LaneWriteInput } from "../src/chains/types.js";
import { createOptionsRuntime } from "../src/runtime/index.js";
import {
  createFakeChainConfig,
  createFakeChainWriter,
  createFakeOptionsReader,
  fixtureLvstAccount,
  fixtureMarket,
  fixtureNft,
  fixtureUser,
  fixtureVault
} from "./helpers/fake-chain.js";

const user = fixtureUser();
const tokenId = asTokenId(1n);
const vaultActive = asVaultId("vault_01");
const vaultDepleted = asVaultId("vault_02");

// An NFT with one streaming lane and one depleted lane (effective rate 0, committedRate retained).
const twoLaneReader = () =>
  createFakeOptionsReader({
    markets: [fixtureMarket({ vaultIds: [vaultActive, vaultDepleted] })],
    vaults: [fixtureVault({ vaultId: vaultActive }), fixtureVault({ vaultId: vaultDepleted })],
    nfts: [
      fixtureNft(user, {
        laneCount: 2,
        lanes: [
          {
            tokenId,
            vaultId: vaultActive,
            side: "yes",
            rate: 800_000n,
            committedRate: 800_000n,
            gPaid: 0n,
            sharesAccrued: 0n,
            depleted: false
          },
          {
            tokenId,
            vaultId: vaultDepleted,
            side: "no",
            rate: 0n, // effective: depleted
            committedRate: 500_000n, // on-chain bookkeeping rate, retained
            gPaid: 0n,
            sharesAccrued: 0n,
            depleted: true
          }
        ]
      })
    ],
    lvstAccounts: [fixtureLvstAccount(user)],
    shareTotals: { vault_01: { yes: 1n, no: 1n }, vault_02: { yes: 1n, no: 1n } }
  });

const bootRuntime = async (writer = createFakeChainWriter()) => {
  const runtime = createOptionsRuntime({
    config: {
      runtimeId: "lane_orchestration",
      user,
      marketIds: [asMarketId("market_01")],
      defaultMarketId: asMarketId("market_01")
    },
    chainConfig: createFakeChainConfig(),
    chain: { reader: twoLaneReader(), writer }
  });
  await runtime.refreshUser(user, asMarketId("market_01"));
  return { runtime, writer };
};

const setLanesArgs = (writer: ReturnType<typeof createFakeChainWriter>): readonly LaneWriteInput[] => {
  const req = writer.requests.find((r) => r.action === "setLanes");
  expect(req).toBeDefined();
  return (req!.args as { lanes: readonly LaneWriteInput[] }).lanes;
};

describe("lane orchestration preserves depleted siblings (bug: depleted lanes wiped on any setLanes)", () => {
  it("pausing an active lane keeps the depleted lane in the desired set", async () => {
    const { runtime, writer } = await bootRuntime();
    await runtime.pauseLane({ vaultId: vaultActive, side: "yes" });

    const lanes = setLanesArgs(writer);
    // The paused lane is dropped; the depleted sibling survives at its committed rate (was wiped before).
    expect(lanes.some((l) => l.vaultId === vaultActive)).toBe(false);
    expect(lanes.some((l) => l.vaultId === vaultDepleted && l.rate === 500_000n)).toBe(true);
  });

  it("re-rating the active lane keeps the depleted lane in the desired set", async () => {
    const { runtime, writer } = await bootRuntime();
    await runtime.streamLane({ vaultId: vaultActive, side: "yes", ratePerMin: 5 });

    const lanes = setLanesArgs(writer);
    expect(lanes.some((l) => l.vaultId === vaultActive)).toBe(true);
    expect(lanes.some((l) => l.vaultId === vaultDepleted && l.rate === 500_000n)).toBe(true);
  });
});

describe("multi-vault funding survives a stale snapshot (bug: the 2nd vault wiped the 1st, capping the NFT at 1)", () => {
  const vaultA = asVaultId("vault_01");
  const vaultB = asVaultId("vault_02");

  // A fresh-mint NFT that NEVER shows a just-funded lane — exactly the Solana read-after-write window
  // where the polled snapshot lags the write. `setLanes` is full-replacement, so without the runtime's
  // own-write overlay the second fund would rebuild `desired` from these zero lanes and wipe the first.
  const laggingMintReader = () =>
    createFakeOptionsReader({
      markets: [fixtureMarket({ vaultIds: [vaultA, vaultB] })],
      vaults: [fixtureVault({ vaultId: vaultA }), fixtureVault({ vaultId: vaultB })],
      nfts: [fixtureNft(user, { laneCount: 0, lanes: [] })],
      lvstAccounts: [fixtureLvstAccount(user)],
      shareTotals: { vault_01: { yes: 1n, no: 1n }, vault_02: { yes: 1n, no: 1n } }
    });

  const bootLagging = async () => {
    const writer = createFakeChainWriter();
    const runtime = createOptionsRuntime({
      config: {
        runtimeId: "multi_vault",
        user,
        marketIds: [asMarketId("market_01")],
        defaultMarketId: asMarketId("market_01")
      },
      chainConfig: createFakeChainConfig(),
      chain: { reader: laggingMintReader(), writer }
    });
    await runtime.refreshUser(user, asMarketId("market_01"));
    return { runtime, writer };
  };

  const laneCalls = (writer: ReturnType<typeof createFakeChainWriter>) =>
    writer.requests
      .filter((r) => r.action === "setLanes")
      .map((r) => (r.args as { lanes: readonly LaneWriteInput[] }).lanes);

  it("funding a second vault keeps the first even though the read never caught up", async () => {
    const { runtime, writer } = await bootLagging();

    await runtime.streamLane({ vaultId: vaultA, side: "yes", ratePerMin: 5 });
    // The post-write refresh still returns zero lanes (lagging read) — the overlay must outlive it.
    await runtime.refreshUser(user, asMarketId("market_01"));
    await runtime.streamLane({ vaultId: vaultB, side: "no", ratePerMin: 3 });

    const calls = laneCalls(writer);
    expect(calls).toHaveLength(2);
    // First fund: just A.
    expect(calls[0]!.map((l) => l.vaultId)).toEqual([vaultA]);
    // Second fund: BOTH vaults — A survived despite the snapshot never reflecting it.
    expect(calls[1]!.some((l) => l.vaultId === vaultA)).toBe(true);
    expect(calls[1]!.some((l) => l.vaultId === vaultB)).toBe(true);
    expect(calls[1]).toHaveLength(2);
  });

  it("accumulates up to many vaults on one NFT across successive stale-snapshot funds", async () => {
    const { runtime, writer } = await bootLagging();
    const vaults = [vaultA, vaultB] as const;

    // Fund both vaults back-to-back with the read never reflecting either.
    await runtime.streamLane({ vaultId: vaults[0], side: "yes", ratePerMin: 4 });
    await runtime.streamLane({ vaultId: vaults[1], side: "yes", ratePerMin: 4 });

    const calls = laneCalls(writer);
    expect(calls[calls.length - 1]).toHaveLength(2); // both lanes present on the final write
    expect(new Set(calls[calls.length - 1]!.map((l) => l.vaultId)).size).toBe(2);
  });
});

// addFunds is a RUNTIME verb (not a writer method): re-assert the token's current lanes + the deposit via
// setLanes, using the overlay-aware set so a lagging read can't wipe a sibling. Chain-agnostic — the
// runtime calls writer.setLanes, which every chain implements.
describe("addFunds (runtime top-up) preserves lanes and parks on a laneless mint", () => {
  const setLanesReq = (writer: ReturnType<typeof createFakeChainWriter>) => {
    const req = writer.requests.find((r) => r.action === "setLanes");
    expect(req).toBeDefined();
    return req!.args as { lanes: readonly LaneWriteInput[]; addDeposit: bigint };
  };

  it("re-asserts ALL current lanes with the deposit (never drops the depleted sibling)", async () => {
    const { runtime, writer } = await bootRuntime();
    await runtime.addFunds({ tokenId, deposit: 1_000_000n });

    const { lanes, addDeposit } = setLanesReq(writer);
    expect(addDeposit).toBe(1_000_000n);
    expect(lanes.some((l) => l.vaultId === vaultActive && l.rate === 800_000n)).toBe(true);
    expect(lanes.some((l) => l.vaultId === vaultDepleted && l.rate === 500_000n)).toBe(true);
  });

  it("parks the deposit as budget on a laneless mint (empty lane set)", async () => {
    const writer = createFakeChainWriter();
    const runtime = createOptionsRuntime({
      config: {
        runtimeId: "addfunds_laneless",
        user,
        marketIds: [asMarketId("market_01")],
        defaultMarketId: asMarketId("market_01")
      },
      chainConfig: createFakeChainConfig(),
      chain: {
        reader: createFakeOptionsReader({
          markets: [fixtureMarket({ vaultIds: [vaultActive] })],
          vaults: [fixtureVault({ vaultId: vaultActive })],
          nfts: [fixtureNft(user, { laneCount: 0, lanes: [] })],
          lvstAccounts: [fixtureLvstAccount(user)],
          shareTotals: { vault_01: { yes: 1n, no: 1n } }
        }),
        writer
      }
    });
    await runtime.refreshUser(user, asMarketId("market_01"));
    await runtime.addFunds({ tokenId, deposit: 500_000n });

    const { lanes, addDeposit } = setLanesReq(writer);
    expect(lanes).toHaveLength(0);
    expect(addDeposit).toBe(500_000n);
  });

  it("rejects a non-positive deposit before any write", async () => {
    const { runtime, writer } = await bootRuntime();
    await expect(runtime.addFunds({ tokenId, deposit: 0n })).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    expect(writer.requests.find((r) => r.action === "setLanes")).toBeUndefined();
  });
});
