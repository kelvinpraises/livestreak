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
