import { createPagesController } from "./pages.js";
import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../middleware/respond.js";
import type { CatalogMarketRef } from "../../services/catalog/catalog.js";

// --- exports ---

const parseMarketRef = (body: unknown): CatalogMarketRef | null => {
  if (body === null || typeof body !== "object") return null;
  const { chain, marketId } = body as { chain?: unknown; marketId?: unknown };
  if ((chain !== "evm" && chain !== "sui" && chain !== "solana") || typeof marketId !== "string") return null;
  if (marketId.trim().length === 0) return null;
  return { chain, marketId: marketId.trim() };
};

export const createCatalogController = (deps: HostRouteDeps) => ({
  // GET /catalog — live cross-chain stream summaries (HostCatalog shape).
  catalog: asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
    await deps.catalogIndexer.ensureAll();
    const home = await deps.catalogReadModel.homepage();
    sendRouteResult(res, { ok: true, result: { streams: home.streams, indexing: home.indexing } }, next);
  }),

  // GET /catalog/full — full live aggregate (catalog + per-route streams + homepage).
  full: asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
    await deps.catalogIndexer.ensureAll();
    sendRouteResult(res, { ok: true, result: await deps.catalogReadModel.full() }, next);
  }),

  stream: createPagesController(deps).stream,

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
            message: "catalog market requires { chain: 'evm'|'sui'|'solana', marketId }",
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
