# syntax=docker/dockerfile:1
#
# LiveStreak host server (@livestreak/host-server) — the provider node: HTTP/WSS API
# on :8787 (Express 5 + Remote Bridge Console WSS + live fMP4 video fan-out over WS).
# All traffic — including live video (/live/ingest producer + /live/watch viewers) — is
# TCP on the single :8787 port; there is NO UDP media relay.
#
# Build context = repo root (same as ./Dockerfile), so this mirrors the app image's
# monorepo-prune pattern: manifests first for a cached install, a single root
# `npm install`, then build only the workspace dist chain host imports
# (core, schema, wallet, contracts) -> packages/host -> host/ itself.
#
# `npm install` (NOT `npm ci`) and no lockfile copy on purpose: native binaries
# (better-sqlite3, sodium-* from the wallet SDK) must resolve for THIS platform; the
# committed lock is macOS-generated and `npm ci` would install darwin binaries.
#
# RUN with a plain port map (`-p 8787:8787`, see deploy-host.yml): the live video path
# is TCP-only, so host networking / a UDP relay port range is no longer needed.

FROM node:22-slim

# Native toolchain for better-sqlite3 (host catalog projection) and the wallet SDK
# (sodium-*, @tetherto/wdk-*). curl is kept for the deploy healthcheck.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# 1) Manifests first so the install layer caches across source changes. The root
#    postinstall runs patch-package against packages/wallet/patches, so the patches
#    must be present before the install.
COPY package.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/schema/package.json ./packages/schema/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/host/package.json ./packages/host/package.json
COPY packages/options/package.json ./packages/options/package.json
COPY packages/wallet/package.json ./packages/wallet/package.json
COPY packages/wallet/patches ./packages/wallet/patches
COPY host/package.json ./host/package.json

# 2) Root workspace install. Re-resolves native binaries for this platform; the
#    remaining absent workspace members (observe, bookmaker, steward, cli, app)
#    are simply skipped.
RUN npm install --no-audit --no-fund

# 3) Build the workspace dist chain host imports. dist/ is gitignored with no prepare
#    script, so nothing resolves until built here. Order: leaves (core, schema,
#    wallet) -> contracts (ts bindings only, no forge) -> packages/host -> options
#    (host-server's catalog service imports @livestreak/options, which depends on
#    core/contracts/host/schema/wallet — all built above).
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/schema ./packages/schema
COPY packages/contracts ./packages/contracts
COPY packages/host ./packages/host
COPY packages/options ./packages/options
COPY packages/wallet ./packages/wallet
RUN npm run build -w @livestreak/core -w @livestreak/schema -w @livestreak/wallet \
 && npm run build:ts -w @livestreak/contracts \
 && npm run build -w @livestreak/host \
 && npm run build -w @livestreak/options

# 4) Host server source + build.
COPY host ./host
RUN npm run build -w @livestreak/host-server

# Runtime. Config (RPC URLs, executor keys, walrus endpoints, remote-console secrets)
# comes from `--env-file` at `docker run` time — never baked into the image.
ENV NODE_ENV=production
ENV LIVESTREAK_HOST_BIND_HOST=0.0.0.0
ENV LIVESTREAK_HOST_BIND_PORT=8787
# The deploy snapshot lives under packages/contracts on the dev box; in prod the
# operator supplies AA chains via LIVESTREAK_AA_CHAINS_FILE (or per-chain env), so
# skip the localhost snapshot auto-load.
ENV LIVESTREAK_AA_FROM_DEPLOY=0
EXPOSE 8787
WORKDIR /repo/host
CMD ["node", "dist/main.js"]
