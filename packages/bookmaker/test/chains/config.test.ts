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

describe("createBookmakerChain sui stub", () => {
  it("throws for sui writer operations", async () => {
    const chain = createBookmakerChain({
      walletInit: { chain: "sui", seedSource: "raw", config: {} },
      seed: "test-seed",
      addresses: validConfig.addresses
    });

    await expect(chain.writer.createVault({
      marketId: `0x${"11".repeat(32)}`,
      question: "q",
      creatorSide: "yes",
      creatorStake: 1n,
      seedRate: 1n
    })).rejects.toThrow(/not implemented/i);
  });
});
