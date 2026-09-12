import type { CatalogMarketRef, CatalogReaderProvider } from "../../services/catalog/catalog.js";
import { readMarketGraph } from "../../services/catalog/readers.js";
import { snapshotToRows } from "../../services/catalog/mapper.js";
import type { CatalogRepository } from "../database/repository.js";

// The indexer: reads the known (chain, marketId) set off BOTH chains and upserts the DB
// projection. It is both the cron job body (`syncAll`) and the lazy path (`ensureMarket` /
// `ensureFresh`) the page endpoints call before serving. Per-market/per-vault failures are
// caught so one bad read never blanks the cache.

export interface CatalogIndexerConfig {
  readonly repo: CatalogRepository;
  readonly readers: CatalogReaderProvider;
  readonly baseUrl: string;
  // The (chain, marketId) set to index — registrations U discovery U env seed.
  readonly knownMarkets: () => readonly CatalogMarketRef[];
  readonly now?: () => number;
  // A market whose row is older than this is re-indexed on the lazy path. Default 15s.
  readonly stalenessMs?: number;
}

export interface CatalogIndexer {
  syncAll(): Promise<{ indexed: number; failed: number }>;
  syncMarket(ref: CatalogMarketRef): Promise<boolean>;
  // Lazy homepage path: index any known market that is missing or stale, leaving fresh
  // ones untouched. Cheap when the cron already warmed the cache.
  ensureAll(): Promise<void>;
  // Lazy: ensure a single route is present + fresh; indexes on demand. Returns false when
  // the route is unknown (caller 404s).
  ensureFresh(routeId: string): Promise<boolean>;
}

export const createCatalogIndexer = (config: CatalogIndexerConfig): CatalogIndexer => {
  const now = config.now ?? (() => Date.now());
  const stalenessMs = config.stalenessMs ?? 15_000;

  const syncMarket = async (ref: CatalogMarketRef): Promise<boolean> => {
    const reader = config.readers.reader(ref.chain);
    if (reader === null) return false;
    try {
      const graph = await readMarketGraph(reader, ref.marketId);
      await config.repo.syncMarket(
        snapshotToRows(ref.chain, graph.snap, now(), config.baseUrl, graph.vaultSnapshots)
      );
      return true;
    } catch (error) {
      console.warn(`[catalog-sync]: skip ${ref.chain}:${ref.marketId} — ${String(error)}`);
      return false;
    }
  };

  // The full (chain, marketId) set to index = explicit/discovery registrations UNION every market
  // enumerated live off each chain's on-chain registry (EVM: marketCount + marketIdAt). The
  // enumeration is why an observe-registered market shows on the homepage without anyone calling
  // /discovery — the host reads the registry directly. A chain whose reader can't enumerate (Sui)
  // simply contributes nothing here and still surfaces via the discovery store.
  const resolveMarkets = async (): Promise<readonly CatalogMarketRef[]> => {
    const out = new Map<string, CatalogMarketRef>();
    for (const ref of config.knownMarkets()) {
      out.set(`${ref.chain}:${ref.marketId}`, ref);
    }
    await Promise.all(
      config.readers.availableChains.map(async (chain) => {
        const reader = config.readers.reader(chain);
        if (reader?.listMarketIds === undefined) return;
        try {
          for (const marketId of await reader.listMarketIds()) {
            const ref: CatalogMarketRef = { chain, marketId: String(marketId) };
            out.set(`${chain}:${ref.marketId}`, ref);
          }
        } catch (error) {
          console.warn(`[catalog-sync]: enumerate ${chain} markets failed — ${String(error)}`);
        }
      })
    );
    return [...out.values()];
  };

  const syncAll = async (): Promise<{ indexed: number; failed: number }> => {
    const results = await Promise.all((await resolveMarkets()).map(syncMarket));
    const indexed = results.filter(Boolean).length;
    return { indexed, failed: results.length - indexed };
  };

  const ensureFresh = async (routeId: string): Promise<boolean> => {
    const ref = (await resolveMarkets()).find((r) => r.marketId === routeId);
    if (ref === undefined) {
      // Unknown to the registry but may already be cached from a prior boot — serve if so.
      return (await config.repo.marketByRoute(routeId)) !== undefined;
    }
    const existing = await config.repo.marketByRoute(routeId);
    if (existing !== undefined && now() - existing.updated_at < stalenessMs) {
      return true;
    }
    const ok = await syncMarket(ref);
    return ok || existing !== undefined;
  };

  const ensureAll = async (): Promise<void> => {
    const markets = await config.repo.allMarkets();
    const freshAt = new Map(markets.map((m) => [m.route_id, m.updated_at]));
    const nowMs = now();
    await Promise.all(
      (await resolveMarkets()).map(async (ref) => {
        const at = freshAt.get(ref.marketId);
        if (at === undefined || nowMs - at >= stalenessMs) {
          await syncMarket(ref);
        }
      })
    );
  };

  return { syncAll, syncMarket, ensureAll, ensureFresh };
};
