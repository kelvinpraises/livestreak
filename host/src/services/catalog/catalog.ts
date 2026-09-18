import { type OptionsReader } from "@livestreak/options";
import { mapMarket, type MappedMarket } from "./mapper.js";
import { readMarketGraph } from "./readers.js";
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
  // Signaling-plane liveness (live ring ingest / direct-lane announce) — a stream serving
  // bytes right now is live even before the on-chain goLive write lands.
  readonly isStreamLive?: (marketId: string) => boolean;
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

/** `seed` ∪ every market enumerable off each chain's on-chain registry. Shared by the live
 *  catalog service and the DB indexer so both self-heal from the chain after a restart. */
export const enumerateMarkets = async (
  readers: CatalogReaderProvider,
  seed: readonly CatalogMarketRef[]
): Promise<readonly CatalogMarketRef[]> => {
  const out = new Map<string, CatalogMarketRef>();
  for (const ref of seed) {
    out.set(refKey(ref), ref);
  }
  await Promise.all(
    readers.availableChains.map(async (chain) => {
      const reader = readers.reader(chain);
      if (reader?.listMarketIds === undefined) return;
      try {
        for (const marketId of await reader.listMarketIds()) {
          const ref: CatalogMarketRef = { chain, marketId: String(marketId) };
          if (!out.has(refKey(ref))) out.set(refKey(ref), ref);
        }
      } catch (error) {
        console.warn(`[catalog]: enumerate ${chain} markets failed — ${String(error)}`);
      }
    })
  );
  return [...out.values()];
};

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

  // Read + map every known market live (registrations ∪ on-chain enumeration — a restarted
  // host self-heals from the chain). Per-market failures are logged and skipped so one bad
  // market (or a not-yet-deployed chain) never blanks the whole catalog.
  const collect = async (): Promise<MappedMarket[]> => {
    const nowMs = now();
    const mapped: MappedMarket[] = [];
    await Promise.all(
      (await enumerateMarkets(config.readers, knownMarkets())).map(async (ref) => {
        const reader = config.readers.reader(ref.chain);
        if (reader === null) return;
        try {
          const graph = await readMarketGraph(reader, ref.marketId);
          mapped.push(
            mapMarket(
              ref.chain,
              graph.snap,
              nowMs,
              config.baseUrl,
              graph.vaultSnapshots,
              config.isStreamLive?.(ref.marketId)
            )
          );
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
