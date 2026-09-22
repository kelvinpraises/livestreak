import { Schema } from "effect";

// EVM hex address (SCH.2). Validated `0x`+40-hex pattern + nominal brand, so the schema rejects
// malformed addresses at decode and "I passed a non-address string" becomes a type error in
// composition roots. NOTE: EVM-only — do NOT brand Sui object ids (those are 0x+64-hex) with this.
export const Address = Schema.String.pipe(
  Schema.pattern(/^0x[0-9a-fA-F]{40}$/),
  Schema.brand("Address")
);
export type Address = Schema.Schema.Type<typeof Address>;

// Per-chain ERC-4337 / Safe deployment addresses.
// Mirrors xylkstream `wdkConfig.contractNetworks[chainKey]` field-for-field.
export const Erc4337ContractNetwork = Schema.Struct({
  safeSingletonAddress: Address,
  safeProxyFactoryAddress: Address,
  multiSendAddress: Address,
  multiSendCallOnlyAddress: Address,
  fallbackHandlerAddress: Address,
  signMessageLibAddress: Address,
  createCallAddress: Address,
  simulateTxAccessorAddress: Address
});
export type Erc4337ContractNetwork = Schema.Schema.Type<typeof Erc4337ContractNetwork>;

// --- per-chain injected wallet configs (caller-supplied; the chain is data, never baked) ---

// EVM ERC-4337 wallet config — mirrors xylkstream's `wdkConfig` 1:1. EVM uses Safe account
// abstraction, so it carries the full bundler / paymaster / entryPoint / Safe-module apparatus.
export const EvmWalletInitConfig = Schema.Struct({
  chainId: Schema.Number,
  provider: Schema.String, // rpc url (xylkstream field name)
  bundlerUrl: Schema.String, // e.g. {host}/aa/bundler/{chain}
  paymasterUrl: Schema.optional(Schema.String), // absent = self-pay (not sponsored)
  isSponsored: Schema.Boolean,
  useNativeCoins: Schema.Boolean,
  entryPointAddress: Address,
  safe4337ModuleAddress: Address,
  safeModulesSetupAddress: Address,
  safeModulesVersion: Schema.String, // e.g. "0.3.0"
  gasOverrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  contractNetworks: Schema.Record({ key: Schema.String, value: Erc4337ContractNetwork })
}).pipe(
  // SCH.1: resolve the schema/runtime contradiction — the vendored `_validateConfig` throws
  // "Missing required sponsorship policy configuration fields: paymasterUrl" when sponsored without a
  // paymasterUrl, but the flat schema decoded it fine. Refine so the contradiction fails at decode.
  // (Self-pay/native — isSponsored:false — needs no paymasterUrl, so it stays valid.)
  Schema.filter(
    (config) =>
      config.isSponsored === false ||
      (typeof config.paymasterUrl === "string" && config.paymasterUrl.length > 0),
    { message: () => "paymasterUrl is required when isSponsored is true" }
  )
);
export type EvmWalletInitConfig = Schema.Schema.Type<typeof EvmWalletInitConfig>;

// SUI wallet config. Sui signs natively (Ed25519), so there is NO bundler / paymaster /
// entryPoint / Safe apparatus — only RPC connectivity.
export const SuiWalletInitConfig = Schema.Struct({
  rpcUrl: Schema.Union(Schema.String, Schema.Array(Schema.String)), // one endpoint or a failover list
  retries: Schema.optional(Schema.Number),
  // Which @mysten/sui v2 network the rpcUrl targets. Filled by the composition root (host/cli read it
  // at their env edge); @livestreak/wallet defaults to 'localnet' when absent.
  network: Schema.optional(Schema.Literal("mainnet", "testnet", "devnet", "localnet"))
});
export type SuiWalletInitConfig = Schema.Schema.Type<typeof SuiWalletInitConfig>;

// SOLANA wallet config. Signs natively (Ed25519) like Sui; sponsorship is the Kora paymaster
// model (fee-payer co-sign quoted in an SPL token), so the sponsored arm carries the paymaster
// triple instead of the EVM bundler/entryPoint apparatus.
export const SolanaWalletInitConfig = Schema.Struct({
  provider: Schema.Union(Schema.String, Schema.Array(Schema.String)), // one endpoint or a failover list
  retries: Schema.optional(Schema.Number),
  isSponsored: Schema.optional(Schema.Boolean),
  paymasterUrl: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))), // e.g. {host}/aa/solana/paymaster
  paymasterAddress: Schema.optional(Schema.String), // base58 fee-payer address
  paymasterToken: Schema.optional(Schema.Struct({ address: Schema.String })),
  network: Schema.optional(Schema.Literal("mainnet-beta", "devnet", "testnet", "localnet"))
}).pipe(
  // Contradiction-kill (fail at decode, not first send): sponsored needs a paymaster URL + fee-payer
  // address. paymasterToken is OPTIONAL — absent selects token-free sponsorship (the paymaster pays the
  // SOL fee and takes nothing); present enables the legacy Kora fee-token flow.
  Schema.filter(
    (config) =>
      config.isSponsored !== true ||
      (config.paymasterUrl !== undefined && config.paymasterAddress !== undefined),
    {
      message: () => "paymasterUrl and paymasterAddress are required when isSponsored is true"
    }
  )
);
export type SolanaWalletInitConfig = Schema.Schema.Type<typeof SolanaWalletInitConfig>;

// --- wallet init ---

// Where the seed comes from. The SECRET bytes are supplied at runtime by the caller —
// never serialized into this schema, the package, or the repo.
export const WalletSeedSource = Schema.Literal("raw", "mnemonic", "signature-derived");
export type WalletSeedSource = Schema.Schema.Type<typeof WalletSeedSource>;

// Which chain a wallet-init targets. Mirrors @livestreak/wallet createWalletManager's switch key.
export const WalletChain = Schema.Literal("evm", "sui", "solana");
export type WalletChain = Schema.Schema.Type<typeof WalletChain>;

// THE wallet-init the caller (composition root) fills — chain-discriminated, one type per chain.
// The secret seed bytes arrive separately at runtime, never in this schema.
export const WalletInit = Schema.Union(
  Schema.Struct({
    chain: Schema.Literal("evm"),
    seedSource: WalletSeedSource,
    config: EvmWalletInitConfig
  }),
  Schema.Struct({
    chain: Schema.Literal("sui"),
    seedSource: WalletSeedSource,
    config: SuiWalletInitConfig
  }),
  Schema.Struct({
    chain: Schema.Literal("solana"),
    seedSource: WalletSeedSource,
    config: SolanaWalletInitConfig
  })
);
export type WalletInit = Schema.Schema.Type<typeof WalletInit>;

// --- descriptor → wallet-init (shared edge composition) ---

// The minimal Solana sponsorship shape a host AA descriptor advertises — just the fields the
// wallet-init mapping reads. Kept structural (NOT an import of @livestreak/host's descriptor) so this
// foundation stays dependency-free; each edge passes its `descriptor.solanaSponsorship` straight in.
export interface SolanaSponsorshipInput {
  readonly paymasterPath: string;
  readonly payerAddress?: string;
  readonly feeTokens?: readonly string[];
  readonly rpcUrl?: string;
}

// Map a host's advertised Solana sponsorship into a WalletInit — the ONE place both edges (the app
// provider and the CLI gateway) shape this config, instead of each hand-rolling the same field copy.
// TOKEN-FREE by default: sponsor whenever a fee-payer address is advertised — the paymaster co-signs as
// fee payer and takes nothing, so no fee token (and no sponsor fee-token ATA) is needed. If the
// descriptor also advertises a feeToken it opts into the legacy Kora fee-token flow. With no payer
// address, a self-pay config so the read-only board still loads and writes fund their own fee.
// `hostBaseUrl` prefixes the relative paymasterPath; `fallbackRpc` is used when the descriptor has no rpcUrl.
export function solanaWalletInitFromDescriptor(
  sponsorship: SolanaSponsorshipInput | undefined,
  opts: {
    readonly hostBaseUrl: string;
    readonly fallbackRpc: string;
    readonly network?: "mainnet-beta" | "devnet" | "testnet" | "localnet";
  }
): WalletInit {
  const network = opts.network ?? "localnet";
  const feeToken = sponsorship?.feeTokens?.[0];
  const raw =
    sponsorship !== undefined && sponsorship.payerAddress !== undefined
      ? {
          provider: sponsorship.rpcUrl ?? opts.fallbackRpc,
          isSponsored: true,
          paymasterUrl: `${opts.hostBaseUrl}${sponsorship.paymasterPath}`,
          paymasterAddress: sponsorship.payerAddress,
          ...(feeToken !== undefined ? { paymasterToken: { address: feeToken } } : {}),
          network
        }
      : { provider: opts.fallbackRpc, network };
  const config = Schema.decodeUnknownSync(SolanaWalletInitConfig)(raw);
  return { chain: "solana", seedSource: "raw", config };
}
