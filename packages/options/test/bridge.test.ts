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
import type { OptionsControlsView, OptionsFunctionView } from "../src/bridge/panel/types.js";
import { asMarketId, asTokenId, asVaultId } from "../src/model/ids.js";
import { priceOf, usdcToNumber } from "../src/model/index.js";
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

  it("readControls returns a self-describing function registry", async () => {
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(fixtureUser(), asMarketId("market_01"));

    const controls = await bridge.readControls(grantedCaller);
    expect(controls.account).toBe(fixtureUser());
    expect(controls.revision).toBeGreaterThan(0);
    expect(controls.functions.length).toBeGreaterThan(0);

    for (const fn of controls.functions) {
      expect(fn.name).toBeTypeOf("string");
      expect(fn.scope).toBeTypeOf("string");
      expect(fn.label).toBeTypeOf("string");
      if (fn.disabled) {
        expect(fn.disabledReason).toBeTypeOf("string");
        expect(fn.disabledReason?.length).toBeGreaterThan(0);
      }
    }
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

  it("readControls exposes withdraw on a resolved winning vault and not on open vaults", async () => {
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
          committedRate: 0n,
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
          committedRate: 0n,
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
    const withdraw = findFunction(controls, "withdraw", { vaultId: "vault_01" });
    expect(withdraw?.disabled).toBe(false);
    expect(withdraw?.target?.vaultId).toBe("vault_01");

    const claimLoss = findFunction(controls, "claimLossLvst", { vaultId: "vault_01" });
    expect(claimLoss?.disabled).toBe(false);

    const mint = findFunction(controls, "mint", { marketId: "market_01" });
    expect(mint?.disabled).toBe(true);
    expect(mint?.disabledReason).toBe("Already entered this market");
  });

  it("callAction dispatches mint (enter market) and returns the full MintResult", async () => {
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

    const result = await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "mint",
      args: { marketId: asMarketId("market_01"), to: fixtureUser() }
    });

    // The console's "Enter market" feedback rides on this: the tokenId must come back, not just a txId.
    expect(result).toEqual({ txId: "0xfake_user_op_hash", tokenId: asTokenId(1n) });
    expect(writer.requests[0]?.action).toBe("mint");

    const withSalt = await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "mintWithSalt",
      args: { marketId: asMarketId("market_01"), salt: 7n, to: fixtureUser() }
    });
    expect(withSalt).toEqual({ txId: "0xfake_user_op_hash", tokenId: asTokenId(1n) });
    expect(writer.requests[1]?.action).toBe("mintWithSalt");
  });

  it("readControls enables fund on an unfunded open vault when the user holds the NFT", async () => {
    const user = fixtureUser();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_fund_unfunded",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          markets: [fixtureMarket()],
          vaults: [fixtureVault()],
          shareTotals: { vault_01: fixtureShareTotals() },
          nfts: [
            fixtureNft(user, {
              laneCount: 0,
              lanes: []
            })
          ],
          lvstAccounts: [fixtureLvstAccount(user)]
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const controls = await bridge.readControls(trustedCaller);
    const fundYes = findFunction(controls, "fund", { vaultId: "vault_01", side: "yes" });
    const fundNo = findFunction(controls, "fund", { vaultId: "vault_01", side: "no" });

    expect(fundYes?.disabled).toBe(false);
    expect(fundNo?.disabled).toBe(false);
  });

  it("readControls disables fund when the vault already holds a lane", async () => {
    const user = fixtureUser();
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const controls = await bridge.readControls(trustedCaller);
    const fundYes = findFunction(controls, "fund", { vaultId: "vault_01", side: "yes" });
    const fundNo = findFunction(controls, "fund", { vaultId: "vault_01", side: "no" });

    expect(fundYes?.disabled).toBe(true);
    expect(fundNo?.disabled).toBe(true);
    expect(fundYes?.disabledReason).toBe(
      "Vault already funded (one side per vault) — stop or adjust lanes to change"
    );
    expect(fundNo?.disabledReason).toBe(
      "Vault already funded (one side per vault) — stop or adjust lanes to change"
    );
  });

  it("readControls carries the active lane side on stopFunding", async () => {
    const user = fixtureUser();
    const rt = runtime();
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const controls = await bridge.readControls(trustedCaller);
    const stopFunding = findFunction(controls, "stopFunding", { vaultId: "vault_01" });

    expect(stopFunding?.disabled).toBe(false);
    expect(stopFunding?.target?.side).toBe("yes");
  });

  it("readControls enables mint before market entry and disables withdraw on open vaults", async () => {
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
          lvstAccounts: [
            {
              ...fixtureLvstAccount(user),
              pendingDividends: 0n
            }
          ]
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const controls = await bridge.readControls(trustedCaller);
    const mint = findFunction(controls, "mint", { marketId: "market_01" });
    expect(mint?.disabled).toBe(false);

    const withdraw = findFunction(controls, "withdraw", { vaultId: "vault_01" });
    expect(withdraw?.disabled).toBe(true);
    expect(withdraw?.disabledReason).toBe("No winnings to claim");

    const claimDividends = findFunction(controls, "claimDividends");
    expect(claimDividends?.disabled).toBe(true);
    expect(claimDividends?.disabledReason).toBe("No dividends pending");
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
    expect(board.panel.user.usdcBalanceUSDC).toBe(250);
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

  it("readBoard exposes per-side marginal share prices from pool projection", async () => {
    const user = fixtureUser();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_share_price",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader(fixtureSeed()),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const board = await bridge.readBoard(trustedCaller);
    const pools = board.panel.markets[0]?.vaults[0]?.pools;

    expect(pools?.sharePriceYes).toBe(usdcToNumber(priceOf(94_000_000n)));
    expect(pools?.sharePriceNo).toBe(usdcToNumber(priceOf(185_000_000n)));
  });

  it("previewAccrual projects hypothetical stream accrual", async () => {
    const user = fixtureUser();
    const vaultId = asVaultId("vault_01");
    const nowMs = Date.now();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_preview_accrual",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          ...fixtureSeed(),
          boards: {
            "vault_01:yes": {
              pool: 20_000_000n,
              sideRate: 1_000_000n,
              g: 5_000_000_000_000_000_000n,
              lastAdvanceMs: nowMs - 5_000
            }
          }
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });
    await rt.refreshUser(user, asMarketId("market_01"));

    const preview = await bridge.previewAccrual(grantedCaller, {
      vaultId,
      side: "yes",
      rate: 1_000_000_000_000_000_000n,
      horizonSec: 60
    });

    expect(preview.projectedShares).toBeGreaterThan(0);
    expect(preview.valueUSDC).toBeGreaterThan(0);
    expect(preview.sharesPerSec).toBeGreaterThan(0);
    expect(preview.sharePriceUSDC).toBe(usdcToNumber(priceOf(20_000_000n)));
  });

  it("previewAccrual returns zero accrual when rate is zero", async () => {
    const user = fixtureUser();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_preview_zero_rate",
        user,
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: createFakeChainConfig(fixtureSeed()),
      chain: {
        reader: createFakeOptionsReader({
          ...fixtureSeed(),
          boards: {
            "vault_01:yes": {
              pool: 20_000_000n,
              sideRate: 1_000_000n,
              g: 5_000_000_000_000_000_000n,
              lastAdvanceMs: 1_700_000_000_000
            }
          }
        }),
        writer: createFakeChainWriter()
      }
    });
    const bridge = createOptionsBridge({ runtime: rt });

    const preview = await bridge.previewAccrual(grantedCaller, {
      vaultId: asVaultId("vault_01"),
      side: "yes",
      rate: 0n
    });

    expect(preview.projectedShares).toBe(0);
    expect(preview.valueUSDC).toBe(0);
    expect(preview.sharesPerSec).toBe(0);
  });

  it("previewAccrual requires board read scope", async () => {
    const bridge = createOptionsBridge({ runtime: runtime() });

    await expect(
      bridge.previewAccrual(deniedCaller, {
        vaultId: asVaultId("vault_01"),
        side: "yes",
        rate: 1n
      })
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);
  });
});

describe("autoAdvanceOverflow fund path", () => {
  const fundArgs = {
    tokenId: asTokenId(1n),
    vaultId: asVaultId("vault_01"),
    side: "yes" as const,
    rate: 10_000n,
    deposit: 1_000_000n
  };

  const overflowRuntime = (input: {
    readonly autoAdvance?: boolean;
    readonly pending?: bigint;
  }) => {
    const writer = createFakeChainWriter();
    const rt = createOptionsRuntime({
      config: {
        runtimeId: "bridge_overflow",
        user: fixtureUser(),
        marketIds: [asMarketId("market_01")]
      },
      chainConfig: {
        ...createFakeChainConfig(fixtureSeed()),
        ...(input.autoAdvance === true ? { autoAdvanceOverflow: true } : {})
      },
      chain: {
        reader: createFakeOptionsReader({
          ...fixtureSeed(),
          pendingBoundaries:
            input.pending === undefined
              ? {}
              : { "vault_01:yes": input.pending }
        }),
        writer
      }
    });

    return { rt, writer, bridge: createOptionsBridge({ runtime: rt }) };
  };

  it("issues one fund and zero advances when the flag is off", async () => {
    const { bridge, writer } = overflowRuntime({ pending: 200n });

    await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "fund",
      args: fundArgs
    });

    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]?.action).toBe("fund");
  });

  it("issues one fund and zero advances when pending is within one fund tx", async () => {
    const { bridge, writer } = overflowRuntime({ autoAdvance: true, pending: 64n });

    await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "fund",
      args: fundArgs
    });

    expect(writer.requests).toHaveLength(1);
    expect(writer.requests[0]?.action).toBe("fund");
  });

  it("advances pre-fund rounds when pending exceeds one fund tx", async () => {
    const { bridge, writer } = overflowRuntime({ autoAdvance: true, pending: 200n });

    await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "fund",
      args: fundArgs
    });

    expect(writer.requests).toHaveLength(4);
    expect(writer.requests.slice(0, 3).every((request) => request.action === "advance")).toBe(true);
    expect(writer.requests[3]?.action).toBe("fund");
  });

  it("caps pre-fund advances at MAX_PRE", async () => {
    const { bridge, writer } = overflowRuntime({ autoAdvance: true, pending: 10_000n });

    await bridge.callAction(grantedCaller, {
      scope: bridgeActionScope,
      action: "fund",
      args: fundArgs
    });

    expect(writer.requests).toHaveLength(65);
    expect(writer.requests.slice(0, 64).every((request) => request.action === "advance")).toBe(true);
    expect(writer.requests[64]?.action).toBe("fund");
  });
});

function findFunction(
  controls: OptionsControlsView,
  name: string,
  target?: { readonly vaultId?: string; readonly marketId?: string; readonly side?: string }
): OptionsFunctionView | undefined {
  return controls.functions.find((fn) => {
    if (fn.name !== name) {
      return false;
    }

    if (target === undefined) {
      return true;
    }

    if (target.vaultId !== undefined && fn.target?.vaultId !== target.vaultId) {
      return false;
    }

    if (target.marketId !== undefined && fn.target?.marketId !== target.marketId) {
      return false;
    }

    if (target.side !== undefined && fn.target?.side !== target.side) {
      return false;
    }

    return true;
  });
}

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
