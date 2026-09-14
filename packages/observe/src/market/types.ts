import type { WalletInit } from "@livestreak/schema";

export type MarketLifecycleStatus =
  | "none"
  | "pending"
  | "registered"
  | "live"
  | "ended"
  | "failed";

/**
 * On-chain StorageScheme enum, byte-identical across EVM (`StorageScheme`) and
 * Sui (`SCHEME_*`): 0=WalrusTestnet, 1=WalrusMainnet, 2=Ipfs, 3=Arweave. observe
 * accepts the NUMERIC scheme — the host's `PointerScheme` → number mapping stays
 * at the CLI edge (observe never imports `@livestreak/host`).
 */
export type MarketStorageScheme = 0 | 1 | 2 | 3;

export type MarketFailurePhase =
  | "validation"
  | "send"
  | "receipt"
  | "paymaster"
  | "unsupported";

export interface MarketLifecycleNone {
  readonly status: "none";
}

export interface MarketLifecyclePending {
  readonly status: "pending";
  readonly startedAtMs: number;
}

export interface MarketLifecycleRegistered {
  readonly status: "registered";
  readonly marketId: string;
  readonly streamId: string;
  readonly userOpHash: string;
  readonly registeredAtMs: number;
}

export interface MarketLifecycleLive {
  readonly status: "live";
  readonly marketId: string;
  readonly scheme: MarketStorageScheme;
  readonly pointerId: string;
  readonly userOpHash: string;
  readonly liveAtMs: number;
}

export interface MarketLifecycleEnded {
  readonly status: "ended";
  readonly marketId: string;
  readonly scheme: MarketStorageScheme;
  readonly pointerId: string;
  readonly userOpHash: string;
  readonly endedAtMs: number;
}

export interface MarketLifecycleFailed {
  readonly status: "failed";
  readonly reason: string;
  readonly phase: MarketFailurePhase;
  readonly failedAtMs: number;
}

export type MarketLifecycleState =
  | MarketLifecycleNone
  | MarketLifecyclePending
  | MarketLifecycleRegistered
  | MarketLifecycleLive
  | MarketLifecycleEnded
  | MarketLifecycleFailed;

export type StreamId = `0x${string}`;
export type EvmAddress = `0x${string}`;

/**
 * Deployed Sui MarketRegistry coordinates. These are resolved from
 * config/deployment (NOT hardcoded constants) — the multichain invariant. The
 * deployed shared-object id is a cross-package input (contracts/host deployment).
 */
export interface SuiMarketRegistryConfig {
  readonly packageId: string;
  readonly marketRegistryObjectId: string;
}

export interface ObserveRunMarketConfig {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly marketRegistryAddress: EvmAddress;
  readonly title: string;
  /** Required only for Sui runs; resolved from deployment, never a constant. */
  readonly suiRegistry?: SuiMarketRegistryConfig;
}

export interface ObserveRunMarketOptions {
  readonly registration: ObserveRunMarketConfig;
  readonly registrar?: MarketRegistrar;
}

export interface MarketRegisterInput {
  readonly runId: string;
  readonly title: string;
}

export interface MarketRegisterResult {
  readonly userOpHash: string;
  readonly marketId: StreamId;
  readonly streamId: StreamId;
  readonly title: string;
  /**
   * True when the market already existed on-chain, so no transaction was sent
   * (userOpHash is the zero sentinel). Consumers should prefer this flag over
   * comparing the hash against 0x0…0.
   */
  readonly alreadyRegistered?: boolean;
}

/** Input to goLive/setEnded: the marketId plus the storage pointer (scheme + id). */
export interface MarketLifecycleInput {
  readonly marketId: StreamId;
  readonly scheme: MarketStorageScheme;
  readonly id: string;
}

export interface MarketLifecycleTxResult {
  readonly userOpHash: string;
}

export interface MarketRegistrar {
  readonly registerMarket: (
    input: MarketRegisterInput
  ) => import("effect").Effect.Effect<MarketRegisterResult, import("@livestreak/core").LiveStreakError>;
  /** Submit the goLive transition (creator-gated). observe owns this on-chain write. */
  readonly goLive: (
    input: MarketLifecycleInput
  ) => import("effect").Effect.Effect<
    MarketLifecycleTxResult,
    import("@livestreak/core").LiveStreakError
  >;
  /** Submit the setEnded transition (creator-gated). */
  readonly setEnded: (
    input: MarketLifecycleInput
  ) => import("effect").Effect.Effect<
    MarketLifecycleTxResult,
    import("@livestreak/core").LiveStreakError
  >;
}
