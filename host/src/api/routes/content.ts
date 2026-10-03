import { createMandateStore } from "../../services/mandates.js";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createContentController } from "../controllers/content.js";

// --- exports ---

export const createContentRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const mandateStore = deps.catalogDb ? createMandateStore(deps.catalogDb.sqlite) : undefined;
  router.post("/content/mandates", async (req, res) => {
    if (!mandateStore) { res.status(503).json({error:"Durable mandate store unavailable"}); return; }
    try { res.status(201).json(await mandateStore.put(req.body)); }
    catch (error) { res.status(400).json({error: error instanceof Error ? error.message : "Invalid mandate"}); }
  });
  router.get("/content/mandates/:digest", async (req, res) => {
    if (!mandateStore) { res.status(503).json({error:"Durable mandate store unavailable"}); return; }
    try { const value = await mandateStore.get(req.params.digest); if (value === undefined) res.status(404).json({error:"Mandate not found"}); else res.json(value); }
    catch (error) { res.status(400).json({error: error instanceof Error ? error.message : "Invalid mandate"}); }
  });
  const controller = createContentController(deps);

  router.post("/content/blobs", controller.store);
  router.get("/content/blobs/:scheme/:id", controller.resolve);

  // Local VOD/stream metadata: stored as a content blob, pointer recorded on-chain via the
  // normal goLive/VOD path, resolved back through this host (issue 10).
  router.post("/content/vod", controller.storeVod);
  router.get("/content/vod/:scheme/:id", controller.resolveVod);

  return router;
};
