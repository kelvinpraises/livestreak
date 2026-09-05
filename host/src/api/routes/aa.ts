import { Router } from "express";
import type { AaRouteDeps } from "../../deps.js";
import { createAaController } from "../controllers/aa.js";
import { asyncHandler } from "../middleware/respond.js";

// --- exports ---

export const createAaRouter = (deps: AaRouteDeps): Router => {
  const router = Router();
  const controller = createAaController(deps);

  router.get("/aa/descriptor", (_req, res) => controller.descriptor(_req, res));
  router.post(
    "/aa/bundler/:chain",
    asyncHandler(async (req, res) => controller.bundler(req, res))
  );
  router.post(
    "/aa/paymaster/:chain",
    asyncHandler(async (req, res) => controller.paymaster(req, res))
  );
  router.post(
    "/aa/sui/sponsor",
    asyncHandler(async (req, res, next) => controller.suiSponsor(req, res, next))
  );

  return router;
};
