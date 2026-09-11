import { describe, expect, it } from "vitest";
import { validateBookmakerChainConfig } from "../../src/chains/config.js";
import { createBookmakerChain } from "../../src/chains/index.js";

const validConfig = {
  walletInit: {
    chain: "evm",
    seedSource: "raw",
    config: {
      chainId: 31_337,
      provider: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      isSponsored: false,
      useNativeCoins: false,
      entryPointAddress: "0x0000000000000000000000000000000000000001",
      safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
      safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
      safeModulesVersion: "0.3.0",
      contractNetworks: {}
    }
  },
  seed: "test-seed",
  addresses: {
    vaultDriver: "0x0000000000000000000000000000000000000010",
    marketRegistry: "0x0000000000000000000000000000000000000011",
    vault: "0x0000000000000000000000000000000000000014",
    usdc: "0x00000000000000000000000000000000000000aa"
  }
} as const;

describe("validateBookmakerChainConfig", () => {
  it("accepts a valid evm chain config", () => {
    const config = validateBookmakerChainConfig(validConfig);
    expect(config.walletInit.chain).toBe("evm");
    expect(config.addresses.vaultDriver).toBe(validConfig.addresses.vaultDriver);
  });

  it("rejects missing addresses", () => {
    expect(() =>
      validateBookmakerChainConfig({
        ...validConfig,
        addresses: { vaultDriver: "0x0000000000000000000000000000000000000010" }
      })
    ).toThrow();
  });
});

const validSuiAddresses = {
  packageId: `0x${"ab".repeat(32)}`,
  vaultDriverRegistry: `0x${"01".repeat(32)}`,
  vaultRegistry: `0x${"02".repeat(32)}`,
  marketRegistry: `0x${"03".repeat(32)}`,
  dripsRegistry: `0x${"04".repeat(32)}`,
  streamsRegistry: `0x${"05".repeat(32)}`
} as const;

describe("createBookmakerChain sui", () => {
  it("builds a sui chain (reader + writer) from valid object ids", () => {
    const chain = createBookmakerChain({
      walletInit: { chain: "sui", seedSource: "raw", config: { rpcUrl: "http://127.0.0.1:9000" } },
      seed: "test-seed",
      addresses: validSuiAddresses
    });

    expect(typeof chain.writer.createVault).toBe("function");
    expect(typeof chain.reader.marketExists).toBe("function");
  });

  it("rejects evm-shaped addresses for a sui chain", () => {
    expect(() =>
      createBookmakerChain({
        walletInit: { chain: "sui", seedSource: "raw", config: { rpcUrl: "http://127.0.0.1:9000" } },
        seed: "test-seed",
        // EVM 0x+40-hex addresses are not valid Sui object ids (0x + 64 hex).
        addresses: validConfig.addresses
      })
    ).toThrow(/Sui object id/i);
  });
});
