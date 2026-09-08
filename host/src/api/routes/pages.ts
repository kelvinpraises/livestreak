import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createPagesController } from "../controllers/pages.js";

// --- exports ---

// Page-named discovery routes (one fetch per page). Always-on like /catalog — the UI's
// live source must work on the plain dev stack with no module token.
export const createPagesRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createPagesController(deps);

  router.get("/homepage", controller.homepage);
  router.get("/agents", controller.agents);
  router.get("/stream/:id", controller.stream);

  return router;
};
