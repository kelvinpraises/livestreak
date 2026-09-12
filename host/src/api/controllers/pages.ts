import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import type { ChainTag } from "../../infrastructure/database/schema.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";

// `?chain=evm|sui` scopes /homepage to one chain (the per-chain router); anything else (absent/invalid)
// falls back to the cross-chain aggregate.
const parseChainParam = (raw: unknown): ChainTag | undefined =>
  raw === "evm" || raw === "sui" ? raw : undefined;

// Page-shaped discovery endpoints: ONE response shape per page, served from the DB
// projection (lazily refreshed by the indexer), typed by `@livestreak/host`. The app
// fetches exactly one of these per page and renders — demo fixture <-> live host is a pure
// source swap. The live options board (vaults/odds/funding) is NOT here — that's the SDK's.

export const createPagesController = (deps: HostRouteDeps) => ({
  // GET /homepage[?chain=evm|sui] -> HomepageData { streams, liveVaults, lifetimeVaults, protocolStats }.
  homepage: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    await deps.catalogIndexer.ensureAll();
    const chain = parseChainParam(req.query.chain);
    sendRouteResult(res, { ok: true, result: await deps.catalogReadModel.homepage(chain) }, next);
  }),

  // GET /agents -> AgentsData { agents }.
  agents: asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, { ok: true, result: await deps.catalogReadModel.agents() }, next);
  }),

  // GET /stream/:id -> HostStreamDetail (static header/metadata) | 404 stream_not_found.
  stream: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const routeId = param(req.params.id);
    const present = await deps.catalogIndexer.ensureFresh(routeId);
    const detail = present ? await deps.catalogReadModel.stream(routeId) : null;
    if (detail === null) {
      sendRouteResult(
        res,
        {
          ok: false,
          status: 404,
          error: new LiveStreakConfigError({
            message: "stream_not_found",
            metadata: { retryable: false }
          })
        },
        next
      );
      return;
    }
    sendRouteResult(res, { ok: true, result: detail }, next);
  })
});
