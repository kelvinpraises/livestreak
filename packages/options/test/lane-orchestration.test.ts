import { describe, expect, it } from "vitest";

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
