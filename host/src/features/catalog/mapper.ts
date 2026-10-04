import type {
  CatalogChain,
  HomepageLifetimeVaultRaw,
  HomepageLiveVaultRaw,
  HostStreamDetail,
  HostStreamSummary
} from "@livestreak/host";
import type {
  OptionsMarketSnapshot,
  OptionsVaultSnapshot
} from "@livestreak/options";
import type {
  Market,
  NewMarket,
  NewResolution,
  NewVault,
  Resolution,
  Vault
} from "../../database/schema.js";
import { projectVaultPools, usdcFromBase, vaultPoolUsdc } from "./pools.js";

export { vaultPoolUsdc } from "./pools.js";

// Corrupt/negative unsigned amounts are data errors, never a valid zero pool.
const toBaseUnits = (text: string): bigint => {
  try {
    if (!/^\d+$/u.test(text)) throw new Error("Invalid unsigned amount");
    return BigInt(text);
  } catch {
    throw new Error("Invalid indexed pool amount");
  }
};

const formatElapsed = (fromMs: number, nowMs: number): string => {
  // A missing/zero start timestamp would render as decades of "elapsed" — show nothing instead.
  if (fromMs <= 0 || fromMs > nowMs + 60_000) return "";
  const mins = Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
};

// Live ids route media. An ended pointer alone is not proof of a playable archive:
// Flow07 will add verified recording metadata. Until then never advertise replay.
const watchUrlFor = (
  snap: OptionsMarketSnapshot,
  baseUrl: string
): string | undefined => {
  const stream = snap.streamState;
  if (stream?.status !== "live" || !stream.id || stream.id === "livestreak:no-recording") return undefined;
  const base = baseUrl.replace(/\/$/u, "");
  return `${base}/content/blobs/${stream.scheme}/${encodeURIComponent(stream.id)}`;
};


const poolUsdc = (text: string): number => {
  try {
    return usdcFromBase(toBaseUnits(text));
  } catch {
    throw new Error("Invalid indexed pool amount");
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
  vaultSnapshots?: ReadonlyMap<string, OptionsVaultSnapshot>,
  liveSignal?: boolean
): MarketRows => {
  const marketId = String(snap.market.marketId);
  const title = snap.market.title;
  const category = !snap.market.category || snap.market.category.toLowerCase() === "live" ? "Uncategorized" : snap.market.category;
  const isLive = snap.streamState?.status !== "ended" && (liveSignal ?? snap.streamState?.status === "live");
  const fromMs =
    snap.streamState?.updatedAtMs ?? snap.market.timing?.createdAtMs ?? nowMs;
  const watchUrl = watchUrlFor(snap, baseUrl);

  let totalPooled = 0;
  let activeVaults = 0;
  const vaults: NewVault[] = [];
  const resolutions: NewResolution[] = [];

  for (const vault of snap.vaults) {
    if (vault.status === "resolved" && vault.outcome !== "yes" && vault.outcome !== "no") throw new Error("Resolved vault has no valid outcome");
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
        resolved_at: vault.timing.resolvedAtMs ?? 0
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
    stream_scheme: snap.streamState?.scheme ?? "",
    ended_at_ms: snap.streamState?.status === "ended" ? snap.streamState.endedAtMs || null : null,
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
  isLive: m.status !== "ended" && m.is_live === 1,
  streamStatus: m.status === "ended" ? "ended" : m.status === "live" ? "live" : "none",
  elapsed: m.status === "ended" ? "" : formatElapsed(m.from_ms, nowMs),
  indexedAtMs: m.updated_at,
  activeVaults: m.active_vaults,
  totalPooled: m.total_pooled,
  chain: m.chain
});

export const marketRowToDetail = (m: Market): HostStreamDetail => ({
  routeId: m.route_id,
  marketId: m.id,
  title: m.title,
  category: m.category,
  isLive: m.status !== "ended" && m.is_live === 1,
  streamStatus: m.status === "ended" ? "ended" : m.status === "live" ? "live" : "none",
  indexedAtMs: m.updated_at,
  ...(m.status === "ended" && m.stream_scheme === "host" ? { replayPointerId: m.stream_id } : {}),
  activeVaults: m.active_vaults,
  totalPooled: m.total_pooled,
  chain: m.chain,
  ...(m.status === "ended" || m.watch_url === null ? {} : { watchUrl: m.watch_url })
});

// A live (open|hot) vault row + its market title -> the homepage live rail item.
export const vaultRowToLiveRaw = (
  v: Vault,
  streamTitle: string,
  nowMs: number
): HomepageLiveVaultRaw => {
  const liveYes = toBaseUnits(v.live_yes_pool);
  const liveNo = toBaseUnits(v.live_no_pool);
  const settledYes = toBaseUnits(v.yes_pool);
  const settledNo = toBaseUnits(v.no_pool);
  const effectiveYes = liveYes;
  const effectiveNo = liveNo;
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
  if (r.outcome !== "yes" && r.outcome !== "no") throw new Error("Invalid indexed outcome");
  const yes = poolUsdc(r.yes_total);
  const no = poolUsdc(r.no_total);
  return {
    id: r.vault_id,
    streamId: r.market_id,
    option: question,
    streamTitle,
    outcome: r.outcome,
    totalPool: vaultPoolUsdc(toBaseUnits(r.yes_total), toBaseUnits(r.no_total)),
    resolutionTimeKnown: r.resolved_at > 0,
    resolvedAgoMs: r.resolved_at > 0 ? Math.max(0, nowMs - r.resolved_at) : 0,
    yesTotal: yes,
    noTotal: no,
    chain: r.chain
  };
};
