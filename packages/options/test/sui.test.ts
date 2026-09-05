import { LiveStreakConfigError, LiveStreakRuntimeError } from "@livestreak/core";
import { describe, expect, it, vi } from "vitest";

import { validateOptionsSuiObjectIds } from "../src/chains/sui/addresses.js";
import { resolveSuiAccountAddress } from "../src/chains/sui/account.js";
import { createSuiOptionsChain } from "../src/chains/sui/index.js";
import { createOptionsSuiConfig } from "../src/chains/sui/config.js";
import {
  readBool,
  readU8,
  readU64,
  readU128,
  readU256,
  sideToSuiValue,
  sideFromSuiValue,
  mapSuiVault,
  mapSuiBoard,
  mapSuiLane,
  enrichSuiLane,
  mapSuiStreamState,
  mapSuiMarket,
  type InspectReturnValue,
  type SuiBoardState,
  type SuiHotState,
  type SuiPosition,
  type SuiVaultData,
  type SuiVaultPools,
  type SuiStreamState
} from "../src/chains/sui/decode.js";
import { asMarketId, asTokenId, asVaultId, asUserAddress } from "../src/model/ids.js";

// ---------------------------------------------------------------------------
// Fixture addresses — valid 64-hex Sui object IDs.
// ---------------------------------------------------------------------------
const ZERO_64 = `0x${"0".repeat(64)}` as `0x${string}`;
const ADDR_A = `0x${"a".repeat(64)}` as `0x${string}`;
const ADDR_B = `0x${"b".repeat(64)}` as `0x${string}`;
const ADDR_C = `0x${"c".repeat(64)}` as `0x${string}`;
const ADDR_D = `0x${"d".repeat(64)}` as `0x${string}`;
const ADDR_E = `0x${"e".repeat(64)}` as `0x${string}`;
const ADDR_F = `0x${"f".repeat(64)}` as `0x${string}`;
const ADDR_1 = `0x${"1".repeat(64)}` as `0x${string}`;
const ADDR_2 = `0x${"2".repeat(64)}` as `0x${string}`;
const ADDR_3 = `0x${"3".repeat(64)}` as `0x${string}`;
const ADDR_4 = `0x${"4".repeat(64)}` as `0x${string}`;

const VALID_SUI_IDS = {
  packageId: ADDR_A,
  protocol: ADDR_B,
  marketRegistry: ADDR_C,
  vaultRegistry: ADDR_D,
  stewardRegistry: ADDR_E,
  treasuryRegistry: ADDR_F,
  dripsRegistry: ADDR_1,
  streamsRegistry: ADDR_2,
  vaultDriverRegistry: ADDR_3,
  marketDriverRegistry: ADDR_4,
  driverRegistry: ZERO_64
};

const LOCALNET_DEPLOYMENT = {
  chain: "localnet" as const,
  rpc: "http://127.0.0.1:9000",
  deployedAt: "2026-06-20T21:27:00.207Z",
  deployer: ZERO_64,
  packageId: ADDR_A,
  objects: {
    packageId: ADDR_A,
    protocol: ADDR_B,
    marketRegistry: ADDR_C,
    vaultRegistry: ADDR_D,
    stewardRegistry: ADDR_E,
    treasuryRegistry: ADDR_F,
    dripsRegistry: ADDR_1,
    streamsRegistry: ADDR_2,
    vaultDriverRegistry: ADDR_3,
    marketDriverRegistry: ADDR_4,
    driverRegistry: ZERO_64,
    lvstTreasuryCap: ADDR_B,
    usdcMintCap: ADDR_C
  }
};

// ---------------------------------------------------------------------------
// BCS encode helpers for fixture byte arrays.
// ---------------------------------------------------------------------------
const encodeU8 = (v: number): InspectReturnValue => {
  const b = new Uint8Array([v]);
  return [Array.from(b), "u8"];
};

const encodeU64Le = (v: bigint): InspectReturnValue => {
  const b = new Uint8Array(8);
  let n = v;
  for (let i = 0; i < 8; i += 1) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return [Array.from(b), "u64"];
};

const encodeU128Le = (v: bigint): InspectReturnValue => {
  const b = new Uint8Array(16);
  let n = v;
  for (let i = 0; i < 16; i += 1) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return [Array.from(b), "u128"];
};

const encodeU256Le = (v: bigint): InspectReturnValue => {
  const b = new Uint8Array(32);
  let n = v;
  for (let i = 0; i < 32; i += 1) {
    b[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return [Array.from(b), "u256"];
};

const encodeBool = (v: boolean): InspectReturnValue =>
  [[v ? 1 : 0], "bool"];

// ---------------------------------------------------------------------------
// Tests: addresses validation
// ---------------------------------------------------------------------------
describe("validateOptionsSuiObjectIds", () => {
  it("accepts all-valid 64-hex Sui object IDs", () => {
    const result = validateOptionsSuiObjectIds(VALID_SUI_IDS);
    expect(result.packageId).toBe(ADDR_A);
    expect(result.marketRegistry).toBe(ADDR_C);
    expect(result.driverRegistry).toBe(ZERO_64);
  });

  it("rejects an EVM-format (40-hex) address in packageId", () => {
    expect(() =>
      validateOptionsSuiObjectIds({
        ...VALID_SUI_IDS,
        packageId: "0x0000000000000000000000000000000000000001" as `0x${string}`
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects a missing 0x prefix", () => {
    expect(() =>
      validateOptionsSuiObjectIds({
        ...VALID_SUI_IDS,
        marketRegistry: `${"a".repeat(64)}` as never
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects an object ID that is too short", () => {
    expect(() =>
      validateOptionsSuiObjectIds({
        ...VALID_SUI_IDS,
        vaultRegistry: "0xaabbcc" as `0x${string}`
      })
    ).toThrow(LiveStreakConfigError);
  });

  it("rejects non-hex characters", () => {
    expect(() =>
      validateOptionsSuiObjectIds({
        ...VALID_SUI_IDS,
        driverRegistry: `0x${"g".repeat(64)}` as `0x${string}`
      })
    ).toThrow(LiveStreakConfigError);
  });
});

// ---------------------------------------------------------------------------
// Tests: createOptionsSuiConfig
// ---------------------------------------------------------------------------
describe("createOptionsSuiConfig", () => {
  it("maps deployment to OptionsChainConfig with sui chain", () => {
    const cfg = createOptionsSuiConfig({ deployment: LOCALNET_DEPLOYMENT, seed: "my-seed" });
    expect(cfg.walletInit.chain).toBe("sui");
    expect(cfg.seed).toBe("my-seed");
    expect((cfg.addresses as { packageId: string }).packageId).toBe(ADDR_A);
    expect(cfg.readRpcUrl).toBe("http://127.0.0.1:9000");
  });

  it("overrides rpcUrl when supplied", () => {
    const cfg = createOptionsSuiConfig({
      deployment: LOCALNET_DEPLOYMENT,
      seed: "my-seed",
      rpcUrl: "http://custom:9000"
    });
    expect(cfg.readRpcUrl).toBe("http://custom:9000");
    expect(
      (cfg.walletInit as { config: { rpcUrl: string } }).config.rpcUrl
    ).toBe("http://custom:9000");
  });
});

// ---------------------------------------------------------------------------
// Tests: BCS decode helpers
// ---------------------------------------------------------------------------
describe("BCS decode helpers", () => {
  it("readBool decodes true", () => {
    expect(readBool(encodeBool(true))).toBe(true);
  });

  it("readBool decodes false", () => {
    expect(readBool(encodeBool(false))).toBe(false);
  });

  it("readU8 decodes 0", () => {
    expect(readU8(encodeU8(0))).toBe(0);
  });

  it("readU8 decodes 255", () => {
    expect(readU8(encodeU8(255))).toBe(255);
  });

  it("readU64 decodes 0n", () => {
    expect(readU64(encodeU64Le(0n))).toBe(0n);
  });

  it("readU64 decodes 12345678n", () => {
    expect(readU64(encodeU64Le(12345678n))).toBe(12345678n);
  });

  it("readU128 decodes large value", () => {
    const val = 999_999_999_999_999_999n;
    expect(readU128(encodeU128Le(val))).toBe(val);
  });

  it("readU256 decodes large value", () => {
    const val = 2n ** 200n;
    expect(readU256(encodeU256Le(val))).toBe(val);
  });
});

// ---------------------------------------------------------------------------
// Tests: side encoding
// ---------------------------------------------------------------------------
describe("side encoding", () => {
  it("sideToSuiValue maps yes → 0", () => {
    expect(sideToSuiValue("yes")).toBe(0);
  });

  it("sideToSuiValue maps no → 1", () => {
    expect(sideToSuiValue("no")).toBe(1);
  });

  it("sideFromSuiValue maps 0 → yes", () => {
    expect(sideFromSuiValue(0)).toBe("yes");
  });

  it("sideFromSuiValue maps 1 → no", () => {
    expect(sideFromSuiValue(1)).toBe("no");
  });

  it("sideFromSuiValue throws on invalid value", () => {
    expect(() => sideFromSuiValue(99)).toThrow(LiveStreakConfigError);
  });
});

// ---------------------------------------------------------------------------
// Tests: map helpers (no RPC needed)
// ---------------------------------------------------------------------------
describe("mapSuiVault", () => {
  const pools: SuiVaultPools = {
    yesPool: 1_000_000n,
    noPool: 500_000n,
    yesShares: 100n,
    noShares: 50n
  };

  const hot: SuiHotState = { active: false, until: 0n, severity: 0 };

  it("maps open vault correctly", () => {
    const data: SuiVaultData = {
      id: `0x${"aa".repeat(32)}`,
      marketId: `0x${"bb".repeat(32)}`,
      question: "Will it happen?",
      creator: `0x${"cc".repeat(32)}`,
      status: 0,
      outcome: 0,
      resolvedAt: 0n
    };
    const vault = mapSuiVault(data, pools, hot);
    expect(vault.status).toBe("open");
    expect(vault.outcome).toBe("pending");
    expect(vault.pools.yes).toBe(1_000_000n);
    expect(vault.pools.no).toBe(500_000n);
    expect(vault.steward.hot).toBe(false);
    expect(vault.question).toBe("Will it happen?");
  });

  it("maps resolved vault with yes outcome", () => {
    const data: SuiVaultData = {
      id: `0x${"aa".repeat(32)}`,
      marketId: `0x${"bb".repeat(32)}`,
      question: "?",
      creator: `0x${"cc".repeat(32)}`,
      status: 3,
      outcome: 1,
      resolvedAt: 1_700_000n
    };
    const vault = mapSuiVault(data, pools, hot);
    expect(vault.status).toBe("resolved");
    expect(vault.outcome).toBe("yes");
    expect(vault.timing.resolvedAtMs).toBe(1_700_000_000);
  });

  it("maps hot state correctly when active", () => {
    const hotActive: SuiHotState = { active: true, until: 9999n, severity: 2 };
    const data: SuiVaultData = {
      id: `0x${"aa".repeat(32)}`,
      marketId: `0x${"bb".repeat(32)}`,
      question: "?",
      creator: `0x${"cc".repeat(32)}`,
      status: 1,
      outcome: 0,
      resolvedAt: 0n
    };
    const vault = mapSuiVault(data, pools, hotActive);
    expect(vault.status).toBe("hot");
    expect(vault.steward.hot).toBe(true);
    expect(vault.steward.hotUntilMs).toBe(9_999_000);
    expect(vault.steward.severity).toBe(2);
  });
});

describe("mapSuiBoard", () => {
  it("converts bigint lastAdvance to ms", () => {
    const board: SuiBoardState = {
      pool: 500_000n,
      sideRate: 100n,
      g: 200n,
      lastAdvance: 1_000_000n
    };
    const result = mapSuiBoard(board);
    expect(result.lastAdvanceMs).toBe(1_000_000_000);
    expect(result.pool).toBe(500_000n);
  });
});

describe("mapSuiLane + enrichSuiLane", () => {
  const tokenId = asTokenId(42n);
  const vaultId = asVaultId(`0x${"dd".repeat(32)}`);
  const position: SuiPosition = {
    rate: 1000n,
    gPaid: 50n,
    sharesAccrued: 200n,
    maxEnd: 999n,
    depleted: false,
    fundStart: 1n,
    lostUsdc: 0n
  };

  it("maps lane fields correctly", () => {
    const lane = mapSuiLane(tokenId, vaultId, "yes", 1000n, position);
    expect(lane.tokenId).toBe(tokenId);
    expect(lane.side).toBe("yes");
    expect(lane.rate).toBe(1000n);
    expect(lane.sharesAccrued).toBe(200n);
    expect(lane.maxEndMs).toBe(999_000);
    expect(lane.depleted).toBe(false);
  });

  it("omits maxEndMs when maxEnd is 0", () => {
    const pos2 = { ...position, maxEnd: 0n };
    const lane = mapSuiLane(tokenId, vaultId, "no", 500n, pos2);
    expect(lane.maxEndMs).toBeUndefined();
  });

  it("enrichSuiLane sets won=true when side matches winningSide", () => {
    const lane = mapSuiLane(tokenId, vaultId, "yes", 1000n, position);
    const enriched = enrichSuiLane(lane, 0n, 0n, "yes");
    expect(enriched.won).toBe(true);
    expect(enriched.lossClaimable).toBe(0n);
  });

  it("enrichSuiLane sets won=false when side differs from winningSide", () => {
    const lane = mapSuiLane(tokenId, vaultId, "yes", 1000n, position);
    const enriched = enrichSuiLane(lane, 0n, 0n, "no");
    expect(enriched.won).toBe(false);
  });

  it("enrichSuiLane omits won when winningSide is undefined", () => {
    const lane = mapSuiLane(tokenId, vaultId, "yes", 1000n, position);
    const enriched = enrichSuiLane(lane, 0n, 0n, undefined);
    expect(enriched.won).toBeUndefined();
  });

  it("enrichSuiLane sets claimable and lossClaimable", () => {
    const lane = mapSuiLane(tokenId, vaultId, "yes", 1000n, position);
    const enriched = enrichSuiLane(lane, 7n, 5n, "yes");
    expect(enriched.claimable).toBe(7n);
    expect(enriched.lossClaimable).toBe(5n);
  });
});

describe("mapSuiStreamState", () => {
  it("maps live stream state", () => {
    const data: SuiStreamState = {
      status: 1,
      scheme: 0,
      contentId: "blob123",
      endedAt: 0n
    };
    const result = mapSuiStreamState(data);
    expect(result.status).toBe("live");
    expect(result.scheme).toBe("walrus-testnet");
    expect(result.id).toBe("blob123");
  });

  it("throws on unknown status", () => {
    const data: SuiStreamState = {
      status: 99,
      scheme: 0,
      contentId: "",
      endedAt: 0n
    };
    expect(() => mapSuiStreamState(data)).toThrow(LiveStreakConfigError);
  });
});

// ---------------------------------------------------------------------------
// Tests: graceful degradation behaviors
// ---------------------------------------------------------------------------
describe("Sui graceful degradation (gaps)", () => {
  describe("vault::claimable landed (winnings-claimable wired)", () => {
    it("enrichSuiLane sets claimable from the winnings read", () => {
      const tokenId = asTokenId(1n);
      const vaultId = asVaultId(`0x${"aa".repeat(32)}`);
      const position: SuiPosition = {
        rate: 100n,
        gPaid: 0n,
        sharesAccrued: 10n,
        maxEnd: 0n,
        depleted: false,
        fundStart: 0n,
        lostUsdc: 0n
      };
      const lane = mapSuiLane(tokenId, vaultId, "yes", 100n, position);
      const enriched = enrichSuiLane(lane, 999n, 5n, "yes");
      expect(enriched.claimable).toBe(999n);
    });
  });

  describe("no-config stub: writes throw notImplemented", () => {
    it("createSuiOptionsChain stub: withdrawMany throws LiveStreakConfigError", async () => {
      const suiChain = createSuiOptionsChain();
      await expect(
        suiChain.writer.withdrawMany({ tokenId: asTokenId(1n), vaultIds: [], to: asUserAddress(ZERO_64) })
      ).rejects.toBeInstanceOf(LiveStreakConfigError);
    });
  });

  describe("steward hot_reason_hash landed (hotReason wired)", () => {
    const pools: SuiVaultPools = {
      yesPool: 0n,
      noPool: 0n,
      yesShares: 0n,
      noShares: 0n
    };
    const data: SuiVaultData = {
      id: `0x${"aa".repeat(32)}`,
      marketId: `0x${"bb".repeat(32)}`,
      question: "?",
      creator: ZERO_64,
      status: 1,
      outcome: 0,
      resolvedAt: 0n
    };

    it("omits hotReason when no reason hash is present", () => {
      const hot: SuiHotState = { active: true, until: 9999n, severity: 1 };
      const vault = mapSuiVault(data, pools, hot);
      expect(vault.steward.hotReason).toBeUndefined();
    });

    it("sets hotReason from the reason hash when present", () => {
      const hot: SuiHotState = {
        active: true,
        until: 9999n,
        severity: 1,
        reasonHash: "0xdeadbeef"
      };
      const vault = mapSuiVault(data, pools, hot);
      expect(vault.steward.hotReason).toBe("0xdeadbeef");
    });
  });

  describe("gap 4 (owned-object model): approval ops throw notSupported", () => {
    it("createSuiOptionsChain stub: approveNft throws LiveStreakConfigError", async () => {
      const suiChain = createSuiOptionsChain();
      await expect(
        suiChain.writer.approveNft({ operator: asUserAddress(ZERO_64), tokenId: asTokenId(1n) })
      ).rejects.toBeInstanceOf(LiveStreakConfigError);
    });

    it("createSuiOptionsChain stub: setApprovalForAll throws LiveStreakConfigError", async () => {
      const suiChain = createSuiOptionsChain();
      await expect(
        suiChain.writer.setApprovalForAll({ operator: asUserAddress(ZERO_64), approved: true })
      ).rejects.toBeInstanceOf(LiveStreakConfigError);
    });

    it("createSuiOptionsChain stub: readApproved throws LiveStreakConfigError", async () => {
      const suiChain = createSuiOptionsChain();
      await expect(
        suiChain.reader.readApproved(asTokenId(1n))
      ).rejects.toBeInstanceOf(LiveStreakConfigError);
    });

    it("createSuiOptionsChain stub: readIsApprovedForAll throws LiveStreakConfigError", async () => {
      const suiChain = createSuiOptionsChain();
      await expect(
        suiChain.reader.readIsApprovedForAll(
          asUserAddress(ZERO_64),
          asUserAddress(ADDR_A)
        )
      ).rejects.toBeInstanceOf(LiveStreakConfigError);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: createSuiOptionsChain with valid config produces real reader/writer
// ---------------------------------------------------------------------------
describe("createSuiOptionsChain with valid config", () => {
  const suiCfg = createOptionsSuiConfig({
    deployment: LOCALNET_DEPLOYMENT,
    seed: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  });

  it("returns a chain with reader and writer objects", () => {
    const chain = createSuiOptionsChain(suiCfg);
    expect(chain.reader).toBeTypeOf("object");
    expect(chain.writer).toBeTypeOf("object");
    expect(chain.reader.readMarket).toBeTypeOf("function");
    expect(chain.writer.fund).toBeTypeOf("function");
  });

  it("real reader: readOwnerOf throws notSupported (owned-object model)", async () => {
    const chain = createSuiOptionsChain(suiCfg);
    await expect(chain.reader.readOwnerOf(asTokenId(1n))).rejects.toThrow(LiveStreakConfigError);
  });

  it("real reader: readApproved throws notSupported", async () => {
    const chain = createSuiOptionsChain(suiCfg);
    await expect(chain.reader.readApproved(asTokenId(1n))).rejects.toThrow(LiveStreakConfigError);
  });

  it("real reader: readIsApprovedForAll throws notSupported", async () => {
    const chain = createSuiOptionsChain(suiCfg);
    await expect(
      chain.reader.readIsApprovedForAll(asUserAddress(ZERO_64), asUserAddress(ADDR_A))
    ).rejects.toThrow(LiveStreakConfigError);
  });

  it("real writer: withdrawMany is wired (withdraw_many landed)", () => {
    const chain = createSuiOptionsChain(suiCfg);
    expect(chain.writer.withdrawMany).toBeTypeOf("function");
  });

  it("real writer: approveNft throws notSupported (owned-object model)", async () => {
    const chain = createSuiOptionsChain(suiCfg);
    await expect(
      chain.writer.approveNft({ operator: asUserAddress(ZERO_64), tokenId: asTokenId(1n) })
    ).rejects.toThrow(LiveStreakConfigError);
  });

  it("real writer: setApprovalForAll throws notSupported (owned-object model)", async () => {
    const chain = createSuiOptionsChain(suiCfg);
    await expect(
      chain.writer.setApprovalForAll({ operator: asUserAddress(ZERO_64), approved: true })
    ).rejects.toThrow(LiveStreakConfigError);
  });
});
