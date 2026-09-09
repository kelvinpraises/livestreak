import type {
  OptionsMarketSnapshot,
  OptionsVault,
  OptionsVaultSnapshot
} from "@livestreak/options";
import type {
  CatalogChain,
  HomepageLifetimeVaultRaw,
  HomepageLiveVaultRaw,
  HostStreamDetail,
  HostStreamSummary
} from "./types.js";
import { projectVaultPools, usdcFromBase, vaultPoolUsdc } from "./pools.js";

export { vaultPoolUsdc } from "./pools.js";

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

const usdc = usdcFromBase;

// SINGLE source of truth for "a vault's pooled USDC". Both the live path (`mapMarket`,
// served at /catalog/full) and the DB read-model path (`snapshotToRows` -> `vaultRowToLiveRaw`,
// served at /homepage + /stream) derive a vault's **effective** pool through THIS function,
// consuming agent-3's board-replayed `livePoolUSDC` when vault snapshots are available.
// Settled on-chain totals remain on `yes_pool`/`no_pool` for optional `settledPool` sublines.
// Routing every effective pool read through one cent-rounded formula means the homepage vault
// card and the per-stream pool can never drift. (pass-4 pool UX.)

// Parse a base-unit USDC string (DB row column) back to bigint; malformed text -> 0n so one
// bad row never NaNs the whole rail.
const toBaseUnits = (text: string): bigint => {
  try {
    return BigInt(text);
  } catch {
    return 0n;
  }
};

const isOpen = (vault: OptionsVault): boolean =>
  vault.status === "open" || vault.status === "hot";

// Implied payout multiplier for the favoured side: total pool / winning-side stake.
// Uses effective (live) pool legs when provided so a just-funded vault shows sane odds.
const impliedMultiplierFromPools = (yes: bigint, no: bigint): number => {
  const yesN = Number(yes);
  const noN = Number(no);
  const total = yesN + noN;
  if (total <= 0) return 2;
  const yesMult = yesN > 0 ? total / yesN : 1;
  const noMult = noN > 0 ? total / noN : 1;
  const best = Math.max(yesMult, noMult);
  return Math.round(best * 100) / 100;
};

const impliedMultiplier = (
  vault: OptionsVault,
  snapshot?: OptionsVaultSnapshot,
  atMs?: number
): number => {
  const pools = projectVaultPools(vault, snapshot, atMs ?? Date.now());
  return impliedMultiplierFromPools(pools.liveYes, pools.liveNo);
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
  baseUrl: string,
  vaultSnapshots?: ReadonlyMap<string, OptionsVaultSnapshot>
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
    const snapshot = vaultSnapshots?.get(String(vault.vaultId));
    const pools = projectVaultPools(vault, snapshot, nowMs);
    const effectivePool = vaultPoolUsdc(pools.liveYes, pools.liveNo);
    const settledPool = vaultPoolUsdc(pools.settledYes, pools.settledNo);
    totalVolume += effectivePool;

    if (isOpen(vault)) {
      activeVaults += 1;
      liveVaults.push({
        id: String(vault.vaultId),
        streamId: marketId,
        streamTitle: title,
        option: vault.question,
        multiplier: impliedMultiplier(vault, snapshot, nowMs),
        totalPool: effectivePool,
        ...(settledPool === effectivePool ? {} : { settledPool }),
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
        totalPool: settledPool,
        resolvedAgoMs: Math.max(0, nowMs - resolvedAtMs),
        yesTotal: usdc(pools.settledYes),
        noTotal: usdc(pools.settledNo),
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
    return usdcFromBase(BigInt(text));
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
  baseUrl: string,
  vaultSnapshots?: ReadonlyMap<string, OptionsVaultSnapshot>
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
    const snapshot = vaultSnapshots?.get(String(vault.vaultId));
    const pools = projectVaultPools(vault, snapshot, nowMs);
    const effectivePool = vaultPoolUsdc(pools.liveYes, pools.liveNo);
    const settledPool = vaultPoolUsdc(pools.settledYes, pools.settledNo);
    const resolved =
      vault.status === "resolved" && (vault.outcome === "yes" || vault.outcome === "no");
    // Market total is the sum of the SAME per-vault effective pool the homepage rail shows
    // (board-replayed `livePoolUSDC` for open vaults; settled for resolved). Keeps
    // `/stream.totalPooled`, `protocolStats.totalVolume`, and `liveVaults[].totalPool` aligned.
    totalPooled += resolved ? settledPool : effectivePool;
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
      yes_pool: pools.settledYes.toString(),
      no_pool: pools.settledNo.toString(),
      live_yes_pool: pools.liveYes.toString(),
      live_no_pool: pools.liveNo.toString(),
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
        yes_total: pools.settledYes.toString(),
        no_total: pools.settledNo.toString(),
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
): HomepageLiveVaultRaw & { readonly settledPool?: number } => {
  const liveYes = toBaseUnits(v.live_yes_pool);
  const liveNo = toBaseUnits(v.live_no_pool);
  const settledYes = toBaseUnits(v.yes_pool);
  const settledNo = toBaseUnits(v.no_pool);
  const useLive = liveYes + liveNo > 0n;
  const effectiveYes = useLive ? liveYes : settledYes;
  const effectiveNo = useLive ? liveNo : settledNo;
  const effectivePool = vaultPoolUsdc(effectiveYes, effectiveNo);
  const settledPool = vaultPoolUsdc(settledYes, settledNo);
  return {
    id: v.id,
    streamId: v.market_id,
    streamTitle,
    option: v.question,
    multiplier: multiplierFromPools(Number(effectiveYes), Number(effectiveNo)),
    totalPool: effectivePool,
    ...(settledPool === effectivePool ? {} : { settledPool }),
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
    totalPool: vaultPoolUsdc(toBaseUnits(r.yes_total), toBaseUnits(r.no_total)),
    resolvedAgoMs: Math.max(0, nowMs - r.resolved_at),
    yesTotal: yes,
    noTotal: no,
    chain: r.chain
  };
};
