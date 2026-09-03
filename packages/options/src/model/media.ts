// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { PointerScheme } from "@livestreak/host";

export type OptionsStreamStatus = "none" | "live" | "ended";

export interface OptionsStreamState {
  readonly status: OptionsStreamStatus;
  readonly scheme: PointerScheme;
  readonly id: string;
  readonly updatedAtMs: number;
  readonly endedAtMs: number;
}

export interface OptionsStreamMedia {
  readonly status: OptionsStreamStatus;
  readonly vodUrl?: string;
}

export type OptionsMediaResolver = (id: string) => string;

export type OptionsMediaResolvers = Record<PointerScheme, OptionsMediaResolver>;

export const WALRUS_TESTNET_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

export const WALRUS_MAINNET_AGGREGATOR = "https://aggregator.walrus-mainnet.walrus.space";

export const walrusAggregatorResolver = (base: string): OptionsMediaResolver => (id) =>
  `${base}/v1/blobs/${id}`;

const unconfiguredResolver = (scheme: PointerScheme): OptionsMediaResolver => () => {
  throw new LiveStreakConfigError({
    message: `${scheme} resolver not configured — Walrus only in v0; inject a resolver to enable`,
    metadata: { details: scheme }
  });
};

export const DEFAULT_MEDIA_RESOLVERS: OptionsMediaResolvers = {
  "walrus-testnet": walrusAggregatorResolver(WALRUS_TESTNET_AGGREGATOR),
  "walrus-mainnet": walrusAggregatorResolver(WALRUS_MAINNET_AGGREGATOR),
  ipfs: unconfiguredResolver("ipfs"),
  arweave: unconfiguredResolver("arweave")
};

export const resolveStreamMedia = (
  state: OptionsStreamState,
  resolvers?: Partial<OptionsMediaResolvers>
): OptionsStreamMedia => {
  if (state.status === "live") {
    return { status: "live" };
  }

  if (state.status === "none") {
    return { status: "none" };
  }

  const registry = mergeMediaResolvers(resolvers);
  const resolver = registry[state.scheme];

  if (resolver === undefined) {
    throw new LiveStreakConfigError({
      message: "No media resolver configured for stream scheme",
      metadata: { details: state.scheme }
    });
  }

  return {
    status: "ended",
    vodUrl: resolver(state.id)
  };
};

// --- helpers ---

const mergeMediaResolvers = (
  overrides?: Partial<OptionsMediaResolvers>
): OptionsMediaResolvers => ({
  ...DEFAULT_MEDIA_RESOLVERS,
  ...overrides
});
