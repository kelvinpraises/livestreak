import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createRemoteController } from "../controllers/remote.js";

// --- exports ---

// HTTP surface of the Remote Bridge Console (the WSS legs are upgraded on the
// shared http.Server in infrastructure/ws/server.ts). Mounted under the "remote"
// module gate in server.ts.
export const createRemoteRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createRemoteController(deps);

  router.post("/remote/:session/join", (req, res) => controller.join(req, res));
  router.get("/remote/:session", (req, res) => controller.serveSpa(req, res));

  return router;
};
