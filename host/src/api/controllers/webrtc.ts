import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";
import { parseSignalPayload, type SignalPayload } from "../../services/webrtc/signal.js";

// --- exports ---

const badRequest = (message: string) => ({
  ok: false as const,
  status: 400,
  error: new LiveStreakConfigError({ message, metadata: { retryable: false } })
});

const notFound = (message: string) => ({
  ok: false as const,
  status: 404,
  error: new LiveStreakConfigError({ message, metadata: { retryable: false } })
});

export const createWebrtcController = (deps: HostRouteDeps) => {
  const store = deps.signaling;
  return {
    postOffer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const payload = parseSignalPayload(req.body, "offer");
      if (streamId.length === 0 || payload === null) {
        sendRouteResult(res, badRequest("offer requires { type:'offer', sdp }"), next);
        return;
      }
      store.setOffer(streamId, payload);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    getOffer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const offer = store.getOffer(param(req.params.streamId));
      if (offer === null) {
        sendRouteResult(res, notFound("no_offer"), next);
        return;
      }
      sendRouteResult(res, { ok: true, result: offer as SignalPayload }, next);
    }),

    postAnswer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const payload = parseSignalPayload(req.body, "answer");
      if (streamId.length === 0 || payload === null) {
        sendRouteResult(res, badRequest("answer requires { type:'answer', sdp }"), next);
        return;
      }
      if (store.getOffer(streamId) === null) {
        sendRouteResult(res, notFound("no_offer_to_answer"), next);
        return;
      }
      store.setAnswer(streamId, payload);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    getAnswer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const answer = store.getAnswer(param(req.params.streamId));
      if (answer === null) {
        sendRouteResult(res, notFound("no_answer"), next);
        return;
      }
      sendRouteResult(res, { ok: true, result: answer as SignalPayload }, next);
    }),

    clear: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      store.clear(param(req.params.streamId));
      sendRouteResult(res, { ok: true, result: { ok: true } }, next);
    })
  };
};
