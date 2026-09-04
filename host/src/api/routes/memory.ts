import { Router } from "express";
import type { HostRouteDeps } from "../deps.js";
import { createMemoryController } from "../controllers/memory.js";

// --- exports ---

export const createMemoryRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createMemoryController(deps);

  router.post("/memory/access", controller.access);

  return router;
};
