import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { asMarketId, asUserAddress, asVaultId } from "../../src/model/ids.js";
import {
  createContractsOptionsReadTransport,
  type ContractReader,
  type ContractReadRequest,
  type LivestreakContractAddresses
} from "../../src/read/contracts/index.js";

const MARKET_ID = asMarketId(
  "0x0000000000000000000000000000000000000000000000000000000000000001"
);
const VAULT_ID = asVaultId(
  "0x00000000000000000000000000000000000000000000000000000000000000aa"
);
const USER = asUserAddress("0x0000000000000000000000000000000000000001");

const ADDRESSES: LivestreakContractAddresses = {
  marketRegistry: "0x0000000000000000000000000000000000000011",
  bookmakerRegistry: "0x0000000000000000000000000000000000000012",
  vaultFactory: "0x0000000000000000000000000000000000000013",
  vault: "0x0000000000000000000000000000000000000014",
  vaultFunding: "0x0000000000000000000000000000000000000015",
  flowToken: "0x0000000000000000000000000000000000000016",
  stewardRegistry: "0x0000000000000000000000000000000000000017"
};

describe("contracts read transport", () => {
  it("maps market read", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES
    });

    const market = await transport.readMarket(MARKET_ID);
    expect(market.title).toBe("Derby stream");
    expect(market.vaultIds).toEqual([VAULT_ID]);
    expect(market.status).toBe("open");
  });

  it("maps market vault ids via listMarketVaults", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES
    });

    const vaultIds = await transport.listMarketVaults(MARKET_ID);
    expect(vaultIds).toEqual([VAULT_ID]);
  });

  it("maps vault read with steward state", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES
    });

    const vault = await transport.readVault(VAULT_ID);
    expect(vault.question).toBe("Next goal");
    expect(vault.pools.yes).toBe(1_000_000n);
    expect(vault.pools.no).toBe(500_000n);
    expect(vault.steward.hot).toBe(true);
  });

  it("maps user YES and NO positions separately", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES
    });

    const position = await transport.readUserVaultPosition(USER, VAULT_ID);
    expect(position.positions.yes.shares).toBe(100n);
    expect(position.positions.yes.streamed).toBe(1_000_000n);
    expect(position.positions.no.shares).toBe(50n);
    expect(position.positions.no.streamed).toBe(500_000n);
  });

  it("maps funding rates per side including rate 0", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES
    });

    const yes = await transport.readFundingStream(USER, VAULT_ID, "yes");
    const no = await transport.readFundingStream(USER, VAULT_ID, "no");

    expect(yes.ratePerSecond).toBe(1_000n);
    expect(yes.active).toBe(true);
    expect(no.ratePerSecond).toBe(0n);
    expect(no.active).toBe(false);
  });

  it("maps FLOW account skeleton reads", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES
    });

    const account = await transport.readLvstAccount(USER);
    expect(account.balance).toBe(50n * 10n ** 18n);
    expect(account.staked).toBe(20n * 10n ** 18n);
    expect(account.pendingDividends).toBe(0n);
  });

  it("maps protocol summary when enabled", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader(),
      addresses: ADDRESSES,
      includeProtocolSummary: true
    });

    const summary = await transport.readProtocolSummary?.();
    expect(summary).toEqual({ marketCount: 1, vaultCount: 1 });
  });

  it("fails typed when market is missing", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader({ marketExists: false }),
      addresses: ADDRESSES
    });

    await expect(transport.readMarket(MARKET_ID)).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("fails typed when vault is missing", async () => {
    const transport = createContractsOptionsReadTransport({
      reader: createFakeReader({ vaultExists: false }),
      addresses: ADDRESSES
    });

    await expect(transport.readVault(VAULT_ID)).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("does not share mutable reader state across adapters", async () => {
    const callsA: string[] = [];
    const callsB: string[] = [];

    const transportA = createContractsOptionsReadTransport({
      reader: createRecordingReader(callsA),
      addresses: ADDRESSES
    });
    const transportB = createContractsOptionsReadTransport({
      reader: createRecordingReader(callsB),
      addresses: ADDRESSES
    });

    await transportA.readMarket(MARKET_ID);
    await transportB.readMarket(MARKET_ID);

    expect(callsA.length).toBeGreaterThan(0);
    expect(callsB.length).toBeGreaterThan(0);
    expect(callsA).not.toBe(callsB);
  });

  it("rejects invalid contract addresses at construction", () => {
    expect(() =>
      createContractsOptionsReadTransport({
        reader: createFakeReader(),
        addresses: {
          ...ADDRESSES,
          marketRegistry: "not-an-address" as `0x${string}`
        }
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects invalid market, vault, and user ids before reader calls", async () => {
    let readerCalls = 0;
    const reader: ContractReader = {
      read: async () => {
        readerCalls += 1;
        return true;
      }
    };

    const transport = createContractsOptionsReadTransport({
      reader,
      addresses: ADDRESSES
    });

    await expect(transport.readMarket(asMarketId("market_01"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    await expect(transport.readVault(asVaultId("vault_01"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    await expect(transport.readLvstAccount(asUserAddress("0xbad"))).rejects.toBeInstanceOf(
      LiveStreakConfigError
    );
    expect(readerCalls).toBe(0);
  });

  it("accepts valid hex ids and reaches reader", async () => {
    let readerCalls = 0;
    const transport = createContractsOptionsReadTransport({
      reader: {
        read: async (request) => {
          readerCalls += 1;
          return respond(request, {});
        }
      },
      addresses: ADDRESSES
    });

    await transport.readMarket(MARKET_ID);
    expect(readerCalls).toBeGreaterThan(0);
  });
});

type FakeReaderOptions = {
  readonly marketExists?: boolean;
  readonly vaultExists?: boolean;
};

const createFakeReader = (options: FakeReaderOptions = {}): ContractReader => ({
  read: async (request) => respond(request, options)
});

const createRecordingReader = (calls: string[]): ContractReader => ({
  read: async (request) => {
    calls.push(`${request.address}:${request.functionName}`);
    return respond(request, {});
  }
});

const respond = (request: ContractReadRequest, options: FakeReaderOptions): unknown => {
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
        createdAt: 1_700_000_000n,
        exists: true
      };
    }

    if (functionName === "getVaultIds") {
      return [VAULT_ID];
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
          creator: USER,
          status: 0,
          outcome: 0,
          yesPool: 0n,
          noPool: 0n,
          exists: false
        };
      }

      return {
        id: VAULT_ID,
        marketId: MARKET_ID,
        question: "Next goal",
        creator: USER,
        status: 0,
        outcome: 0,
        yesPool: 1_000_000n,
        noPool: 500_000n,
        exists: true
      };
    }

    if (functionName === "position") {
      const side = args[2];
      if (side === 0) {
        return { shares: 100n, deposited: 1_000_000n };
      }

      return { shares: 50n, deposited: 500_000n };
    }
  }

  if (address === ADDRESSES.vaultFunding) {
    if (functionName === "fundingRate") {
      return args[2] === 0 ? 1_000n : 0n;
    }

    if (functionName === "fundingActive") {
      return args[2] === 0;
    }
  }

  if (address === ADDRESSES.flowToken) {
    if (functionName === "balanceOf") {
      return 50n * 10n ** 18n;
    }

    if (functionName === "skeletonStaked") {
      return 20n * 10n ** 18n;
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
