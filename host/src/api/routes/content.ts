import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createContentController } from "../controllers/content.js";

// --- exports ---

export const createContentRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createContentController(deps);

  router.post("/content/blobs", controller.store);
  router.get("/content/blobs/:scheme/:id", controller.resolve);

  return router;
};
