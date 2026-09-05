import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createDiscoveryController } from "../controllers/discovery.js";

// --- exports ---

export const createDiscoveryRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createDiscoveryController(deps);

  router.post("/discovery/vaults", controller.indexVault);
  router.post("/discovery/find", controller.findSimilar);

  return router;
};
