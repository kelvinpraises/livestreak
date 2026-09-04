import { Router } from "express";
import type { HostRouteDeps } from "../deps.js";
import { createDescriptorController } from "../controllers/descriptor.js";

// --- exports ---

export const createDescriptorRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createDescriptorController(deps);

  router.get("/health", (_req, res) => controller.health(_req, res));
  router.get("/descriptor", (_req, res) => controller.descriptor(_req, res));

  return router;
};
