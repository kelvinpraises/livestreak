import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../middleware/respond.js";
import {
  handleDirectAnnounce,
  handleDirectLookup,
  handleDirectWithdraw,
  handleReachabilityEcho
} from "../../services/live/direct.js";

// --- exports ---

const streamIdParam = (req: Request): string => {
  const raw = req.params.streamId;
  return typeof raw === "string" ? raw : "";
};

export const createLiveController = (deps: HostRouteDeps) => ({
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
