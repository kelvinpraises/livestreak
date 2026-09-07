import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";
import {
  handleContentBlobResolve,
  handleContentBlobStore
} from "../../services/walrus/content/routes.js";
import {
  handleVodMetadataResolve,
  handleVodMetadataStore
} from "../../services/walrus/content/vod.js";

// --- exports ---

export const createContentController = (deps: HostRouteDeps) => ({
  store: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleContentBlobStore(req.body, {
        config: deps.config,
        store: deps.walrus.content.store
      }),
      next,
      201
    );
  }),

  resolve: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleContentBlobResolve(param(req.params.scheme), param(req.params.id), {
        config: deps.config,
        store: deps.walrus.content.store
      }),
      next
    );
  }),

  storeVod: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleVodMetadataStore(req.body, { store: deps.walrus.content.store }),
      next,
      201
    );
  }),

  resolveVod: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleVodMetadataResolve(param(req.params.scheme), param(req.params.id), {
        store: deps.walrus.content.store
      }),
      next
    );
  })
});
