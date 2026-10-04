import { type OptionsReader } from "@livestreak/options";
import type { CatalogChain } from "./types.js";
import { readWithDeadline } from "./deadline.js";

// --- exports ---

export interface CatalogMarketRef {
  readonly chain: CatalogChain;
  readonly marketId: string;
}

// Lazily resolves a read-only options reader per chain. Returns null when a chain leg is
// not configured (e.g. the EVM-only dev stack has no Sui reader) so the catalog degrades
// gracefully instead of failing the whole request.
export interface CatalogReaderProvider {
  reader(chain: CatalogChain): OptionsReader | null;
  readonly availableChains: readonly CatalogChain[];
}

export interface CatalogServiceConfig {
  readonly readers: CatalogReaderProvider;
  // Chain a discovery-store marketId (which carries no chain tag) is attributed to.
  readonly defaultChain?: CatalogChain;
  // Markets the host already knows about from the discovery similarity index. Read each
  // request so freshly-indexed vaults appear without a restart.
  readonly listDiscoveryMarketIds?: () => readonly string[];
  // Explicit (chain, marketId) seeds, e.g. from LIVESTREAK_CATALOG_MARKETS.
  readonly seedMarkets?: readonly CatalogMarketRef[];
}

export interface CatalogService {
  registerMarket(ref: CatalogMarketRef): void;
  knownMarkets(): readonly CatalogMarketRef[];
}

const refKey = (ref: CatalogMarketRef): string => `${ref.chain}:${ref.marketId}`;

/** `seed` ∪ every market enumerable off each chain's on-chain registry. Shared by the live
 *  catalog service and the DB indexer so both self-heal from the chain after a restart. */
export const enumerateMarkets = async (
  readers: CatalogReaderProvider,
  seed: readonly CatalogMarketRef[],
  onEnumerationFailure?: (chain: CatalogChain) => void,
  timeoutMs = 8000,
): Promise<readonly CatalogMarketRef[]> => {
  const out = new Map<string, CatalogMarketRef>();
  for (const ref of seed) {
    if (readers.availableChains.includes(ref.chain)) out.set(refKey(ref), ref);
  }
  await Promise.all(
    readers.availableChains.map(async (chain) => {
      const reader = readers.reader(chain);
      if (reader?.listMarketIds === undefined) {
        onEnumerationFailure?.(chain);
        return;
      }
      try {
        for (const marketId of await readWithDeadline(reader.listMarketIds(), timeoutMs)) {
          const ref: CatalogMarketRef = { chain, marketId: String(marketId) };
          if (!out.has(refKey(ref))) out.set(refKey(ref), ref);
        }
      } catch (error) {
        onEnumerationFailure?.(chain);
        console.warn(`[catalog]: enumerate ${chain} markets failed — ${String(error)}`);
      }
    }),
  );
  return [...out.values()];
};

export const createCatalogService = (config: CatalogServiceConfig): CatalogService => {
  const defaultChain = config.defaultChain ?? "evm";
  const registry = new Map<string, CatalogMarketRef>();

  for (const ref of config.seedMarkets ?? []) {
    registry.set(refKey(ref), ref);
  }

  const registerMarket = (ref: CatalogMarketRef): void => {
    registry.set(refKey(ref), ref);
  };

  // Snapshot of every market the host knows about right now: explicit registrations +
  // discovery-store marketIds (attributed to the default chain, only if that leg is live).
  const knownMarkets = (): readonly CatalogMarketRef[] => {
    const out = new Map<string, CatalogMarketRef>(registry);
    if (
      config.listDiscoveryMarketIds !== undefined &&
      config.readers.reader(defaultChain) !== null
    ) {
      for (const marketId of config.listDiscoveryMarketIds()) {
        const ref: CatalogMarketRef = { chain: defaultChain, marketId };
        const key = refKey(ref);
        if (!out.has(key)) out.set(key, ref);
      }
    }
    return [...out.values()];
  };

  return { registerMarket, knownMarkets };
};
