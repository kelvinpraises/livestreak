import { Schema } from "effect";

// --- exports ---

// The host<->UI discovery CONTRACT. These are the per-page response shapes the host
// serves and the app renders. They are the SINGLE SOURCE OF TRUTH: they originate from
// the app's `app/src/types/host-edge.ts` (HostStreamSummary/Detail/Catalog) + the
// `Homepage*Raw` / `Agent` shapes in `app/src/types/demo.ts`, MOVED here so the app can
// drop its local copies and import `@livestreak/host` instead. Every stream/vault item
// additionally carries a `chain` tag (`evm`|`sui`); the app ignores unknown fields, so
// the tag is a non-breaking superset of the app's current shapes.

export const CatalogChain = Schema.Literal("evm", "sui", "solana");
export type CatalogChain = Schema.Schema.Type<typeof CatalogChain>;

// app/src/types/host-edge.ts -> HostStreamSummary (+ chain tag).
export const HostStreamSummary = Schema.Struct({
  routeId: Schema.String,
  marketId: Schema.String,
  title: Schema.String,
  category: Schema.String,
  isLive: Schema.Boolean,
  indexedAtMs: Schema.optional(Schema.Number),
  stale: Schema.optional(Schema.Boolean),
  streamStatus: Schema.optional(Schema.Literal("none", "live", "ended")),
  elapsed: Schema.optional(Schema.String),
  activeVaults: Schema.optional(Schema.Number),
  totalPooled: Schema.optional(Schema.Number),
  // Settled on-chain aggregate; present only when it diverges from the effective totalPooled.
  settledPooled: Schema.optional(Schema.Number),
  recordingStatus: Schema.optional(Schema.Literal("recording", "processing", "ready", "failed")),
  replay: Schema.optional(Schema.Struct({ pointerId: Schema.String, url: Schema.String, format: Schema.Literal("hls"), durationSeconds: Schema.Number })),
  chain: CatalogChain
});
export type HostStreamSummary = Schema.Schema.Type<typeof HostStreamSummary>;

// app/src/types/host-edge.ts -> HostStreamDetail (+ chain tag). Static header/metadata
// only — the live options board (vaults/odds/funding) is the options SDK's, not the host.
export const HostStreamDetail = Schema.Struct({
  routeId: Schema.String,
  marketId: Schema.String,
  title: Schema.String,
  category: Schema.String,
  watchUrl: Schema.optional(Schema.String),
  isLive: Schema.Boolean,
  indexedAtMs: Schema.optional(Schema.Number),
  stale: Schema.optional(Schema.Boolean),
  streamStatus: Schema.optional(Schema.Literal("none", "live", "ended")),
  replayPointerId: Schema.optional(Schema.String),
  recordingStatus: Schema.optional(Schema.Literal("recording", "processing", "ready", "failed")),
  replay: Schema.optional(Schema.Struct({ pointerId: Schema.String, url: Schema.String, format: Schema.Literal("hls"), durationSeconds: Schema.Number })),
  activeVaults: Schema.optional(Schema.Number),
  totalPooled: Schema.optional(Schema.Number),
  chain: CatalogChain
});
export type HostStreamDetail = Schema.Schema.Type<typeof HostStreamDetail>;

// app/src/types/demo.ts -> HomepageLiveVaultRaw (+ chain tag).
export const HomepageLiveVaultRaw = Schema.Struct({
  indexedAtMs: Schema.optional(Schema.Number),
  stale: Schema.optional(Schema.Boolean),
  id: Schema.String,
  streamId: Schema.String,
  streamTitle: Schema.String,
  option: Schema.String,
  multiplier: Schema.Number,
  totalPool: Schema.Number,
  status: Schema.Literal("open", "hot"),
  expiresIn: Schema.Number,
  // Settled on-chain pool; present only when it diverges from the effective totalPool.
  settledPool: Schema.optional(Schema.Number),
  chain: CatalogChain
});
export type HomepageLiveVaultRaw = Schema.Schema.Type<typeof HomepageLiveVaultRaw>;

// app/src/types/demo.ts -> HomepageLifetimeVaultRaw (+ chain tag).
export const HomepageLifetimeVaultRaw = Schema.Struct({
  indexedAtMs: Schema.optional(Schema.Number),
  stale: Schema.optional(Schema.Boolean),
  resolutionTimeKnown: Schema.optional(Schema.Boolean),
  id: Schema.String,
  streamId: Schema.optional(Schema.String),
  option: Schema.String,
  streamTitle: Schema.String,
  outcome: Schema.Literal("yes", "no"),
  totalPool: Schema.Number,
  resolvedAgoMs: Schema.Number,
  yesTotal: Schema.Number,
  noTotal: Schema.Number,
  chain: CatalogChain
});
export type HomepageLifetimeVaultRaw = Schema.Schema.Type<typeof HomepageLifetimeVaultRaw>;

// app/src/types/demo.ts -> HomepageProtocolStatsRaw.
export const HomepageProtocolStatsRaw = Schema.Struct({
  totalVaults: Schema.Number,
  totalVolume: Schema.Number,
  activeStreams: Schema.Number
});
export type HomepageProtocolStatsRaw = Schema.Schema.Type<typeof HomepageProtocolStatsRaw>;

// GET /homepage -> the homepage's whole payload in ONE fetch. `streams` is the catalog
// rail; the vault rails + protocol stats are the homepage aggregate.
export const CatalogIndexing = Schema.Struct({
  status: Schema.Literal("fresh", "partial", "unavailable"),
  generatedAtMs: Schema.Number,
  staleMarkets: Schema.Number,
  failedMarkets: Schema.Number,
  failedChains: Schema.Array(CatalogChain),
  availableChains: Schema.Array(CatalogChain),
  verifiedChains: Schema.optional(Schema.Array(CatalogChain)),
  statsScope: Schema.optional(Schema.Literal("complete", "verified-subset", "unavailable")),
  chains: Schema.optional(Schema.Array(Schema.Struct({
    chain: CatalogChain,
    status: Schema.Literal("fresh", "partial", "unavailable"),
    verifiedMarkets: Schema.Number,
    staleMarkets: Schema.Number
  }))),
  oldestIndexedAtMs: Schema.optional(Schema.Number)
});
export type CatalogIndexing = Schema.Schema.Type<typeof CatalogIndexing>;

// app/src/types/host-edge.ts -> HostCatalog.
export const HostCatalog = Schema.Struct({
  indexing: Schema.optional(CatalogIndexing),
  streams: Schema.Array(HostStreamSummary)
});
export type HostCatalog = Schema.Schema.Type<typeof HostCatalog>;


export const HomepageData = Schema.Struct({
  indexing: Schema.optional(CatalogIndexing),
  streams: Schema.Array(HostStreamSummary),
  liveVaults: Schema.Array(HomepageLiveVaultRaw),
  lifetimeVaults: Schema.Array(HomepageLifetimeVaultRaw),
  protocolStats: HomepageProtocolStatsRaw
});
export type HomepageData = Schema.Schema.Type<typeof HomepageData>;

export const AgentRole = Schema.Literal("bookmaker", "steward", "observer");
export type AgentRole = Schema.Schema.Type<typeof AgentRole>;

// app/src/types/demo.ts -> Agent. The agents directory row.
export const Agent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  address: Schema.String,
  role: AgentRole,
  accuracy: Schema.Number,
  winRate: Schema.Number,
  vaultsCreated: Schema.Number,
  vaultsMonitored: Schema.Number,
  totalVolume: Schema.Number,
  batchesSubmitted: Schema.optional(Schema.Number),
  resolutionsConfirmed: Schema.optional(Schema.Number),
  proposals: Schema.optional(Schema.Number),
  vetosUsed: Schema.optional(Schema.Number),
  uptime: Schema.optional(Schema.Number),
  reputation: Schema.Number,
  successRate: Schema.optional(Schema.Number)
});
export type Agent = Schema.Schema.Type<typeof Agent>;

// GET /agents -> the agents directory in ONE fetch.
export const AgentsData = Schema.Struct({
  source: Schema.optional(Schema.Literal("configured", "unavailable")),
  agents: Schema.Array(Agent)
});
export type AgentsData = Schema.Schema.Type<typeof AgentsData>;
