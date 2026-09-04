import { LiveStreakCapabilityError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import type { CapabilityGrant, CapabilityScope } from "../src/bridge/scope.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
  createOptionsBridge
} from "../src/bridge/index.js";
import { asMarketId, asTokenId, asVaultId } from "../src/model/ids.js";
import { createOptionsRuntime } from "../src/runtime/index.js";
import {
  createFakeChainConfig,
  createFakeChainWriter,
  createFakeOptionsReader,
  fixtureLvstAccount,
  fixtureMarket,
  fixtureNft,
  fixtureResolvedVault,
  fixtureSeed,
  fixtureShareTotals,
  fixtureUser,
  fixtureVault
} from "./helpers/fake-chain.js";

const trustedCaller = { id: "trusted-local", trusted: true as const };

const grantedCaller = {
  id: "granted-user",
  grants: [
    createCapabilityGrant({
      id: "grant-1",
      holder: "granted-user",
      scopes: [
        bridgeBoardReadScope,
        bridgeControlsReadScope,
        bridgeBoardSubscribeScope,
        bridgeActionScope
      ]
    })
  ]
};

const deniedCaller = { id: "denied-user", grants: [] };

const runtime = () =>
  createOptionsRuntime({
    config: {
      runtimeId: "bridge_runtime",
      user: fixtureUser(),
      marketIds: [asMarketId("market_01")],
      defaultMarketId: asMarketId("market_01")
    },
    chainConfig: createFakeChainConfig(fixtureSeed()),
    chain: { reader: createFakeOptionsReader(fixtureSeed()), writer: createFakeChainWriter() }
  });

describe("options bridge", () => {
  it("readBoard requires authorization", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));

    await expect(bridge.readBoard(deniedCaller)).rejects.toBeInstanceOf(LiveStreakCapabilityError);

    const board = await bridge.readBoard(trustedCaller);
    expect(board.panel.account).toBe(fixtureUser());
    expect(board.revision).toBeGreaterThan(0);
  });

  it("readControls projects action flags", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));

    const controls = await bridge.readControls(grantedCaller);
    expect(controls.account).toBe(fixtureUser());
    expect(controls.actions.canFund).toBe(true);
  });

  it("callAction dispatches writer operations and returns TxId", async () => {
    const writer = createFakeChainWriter();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_write",
        user: fixtureUser(),
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: { reader: createFakeOptionsReader(fixtureSeed()), writer }
    });
    const bridge = createOptionsBridge({ runtime: rt });

    const txId = await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "claimDividends",
      args: {}
    });

    expect(txId).toBeTruthy();
    expect(writer.requests[0]?.action).toBe("claimDividends");
  });

  it("subscribeBoard notifies on refresh", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    const boards: number[] = [];

    const unsubscribe = bridge.subscribeBoard(grantedCaller, (board) => {
      boards.push(board.revision);
    });

    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));
    unsubscribe();

    expect(boards.length).toBeGreaterThan(0);
  });

  it("watch forwards memory updates", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    const seen: unknown[] = [];

    const unsubscribe = bridge.watch(grantedCaller, "session:key", (value) => {
      seen.push(value);
    });

    rt.set("session:key", { ok: true });
    unsubscribe();

    expect(seen).toEqual([{ ok: true }]);
  });

  it("readClaims requires authorization and returns the claims view", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });

    await expect(bridge.readClaims(deniedCaller)).rejects.toBeInstanceOf(
      LiveStreakCapabilityError
    );

    const claims = await bridge.readClaims(trustedCaller);
    expect(claims.account).toBe(fixtureUser());
    expect(Array.isArray(claims.claims)).toBe(true);
  });

  it("readPnl requires authorization and threads investedUSDC", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });

    await expect(bridge.readPnl(deniedCaller)).rejects.toBeInstanceOf(
      LiveStreakCapabilityError
    );

    const pnl = await bridge.readPnl(trustedCaller, 100_000_000n);
    expect(pnl.investedUSDC).toBe("100000000");
    expect(pnl.netPnlUSDC).toBeDefined();
  });

  it("readStreamState requires authorization and delegates to the reader", async () => {
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_stream",
        user: fixtureUser(),
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          ...fixtureSeed(),
          streamStates: {
            market_01: {
              status: "ended",
              scheme: "walrus-testnet",
              id: "blob_01",
              updatedAtMs: 1_700_000_000_000,
              endedAtMs: 1_700_001_000_000
            }
          }
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });

    await expect(
      bridge.readStreamState(deniedCaller, asMarketId("market_01"))
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);

    const state = await bridge.readStreamState(trustedCaller, asMarketId("market_01"));
    expect(state.status).toBe("ended");
    expect(state.id).toBe("blob_01");
  });

  it("readControls flags withdrawable winnings on a resolved winning lane", async () => {
    const user = fixtureUser();
    const tokenId = asTokenId(1n);
    const vaultId = asVaultId("vault_01");
    const resolvedNft = fixtureNft(user, {
      laneCount: 2,
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
      ]
    });

    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_controls",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          markets: [fixtureMarket()],
          vaults: [fixtureResolvedVault()],
          shareTotals: { vault_01: fixtureShareTotals() },
          nfts: [resolvedNft],
          lvstAccounts: [fixtureLvstAccount(user)],
          winningSide: { vault_01: "yes" },
          pot: { vault_01: 597_000_000n },
          collected: { vault_01: true }
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const controls = await bridge.readControls(trustedCaller);
    expect(controls.actions.canWithdraw).toBe(true);
    expect(controls.actions.canClaimLoss).toBe(true);
    expect(controls.actions.canTransferNft).toBe(true);
    expect(controls.actions.canMint).toBe(false);
  });

  it("callAction dispatches mint to the writer", async () => {
    const writer = createFakeChainWriter();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_mint",
        user: fixtureUser(),
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: { reader: createFakeOptionsReader(fixtureSeed()), writer }
    });
    const bridge = createOptionsBridge({ runtime: rt });

    const txId = await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "mint",
      args: { marketId: asMarketId("market_01"), to: fixtureUser() }
    });

    expect(txId).toBeTruthy();
    expect(writer.requests[0]?.action).toBe("mint");
  });

  it("readControls flags canMint for a market the user has not entered", async () => {
    const user = fixtureUser();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_canmint",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          markets: [fixtureMarket()],
          vaults: [fixtureVault()],
          shareTotals: { vault_01: fixtureShareTotals() },
          lvstAccounts: [fixtureLvstAccount(user)]
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const controls = await bridge.readControls(trustedCaller);
    expect(controls.actions.canMint).toBe(true);
    expect(controls.actions.canFund).toBe(false);
  });

  it("readBoard surfaces the connected wallet USDC balance", async () => {
    const user = fixtureUser();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_usdc",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          ...fixtureSeed(),
          usdcBalances: { [user]: 250_000_000n }
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const board = await bridge.readBoard(trustedCaller);
    expect(board.panel.user.usdcBalanceUSDC).toBe("250000000");
  });

  it("readBoard surfaces steward severity on a hot vault", async () => {
    const user = fixtureUser();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_severity",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          markets: [fixtureMarket()],
          vaults: [fixtureVault({ status: "hot", steward: { hot: true, severity: 2 } })],
          shareTotals: { vault_01: fixtureShareTotals() },
          nfts: [fixtureNft(user)],
          lvstAccounts: [fixtureLvstAccount(user)]
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const board = await bridge.readBoard(trustedCaller);
    const vaultPanel = board.panel.markets[0]?.vaults[0];
    expect(vaultPanel?.steward.severity).toBe(2);
  });
});

function createCapabilityGrant(input: {
  id: string;
  holder: string;
  scopes: readonly CapabilityScope[];
}): CapabilityGrant {
  return {
    id: input.id,
    sessionId: input.id,
    holder: input.holder,
    scopes: input.scopes,
    revoked: false
  };
}
