import { Schema } from "effect";

/** AA paths relative to host base URL. */
export const ChainAaSettings = Schema.Struct({
  bundlerPath: Schema.String,
  paymasterPath: Schema.String,
  isSponsored: Schema.Boolean
});
export type ChainAaSettings = Schema.Schema.Type<typeof ChainAaSettings>;

/** Per-chain wallet keystore slot in CLI encrypted keystore. */
export const ChainWalletSlot = Schema.Struct({
  keystoreSlot: Schema.String
});
export type ChainWalletSlot = Schema.Schema.Type<typeof ChainWalletSlot>;

/** One chain entry keyed by CAIP-2 in settings.json. */
export const ChainSettings = Schema.Struct({
  deployment: Schema.String,
  rpc: Schema.String,
  contracts: Schema.Record({ key: Schema.String, value: Schema.String }),
  wallet: ChainWalletSlot,
  aa: Schema.optional(ChainAaSettings),
  /** User overrides merged over generated deployment addresses. */
  contractOverrides: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String }))
});
export type ChainSettings = Schema.Schema.Type<typeof ChainSettings>;

/** CLI working-directory settings.json — host + multichain deployments. No run cache, no seed. */
export const SettingsDoc = Schema.Struct({
  host: Schema.Struct({
    url: Schema.String
  }),
  defaultChain: Schema.String,
  chains: Schema.Record({ key: Schema.String, value: ChainSettings })
});
export type SettingsDoc = Schema.Schema.Type<typeof SettingsDoc>;

export const DEFAULT_HOST_URL = "http://127.0.0.1:8787";
export const DEFAULT_EVM_CAIP2 = "eip155:31337";
