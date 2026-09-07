import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";
import type { CatalogMarketRef } from "../../services/catalog/catalog.js";

// --- exports ---

const parseMarketRef = (body: unknown): CatalogMarketRef | null => {
  if (body === null || typeof body !== "object") return null;
  const { chain, marketId } = body as { chain?: unknown; marketId?: unknown };
  if ((chain !== "evm" && chain !== "sui") || typeof marketId !== "string") return null;
  if (marketId.trim().length === 0) return null;
  return { chain, marketId: marketId.trim() };
};

export const createCatalogController = (deps: HostRouteDeps) => ({
  // GET /catalog — live cross-chain stream summaries (HostCatalog shape).
  catalog: asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, { ok: true, result: await deps.catalog.buildCatalog() }, next);
  }),

  // GET /catalog/full — full live aggregate (catalog + per-route streams + homepage).
  full: asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, { ok: true, result: await deps.catalog.buildFull() }, next);
  }),

  // GET /catalog/streams/:routeId — single stream header (HostStreamDetail shape).
  stream: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const detail = await deps.catalog.buildStream(param(req.params.routeId));
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
  }),

  // POST /catalog/markets — register a (chain, marketId) the catalog should read live.
  register: asyncHandler((req: Request, res: Response, next: NextFunction) => {
    const ref = parseMarketRef(req.body);
    if (ref === null) {
      sendRouteResult(
        res,
        {
          ok: false,
          status: 400,
          error: new LiveStreakConfigError({
            message: "catalog market requires { chain: 'evm'|'sui', marketId }",
            metadata: { retryable: false }
          })
        },
        next
      );
      return;
    }
    deps.catalog.registerMarket(ref);
    sendRouteResult(res, { ok: true, result: { registered: ref } }, next, 201);
  })
});
