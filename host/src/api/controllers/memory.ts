import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../middleware/respond.js";
import { handleMemoryRecall, handleMemoryRemember } from "../../services/memory/records.js";

// --- exports ---

export const createMemoryController = (deps: HostRouteDeps) => ({
  remember: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, await handleMemoryRemember(req.body, deps.memory), next);
  }),

  recall: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleMemoryRecall(req.query as Record<string, unknown>, deps.memory),
      next
    );
  })
});
