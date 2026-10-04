import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../../http/respond.js";
import type { CatalogMarketRef } from "./catalog.js";
import type { ChainTag } from "../../database/schema.js";
import { param } from "../../http/respond.js";

// --- exports ---

export const createCatalogRouter = (deps: Pick<HostRouteDeps, "catalog" | "catalogIndexer" | "catalogReadModel" | "config" | "recordings">): Router => {
  const router = Router();
  const handlers = createCatalogHandlers(deps);

  router.get("/catalog", handlers.catalog);
  router.get("/catalog/full", handlers.full);
  router.get("/catalog/streams/:routeId", handlers.stream);
  router.post("/catalog/markets", handlers.register);

  return router;
};


// --- exports ---

const parseMarketRef = (body: unknown): CatalogMarketRef | null => {
  if (body === null || typeof body !== "object") return null;
  const { chain, marketId } = body as { chain?: unknown; marketId?: unknown };
  if ((chain !== "evm" && chain !== "sui" && chain !== "solana") || typeof marketId !== "string") return null;
  if (marketId.trim().length === 0) return null;
  return { chain, marketId: marketId.trim() };
};

export const createCatalogHandlers = (deps: Pick<HostRouteDeps, "catalog" | "catalogIndexer" | "catalogReadModel" | "config" | "recordings">) => ({
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

  stream: createPagesHandlers(deps).stream,

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


// --- exports ---

// Page-named discovery routes (one fetch per page). Always-on like /catalog — the UI's
// live source must work on the plain dev stack with no module token.
export const createPagesRouter = (deps: Pick<HostRouteDeps, "catalogIndexer" | "catalogReadModel" | "config" | "recordings">): Router => {
  const router = Router();
  const handlers = createPagesHandlers(deps);

  router.get("/homepage", handlers.homepage);
  router.get("/agents", handlers.agents);
  router.get("/stream/:id", handlers.stream);

  return router;
};


// Omission means all chains; an invalid scope must never silently broaden a request.
const parseChainParam = (raw: unknown): ChainTag | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "evm" || raw === "sui" || raw === "solana") return raw;
  throw new LiveStreakConfigError({ message: "Invalid chain; expected evm, sui or solana", metadata: { retryable: false } });
};

// Page-shaped discovery endpoints: ONE response shape per page, served from the DB
// projection (lazily refreshed by the indexer), typed by `@livestreak/host`. The app
// fetches a page projection. Account balances/positions/actions remain the options SDK's.

export const createPagesHandlers = (deps: Pick<HostRouteDeps, "catalogIndexer" | "catalogReadModel" | "config" | "recordings">) => ({
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
    const routeId = param(req.params.id ?? req.params.routeId);
    const chain = parseChainParam(req.query.chain);
    let detail;
    try {
      const present = await deps.catalogIndexer.ensureFresh(routeId, chain);
      detail = present ? await deps.catalogReadModel.stream(routeId, chain) : null;
    } catch (error) {
      if (error instanceof Error && error.message === 'ambiguous_stream_chain') {
        sendRouteResult(res, { ok: false, status: 409, error: new LiveStreakConfigError({ message: 'Specify chain for this stream ID', metadata: { retryable: false } }) }, next);
        return;
      }
      throw error;
    }
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
    const result = detail;
    sendRouteResult(res, { ok: true, result }, next);
  })
});
