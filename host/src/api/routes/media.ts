import { Router } from "express";
import type { HostRouteDeps } from "../deps.js";
import { createMediaController } from "../controllers/media.js";

// --- exports ---

export const createMediaRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createMediaController(deps);

  router.post("/media/policy/evaluate", controller.evaluatePolicy);
  router.post("/media/sessions", controller.createSession);
  router.get("/media/sessions/:sessionId/manifest", controller.getManifest);
  router.post("/media/sessions/:sessionId/cache-receipts", controller.cacheReceipt);

  return router;
};
