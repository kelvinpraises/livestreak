import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createCatalogController } from "../controllers/catalog.js";

// --- exports ---

export const createCatalogRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createCatalogController(deps);

  router.get("/catalog", controller.catalog);
  router.get("/catalog/full", controller.full);
  router.get("/catalog/streams/:routeId", controller.stream);
  router.post("/catalog/markets", controller.register);

  return router;
};
