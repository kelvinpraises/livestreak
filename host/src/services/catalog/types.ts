// Catalog seam types. Mirrors the EXACT shape the app consumes (see
// `app/src/types/host-edge.ts` + `app/src/types/demo.ts` Raw variants) so that the
// app's demo<->live flip is a pure SOURCE SWAP with zero app-side adapters. Every
// item additionally carries a `chain` tag (`evm`|`sui`); the app ignores unknown
// fields, so the tag is a non-breaking superset.

export type CatalogChain = "evm" | "sui";

// app/src/types/host-edge.ts -> HostStreamSummary (+ chain tag).
export interface HostStreamSummary {
  readonly routeId: string;
  readonly marketId: string;
  readonly title: string;
  readonly category: string;
  readonly isLive: boolean;
  readonly elapsed?: string;
  readonly activeVaults?: number;
  readonly totalPooled?: number;
  readonly chain: CatalogChain;
}

// app/src/types/host-edge.ts -> HostStreamDetail (+ chain tag).
export interface HostStreamDetail {
  readonly routeId: string;
  readonly marketId: string;
  readonly title: string;
  readonly category: string;
  readonly watchUrl?: string;
  readonly isLive: boolean;
  readonly activeVaults?: number;
  readonly totalPooled?: number;
  readonly chain: CatalogChain;
}

// app/src/types/host-edge.ts -> HostCatalog.
export interface HostCatalog {
  readonly streams: readonly HostStreamSummary[];
}

// app/src/types/demo.ts -> HomepageLiveVaultRaw (+ chain tag).
export interface HomepageLiveVaultRaw {
  readonly id: string;
  readonly streamId: string;
  readonly streamTitle: string;
  readonly option: string;
  readonly multiplier: number;
  readonly totalPool: number;
  readonly status: "open" | "hot";
  readonly expiresIn: number;
  readonly chain: CatalogChain;
}

// app/src/types/demo.ts -> HomepageLifetimeVaultRaw (+ chain tag).
export interface HomepageLifetimeVaultRaw {
  readonly id: string;
  readonly option: string;
  readonly streamTitle: string;
  readonly outcome: "yes" | "no";
  readonly totalPool: number;
  readonly resolvedAgoMs: number;
  readonly yesTotal: number;
  readonly noTotal: number;
  readonly chain: CatalogChain;
}

// app/src/types/demo.ts -> HomepageProtocolStatsRaw.
export interface HomepageProtocolStatsRaw {
  readonly totalVaults: number;
  readonly totalVolume: number;
  readonly activeStreams: number;
}

export interface HomepageAggregate {
  readonly liveVaults: readonly HomepageLiveVaultRaw[];
  readonly lifetimeVaults: readonly HomepageLifetimeVaultRaw[];
  readonly protocolStats: HomepageProtocolStatsRaw;
}

// The full live aggregate: `catalog` + per-route `streams` + `homepage`. This is the
// AppFixture subset the homepage/agents/stream pages render. `agents`/`options` are
// NOT catalog concerns and are intentionally omitted (they come from the options board
// bridge, not the host) — flagged in the reply.
export interface HostFullCatalog {
  readonly catalog: HostCatalog;
  readonly streams: Record<string, HostStreamDetail>;
  readonly homepage: HomepageAggregate;
}
