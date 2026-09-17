import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, sendRouteResult } from "../middleware/respond.js";
import { handleForumList, handleForumPost } from "../../services/forum/messages.js";

// --- exports ---

export const createForumController = (deps: HostRouteDeps) => ({
  post: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, await handleForumPost(req.body, deps.forum), next);
  }),

  list: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleForumList(req.query as Record<string, unknown>, deps.forum),
      next
    );
  })
});
