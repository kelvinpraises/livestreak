import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../deps.js";
import { asyncHandler, param, sendRouteResult } from "../respond.js";
import { handlePolicyEvaluate } from "../../services/media/policy-routes.js";
import {
  handleCacheReceipt,
  handleCreateSession,
  handleGetManifest
} from "../../services/media/routes.js";

// --- exports ---

const policyEvaluatorState = (deps: HostRouteDeps) => ({
  quotaRemainingBytes: deps.media.evidence.getQuotaRemainingBytes()
});

export const createMediaController = (deps: HostRouteDeps) => ({
  evaluatePolicy: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      handlePolicyEvaluate(req.body, {
        config: deps.config,
        state: policyEvaluatorState(deps)
      }),
      next
    );
  }),

  createSession: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleCreateSession(req.body, {
        ...deps.media,
        config: deps.config
      }),
      next,
      201
    );
  }),

  getManifest: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(res, handleGetManifest(param(req.params.sessionId), deps.media), next);
  }),

  cacheReceipt: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      handleCacheReceipt(param(req.params.sessionId), req.body, {
        ...deps.media,
        config: deps.config
      }),
      next
    );
  })
});
