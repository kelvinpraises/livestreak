import { Schema } from "effect";

import type { WalletInit } from "./wallet.js";

export const OutputMode = Schema.Literal("file", "local", "simulcast");

export type OutputMode = Schema.Schema.Type<typeof OutputMode>;

/** CAIP-2 chain id, e.g. `eip155:31337`, `sui:localnet`. */
export type Caip2ChainId = string;

/**
 * Wallet material the CLI gateway injects into package runtime init.
 * Never serialized on the browser leg — gateway adds this server-side when forwarding calls.
 */
export interface SessionWallet {
  /** Which chain this session wallet targets. */
  readonly chain: Caip2ChainId;
  /** Decrypted seed bytes — gateway memory only. */
  readonly seed: string | Uint8Array;
  /** Chain-specific wallet init (AA config for EVM, rpc for Sui). */
  readonly walletInit: WalletInit;
  /** Operator address derived from seed (Safe on EVM). */
  readonly operatorAddress: string;
}

/** Per-package runtime bootstrap the gateway passes when opening a remote session fork. */
export interface PackageRuntimeInit {
  readonly package: "observe" | "options" | "bookmaker" | "steward";
  readonly chain: Caip2ChainId;
  /** Deployment contract addresses for this chain (package-specific slice). */
  readonly contracts: Readonly<Record<string, string>>;
  readonly wallet: SessionWallet;
  readonly hostUrl: string;
  /** Observe-only session fields. */
  readonly title?: string;
  readonly runId?: string;
}
