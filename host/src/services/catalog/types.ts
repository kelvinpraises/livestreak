// Catalog seam types. The per-page CONTRACT shapes are now PUBLISHED by `@livestreak/host`
// (`packages/host/src/catalog.ts`) as the single source of truth; this module re-exports
// them so the server's existing import sites (`./types.js`) keep working unchanged, and
// adds the host-INTERNAL aggregate wrappers the live `/catalog/full` endpoint composes.

export type {
  CatalogChain,
  HostStreamSummary,
  HostStreamDetail,
  HostCatalog,
  HomepageLiveVaultRaw,
  HomepageLifetimeVaultRaw,
  HomepageProtocolStatsRaw,
  HomepageData,
  Agent,
  AgentRole,
  AgentsData
} from "@livestreak/host";

import type {
  HomepageLifetimeVaultRaw,
  HomepageLiveVaultRaw,
  HomepageProtocolStatsRaw,
  HostCatalog,
  HostStreamDetail
} from "@livestreak/host";

// Host-internal: the homepage aggregate the live reader composes (superset of the
// published `HomepageData` minus `streams`, which the full catalog carries separately).
export interface HomepageAggregate {
  readonly liveVaults: readonly HomepageLiveVaultRaw[];
  readonly lifetimeVaults: readonly HomepageLifetimeVaultRaw[];
  readonly protocolStats: HomepageProtocolStatsRaw;
}

// Host-internal: the full live aggregate served by `/catalog/full`.
export interface HostFullCatalog {
  readonly catalog: HostCatalog;
  readonly streams: Record<string, HostStreamDetail>;
  readonly homepage: HomepageAggregate;
}
