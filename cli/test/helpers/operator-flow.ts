// Shared fixtures for the per-edge operator-flow regression guards (cli/test/*-operator-flow.test.ts).
//
// These drive the REAL cli console edges (cli/src/adapters/{bookmaker,options,steward}-edge.ts) — the
// seam where the stub/placeholder purge landed (NO_MARKET honest-unconfigured, board-first reveal,
// close = deconfigure). Each edge exposes a test-only chain/sink injection so the flow can be driven
// without a live chain.
import type { BridgeCaller, PackageRuntimeInit, SessionWallet } from "@livestreak/schema";

const EVM_WALLET_INIT = {
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
} as const;

export const OPERATOR_ADDRESS = "0x00000000000000000000000000000000000000ab" as const;

export const sessionWallet = (): SessionWallet => ({
  chain: "eip155:31337",
  seed: "test-seed",
  walletInit: EVM_WALLET_INIT,
  operatorAddress: OPERATOR_ADDRESS
});

// A full contracts bag so every package bootstrap validates. The injected fake chain/sink means these
// addresses are never dialed — but the bootstrap still requires them present.
const CONTRACTS: Readonly<Record<string, string>> = {
  vaultDriver: "0x0000000000000000000000000000000000000010",
  marketRegistry: "0x0000000000000000000000000000000000000011",
  vault: "0x0000000000000000000000000000000000000014",
  marketDriver: "0x0000000000000000000000000000000000000015",
  lvstToken: "0x0000000000000000000000000000000000000016",
  stewardRegistry: "0x0000000000000000000000000000000000000017",
  treasury: "0x0000000000000000000000000000000000000018",
  dripsStreaming: "0x0000000000000000000000000000000000000019",
  usdc: "0x00000000000000000000000000000000000000aa"
};

// hostUrl is intentionally empty: keeps the bookmaker bootstrap from wiring a real host discovery client
// (register-on-create would otherwise dial the network on createVault).
export const packageInit = (
  pkg: PackageRuntimeInit["package"],
  overrides: Partial<PackageRuntimeInit> = {}
): PackageRuntimeInit => ({
  package: pkg,
  chain: "eip155:31337",
  contracts: CONTRACTS,
  wallet: sessionWallet(),
  hostUrl: "",
  runId: "remote",
  ...overrides
});

/** A trusted remote caller — the gateway relay admits console dispatches as trusted (localOperator). */
export const trustedCaller = (): BridgeCaller => ({ id: "operator", trusted: true });
