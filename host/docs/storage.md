# Cloud content and replay

Host supplies a provider-neutral content API. Its first adapter supports S3-compatible storage, including Cloudflare R2. Provider credentials exist only on Host. There is no Walrus client or production local archive fallback. Historical chain scheme slots remain readable; new Host routing and archive pointers use slot 4. Ending without a recording still uses the canonical empty id and scheme 0.

Copy the cloud settings in `host/.env.example` into the repo's ignored `.env` or deployment environment. Host and gateway development commands load the root `.env`; the browser never receives these credentials. Configure the bucket and a public HTTPS playback base URL. Add GET/HEAD playback CORS for the actual app origin, with Range allowed and Content-Length/Content-Range/Accept-Ranges exposed. `r2.dev` supports development verification; configure a custom playback domain for the public launch.

Private writes require `Authorization: Bearer <LIVESTREAK_HOST_API_TOKEN>`. Trusted broadcaster gateways receive only that Host credential, never the storage credentials. Treat this alpha write token as operator access, not a user-facing login system.

| API | Purpose |
| --- | --- |
| POST `/content/blobs` | Small base64 JSON evidence or metadata; maximum 12 MiB decoded |
| POST `/content/uploads` | Binary streaming upload; maximum 1 GiB; `X-Content-SHA256` required |
| POST `/recordings` | Begin an idempotent chain/market/run recording; returns an ingest capability |
| GET `/recordings/by-market/:chain/:marketId?runId=...` | Public progress/receipt for the exact run |
| GET `/recordings/:id` | Public recording receipt, without ingest credentials |
| POST `/recordings/:id/retry` | Reverify a cleanly completed archive after storage/delivery failure |
| GET `/stream/:id` | Replay only if ready media and the current native Host pointer match |

The binary upload hashes while streaming, verifies a streamed cloud readback, then publishes its content-addressed object. Multipart buffering is bounded; failed temporary objects are removed. Ordinary JSON routes retain their small body limits.

The Host-relayed live lane records the exact incoming fMP4 initialization and media fragments. Each media object is content-addressed and read back; finalization produces a single-rendition HLS playlist, verifies every public media URL and playlist, and stores recording state and segment references in Turso. This adds no second broadcaster encode. The current relay produces one video track; audio/multiple-track recordings are explicitly rejected. Recording buffers are capped at 32 MiB, individual fragments at 8 MiB, and duration at six hours. The live ring has its own 24 MiB cap. There is no adaptive multi-resolution promise.

A unique database constraint binds a market to one run; an atomic database producer lease prevents a second Host process from accepting a duplicate producer. A clean end seals the sequence. An interrupted producer cannot restart silently or turn partial media into replay. Stale partial state is reported as failed after two minutes without an active writer/update. A sealed failed archive can be retried on a fresh Host. Ready replay metadata alone does not publish a chain reference.

Broadcaster controls: **Check recording** reads progress without a chain transaction; **Retry recording** retries a failed completed archive; **Publish replay** fetches and checks a fresh receipt for this market/run, then signs the native scheme-4 pointer within the original 24-hour revision window. Plain repeated end cannot erase an existing archive. Viewer playback uses native HLS where available and Hls.js otherwise, with controls and an explicit retry state on playback failure.

Direct and file-export lanes do not pass their media through Host and are explicitly excluded from this replay path. They remain live-only/no Host recording; the console does not offer Host replay controls for them.

Opt-in real cloud proof, from repo root:

```sh
node --env-file=.env --conditions=livestreak-dev --import tsx host/scripts/prove-cloud-replay.ts
```

It streams a two-minute generated episode through the production SDK transport and Host recording routes, then verifies public R2 delivery and recovery on a fresh service. It writes only a sanitized proof receipt to `/tmp/flow07-cloud-proof.json`. It creates cloud test objects and does not claim chain deployment or production domain readiness.

Recording JSON, market mappings and producer leases are persisted in Turso, not R2. R2 contains content-addressed initialization/media fragments and HLS playlists. Existing recording metadata can be moved with `node --env-file=.env --import tsx host/scripts/migrate-recording-metadata.ts`; it preserves a backup, verifies reopened database rows, and removes only migrated metadata objects. Catalog/homepage/stream responses share replay readiness, gated by the current chain pointer and index freshness.
