import type { Kysely } from "kysely";
import type { DB } from "./schema.js";
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

export interface CatalogRepository {
  syncMarket(rows: MarketRows): Promise<void>;
  allMarkets(): Promise<readonly Market[]>;
  marketByRoute(routeId: string): Promise<Market | undefined>;
  liveVaults(): Promise<readonly LiveVaultRow[]>;
  lifetimeVaults(): Promise<readonly LifetimeRow[]>;
  protocolStats(): Promise<ProtocolStatsRow>;
}

export const createCatalogRepository = (db: Kysely<DB>): CatalogRepository => {
  const syncMarket = async (rows: MarketRows): Promise<void> => {
    const { id } = rows.market;
    await db.transaction().execute(async (tx) => {
      const { id: _omit, ...marketUpdate } = rows.market;
      await tx
        .insertInto("markets")
        .values(rows.market)
        .onConflict((oc) => oc.column("id").doUpdateSet(marketUpdate))
        .execute();

      // Replace this market's vault projection wholesale.
      await tx.deleteFrom("vaults").where("market_id", "=", id).execute();
      if (rows.vaults.length > 0) {
        await tx.insertInto("vaults").values([...rows.vaults]).execute();
      }

      for (const r of rows.resolutions) {
        const { vault_id: _vid, ...resUpdate } = r;
        await tx
          .insertInto("resolutions")
          .values(r)
          .onConflict((oc) => oc.column("vault_id").doUpdateSet(resUpdate))
          .execute();
      }
    });
  };

  const allMarkets = async (): Promise<readonly Market[]> =>
    db.selectFrom("markets").selectAll().orderBy("updated_at", "desc").execute();

  const marketByRoute = async (routeId: string): Promise<Market | undefined> =>
    db
      .selectFrom("markets")
      .selectAll()
      .where("route_id", "=", routeId)
      .executeTakeFirst();

  const liveVaults = async (): Promise<readonly LiveVaultRow[]> => {
    const rows = await db
      .selectFrom("vaults")
      .innerJoin("markets", "markets.id", "vaults.market_id")
      .where("vaults.status", "in", ["open", "hot"])
      .orderBy("vaults.expires_at_ms", "asc")
      .selectAll("vaults")
      .select("markets.title as stream_title")
      .execute();
    return rows.map(({ stream_title, ...vault }) => ({
      vault: vault as Vault,
      streamTitle: stream_title
    }));
  };

  const lifetimeVaults = async (): Promise<readonly LifetimeRow[]> => {
    const rows = await db
      .selectFrom("resolutions")
      .innerJoin("vaults", "vaults.id", "resolutions.vault_id")
      .innerJoin("markets", "markets.id", "resolutions.market_id")
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

  const protocolStats = async (): Promise<ProtocolStatsRow> => {
    const vaultCount = await db
      .selectFrom("vaults")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirst();
    const volume = await db
      .selectFrom("markets")
      .select((eb) => eb.fn.sum<number>("total_pooled").as("v"))
      .executeTakeFirst();
    const live = await db
      .selectFrom("markets")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("is_live", "=", 1)
      .executeTakeFirst();
    return {
      totalVaults: Number(vaultCount?.n ?? 0),
      totalVolume: Math.round(Number(volume?.v ?? 0) * 100) / 100,
      activeStreams: Number(live?.n ?? 0)
    };
  };

  return {
    syncMarket,
    allMarkets,
    marketByRoute,
    liveVaults,
    lifetimeVaults,
    protocolStats
  };
};
