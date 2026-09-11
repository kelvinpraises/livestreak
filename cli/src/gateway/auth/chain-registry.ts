// The CLI's floating, extensible chain layer.
//
// The CLI does NOT implement wallets — it INTERFACES @livestreak/wallet's createWalletManager. Each
// chain contributes ONE ChainAdapter that knows how to (a) match its CAIP-2 namespace, (b) flatten its
// deployment artifact into the canonical contracts bag, and (c) build the (floating) WalletInit that
// the exported wallet manager consumes. Nothing chain-specific is baked into settings.json: the
// contracts bag and the WalletInit are DERIVED here at load time from the deployment + host + rpc.
//
// Adding a chain (e.g. Solana) = add one adapter to `chainAdapters` and a WalletInit arm in
// @livestreak/schema + a createWalletManager case in @livestreak/wallet. Zero edits to call sites.

import type { ChainAaSettings, EvmWalletInitConfig, WalletChain, WalletInit } from "@livestreak/schema";
import { localhostDeployment } from "@livestreak/contracts/evm/deployments/localhost";
import { localnetDeployment } from "@livestreak/contracts/sui/deployments/localnet";

// What the registry needs to assemble a chain's runtime config. Everything here is a "float" — read
// from settings.json or the host at load, never a pre-baked wallet/contracts blob.
export interface ChainBuildContext {
  readonly caip2: string;
  readonly rpc: string;
  readonly hostUrl: string;
  /** Optional AA tuning (EVM only). Absent => the adapter defaults sponsored + standard host paths. */
  readonly aa?: ChainAaSettings;
  /** The derived contracts bag (from deriveContracts), passed in so buildWalletInit can read AA addrs. */
  readonly contracts: Readonly<Record<string, string>>;
}

export interface ChainAdapter {
  /** The @livestreak/wallet createWalletManager switch key. */
  readonly kind: WalletChain;
  /** Does this adapter own the given CAIP-2 id? (e.g. eip155:* -> evm, sui:* -> sui). */
  matches(caip2: string): boolean;
  /** Flatten the chain's deployment artifact into the canonical Record<string,string> contracts bag. */
  deriveContracts(overrides?: Readonly<Record<string, string>>): Record<string, string>;
  /** Build the floating WalletInit the exported wallet manager consumes. */
  buildWalletInit(ctx: ChainBuildContext): WalletInit;
}

const namespaceOf = (caip2: string): string => caip2.split(":")[0] ?? "";

// --- EVM adapter (eip155:*) — Safe 4337 AA over the deployed ERC-4337 stack ---

const flattenEvmDeployment = (): Record<string, string> => {
  const s = localhostDeployment.scopes;
  const aa = s.aa.contracts;
  const protocol = s.protocol.contracts;
  const streaming = s.streaming.contracts;
  const wire = s.wire.contracts;
  if (aa === undefined || protocol === undefined || streaming === undefined || wire === undefined) {
    throw new Error("localhost EVM deployment is missing contract scopes");
  }
  return {
    entryPoint: aa.entryPoint,
    safeSingleton: aa.safeSingleton,
    safeProxyFactory: aa.safeProxyFactory,
    safeModuleSetup: aa.safeModuleSetup,
    safe4337Module: aa.safe4337Module,
    multiSend: aa.multiSend,
    multiSendCallOnly: aa.multiSendCallOnly,
    fallbackHandler: aa.fallbackHandler,
    signMessageLib: aa.signMessageLib,
    createCall: aa.createCall,
    simulateTxAccessor: aa.simulateTxAccessor,
    marketRegistry: protocol.marketRegistry,
    vault: protocol.vault,
    mockUsdc: protocol.mockUsdc,
    lvstToken: protocol.lvstToken,
    treasury: protocol.treasury,
    stewardRegistry: protocol.stewardRegistry,
    dripsStreaming: streaming.dripsStreaming,
    vaultDriver: wire.vaultDriver,
    marketDriver: wire.marketDriverProxy
  };
};

const evmChainAdapter: ChainAdapter = {
  kind: "evm",
  matches: (caip2) => namespaceOf(caip2) === "eip155",
  deriveContracts: (overrides) => ({ ...flattenEvmDeployment(), ...(overrides ?? {}) }),
  buildWalletInit: (ctx) => {
    const chainId = Number(ctx.caip2.split(":")[1] ?? "31337");
    const hostBase = ctx.hostUrl.replace(/\/$/, "");
    const isSponsored = ctx.aa?.isSponsored ?? true;
    const bundlerUrl = `${hostBase}${ctx.aa?.bundlerPath ?? "/aa/bundler/local"}`;
    const paymasterUrl = `${hostBase}${ctx.aa?.paymasterPath ?? "/aa/paymaster/local"}`;
    const c = ctx.contracts;
    const config = {
      chainId,
      provider: ctx.rpc,
      bundlerUrl,
      ...(isSponsored ? { paymasterUrl } : {}),
      isSponsored: true,
      useNativeCoins: false,
      entryPointAddress: c.entryPoint as `0x${string}`,
      safe4337ModuleAddress: c.safe4337Module as `0x${string}`,
      safeModulesSetupAddress: c.safeModuleSetup as `0x${string}`,
      safeModulesVersion: "0.3.0",
      contractNetworks: {
        [String(chainId)]: {
          safeSingletonAddress: c.safeSingleton as `0x${string}`,
          safeProxyFactoryAddress: c.safeProxyFactory as `0x${string}`,
          multiSendAddress: c.multiSend as `0x${string}`,
          multiSendCallOnlyAddress: c.multiSendCallOnly as `0x${string}`,
          fallbackHandlerAddress: c.fallbackHandler as `0x${string}`,
          signMessageLibAddress: c.signMessageLib as `0x${string}`,
          createCallAddress: c.createCall as `0x${string}`,
          simulateTxAccessorAddress: c.simulateTxAccessor as `0x${string}`
        }
      }
    } as EvmWalletInitConfig;
    return { chain: "evm", seedSource: "signature-derived", config };
  }
};

// --- Sui adapter (sui:*) — Ed25519 native signing, no AA apparatus, just RPC ---

const flattenSuiDeployment = (): Record<string, string> => ({
  ...localnetDeployment.objects,
  packageId: localnetDeployment.packageId,
  // observe's Sui market registrar consumes the registry as ONE JSON-encoded contract key
  // (control.ts parses contracts.suiMarketRegistry -> { packageId, marketRegistryObjectId }).
  suiMarketRegistry: JSON.stringify({
    packageId: localnetDeployment.packageId,
    marketRegistryObjectId: localnetDeployment.objects.marketRegistry
  })
});

const suiChainAdapter: ChainAdapter = {
  kind: "sui",
  matches: (caip2) => namespaceOf(caip2) === "sui",
  deriveContracts: (overrides) => ({ ...flattenSuiDeployment(), ...(overrides ?? {}) }),
  buildWalletInit: (ctx) => ({
    chain: "sui",
    seedSource: "raw",
    config: { rpcUrl: ctx.rpc }
  })
};

// --- the registry ---

// Ordered; first matching adapter wins. Append new chains here (e.g. solanaChainAdapter).
export const chainAdapters: readonly ChainAdapter[] = [evmChainAdapter, suiChainAdapter];

export const resolveChainAdapter = (caip2: string): ChainAdapter => {
  const adapter = chainAdapters.find((a) => a.matches(caip2));
  if (adapter === undefined) {
    throw new Error(
      `No chain adapter for CAIP-2 "${caip2}". Known namespaces: ${chainAdapters
        .map((a) => a.kind)
        .join(", ")}. Add an adapter to cli/src/gateway/auth/chain-registry.ts to support it.`
    );
  }
  return adapter;
};
