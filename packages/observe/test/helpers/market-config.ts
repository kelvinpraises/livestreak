import type { ObserveRunMarketConfig } from "#market/types.js";

export const minimalEvmWalletInit = () =>
  ({
    chain: "evm",
    seedSource: "raw",
    config: {
      chainId: 31_337,
      provider: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      isSponsored: true,
      useNativeCoins: false,
      entryPointAddress: "0x0000000000000000000000000000000000000001",
      safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
      safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
      safeModulesVersion: "0.3.0",
      contractNetworks: {}
    }
  }) as const;

export const minimalEvmMarketRegistrationConfig = (runId: string): ObserveRunMarketConfig => ({
  walletInit: minimalEvmWalletInit(),
  seed: "test-seed-bytes",
  marketRegistryAddress: "0x00000000000000000000000000000000000000bb",
  title: `Market for ${runId}`
});
