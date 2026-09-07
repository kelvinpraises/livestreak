import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createContentController } from "../controllers/content.js";

// --- exports ---

export const createContentRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createContentController(deps);

  router.post("/content/blobs", controller.store);
  router.get("/content/blobs/:scheme/:id", controller.resolve);

  // Local VOD/stream metadata: stored as a content blob, pointer recorded on-chain via the
  // normal goLive/VOD path, resolved back through this host (issue 10).
  router.post("/content/vod", controller.storeVod);
  router.get("/content/vod/:scheme/:id", controller.resolveVod);

  return router;
};
