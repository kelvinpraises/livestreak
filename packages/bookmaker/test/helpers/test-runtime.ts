import type { BookmakerRuntimeConfig } from "../../src/runtime/config.js";
import { createBookmakerRuntime } from "../../src/runtime/runtime.js";
import type { BookmakerChain } from "../../src/chains/types.js";
import { detection, marketContext, watchSource } from "./fixtures.js";

const chainFields = {
  walletInit: {
    chain: "evm" as const,
    seedSource: "raw" as const,
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
};

export const testRuntimeConfig = (
  overrides: Partial<BookmakerRuntimeConfig> = {}
): BookmakerRuntimeConfig => ({
  runtimeId: "bookmaker-test",
  marketContext: marketContext(),
  watchSource: watchSource(),
  policy: {
    duplicatePolicy: "always-create",
    detection: detection()
  },
  fundingToken: "0x0000000000000000000000000000000000000002",
  ...chainFields,
  ...overrides
});

export const createTestRuntime = (chain: BookmakerChain) =>
  createBookmakerRuntime({
    config: testRuntimeConfig(),
    chain
  });
