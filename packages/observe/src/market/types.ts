import type { WalletInit } from "@livestreak/schema";

export type MarketLifecycleStatus = "none" | "pending" | "registered" | "failed";

export type MarketFailurePhase =
  | "validation"
  | "send"
  | "receipt"
  | "verify"
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
  | MarketLifecycleFailed;

export type StreamId = `0x${string}`;
export type EvmAddress = `0x${string}`;

export interface ObserveRunMarketConfig {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly marketRegistryAddress: EvmAddress;
  readonly title: string;
  readonly deriveStreamId: (runId: string) => StreamId;
}

export interface ObserveRunMarketOptions {
  readonly registration: ObserveRunMarketConfig;
  readonly registrar?: MarketRegistrar;
}

export interface MarketRegisterInput {
  readonly runId: string;
  readonly title: string;
  readonly streamId: StreamId;
}

export interface MarketRegisterResult {
  readonly userOpHash: string;
  readonly sender: EvmAddress;
  readonly decoded: DecodedMarketRegistered;
}

export interface DecodedMarketRegistered {
  readonly marketId: StreamId;
  readonly streamId: StreamId;
  readonly title: string;
}

export interface VerifiedMarketRegistration {
  readonly marketId: StreamId;
  readonly streamId: StreamId;
  readonly title: string;
  readonly userOpHash: string;
  readonly sender: EvmAddress;
}

export interface MarketRegistrar {
  readonly registerMarket: (
    input: MarketRegisterInput
  ) => import("effect").Effect.Effect<MarketRegisterResult, import("@livestreak/core").LiveStreakError>;
}

/** Test-only streamId placeholder — NOT a canonical contracts formula. */
export const testPlaceholderDeriveStreamId = (runId: string): StreamId => {
  const hex = Buffer.from(runId, "utf8").toString("hex").padEnd(64, "0").slice(0, 64);
  return `0x${hex}` as StreamId;
};
