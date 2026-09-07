import { asMarketId, readMarketSnapshot, type OptionsReader } from "@livestreak/options";
import { mapMarket, type MappedMarket } from "./mapper.js";
import type {
  CatalogChain,
  HomepageAggregate,
  HostCatalog,
  HostFullCatalog,
  HostStreamDetail
} from "./types.js";

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
  readonly baseUrl: string;
  // Chain a discovery-store marketId (which carries no chain tag) is attributed to.
  readonly defaultChain?: CatalogChain;
  // Marketds the host already knows about from the discovery similarity index. Read each
  // request so freshly-indexed vaults appear without a restart.
  readonly listDiscoveryMarketIds?: () => readonly string[];
  // Explicit (chain, marketId) seeds, e.g. from LIVESTREAK_CATALOG_MARKETS.
  readonly seedMarkets?: readonly CatalogMarketRef[];
  readonly now?: () => number;
}

export interface CatalogService {
  registerMarket(ref: CatalogMarketRef): void;
  knownMarkets(): readonly CatalogMarketRef[];
  buildCatalog(): Promise<HostCatalog>;
  buildFull(): Promise<HostFullCatalog>;
  buildStream(routeId: string): Promise<HostStreamDetail | null>;
}

const refKey = (ref: CatalogMarketRef): string => `${ref.chain}:${ref.marketId}`;

export const createCatalogService = (config: CatalogServiceConfig): CatalogService => {
  const now = config.now ?? (() => Date.now());
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

  // Read + map every known market live. Per-market failures are logged and skipped so one
  // bad market (or a not-yet-deployed chain) never blanks the whole catalog.
  const collect = async (): Promise<MappedMarket[]> => {
    const nowMs = now();
    const mapped: MappedMarket[] = [];
    await Promise.all(
      knownMarkets().map(async (ref) => {
        const reader = config.readers.reader(ref.chain);
        if (reader === null) return;
        try {
          const snap = await readMarketSnapshot(reader, asMarketId(ref.marketId));
          mapped.push(mapMarket(ref.chain, snap, nowMs, config.baseUrl));
        } catch (error) {
          console.warn(
            `[catalog]: skip ${ref.chain}:${ref.marketId} — ${String(error)}`
          );
        }
      })
    );
    return mapped;
  };

  const aggregateHomepage = (mapped: readonly MappedMarket[]): HomepageAggregate => {
    const liveVaults = mapped.flatMap((m) => m.liveVaults);
    const lifetimeVaults = [...mapped.flatMap((m) => m.lifetimeVaults)].sort(
      (a, b) => a.resolvedAgoMs - b.resolvedAgoMs
    );
    const totalVaults = mapped.reduce((sum, m) => sum + m.vaultCount, 0);
    const totalVolume =
      Math.round(mapped.reduce((sum, m) => sum + m.totalVolume, 0) * 100) / 100;
    const activeStreams = mapped.filter((m) => m.stream.isLive).length;
    return {
      liveVaults,
      lifetimeVaults,
      protocolStats: { totalVaults, totalVolume, activeStreams }
    };
  };

  const buildFull = async (): Promise<HostFullCatalog> => {
    const mapped = await collect();
    const streams: Record<string, HostStreamDetail> = {};
    for (const m of mapped) {
      streams[m.detail.routeId] = m.detail;
    }
    return {
      catalog: { streams: mapped.map((m) => m.stream) },
      streams,
      homepage: aggregateHomepage(mapped)
    };
  };

  return {
    registerMarket,
    knownMarkets,
    buildCatalog: async () => ({ streams: (await collect()).map((m) => m.stream) }),
    buildFull,
    buildStream: async (routeId) => {
      const full = await buildFull();
      return full.streams[routeId] ?? null;
    }
  };
};
