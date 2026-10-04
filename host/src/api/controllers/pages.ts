import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import type { ChainTag } from "../../infrastructure/database/schema.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";

// Omission means all chains; an invalid scope must never silently broaden a request.
const parseChainParam = (raw: unknown): ChainTag | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "evm" || raw === "sui" || raw === "solana") return raw;
  throw new LiveStreakConfigError({ message: "Invalid chain; expected evm, sui or solana", metadata: { retryable: false } });
};

// Page-shaped discovery endpoints: ONE response shape per page, served from the DB
// projection (lazily refreshed by the indexer), typed by `@livestreak/host`. The app
// fetches a page projection. Account balances/positions/actions remain the options SDK's.

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
    let result=detail;
    if(deps.config.storage !== null) {
      try {
        const record=await deps.recordings.forMarket(detail.chain,detail.marketId);
        if(record) result={...detail,recordingStatus:record.status,...(!detail.stale && detail.streamStatus==="ended" && record.status==="ready" && record.pointer !== undefined && record.pointer.id===detail.replayPointerId ? { replay:{pointerId:record.pointer.id,url:record.pointer.url,format:"hls" as const,durationSeconds:record.durationSeconds} } : {})};
      } catch { /* Cloud unavailable: omit replay rather than invent an archive. */ }
    }
    sendRouteResult(res, { ok: true, result }, next);
  })
});
