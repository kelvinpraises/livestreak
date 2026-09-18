import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createLiveController } from "../controllers/live.js";

// --- exports ---

// Direct-stream signaling: reachability echo + watch-URL announce. Always-on like the catalog —
// these are the host's ONLY jobs on the direct lane; media bytes never transit it.
export const createLiveRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createLiveController(deps);

  router.post("/reachability/echo", controller.echo);
  router.post("/live/direct/:streamId", controller.announce);
  router.get("/live/direct/:streamId", controller.lookup);
  router.delete("/live/direct/:streamId", controller.withdraw);

  return router;
};
