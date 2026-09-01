# Host — TODO

See [architecture.md](./architecture.md). Types: `packages/host`. Server: top-level `host/`. See [repo TODO](../../README.md).

---

## Type package (`packages/host`)

- [x] Scaffold protocol/type-only package per architecture file list
- [x] Descriptor, policy, session, manifest, cache, account, AA, forum types
- [x] Similarity request/result/index types (`src/similarity.ts`)
- [x] No server, fetch client, or `Effect.run*` in type package

---

## Dev server (`host/`)

### Registered routes (14)

- [x] `GET /health`, `GET /descriptor`, `POST /policy/evaluate`, `GET /aa/descriptor`
- [x] `POST /sessions`, `GET /sessions/:sessionId/manifest`, `POST /sessions/:sessionId/cache-receipts`
- [x] `POST /similarity/vaults`, `POST /similarity/find`
- [x] `POST /forum/threads`, `GET /forum/threads/:threadId`, `POST /forum/threads/:threadId/messages`
- [x] `POST /aa/bundler/:chain`, `POST /aa/paymaster/:chain`
- [x] Sessions/manifests/cache hardening

**Deferred:**

- Production chain-event vault indexer (replaces dev `POST /similarity/vaults` in production)

### Slice 4 — production indexing

- [ ] Replace open `POST /similarity/vaults` with chain-event indexer in production

### Later (documented aspiration)

- [ ] API keys, multi-tenant accounts, quota enforcement
- [ ] Durable cache storage, audit logs, endpoint signing
- [ ] WebRTC/SFU/TURN provider binding
- [ ] Production AA relayer / session-key service
- [ ] Abuse controls

---

## Engineering

- [x] v0 open/dev-only; auth and tenancy documented but not blocking slice 1
- [x] Side effects at server edge only
- [x] Top-level `host/` added to root npm workspaces (`@livestreak/host-server`)

---

## Hardening (every slice)

```text
npm run check:host
npm run test:host
cd host && npm run check && npm run build && npm test
cd packages/host && npm run check && npm run build && npm test
```
