import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../deps.js";
import { asyncHandler, sendRouteResult } from "../respond.js";
import { handleFindSimilar, handleIndexVault } from "../../services/discovery-routes.js";

// --- exports ---

export const createDiscoveryController = (deps: HostRouteDeps) => ({
  indexVault: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, handleIndexVault(req.body, deps.discovery), next, 201);
  }),

  findSimilar: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, handleFindSimilar(req.body, deps.discovery), next);
  })
});
