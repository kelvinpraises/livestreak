import { LiveStreakConfigError } from "@livestreak/core";
import type { NextFunction, Request, Response } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../middleware/respond.js";
import { parseSignalPayload, type SignalPayload } from "../../services/webrtc/signal.js";
import { iceServersForHost, readTurnConfig } from "../../services/webrtc/turn.js";

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
    // Viewer announces intent to watch — the producer discovers it via listViewers and mints an offer.
    registerViewer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const viewerId = param(req.params.viewerId);
      if (streamId.length === 0 || viewerId.length === 0) {
        sendRouteResult(res, badRequest("register requires streamId + viewerId"), next);
        return;
      }
      store.registerViewer(streamId, viewerId);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    // Producer polls this to learn which viewers want in (one peer + encode per viewer).
    listViewers: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const viewers = store.listViewers(param(req.params.streamId));
      sendRouteResult(res, { ok: true, result: { viewers } }, next);
    }),

    postOffer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const viewerId = param(req.params.viewerId);
      const payload = parseSignalPayload(req.body, "offer");
      if (streamId.length === 0 || viewerId.length === 0 || payload === null) {
        sendRouteResult(res, badRequest("offer requires streamId, viewerId, { type:'offer', sdp }"), next);
        return;
      }
      store.setViewerOffer(streamId, viewerId, payload);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    getOffer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const offer = store.getViewerOffer(param(req.params.streamId), param(req.params.viewerId));
      if (offer === null) {
        sendRouteResult(res, notFound("no_offer"), next);
        return;
      }
      sendRouteResult(res, { ok: true, result: offer as SignalPayload }, next);
    }),

    postAnswer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const streamId = param(req.params.streamId);
      const viewerId = param(req.params.viewerId);
      const payload = parseSignalPayload(req.body, "answer");
      if (streamId.length === 0 || viewerId.length === 0 || payload === null) {
        sendRouteResult(res, badRequest("answer requires streamId, viewerId, { type:'answer', sdp }"), next);
        return;
      }
      if (store.getViewerOffer(streamId, viewerId) === null) {
        sendRouteResult(res, notFound("no_offer_to_answer"), next);
        return;
      }
      store.setViewerAnswer(streamId, viewerId, payload);
      sendRouteResult(res, { ok: true, result: { ok: true } }, next, 201);
    }),

    getAnswer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const answer = store.getViewerAnswer(param(req.params.streamId), param(req.params.viewerId));
      if (answer === null) {
        sendRouteResult(res, notFound("no_answer"), next);
        return;
      }
      sendRouteResult(res, { ok: true, result: answer as SignalPayload }, next);
    }),

    removeViewer: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      store.removeViewer(param(req.params.streamId), param(req.params.viewerId));
      sendRouteResult(res, { ok: true, result: { ok: true } }, next);
    }),

    clear: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      store.clear(param(req.params.streamId));
      sendRouteResult(res, { ok: true, result: { ok: true } }, next);
    }),

    // The host advertises ITS embedded relay: hand back TURN/STUN on the same host the caller reached us at
    // (so a browser gets localhost/LAN and a container gets host.docker.internal, each reachable for them).
    // relayOnly is advised because the dev peers (Docker container, Chromium mDNS host candidates) can't do
    // direct — the reachable path is the relay.
    getIce: asyncHandler((req: Request, res: Response, next: NextFunction) => {
      const config = readTurnConfig();
      const hostname = (req.headers.host ?? "").split(":")[0] || "127.0.0.1";
      const iceServers = config.enabled
        ? iceServersForHost(hostname, config)
        : [{ urls: "stun:stun.l.google.com:19302" }];
      sendRouteResult(res, { ok: true, result: { iceServers, relayOnly: config.enabled } }, next);
    })
  };
};
