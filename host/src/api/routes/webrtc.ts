import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createWebrtcController } from "../controllers/webrtc.js";

// --- exports ---

export const createWebrtcRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createWebrtcController(deps);

  // The host embeds its own TURN relay; advertise how to reach it.
  router.get("/webrtc/ice", controller.getIce);

  // Per-viewer signaling: one producer serves many viewers (a peer + encode each), keyed by (streamId, viewerId).
  router.get("/webrtc/signal/:streamId/viewers", controller.listViewers);
  router.post("/webrtc/signal/:streamId/viewers/:viewerId/offer", controller.postOffer);
  router.get("/webrtc/signal/:streamId/viewers/:viewerId/offer", controller.getOffer);
  router.post("/webrtc/signal/:streamId/viewers/:viewerId/answer", controller.postAnswer);
  router.get("/webrtc/signal/:streamId/viewers/:viewerId/answer", controller.getAnswer);
  router.post("/webrtc/signal/:streamId/viewers/:viewerId", controller.registerViewer);
  router.delete("/webrtc/signal/:streamId/viewers/:viewerId", controller.removeViewer);
  router.delete("/webrtc/signal/:streamId", controller.clear);

  return router;
};
