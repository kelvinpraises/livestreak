import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asMarketId, asTokenId, asUserAddress, asVaultId } from "../../src/model/ids.js";
import { WAD } from "../../src/model/math/curve.js";

import type { OptionsContractAddresses } from "../../src/chains/evm/addresses.js";
import { createEvmOptionsReaderFromCall } from "../../src/chains/evm/reader.js";
import { createFakeChainWriter } from "../helpers/fake-chain.js";

const MARKET_ID = asMarketId(
  "0x0000000000000000000000000000000000000000000000000000000000000001"
);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);
const USER = asUserAddress("0x0000000000000000000000000000000000000001");
const CREATOR = asUserAddress("0x00000000000000000000000000000000000000cc");
const TOKEN_ID = asTokenId(42n);

const ADDRESSES: OptionsContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  vault: "0x0000000000000000000000000000000000000014",
  marketDriver: "0x0000000000000000000000000000000000000015",
  stewardRegistry: "0x0000000000000000000000000000000000000017",
  treasury: "0x0000000000000000000000000000000000000018",
  lvstToken: "0x0000000000000000000000000000000000000016",
  dripsStreaming: "0x0000000000000000000000000000000000000019"
};

describe("options reader", () => {
  it("maps stream state from marketRegistry", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const state = await reader.readStreamState(MARKET_ID);
    expect(state.status).toBe("ended");
    expect(state.scheme).toBe("walrus-testnet");
    expect(state.id).toBe("blob_contract_id");
    expect(state.endedAtMs).toBe(1_700_001_000_000);
  });

  it("maps market read with creator", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const market = await reader.readMarket(MARKET_ID);
    expect(market.title).toBe("Derby stream");
    expect(market.creator).toBe(CREATOR);
    expect(market.vaultIds).toEqual([VAULT_ID]);
    expect(market.status).toBe("open");
  });

  it("maps market vault ids via listMarketVaults", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const vaultIds = await reader.listMarketVaults(MARKET_ID);
    expect(vaultIds).toEqual([VAULT_ID]);
  });

  it("maps vault read with steward state and pools", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const vault = await reader.readVault(VAULT_ID);
    expect(vault.question).toBe("Next goal");
    expect(vault.pools.yes).toBe(1_000_000n);
    expect(vault.pools.no).toBe(500_000n);
    expect(vault.steward.hot).toBe(true);
  });

  it("maps vault share totals via getVaultPools", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const totals = await reader.readVaultShareTotals(VAULT_ID);
    expect(totals.yes).toBe(100n);
    expect(totals.no).toBe(50n);
  });

  it("maps tokensOfOwner for multi-NFT holders", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const tokenIds = await reader.listOwnerTokens(USER);
    expect(tokenIds).toEqual([TOKEN_ID, asTokenId(43n)]);
  });

  it("maps NFT lanes from MarketDriver and Vault getPosition", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const nft = await reader.readNft(TOKEN_ID, USER);
    expect(nft.tokenId).toBe(TOKEN_ID);
    expect(nft.owner).toBe(USER);
    expect(nft.marketId).toBe(MARKET_ID);
    expect(nft.laneCount).toBe(2);
    expect(nft.lanes[0]?.side).toBe("yes");
    expect(nft.lanes[0]?.rate).toBe(1_000n);
    expect(nft.lanes[0]?.sharesAccrued).toBe(100n);
    expect(nft.lanes[1]?.side).toBe("no");
    expect(nft.lanes[1]?.rate).toBe(0n);
  });

  it("maps LVST account from token balance and treasury staking", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake());

    const account = await reader.readLvstAccount(USER);
    expect(account.balance).toBe(50n * 10n ** 18n);
    expect(account.staked).toBe(20n * 10n ** 18n);
    expect(account.pendingDividends).toBe(5_000_000n);
  });

  it("maps protocol summary when enabled", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake(), {
      includeProtocolSummary: true
    });

    const summary = await reader.readProtocolSummary?.();
    expect(summary).toEqual({ marketCount: 1, vaultCount: 1 });
  });

  it("fails typed when market is missing", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake({ marketExists: false }));

    await expect(reader.readMarket(MARKET_ID)).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("fails typed when vault is missing", async () => {
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, contractCallFromFake({ vaultExists: false }));

    await expect(reader.readVault(VAULT_ID)).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("does not share mutable reader state across adapters", async () => {
    const callsA: string[] = [];
    const callsB: string[] = [];

    const readerA = createEvmOptionsReaderFromCall(ADDRESSES, async (address, _abi, functionName, args = []) => {
      callsA.push(`${address}:${functionName}`);
      return respond({ address, functionName, args }, {});
    });
    const readerB = createEvmOptionsReaderFromCall(ADDRESSES, async (address, _abi, functionName, args = []) => {
      callsB.push(`${address}:${functionName}`);
      return respond({ address, functionName, args }, {});
    });

    await readerA.readMarket(MARKET_ID);
    await readerB.readMarket(MARKET_ID);

    expect(callsA.length).toBeGreaterThan(0);
    expect(callsB.length).toBeGreaterThan(0);
    expect(callsA).not.toBe(callsB);
  });

  it("rejects invalid contract addresses at construction", () => {
    expect(() =>
      createEvmOptionsReaderFromCall(
        {
          ...ADDRESSES,
          marketRegistry: "not-an-address" as `0x${string}`
        },
        contractCallFromFake()
      )
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects invalid market, vault, token, and user ids before reader calls", async () => {
    let readerCalls = 0;
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, async () => {
      readerCalls += 1;
      return true;
    });

    await expect(reader.readMarket(asMarketId("market_01"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    await expect(reader.readVault(asVaultId("vault_01"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    await expect(reader.readNft(asTokenId(-1n), USER)).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    await expect(reader.readLvstAccount(asUserAddress("0xbad"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    expect(readerCalls).toBe(0);
  });

  it("accepts valid hex ids and reaches reader", async () => {
    let readerCalls = 0;
    const reader = createEvmOptionsReaderFromCall(ADDRESSES, async (address, _abi, functionName, args = []) => { readerCalls += 1; return respond({ address, functionName, args }, {}); });

    await reader.readMarket(MARKET_ID);
    expect(readerCalls).toBeGreaterThan(0);
  });
});


type FakeReaderOptions = {
  readonly marketExists?: boolean;
  readonly vaultExists?: boolean;
};

type SimRequest = {
  readonly address: `0x${string}`;
  readonly functionName: string;
  readonly args?: readonly unknown[];
};

const contractCallFromFake = (options: FakeReaderOptions = {}) =>
  async (address: `0x${string}`, _abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) =>
    respond({ address, functionName, args }, options);

const respond = (request: SimRequest, options: FakeReaderOptions): unknown => {
  const { address, functionName, args = [] } = request;

  if (address === ADDRESSES.marketRegistry) {
    if (functionName === "marketExists") {
      return options.marketExists ?? true;
    }

    if (functionName === "getMarket") {
      return {
        id: MARKET_ID,
        title: "Derby stream",
        streamId:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        creator: CREATOR,
        createdAt: 1_700_000_000n,
        exists: true
      };
    }

    if (functionName === "getVaultIds") {
      return [VAULT_ID];
    }

    if (functionName === "streamState") {
      return {
        status: 2,
        scheme: 0,
        id: "blob_contract_id",
        updatedAt: 1_700_000_000n,
        endedAt: 1_700_001_000n
      };
    }

    if (functionName === "marketCount") {
      return 1n;
    }

    if (functionName === "marketIdAt") {
      return MARKET_ID;
    }
  }

  if (address === ADDRESSES.vault) {
    if (functionName === "getVault") {
      if (options.vaultExists === false) {
        return {
          id: VAULT_ID,
          marketId: MARKET_ID,
          question: "Ghost",
          creator: CREATOR,
          status: 0,
          outcome: 0,
          resolvedAt: 0,
          exists: false
        };
      }

      return {
        id: VAULT_ID,
        marketId: MARKET_ID,
        question: "Next goal",
        creator: CREATOR,
        status: 0,
        outcome: 0,
        resolvedAt: 0,
        exists: true
      };
    }

    if (functionName === "getVaultPools") {
      return {
        yesTotal: 1_000_000n,
        noTotal: 500_000n,
        yesShareTotal: 100n,
        noShareTotal: 50n
      };
    }

    if (functionName === "getPosition") {
      const side = args[1];
      if (side === 0) {
        return {
          rate: 1_000n,
          gPaid: 0n,
          sharesAccrued: 100n * WAD, // on-chain WAD·SCALE; decode ÷WAD → 100n SHARE_SCALE
          maxEnd: 0,
          depleted: false
        };
      }

      return {
        rate: 0n,
        gPaid: 0n,
        sharesAccrued: 50n * WAD,
        maxEnd: 0,
        depleted: false
      };
    }

    if (functionName === "claimable" || functionName === "lossClaimable") {
      return 0n;
    }

    if (functionName === "getBoard") {
      return {
        pool: 1_000_000n,
        sideRate: 100_000n,
        g: 0n,
        lastAdvance: 1_700_000_000
      };
    }

    if (functionName === "getSharePrice") {
      return 100_000n;
    }

    if (functionName === "pendingShares") {
      return 100n;
    }

    if (functionName === "pot" || functionName === "collected") {
      return functionName === "pot" ? 0n : false;
    }

    if (functionName === "getAccountVaultIds") {
      return [VAULT_ID];
    }

    if (functionName === "winningSide") {
      return 0;
    }
  }

  if (address === ADDRESSES.marketDriver) {
    if (functionName === "tokensOfOwner") {
      return [TOKEN_ID, 43n];
    }

    if (functionName === "USDC") {
      return "0x00000000000000000000000000000000000000dd";
    }

    if (functionName === "ownerOf") {
      return USER;
    }

    if (functionName === "getApproved") {
      return "0x0000000000000000000000000000000000000000";
    }

    if (functionName === "isApprovedForAll") {
      return false;
    }

    if (functionName === "marketIdOf") {
      return MARKET_ID;
    }

    if (functionName === "laneCount") {
      return 2n;
    }

    if (functionName === "laneAt") {
      const index = Number(args[1]);
      if (index === 0) {
        return { vaultId: VAULT_ID, side: 0, rate: 1_000n };
      }

      return { vaultId: VAULT_ID, side: 1, rate: 0n };
    }
  }

  if (address === ADDRESSES.dripsStreaming) {
    if (functionName === "streamsState") {
      return {
        streamsHash:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
        streamsHistoryHash:
          "0x0000000000000000000000000000000000000000000000000000000000000002",
        updateTime: 1,
        balance: 1_000_000n,
        maxEnd: 0
      };
    }
  }

  if (address === ADDRESSES.lvstToken) {
    if (functionName === "balanceOf") {
      return 50n * 10n ** 18n;
    }
  }

  if (address === ADDRESSES.treasury) {
    if (functionName === "lvstStaked") {
      return 20n * 10n ** 18n;
    }

    if (functionName === "lvstPendingDividends") {
      return 5_000_000n;
    }
  }

  if (address === ADDRESSES.stewardRegistry) {
    if (functionName === "vaultHotState") {
      return {
        active: true,
        until: 1_700_001_000n,
        severity: 1,
        reasonHash:
          "0x00000000000000000000000000000000000000000000000000000000000000bb"
      };
    }

    if (functionName === "disputeState") {
      return {
        active: false,
        challengeUntil: 0n,
        proofRef:
          "0x0000000000000000000000000000000000000000000000000000000000000000"
      };
    }
  }

  throw new Error(`Unhandled fake read ${address}.${functionName}`);
};
