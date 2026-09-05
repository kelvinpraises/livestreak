# syntax=docker/dockerfile:1
#
# LiveStreak frontend — TanStack Start + Nitro (node-server preset), runs on :3000.
#
# `app` is an npm workspace member that depends on the vendored `@livestreak/wallet`
# (packages/wallet). We do a single root `npm install`, which hoists the wallet's
# deps (@safe-global/*, @tetherto/wdk-*, ethers, sodium-*) into the repo-root
# node_modules. app/vite.config.ts resolves its node-polyfill shims + sodium from
# wherever npm hoists them (via createRequire), so the client build works against
# this hoisted layout — no `--install-links` needed.
#
# The build context includes the root manifest, app, and the workspace packages
# app needs (wallet, options, schema, contracts, core, host) - see .dockerignore.
# A root `npm install` tolerates the remaining workspace members (observe,
# bookmaker, steward, cli, host-server) being absent.
#
# We deliberately use `npm install` (NOT `npm ci`) and do NOT copy the lockfile, so
# native binaries (rollup / esbuild / lightningcss / tailwind-oxide) resolve for
# THIS platform; the committed lock is macOS-generated and `npm ci` would install
# darwin binaries and break the build.
#
# Single-stage on purpose: several wallet packages are kept external from the Nitro
# server bundle, so the runtime needs node_modules + packages/wallet/dist intact.

FROM node:22-slim

# Native toolchain for the wallet SDK (sodium-*, @tetherto/wdk-*, safe kits).
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
COPY app/package.json ./app/package.json

# 2) Root workspace install. Re-resolves native binaries for this platform; the
#    remaining absent workspace members (observe, bookmaker, steward, cli,
#    host-server) are simply skipped.
RUN npm install --no-audit --no-fund

# 3) Build the workspace packages app needs. Their dist/ is gitignored with no
#    prepare script, so the app cannot resolve them until built here. Build in
#    dependency order: leaves (core, schema, contracts, wallet) -> host -> options.
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/schema ./packages/schema
COPY packages/contracts ./packages/contracts
COPY packages/host ./packages/host
COPY packages/options ./packages/options
COPY packages/wallet ./packages/wallet
RUN npm run build -w @livestreak/core -w @livestreak/schema -w @livestreak/wallet \
 && npm run build:ts -w @livestreak/contracts \
 && npm run build -w @livestreak/host -w @livestreak/options

# 4) App source + build. Public config (chain id, RPC/bundler/paymaster URLs,
#    contract addresses) is committed in app/src/config/contracts.ts, so there are
#    no build-time env vars / build-args.
COPY app ./app
RUN npm run build -w app

# Runtime
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /repo/app
CMD ["node", ".output/server/index.mjs"]
