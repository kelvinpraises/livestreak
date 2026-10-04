import type { Kysely } from "kysely";
import type { ChainTag, DB } from "./schema.js";
import type { Market, Resolution, Vault } from "./models.js";
import type { MarketRows } from "../../services/catalog/mapper.js";

// The discovery read-model repository: the ONLY writer is the indexer (`syncMarket`), and
// the page endpoints read through the typed query helpers. All upserts are idempotent so a
// re-index is safe; vault rows for a market are replaced wholesale so a vault that
// disappeared on-chain does not linger in the projection.

export interface LiveVaultRow {
  readonly vault: Vault;
  readonly streamTitle: string;
}

export interface LifetimeRow {
  readonly resolution: Resolution;
  readonly question: string;
  readonly streamTitle: string;
}

export interface ProtocolStatsRow {
  readonly totalVaults: number;
  readonly totalVolume: number;
  readonly activeStreams: number;
}

// Discovery reads accept an optional `chain` filter (the per-chain router): omit it for the
// cross-chain aggregate (back-compat), or pass "evm"/"sui" to scope to the UI's selected chain.
export interface CatalogRepository {
  snapshot(chain?: ChainTag): Promise<{ markets: readonly Market[]; vaults: readonly Vault[]; resolutions: readonly Resolution[] }>;
  syncMarket(rows: MarketRows): Promise<void>;
  allMarkets(chain?: ChainTag): Promise<readonly Market[]>;
  marketByRoute(routeId: string, chain?: ChainTag): Promise<Market | undefined>;
  liveVaults(chain?: ChainTag): Promise<readonly LiveVaultRow[]>;
  lifetimeVaults(chain?: ChainTag): Promise<readonly LifetimeRow[]>;
  protocolStats(chain?: ChainTag): Promise<ProtocolStatsRow>;
  /** Wipe the whole discovery projection — used on a dev reset when local chains are wiped. */
  clearAll(): Promise<void>;
}

export const createCatalogRepository = (db: Kysely<DB>): CatalogRepository => {
  const syncMarket = async (rows: MarketRows): Promise<void> => {
    const { id } = rows.market;
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto("markets")
        .values(rows.market)
        .onConflict((oc) => oc.columns(["chain", "id"]).doUpdateSet(rows.market))
        .execute();

      // Replace this market's vault projection wholesale.
      await tx.deleteFrom("vaults").where("market_id", "=", id).where("chain", "=", rows.market.chain).execute();
      if (rows.vaults.length > 0) {
        await tx.insertInto("vaults").values([...rows.vaults]).execute();
      }

      await tx.deleteFrom("resolutions").where("market_id", "=", id).where("chain", "=", rows.market.chain).execute();
      for (const r of rows.resolutions) {
        await tx
          .insertInto("resolutions")
          .values(r)
          .execute();
      }
    });
  };

  const allMarkets = async (chain?: ChainTag): Promise<readonly Market[]> => {
    let q = db.selectFrom("markets");
    if (chain !== undefined) q = q.where("chain", "=", chain);
    return q.selectAll().orderBy("updated_at", "desc").execute();
  };

  const marketByRoute = async (routeId: string, chain?: ChainTag): Promise<Market | undefined> => {
    let query = db.selectFrom('markets').selectAll().where('route_id', '=', routeId);
    if (chain !== undefined) query = query.where('chain', '=', chain);
    const rows = await query.execute();
    if (rows.length > 1) throw new Error('ambiguous_stream_chain');
    return rows[0];
  };

  const snapshot = async (chain?: ChainTag) => db.transaction().execute(async tx => {
    let mq = tx.selectFrom('markets').selectAll();
    let vq = tx.selectFrom('vaults').selectAll();
    let rq = tx.selectFrom('resolutions').selectAll();
    if (chain !== undefined) { mq = mq.where('chain', '=', chain); vq = vq.where('chain', '=', chain); rq = rq.where('chain', '=', chain); }
    // Sequential within one read transaction: never interleave pieces of a refresh.
    return { markets: await mq.orderBy('updated_at', 'desc').execute(), vaults: await vq.execute(), resolutions: await rq.execute() };
  });

  const liveVaults = async (chain?: ChainTag): Promise<readonly LiveVaultRow[]> => {
    let q = db
      .selectFrom("vaults")
      .innerJoin("markets", join => join.onRef("markets.id", "=", "vaults.market_id").onRef("markets.chain", "=", "vaults.chain"))
      .where("vaults.status", "in", ["open", "hot"]);
    if (chain !== undefined) q = q.where("vaults.chain", "=", chain);
    const rows = await q
      .orderBy("vaults.expires_at_ms", "asc")
      .selectAll("vaults")
      .select("markets.title as stream_title")
      .execute();
    return rows.map(({ stream_title, ...vault }) => ({
      vault: vault as Vault,
      streamTitle: stream_title
    }));
  };

  const lifetimeVaults = async (chain?: ChainTag): Promise<readonly LifetimeRow[]> => {
    let q = db
      .selectFrom("resolutions")
      .innerJoin("vaults", join => join.onRef("vaults.id", "=", "resolutions.vault_id").onRef("vaults.chain", "=", "resolutions.chain"))
      .innerJoin("markets", join => join.onRef("markets.id", "=", "resolutions.market_id").onRef("markets.chain", "=", "resolutions.chain"));
    if (chain !== undefined) q = q.where("resolutions.chain", "=", chain);
    const rows = await q
      .orderBy("resolutions.resolved_at", "desc")
      .selectAll("resolutions")
      .select(["vaults.question as question", "markets.title as stream_title"])
      .execute();
    return rows.map(({ question, stream_title, ...resolution }) => ({
      resolution: resolution as Resolution,
      question,
      streamTitle: stream_title
    }));
  };

  const protocolStats = async (chain?: ChainTag): Promise<ProtocolStatsRow> => {
    let vq = db.selectFrom("vaults");
    if (chain !== undefined) vq = vq.where("chain", "=", chain);
    const vaultCount = await vq.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst();
    let volq = db.selectFrom("markets");
    if (chain !== undefined) volq = volq.where("chain", "=", chain);
    const volume = await volq.select((eb) => eb.fn.sum<number>("total_pooled").as("v")).executeTakeFirst();
    let lq = db.selectFrom("markets").where("is_live", "=", 1);
    if (chain !== undefined) lq = lq.where("chain", "=", chain);
    const live = await lq.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst();
    return {
      totalVaults: Number(vaultCount?.n ?? 0),
      totalVolume: Math.round(Number(volume?.v ?? 0) * 100) / 100,
      activeStreams: Number(live?.n ?? 0)
    };
  };

  // Stale rows from a previous boot outlive a local-chain wipe (anvil/sui localnet reset on each dev
  // run), so the projection would show vaults that no longer exist on-chain. Clearing on a dev reset
  // lets the indexer rebuild from the fresh chain state. Order respects FK direction.
  const clearAll = async (): Promise<void> => {
    await db.transaction().execute(async (tx) => {
      await tx.deleteFrom("resolutions").execute();
      await tx.deleteFrom("vaults").execute();
      await tx.deleteFrom("markets").execute();
    });
  };

  return {
    snapshot,
    syncMarket,
    allMarkets,
    marketByRoute,
    liveVaults,
    lifetimeVaults,
    protocolStats,
    clearAll
  };
};
