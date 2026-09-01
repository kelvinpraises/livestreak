# syntax=docker/dockerfile:1
#
# LiveStreak frontend — TanStack Start + Nitro (node-server preset), runs on :3000.
#
# Build context is the repo root (the app depends on `@livestreak/wallet` via
# `file:../packages/wallet`, so packages/wallet must be in the context). Build with:
#   docker build -t livestreak-app .
#
# Single-stage on purpose: the `file:` wallet dep is symlinked into
# app/node_modules and several wallet packages are kept external from the Nitro
# server bundle, so the runtime needs node_modules + packages/wallet intact.
# (Slimming to multi-stage is a later optimization — see DEPLOY.md.)

FROM node:22-slim

# Native toolchain for the wallet SDK (sodium-javascript, @tetherto/wdk-*, safe kits).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# 1) Vendored wallet (a file: dependency of the app) + its patch-package patch.
COPY packages/wallet ./packages/wallet

# 2) Install app deps. We copy only package.json (NOT the macOS-generated
#    package-lock.json) so npm resolves the linux-correct native binaries
#    (rollup / esbuild / lightningcss / tailwind-oxide) for this container.
COPY app/package.json ./app/package.json
WORKDIR /repo/app
RUN npm install --no-audit --no-fund

# 3) Apply the wallet's @safe-global/relay-kit patch into node_modules (non-fatal:
#    the app build does not require it, and the wallet edge fails soft at runtime).
RUN npx --yes patch-package --patch-dir ../packages/wallet/patches || true

# 4) App source + build-time public config (Vite bakes VITE_* into the client bundle).
COPY app ./
ARG VITE_CHAIN_ID
ARG VITE_ARC_RPC_URL
ARG VITE_BUNDLER_URL
ARG VITE_PAYMASTER_URL
ARG VITE_USDC_ADDRESS
ENV VITE_CHAIN_ID=$VITE_CHAIN_ID \
    VITE_ARC_RPC_URL=$VITE_ARC_RPC_URL \
    VITE_BUNDLER_URL=$VITE_BUNDLER_URL \
    VITE_PAYMASTER_URL=$VITE_PAYMASTER_URL \
    VITE_USDC_ADDRESS=$VITE_USDC_ADDRESS

RUN npm run build

# Runtime
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
