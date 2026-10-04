import type { Agent, AgentsData, CatalogIndexing, HomepageData, HostStreamDetail } from "@livestreak/host";
import type { Kysely } from "kysely";
import type { ChainTag, DB, Market } from "../../database/schema.js";
import {
  marketRowToDetail,
  marketRowToSummary,
  resolutionRowToLifetime,
  vaultRowToLiveRaw,
} from "./mapper.js";
import { vaultPoolUsdc } from "./pools.js";

interface IndexHealth {
  readonly availableChains: readonly ChainTag[];
  readonly failedChains: readonly ChainTag[];
  readonly failedMarketKeys: readonly string[];
}
interface FullProjection {
  readonly catalog: { streams: HomepageData["streams"]; indexing: CatalogIndexing };
  readonly streams: Record<string, HostStreamDetail>;
  readonly homepage: HomepageData;
}
export interface CatalogReadModelConfig {
  readonly db: Kysely<DB>;
  readonly health?: () => IndexHealth;
  readonly now?: () => number;
  // Configuration is an agent directory, never measured performance.
  readonly agents?: readonly Agent[];
}
export interface CatalogReadModel {
  homepage(chain?: ChainTag): Promise<HomepageData>;
  full(chain?: ChainTag): Promise<FullProjection>;
  agents(): Promise<AgentsData>;
  stream(routeId: string, chain?: ChainTag): Promise<HostStreamDetail | null>;
}

const key = (chain: ChainTag, id: string) => `${chain}:${id}`;
const unsigned = (value: string): bigint => {
  if (!/^\d+$/u.test(value)) throw new Error("Invalid indexed pool amount");
  return BigInt(value);
};
const isStale = (row: Market, nowMs: number, health?: IndexHealth): boolean =>
  nowMs - row.updated_at > 45_000 ||
  row.updated_at > nowMs ||
  (health !== undefined &&
    (!health.availableChains.includes(row.chain) ||
      health.failedMarketKeys.includes(key(row.chain, row.id))));
const detail = (row: Market, at: number, health?: IndexHealth): HostStreamDetail => {
  const stale = isStale(row, at, health);
  return {
    ...marketRowToDetail(row),
    stale,
    isLive: !stale && row.status !== "ended" && row.is_live === 1,
  };
};

/** Replay requires a completed verified recording matching the chain's committed pointer. */
function recordingDetail(detail: HostStreamDetail, body?: string): HostStreamDetail {
  if (!body) return detail;
  try {
    const record = JSON.parse(body) as { chain: string; marketId: string; status: HostStreamDetail["recordingStatus"]; pointer?: { id: string; url: string }; durationSeconds: number };
    if (record.chain !== detail.chain || record.marketId !== detail.marketId || !["recording", "processing", "ready", "failed"].includes(record.status ?? "")) throw new Error("Invalid recording metadata");
    return { ...detail, recordingStatus: record.status,
      ...(!detail.stale && detail.streamStatus === "ended" && record.status === "ready" && record.pointer?.id === detail.replayPointerId && /^https?:\/\//.test(record.pointer?.url ?? "") && Number.isFinite(record.durationSeconds) && record.durationSeconds > 0
        ? { replay: { pointerId: record.pointer!.id, url: record.pointer!.url, format: "hls" as const, durationSeconds: record.durationSeconds } } : {}),
    };
  } catch { return { ...detail, recordingStatus: "failed" }; }
}

export const createCatalogReadModel = (
  config: CatalogReadModelConfig,
): CatalogReadModel => {
  const now = config.now ?? (() => Date.now());
  const agents = config.agents ?? [];
  const full = async (chain?: ChainTag): Promise<FullProjection> => {
    const nowMs = now();
    // All response sections originate in this one read transaction.
    const snapshot = await config.db.transaction().execute(async (tx) => {
      let mq = tx.selectFrom("markets").selectAll();
      let vq = tx.selectFrom("vaults").selectAll();
      let rq = tx.selectFrom("resolutions").selectAll();
      if (chain !== undefined) {
        mq = mq.where("chain", "=", chain);
        vq = vq.where("chain", "=", chain);
        rq = rq.where("chain", "=", chain);
      }
      return {
        markets: await mq.orderBy("updated_at", "desc").execute(),
        vaults: await vq.execute(),
        resolutions: await rq.execute(),
        recordings: await tx.selectFrom("recordings").selectAll().execute(),
      };
    });
    const health = config.health?.();
    // Disabled chains are historical cache, not part of this Host’s configured scope.
    const enabled = (tag: ChainTag) => !health || health.availableChains.includes(tag);
    const markets = snapshot.markets.filter((m) => enabled(m.chain));
    const vaults = snapshot.vaults.filter((v) => enabled(v.chain));
    const resolutions = snapshot.resolutions.filter((r) => enabled(r.chain));
    const availableChains = health?.availableChains.filter(
      (c) => !chain || c === chain,
    ) ?? [...new Set(markets.map((m) => m.chain))];
    const failedChains = health?.failedChains.filter((c) => !chain || c === chain) ?? [];
    const failedMarkets =
      health?.failedMarketKeys.filter((id) => !chain || id.startsWith(`${chain}:`))
        .length ?? 0;
    const byMarket = new Map(markets.map((m) => [key(m.chain, m.id), m]));
    const byVault = new Map(vaults.map((v) => [key(v.chain, v.id), v]));
    const staleMarkets = markets.filter((m) => isStale(m, nowMs, health)).length;
    const verifiedMarkets = markets.filter((m) => !isStale(m, nowMs, health));
    const verifiedMarketKeys = new Set(verifiedMarkets.map((m) => key(m.chain, m.id)));
    const verifiedVaults = vaults.filter((v) =>
      verifiedMarketKeys.has(key(v.chain, v.market_id)),
    );
    const chainStates = [
      ...new Set([...availableChains, ...markets.map((m) => m.chain)]),
    ].map((tag) => {
      const current = verifiedMarkets.filter((m) => m.chain === tag).length;
      const stale = markets.filter(
        (m) => m.chain === tag && isStale(m, nowMs, health),
      ).length;
      const failed =
        failedChains.includes(tag) ||
        (health?.failedMarketKeys.some((id) => id.startsWith(`${tag}:`)) ?? false);
      const complete = availableChains.includes(tag) && !failed && !stale;
      return {
        chain: tag,
        status: complete
          ? ("fresh" as const)
          : current
            ? ("partial" as const)
            : ("unavailable" as const),
        verifiedMarkets: current,
        staleMarkets: stale,
      };
    });
    const verifiedChains = chainStates
      .filter((c) => c.status === "fresh" || c.verifiedMarkets > 0)
      .map((c) => c.chain);
    const complete =
      availableChains.length > 0 && chainStates.every((c) => c.status === "fresh");
    const indexing: CatalogIndexing = {
      status: complete ? "fresh" : verifiedChains.length ? "partial" : "unavailable",
      generatedAtMs: nowMs,
      staleMarkets,
      failedMarkets,
      failedChains,
      availableChains,
      verifiedChains,
      statsScope: complete
        ? "complete"
        : verifiedChains.length
          ? "verified-subset"
          : "unavailable",
      chains: chainStates,
      ...(markets.length
        ? { oldestIndexedAtMs: Math.min(...markets.map((m) => m.updated_at)) }
        : {}),
    };
    const recordings = new Map(snapshot.recordings.map(row => [`${row.chain}:${row.market_id}`, row.body]));
    const withRecording = (m: Market) => recordingDetail(detail(m, nowMs, health), recordings.get(key(m.chain, m.id)));
    const streams = markets.map((m) => ({
      ...marketRowToSummary(m, nowMs),
      ...withRecording(m),
    }));
    const totals = new Map<string, { pooled: number; active: number }>();
    for (const vault of vaults) {
      const id = key(vault.chain, vault.market_id);
      if (!byMarket.has(id)) throw new Error("Indexed vault has no market");
      const current = totals.get(id) ?? { pooled: 0, active: 0 };
      const resolved = vault.status === "resolved";
      const amount = vaultPoolUsdc(
        unsigned(resolved ? vault.yes_pool : vault.live_yes_pool),
        unsigned(resolved ? vault.no_pool : vault.live_no_pool),
      );
      current.pooled += amount;
      if (vault.status === "open" || vault.status === "hot") current.active++;
      totals.set(id, current);
    }
    for (const market of markets) {
      const total = totals.get(key(market.chain, market.id)) ?? { pooled: 0, active: 0 };
      if (
        market.total_pooled !== Math.round(total.pooled * 100) / 100 ||
        market.active_vaults !== total.active
      ) {
        throw new Error("Indexed market totals disagree with vaults");
      }
    }
    const liveVaults = vaults
      .filter((v) => v.status === "open" || v.status === "hot")
      .sort((a, b) => a.expires_at_ms - b.expires_at_ms)
      .map((v) => {
        const m = byMarket.get(key(v.chain, v.market_id))!;
        return {
          ...vaultRowToLiveRaw(v, m.title, nowMs),
          indexedAtMs: v.updated_at,
          stale: isStale(m, nowMs, health),
        };
      });
    const lifetimeVaults = [...resolutions]
      .sort((a, b) => b.resolved_at - a.resolved_at)
      .map((r) => {
        const v = byVault.get(key(r.chain, r.vault_id));
        const m = byMarket.get(key(r.chain, r.market_id));
        if (
          !v ||
          !m ||
          v.market_id !== r.market_id ||
          v.status !== "resolved" ||
          v.resolved_outcome !== r.outcome ||
          v.yes_pool !== r.yes_total ||
          v.no_pool !== r.no_total
        ) {
          throw new Error("Indexed resolution disagrees with vault");
        }
        return {
          ...resolutionRowToLifetime(r, v.question, m.title, nowMs),
          streamId: m.route_id,
          indexedAtMs: v.updated_at,
          stale: isStale(m, nowMs, health),
        };
      });
    const homepage: HomepageData = {
      indexing,
      streams,
      liveVaults,
      lifetimeVaults,
      protocolStats: {
        totalVaults: verifiedVaults.length,
        // Compatibility field name: pooled snapshot, NOT transaction volume.
        totalVolume:
          Math.round(verifiedMarkets.reduce((sum, m) => sum + m.total_pooled, 0) * 100) /
          100,
        activeStreams: streams.filter((s) => s.isLive).length,
      },
    };
    return {
      homepage,
      catalog: { streams, indexing },
      streams: Object.fromEntries(
        markets.map((m) => [key(m.chain, m.route_id), withRecording(m)]),
      ),
    };
  };
  return {
    full,
    homepage: async (chain) => (await full(chain)).homepage,
    agents: async () => ({ agents, source: agents.length ? "configured" : "unavailable" }),
    stream: async (routeId, chain) => {
      const health = config.health?.();
      let query = config.db
        .selectFrom("markets")
        .selectAll()
        .where("route_id", "=", routeId);
      if (chain !== undefined) query = query.where("chain", "=", chain);
      const matches = (await query.execute()).filter(
        (row) =>
          row.route_id === routeId &&
          (!health || health.availableChains.includes(row.chain)),
      );
      if (matches.length > 1) throw new Error("ambiguous_stream_chain");
      if (!matches[0]) return null;
      const m = matches[0];
      const recording = await config.db.selectFrom("recordings").select("body").where("chain", "=", m.chain).where("market_id", "=", m.id).executeTakeFirst();
      return recordingDetail(detail(m, now(), health), recording?.body);
    },
  };
};
