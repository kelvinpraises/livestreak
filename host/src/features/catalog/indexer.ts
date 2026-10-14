import type { Kysely } from "kysely";
import type { DB } from "../../database/schema.js";
import { deploymentScopeWhere } from "../../database/schema.js";
import {
  enumerateMarkets,
  type CatalogMarketRef,
  type CatalogReaderProvider,
} from "./catalog.js";
import { readWithDeadline } from "./deadline.js";
import { snapshotToRows } from "./mapper.js";
import { readMarketGraph } from "./readers.js";

// Reads configured chain registries and atomically replaces each complete market graph.
// It is both the cron job body (`syncAll`) and the lazy path (`ensureAll` /
// `ensureFresh`) the page endpoints call before serving. Per-market/per-vault failures are
// caught so one bad read never blanks the cache.

export interface CatalogIndexerConfig {
  readonly db: Kysely<DB>;
  readonly readers: CatalogReaderProvider;
  readonly baseUrl: string;
  // The (chain, marketId) set to index — registrations U discovery U env seed.
  readonly knownMarkets: () => readonly CatalogMarketRef[];
  // Signaling-plane liveness (live ring ingest / direct-lane announce); see mapMarket.
  readonly isStreamLive?: (marketId: string) => boolean;
  readonly now?: () => number;
  // A market whose row is older than this is re-indexed on the lazy path. Default 15s.
  readonly stalenessMs?: number;
  readonly readTimeoutMs?: number;
}

export interface CatalogIndexer {
  syncAll(): Promise<{ indexed: number; failed: number }>;
  syncMarket(ref: CatalogMarketRef): Promise<boolean>;
  // Lazy homepage path: index any known market that is missing or stale, leaving fresh
  // ones untouched. Cheap when the cron already warmed the cache.
  ensureAll(): Promise<void>;
  // Lazy: ensure a single route is present + fresh; indexes on demand. Returns false when
  // the route is unknown (caller 404s).
  ensureFresh(routeId: string, chain?: CatalogMarketRef["chain"]): Promise<boolean>;
  health(): {
    availableChains: readonly CatalogMarketRef["chain"][];
    failedChains: readonly CatalogMarketRef["chain"][];
    failedMarkets: number;
    failedMarketKeys: readonly string[];
  };
}

export const createCatalogIndexer = (config: CatalogIndexerConfig): CatalogIndexer => {
  const now = config.now ?? (() => Date.now());
  const stalenessMs = config.stalenessMs ?? 15_000;
  const readTimeoutMs = config.readTimeoutMs ?? 30000;

  const inFlight = new Map<string, Promise<boolean>>();
  const failed = new Set<string>();
  let failedChains: CatalogMarketRef["chain"][] = [];
  const key = (ref: CatalogMarketRef) => `${ref.chain}:${ref.marketId}`;
  const scoped = deploymentScopeWhere(config.readers.deploymentScopes);
  const readAndSync = async (ref: CatalogMarketRef): Promise<boolean> => {
    const reader = config.readers.reader(ref.chain);
    if (reader === null) {
      failed.add(key(ref));
      return false;
    }
    try {
      const graph = await readWithDeadline(
        readMarketGraph(reader, ref.marketId),
        readTimeoutMs,
      );
      const rows = snapshotToRows(
        ref.chain,
        graph.snap,
        now(),
        config.baseUrl,
        graph.vaultSnapshots,
        config.isStreamLive?.(ref.marketId),
      );
      const deploymentScope = config.readers.deploymentScopes?.[ref.chain] ?? '';
      const market = { ...rows.market, deployment_scope: deploymentScope };
      await config.db.transaction().execute(async (tx) => {
        await tx
          .insertInto("markets")
          .values(market)
          .onConflict((oc) => oc.columns(["deployment_scope", "chain", "id"]).doUpdateSet(market))
          .execute();
        await tx
          .deleteFrom("vaults")
          .where("deployment_scope", "=", deploymentScope)
          .where("chain", "=", ref.chain)
          .where("market_id", "=", rows.market.id)
          .execute();
        if (rows.vaults.length)
          await tx
            .insertInto("vaults")
            .values(rows.vaults.map(row => ({ ...row, deployment_scope: deploymentScope })))
            .execute();
        await tx
          .deleteFrom("resolutions")
          .where("deployment_scope", "=", deploymentScope)
          .where("chain", "=", ref.chain)
          .where("market_id", "=", rows.market.id)
          .execute();
        if (rows.resolutions.length)
          await tx
            .insertInto("resolutions")
            .values(rows.resolutions.map(row => ({ ...row, deployment_scope: deploymentScope })))
            .execute();
      });
      failed.delete(key(ref));
      return true;
    } catch (error) {
      failed.add(key(ref));
      console.warn(`[catalog-sync]: skip ${ref.chain}:${ref.marketId} — ${String(error)}`);
      return false;
    }
  };

  const syncMarket = (ref: CatalogMarketRef): Promise<boolean> => {
    const id = key(ref);
    const pending = inFlight.get(id);
    if (pending) return pending;
    const work = readAndSync(ref).finally(() => inFlight.delete(id));
    inFlight.set(id, work);
    return work;
  };

  // The full (chain, marketId) set to index = explicit/discovery registrations UNION every market
  // enumerated live off each chain's on-chain registry (EVM: marketCount + marketIdAt). The
  // enumeration is why an observe-registered market shows on the homepage without anyone calling
  // /discovery. Enumeration failures expose incomplete coverage, while known graphs can
  // still refresh independently. Disabled-chain seeds/cache do not enter the scope.
  let enumeration: Promise<readonly CatalogMarketRef[]> | undefined;
  const resolveMarkets = (): Promise<readonly CatalogMarketRef[]> => {
    if (enumeration) return enumeration;
    const errors: CatalogMarketRef["chain"][] = [];
    enumeration = config.db
      .selectFrom("markets")
      .selectAll()
      .where(scoped)
      .orderBy("updated_at", "desc")
      .execute()
      .then((cached) =>
        enumerateMarkets(
          config.readers,
          [
            ...config.knownMarkets(),
            ...cached.map((row) => ({ chain: row.chain, marketId: row.id })),
          ],
          (chain) => errors.push(chain),
          readTimeoutMs,
        ),
      )
      .then((refs) => {
        failedChains = errors;
        return refs;
      })
      .finally(() => {
        enumeration = undefined;
      });
    return enumeration;
  };

  const syncAll = async (): Promise<{ indexed: number; failed: number }> => {
    const results = await Promise.all((await resolveMarkets()).map(syncMarket));
    const indexed = results.filter(Boolean).length;
    return { indexed, failed: results.length - indexed };
  };

  const ensureFresh = async (
    routeId: string,
    chain?: CatalogMarketRef["chain"],
  ): Promise<boolean> => {
    const refs = (await resolveMarkets()).filter(
      (r) => r.marketId === routeId && (chain === undefined || chain === r.chain),
    );
    if (refs.length > 1) throw new Error("ambiguous_stream_chain");
    const ref = refs[0];
    if (ref === undefined) {
      // Unknown to the registry but may already be cached from a prior boot — serve if so.
      return (
        await config.db
          .selectFrom("markets")
          .selectAll()
          .where(scoped)
          .where("route_id", "=", routeId)
          .execute()
      ).some(
        (m) =>
          (chain === undefined || m.chain === chain) &&
          config.readers.availableChains.includes(m.chain),
      );
    }
    const existing = await config.db
      .selectFrom("markets")
      .selectAll()
      .where(scoped)
      .where("route_id", "=", routeId)
      .where("chain", "=", ref.chain)
      .executeTakeFirst();
    if (
      existing !== undefined &&
      !failed.has(key(ref)) &&
      now() - existing.updated_at < stalenessMs
    ) {
      return true;
    }
    const ok = await syncMarket(ref);
    return ok || existing !== undefined;
  };

  const ensureAll = async (): Promise<void> => {
    const markets = await config.db.selectFrom("markets").selectAll().where(scoped).execute();
    const freshAt = new Map(markets.map((m) => [`${m.chain}:${m.id}`, m.updated_at]));
    const nowMs = now();
    await Promise.all(
      (await resolveMarkets()).map(async (ref) => {
        const at = freshAt.get(key(ref));
        if (at === undefined || failed.has(key(ref)) || nowMs - at >= stalenessMs) {
          await syncMarket(ref);
        }
      }),
    );
  };

  return {
    syncAll,
    syncMarket,
    ensureAll,
    ensureFresh,
    health: () => ({
      availableChains: config.readers.availableChains,
      failedChains,
      failedMarkets: failed.size,
      failedMarketKeys: [...failed],
    }),
  };
};
