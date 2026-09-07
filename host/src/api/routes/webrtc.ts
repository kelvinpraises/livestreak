import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createWebrtcController } from "../controllers/webrtc.js";

// --- exports ---

export const createWebrtcRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createWebrtcController(deps);

  router.post("/webrtc/signal/:streamId/offer", controller.postOffer);
  router.get("/webrtc/signal/:streamId/offer", controller.getOffer);
  router.post("/webrtc/signal/:streamId/answer", controller.postAnswer);
  router.get("/webrtc/signal/:streamId/answer", controller.getAnswer);
  router.delete("/webrtc/signal/:streamId", controller.clear);

  return router;
};
