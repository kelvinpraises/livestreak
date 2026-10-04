# Catalog index scope and freshness

The Host polls configured chain deployments, atomically stores complete market/vault/resolution graphs, and serves discovery from one transactional Turso/libSQL projection. `/catalog`, `/catalog/full`, `/homepage`, `/stream/:id` and its catalog alias share that projection. IDs are chain-qualified; ambiguous detail routes require `?chain=evm|sui|solana`.

## Configuration

Set `LIVESTREAK_CATALOG_CHAINS=evm,sui,solana` to index all three chain families, or a comma-separated subset. An unset value defaults to `evm`. Invalid/empty values fail startup. Deployment files alone do not activate a chain. An explicitly selected chain with a missing reader or failing RPC remains a visible coverage failure. The local `dev.sh` passes the chains it actually started successfully.

Disabled-chain cache remains stored but is excluded from discovery and totals. This is chain selection, not network isolation: separate local/testnet databases, buckets, deployment identities and resets still need enforcement.

## Response semantics

`indexing.availableChains` is the configured scope, not an assertion that an RPC is reachable. `chains` reports each chain's `fresh`, `partial` or `unavailable` state and verified/stale market counts. `verifiedChains` lists chains with verified records or a successfully scanned empty registry.

- `statsScope=complete`: every configured chain's registry and known graphs were verified.
- `statsScope=verified-subset`: only individually verified graphs contribute to totals. Coverage may be incomplete because enumeration or a graph read failed. The UI names this limited scope.
- `statsScope=unavailable`: no current records or complete empty registry can be verified. The UI withholds totals and resolution results.

A registry scan failure does not invalidate an independently refreshed market graph, but prevents claiming complete chain coverage. Failed graph reads preserve cached rows, mark them stale, and exclude them from totals, live listings and recent resolutions. Cached stream cards remain discoverable as stale. Rows older than 45 seconds also become stale. Lazy graph refresh uses a 15-second TTL, cron runs every 30 seconds, and RPC work has an 8-second deadline. A late timed-out read cannot overwrite a recovered graph.

`totalVolume` is retained as an API compatibility field name; its meaning is the current pooled snapshot, not historical transaction volume. The UI labels it POOLED and separately sums verified resolved pools. Resolution counts and YES outcome percentages use the same verified resolution rows.

## Verification and limits

Regression tests cover mixed-chain outage/recovery, failed registry scans with readable known markets, healthy empty scopes, disabled cache, failed child reads, overlapping refresh, migration preservation, chain ID collisions and consistent public endpoints. App tests cover totals/results through partial and unavailable states.

This is a polling mini-indexer. It does not pin every RPC to one block/slot/checkpoint or implement finalized event history. Turso recording-metadata migration, network isolation, historical activity/volume and agent reputation remain separate work. Recording playback is independently checked against storage and the committed pointer; an ended stream does not imply a replay exists.

## Database layout

`database/` contains only `connection.ts`, `schema.ts` and `migrations/`. Schema and row types live together. Shared DDL lives in the initial migration, and catalog rebuild logic lives in its integrity migration. Applied migration names and data-preservation behavior are retained.

The catalog read model and indexer use Kysely directly, with transactions for complete graph replacement and consistent reads. Memory and forum handlers likewise query their injected Kysely connection directly. The dependency builder provides the connection; no repository factory or facade is involved. Runtime connects to the configured Turso/libSQL URL; only isolated tests use SQLite. Mandates and resolution receipts share the same remote Kysely connection.
