import { describe, expect, it } from "vitest";

import { asMarketId, asTokenId, asUserAddress, asVaultId } from "../src/model/ids.js";
import { mapStreamsStateBalance } from "../src/chains/evm/decode.js";
import { readClaimsView } from "../src/flows/claims.js";
import { readSessionPnl } from "../src/flows/pnl.js";
import { projectOptionsPanel } from "../src/bridge/panel/project.js";
import { readUserOptionsSnapshot } from "../src/flows/snapshot.js";
import { createOptionsRuntime } from "../src/runtime/index.js";
import {
  createFakeChainConfig,
  createFakeChainWriter,
  createFakeOptionsReader,
  fixtureLvstAccount,
  fixtureMarket,
  fixtureNft,
  fixtureResolvedVault,
  fixtureUser,
  fixtureVault
} from "./helpers/fake-chain.js";

const user = fixtureUser();
const tokenOne = asTokenId(1n);
const tokenTwo = asTokenId(2n);
const vaultWin = asVaultId("vault_win");
const vaultLoss = asVaultId("vault_loss");

describe("session PnL", () => {
  const transport = createFakeOptionsReader({
    markets: [fixtureMarket()],
    vaults: [
      fixtureResolvedVault({ vaultId: vaultWin, marketId: asMarketId("market_01") }),
      fixtureResolvedVault({
        vaultId: vaultLoss,
        marketId: asMarketId("market_01"),
        outcome: "no"
      })
    ],
    nfts: [
      fixtureNft(user, {
        tokenId: tokenOne,
        laneCount: 1,
        lanes: [
          {
            tokenId: tokenOne,
            vaultId: vaultWin,
            side: "yes",
            rate: 0n,
            committedRate: 0n,
            gPaid: 0n,
            sharesAccrued: 1n,
            depleted: false,
            claimable: 40_000_000n,
            lossClaimable: 0n,
            won: true
          }
        ]
      }),
      fixtureNft(user, {
        tokenId: tokenTwo,
        laneCount: 1,
        lanes: [
          {
            tokenId: tokenTwo,
            vaultId: vaultLoss,
            side: "yes",
            rate: 0n,
            committedRate: 0n,
            gPaid: 0n,
            sharesAccrued: 1n,
            depleted: false,
            claimable: 0n,
            lossClaimable: 15_000_000n,
            won: false
          }
        ]
      })
    ],
    lvstAccounts: [fixtureLvstAccount(user)],
    winningSide: { vault_win: "yes", vault_loss: "no" },
    accountVaultIds: {
      "1": [vaultWin],
      "2": [vaultLoss]
    },
    nftBalances: {
      "1": 25_000_000n,
      "2": 10_000_000n
    }
  });

  it("sums returned, loss basis, and remaining across NFTs", async () => {
    const pnl = await readSessionPnl(transport, user);

    expect(pnl.returnedUSDC).toBe("40000000");
    expect(pnl.lossBasisUSDC).toBe("15000000");
    expect(pnl.remainingUSDC).toBe("35000000");
    expect(pnl.netPnlUSDC).toBeUndefined();
    expect(pnl.investedUSDC).toBeUndefined();
  });

  it("computes netPnlUSDC only when investedUSDC is supplied", async () => {
    const pnl = await readSessionPnl(transport, user, 50_000_000n);

    expect(pnl.investedUSDC).toBe("50000000");
    expect(pnl.netPnlUSDC).toBe("25000000");
  });
});

describe("claims view", () => {
  it("enumerates active vaults across multiple NFTs", async () => {
    const transport = createFakeOptionsReader({
      markets: [fixtureMarket()],
      vaults: [
        fixtureResolvedVault({ vaultId: vaultWin }),
        fixtureVault({ vaultId: vaultLoss, status: "open" })
      ],
      nfts: [
        fixtureNft(user, {
          tokenId: tokenOne,
          laneCount: 1,
          lanes: [
            {
              tokenId: tokenOne,
              vaultId: vaultWin,
              side: "yes",
              rate: 0n,
              committedRate: 0n,
              gPaid: 0n,
              sharesAccrued: 1n,
              depleted: false,
              claimable: 5_000_000n,
              lossClaimable: 0n,
              won: true
            }
          ]
        }),
        fixtureNft(user, {
          tokenId: tokenTwo,
          laneCount: 1,
          lanes: [
            {
              tokenId: tokenTwo,
              vaultId: vaultLoss,
              side: "no",
              rate: 100n,
              committedRate: 100n,
              gPaid: 0n,
              sharesAccrued: 1n,
              depleted: false
            }
          ]
        })
      ],
      lvstAccounts: [fixtureLvstAccount(user)],
      winningSide: { vault_win: "yes" },
      accountVaultIds: {
        "1": [vaultWin],
        "2": [vaultLoss]
      }
    });

    const claims = await readClaimsView(transport, user);

    expect(claims.claims).toHaveLength(2);
    expect(claims.claims.some((entry) => entry.tokenId === tokenOne && entry.canClaimWin)).toBe(true);
    expect(claims.claims.some((entry) => entry.tokenId === tokenTwo && entry.status === "open")).toBe(
      true
    );
  });
});

describe("nft drips balance", () => {
  it("maps streamsState balance field as remainingUSDC", () => {
    const balance = mapStreamsStateBalance({
      streamsHash:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      streamsHistoryHash:
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      updateTime: 1,
      balance: 42_000_000n,
      maxEnd: 0
    });

    expect(balance).toBe(42_000_000n);
  });
});

describe("runtime memory API", () => {
  it("set/get round-trips and onChange fires on set and refresh", async () => {
    const transport = createFakeOptionsReader({
      markets: [fixtureMarket()],
      vaults: [fixtureVault()],
      shareTotals: { vault_01: { yes: 1n, no: 1n } },
      nfts: [fixtureNft(user)],
      lvstAccounts: [fixtureLvstAccount(user)]
    });

    const runtime = createOptionsRuntime({
      config: {
        runtimeId: "runtime_r3",
        user,
        marketIds: [asMarketId("market_01")],
        defaultMarketId: asMarketId("market_01")
      },
      chainConfig: createFakeChainConfig(),
      chain: { reader: transport, writer: createFakeChainWriter() }
    });

    const revisions: number[] = [];
    const unsubscribe = runtime.onChange((state) => {
      revisions.push(state.revision);
    });

    runtime.set("depositTotal", 99n);
    expect(runtime.get<bigint>("depositTotal")).toBe(99n);

    await runtime.refreshUser(user, asMarketId("market_01"));

    unsubscribe();
    const count = revisions.length;
    runtime.set("afterUnsub", true);
    expect(revisions.length).toBe(count);
  });
});

describe("panel flags and market total", () => {
  it("projects LVST stake flags, NFT transfer fields, and market total pool", async () => {
    const operator = asUserAddress("0xoperator");
    const transport = createFakeOptionsReader({
      markets: [
        fixtureMarket({
          vaultIds: [asVaultId("vault_01"), asVaultId("vault_02")]
        })
      ],
      vaults: [
        fixtureVault({ vaultId: asVaultId("vault_01"), pools: { yes: 100n, no: 200n } }),
        fixtureVault({ vaultId: asVaultId("vault_02"), pools: { yes: 300n, no: 400n } })
      ],
      nfts: [
        fixtureNft(user, {
          approved: operator,
          isOperator: true
        })
      ],
      lvstAccounts: [fixtureLvstAccount(user)],
      shareTotals: {
        vault_01: { yes: 1n, no: 1n },
        vault_02: { yes: 1n, no: 1n }
      }
    });

    const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
    const panel = projectOptionsPanel(snapshot);

    expect(panel.lvst.actions.canStake).toBe(true);
    expect(panel.lvst.actions.canUnstake).toBe(true);
    expect(panel.lvst.actions.canClaimDividends).toBe(true);
    expect(panel.nfts[0]?.owner).toBe(user);
    expect(panel.nfts[0]?.transfer.approved).toBe(operator);
    expect(panel.nfts[0]?.transfer.isOperator).toBe(true);
    expect(panel.markets[0]?.totals.totalPooledUSDC).toBe(0.001);
  });
});
