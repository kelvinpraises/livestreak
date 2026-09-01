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
# Only the root manifest, packages/wallet, and app are in the build context (see
# .dockerignore). A root `npm install` tolerates the other workspace members being
# absent and just installs the app + wallet subtree.
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
COPY packages/wallet/package.json ./packages/wallet/package.json
COPY packages/wallet/patches ./packages/wallet/patches
COPY app/package.json ./app/package.json

# 2) Root workspace install. Re-resolves native binaries for this platform; absent
#    workspace members (host, cli, packages/* except wallet) are simply skipped.
RUN npm install --no-audit --no-fund

# 3) Build the vendored wallet. Its tsc build extends the root tsconfig.base.json
#    (via packages/wallet/tsconfig.json), and its dist/ is gitignored with no
#    prepare script, so the app cannot resolve @livestreak/wallet's entry until it
#    is built here.
COPY tsconfig.base.json ./
COPY packages/wallet ./packages/wallet
RUN npm run build -w @livestreak/wallet

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
