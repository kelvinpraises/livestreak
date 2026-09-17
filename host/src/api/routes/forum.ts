import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createForumController } from "../controllers/forum.js";

// --- exports ---

export const createForumRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const controller = createForumController(deps);

  router.post("/forum/messages", controller.post);
  router.get("/forum/messages", controller.list);

  return router;
};
