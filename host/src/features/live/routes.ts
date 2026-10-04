import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../../http/respond.js";
import {
  handleDirectAnnounce,
  handleDirectLookup,
  handleDirectWithdraw,
  handleReachabilityEcho
} from "./direct.js";

// --- exports ---

// Direct-stream signaling: reachability echo + watch-URL announce. Always-on like the catalog —
// these are the host's ONLY jobs on the direct lane; media bytes never transit it.
export const createLiveRouter = (deps: Pick<HostRouteDeps, "direct">): Router => {
  const router = Router();
  const handlers = createLiveHandlers(deps);

  router.post("/reachability/echo", handlers.echo);
  router.post("/live/direct/:streamId", handlers.announce);
  router.get("/live/direct/:streamId", handlers.lookup);
  router.delete("/live/direct/:streamId", handlers.withdraw);

  return router;
};


// --- exports ---

const streamIdParam = (req: Request): string => {
  const raw = req.params.streamId;
  return typeof raw === "string" ? raw : "";
};

export const createLiveHandlers = (deps: Pick<HostRouteDeps, "direct">) => ({
  echo: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // req.ip respects the scoped trust-proxy setting: behind the local reverse proxy it is the real
    // client (not the proxy's loopback), and a spoofed X-Forwarded-For from a direct caller is ignored.
    sendRouteResult(res, await handleReachabilityEcho(req.body, req.ip ?? req.socket.remoteAddress), next);
  }),

  announce: (req: Request, res: Response, next: NextFunction): void => {
    sendRouteResult(res, handleDirectAnnounce(streamIdParam(req), req.body, deps.direct), next);
  },

  lookup: (req: Request, res: Response, next: NextFunction): void => {
    sendRouteResult(res, handleDirectLookup(streamIdParam(req), deps.direct), next);
  },

  withdraw: (req: Request, res: Response, next: NextFunction): void => {
    sendRouteResult(res, handleDirectWithdraw(streamIdParam(req), req.body, deps.direct), next);
  }
});
