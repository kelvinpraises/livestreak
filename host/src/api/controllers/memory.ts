import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../deps.js";
import { asyncHandler, sendRouteResult } from "../respond.js";
import { handleMemoryAccess } from "../../services/walrus/memory/routes.js";

// --- exports ---

export const createMemoryController = (deps: HostRouteDeps) => ({
  access: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleMemoryAccess(req.body, {
        config: deps.config,
        bindings: deps.walrus.memory.bindings
      }),
      next
    );
  })
});
