import type {
  OptionsMarketSnapshot,
  OptionsVault
} from "@livestreak/options";
import type {
  CatalogChain,
  HomepageLifetimeVaultRaw,
  HomepageLiveVaultRaw,
  HostStreamDetail,
  HostStreamSummary
} from "./types.js";

// USDC base unit scale (6 decimals) — vault pools are bigint USDC base units.
const USDC_SCALE = 1_000_000;

// Pure projection of an on-chain market snapshot into the catalog/homepage shapes the
// app consumes. No I/O — fully unit-testable. `nowMs` is injected so elapsed/expiry are
// deterministic in tests.
export interface MappedMarket {
  readonly stream: HostStreamSummary;
  readonly detail: HostStreamDetail;
  readonly liveVaults: readonly HomepageLiveVaultRaw[];
  readonly lifetimeVaults: readonly HomepageLifetimeVaultRaw[];
  readonly vaultCount: number;
  readonly totalVolume: number;
}

const usdc = (value: bigint): number => Number(value) / USDC_SCALE;

const isOpen = (vault: OptionsVault): boolean =>
  vault.status === "open" || vault.status === "hot";

// Implied payout multiplier for the favoured side: total pool / winning-side stake.
// Empty/one-sided pools fall back to a sane default so the UI never shows 0/Infinity.
const impliedMultiplier = (vault: OptionsVault): number => {
  const yes = Number(vault.pools.yes);
  const no = Number(vault.pools.no);
  const total = yes + no;
  if (total <= 0) return 2;
  const yesMult = yes > 0 ? total / yes : 1;
  const noMult = no > 0 ? total / no : 1;
  const best = Math.max(yesMult, noMult);
  return Math.round(best * 100) / 100;
};

const formatElapsed = (fromMs: number, nowMs: number): string => {
  const mins = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
};

// Resolve a watchable URL for a market's stream pointer. Local/ipfs pointers resolve
// back through this host's content endpoint; walrus pointers are served by aggregator.
const watchUrlFor = (
  snap: OptionsMarketSnapshot,
  baseUrl: string
): string | undefined => {
  const stream = snap.streamState;
  if (stream === undefined || stream.status === "none") return undefined;
  const base = baseUrl.replace(/\/$/u, "");
  return `${base}/content/blobs/${stream.scheme}/${encodeURIComponent(stream.id)}`;
};

export const mapMarket = (
  chain: CatalogChain,
  snap: OptionsMarketSnapshot,
  nowMs: number,
  baseUrl: string
): MappedMarket => {
  const marketId = String(snap.market.marketId);
  const title = snap.market.title;
  const category = snap.market.category ?? "Live";
  const isLive = snap.streamState?.status === "live";

  const fromMs =
    snap.streamState?.updatedAtMs ?? snap.market.timing?.createdAtMs ?? nowMs;

  let totalVolume = 0;
  let activeVaults = 0;
  const liveVaults: HomepageLiveVaultRaw[] = [];
  const lifetimeVaults: HomepageLifetimeVaultRaw[] = [];

  for (const vault of snap.vaults) {
    const pool = usdc(vault.pools.yes + vault.pools.no);
    totalVolume += pool;

    if (isOpen(vault)) {
      activeVaults += 1;
      liveVaults.push({
        id: String(vault.vaultId),
        streamId: marketId,
        streamTitle: title,
        option: vault.question,
        multiplier: impliedMultiplier(vault),
        totalPool: pool,
        status: vault.status === "hot" ? "hot" : "open",
        expiresIn: Math.max(
          0,
          Math.floor((vault.timing.expiresAtMs - nowMs) / 1000)
        ),
        chain
      });
    }

    if (vault.status === "resolved" && (vault.outcome === "yes" || vault.outcome === "no")) {
      const resolvedAtMs = vault.timing.resolvedAtMs ?? vault.timing.expiresAtMs;
      lifetimeVaults.push({
        id: String(vault.vaultId),
        option: vault.question,
        streamTitle: title,
        outcome: vault.outcome,
        totalPool: pool,
        resolvedAgoMs: Math.max(0, nowMs - resolvedAtMs),
        yesTotal: usdc(vault.pools.yes),
        noTotal: usdc(vault.pools.no),
        chain
      });
    }
  }

  const totalPooled = Math.round(totalVolume * 100) / 100;

  const stream: HostStreamSummary = {
    routeId: marketId,
    marketId,
    title,
    category,
    isLive,
    elapsed: formatElapsed(fromMs, nowMs),
    activeVaults,
    totalPooled,
    chain
  };

  const detail: HostStreamDetail = {
    routeId: marketId,
    marketId,
    title,
    category,
    isLive,
    activeVaults,
    totalPooled,
    chain,
    ...(watchUrlFor(snap, baseUrl) === undefined
      ? {}
      : { watchUrl: watchUrlFor(snap, baseUrl) })
  };

  return {
    stream,
    detail,
    liveVaults,
    lifetimeVaults,
    vaultCount: snap.vaults.length,
    totalVolume
  };
};


// =====================================================================================
// DB read-model mapping — snapshot -> rows (indexer) and rows -> @livestreak/host shapes
// (page endpoints). The chain is source of truth; rows are a projection, so every
// conversion is pure + nowMs-injected for deterministic tests.
// =====================================================================================

import type {
  Market,
  NewMarket,
  NewResolution,
  NewVault,
  Resolution,
  Vault
} from "../../infrastructure/database/models.js";

const poolUsdc = (text: string): number => {
  try {
    return Number(BigInt(text)) / USDC_SCALE;
  } catch {
    return 0;
  }
};

// Pool-based implied multiplier (USDC floats or base-unit numbers — ratio is unit-free).
const multiplierFromPools = (yes: number, no: number): number => {
  const total = yes + no;
  if (total <= 0) return 2;
  const yesMult = yes > 0 ? total / yes : 1;
  const noMult = no > 0 ? total / no : 1;
  return Math.round(Math.max(yesMult, noMult) * 100) / 100;
};

export interface MarketRows {
  readonly market: NewMarket;
  readonly vaults: readonly NewVault[];
  readonly resolutions: readonly NewResolution[];
}

// Project an on-chain market snapshot into the DB rows the indexer upserts.
export const snapshotToRows = (
  chain: CatalogChain,
  snap: OptionsMarketSnapshot,
  nowMs: number,
  baseUrl: string
): MarketRows => {
  const marketId = String(snap.market.marketId);
  const title = snap.market.title;
  const category = snap.market.category ?? "Live";
  const isLive = snap.streamState?.status === "live";
  const fromMs =
    snap.streamState?.updatedAtMs ?? snap.market.timing?.createdAtMs ?? nowMs;
  const watchUrl = watchUrlFor(snap, baseUrl);

  let totalPooled = 0;
  let activeVaults = 0;
  const vaults: NewVault[] = [];
  const resolutions: NewResolution[] = [];

  for (const vault of snap.vaults) {
    const yesPool = vault.pools.yes;
    const noPool = vault.pools.no;
    totalPooled += usdc(yesPool + noPool);
    const resolved =
      vault.status === "resolved" && (vault.outcome === "yes" || vault.outcome === "no");
    if (vault.status === "open" || vault.status === "hot") activeVaults += 1;
    const resolvedAtMs = vault.timing.resolvedAtMs ?? null;

    vaults.push({
      id: String(vault.vaultId),
      market_id: marketId,
      chain,
      question: vault.question,
      side: null,
      status: vault.status,
      resolved_outcome: resolved ? vault.outcome : null,
      yes_pool: yesPool.toString(),
      no_pool: noPool.toString(),
      expires_at_ms: vault.timing.expiresAtMs,
      resolved_at_ms: resolvedAtMs,
      updated_at: nowMs
    });

    if (resolved) {
      resolutions.push({
        vault_id: String(vault.vaultId),
        market_id: marketId,
        chain,
        outcome: vault.outcome as string,
        yes_total: yesPool.toString(),
        no_total: noPool.toString(),
        resolved_at: vault.timing.resolvedAtMs ?? vault.timing.expiresAtMs
      });
    }
  }

  const market: NewMarket = {
    id: marketId,
    chain,
    route_id: marketId,
    title,
    category,
    stream_id: snap.streamState?.id ?? "",
    status: snap.streamState?.status ?? "none",
    is_live: isLive ? 1 : 0,
    watch_url: watchUrl ?? null,
    active_vaults: activeVaults,
    total_pooled: Math.round(totalPooled * 100) / 100,
    from_ms: fromMs,
    updated_at: nowMs
  };

  return { market, vaults, resolutions };
};

// --- rows -> @livestreak/host contract shapes ---

export const marketRowToSummary = (m: Market, nowMs: number): HostStreamSummary => ({
  routeId: m.route_id,
  marketId: m.id,
  title: m.title,
  category: m.category,
  isLive: m.is_live === 1,
  elapsed: formatElapsed(m.from_ms, nowMs),
  activeVaults: m.active_vaults,
  totalPooled: m.total_pooled,
  chain: m.chain
});

export const marketRowToDetail = (m: Market): HostStreamDetail => ({
  routeId: m.route_id,
  marketId: m.id,
  title: m.title,
  category: m.category,
  isLive: m.is_live === 1,
  activeVaults: m.active_vaults,
  totalPooled: m.total_pooled,
  chain: m.chain,
  ...(m.watch_url === null ? {} : { watchUrl: m.watch_url })
});

// A live (open|hot) vault row + its market title -> the homepage live rail item.
export const vaultRowToLiveRaw = (
  v: Vault,
  streamTitle: string,
  nowMs: number
): HomepageLiveVaultRaw => {
  const yes = poolUsdc(v.yes_pool);
  const no = poolUsdc(v.no_pool);
  return {
    id: v.id,
    streamId: v.market_id,
    streamTitle,
    option: v.question,
    multiplier: multiplierFromPools(yes, no),
    totalPool: Math.round((yes + no) * 100) / 100,
    status: v.status === "hot" ? "hot" : "open",
    expiresIn: Math.max(0, Math.floor((v.expires_at_ms - nowMs) / 1000)),
    chain: v.chain
  };
};

// A resolution row (+ vault question / market title) -> the homepage lifetime rail item.
export const resolutionRowToLifetime = (
  r: Resolution,
  question: string,
  streamTitle: string,
  nowMs: number
): HomepageLifetimeVaultRaw => {
  const yes = poolUsdc(r.yes_total);
  const no = poolUsdc(r.no_total);
  return {
    id: r.vault_id,
    option: question,
    streamTitle,
    outcome: r.outcome === "no" ? "no" : "yes",
    totalPool: Math.round((yes + no) * 100) / 100,
    resolvedAgoMs: Math.max(0, nowMs - r.resolved_at),
    yesTotal: yes,
    noTotal: no,
    chain: r.chain
  };
};
