import { createResolutionStore } from "../../services/resolutions.js";
import { createMandateStore } from "../../services/mandates.js";
import { requireContentWrite } from "./recordings.js";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { createContentController } from "../controllers/content.js";

// --- exports ---

export const createContentRouter = (deps: HostRouteDeps): Router => {
  const router = Router();
  const mandateStore = deps.catalogDb
    ? createMandateStore(deps.catalogDb.sqlite)
    : undefined;
  router.post("/content/mandates", async (req, res) => {
    if (!mandateStore) {
      res.status(503).json({ error: "Durable mandate store unavailable" });
      return;
    }
    try {
      res.status(201).json(await mandateStore.put(req.body));
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Invalid mandate" });
    }
  });
  router.get("/content/mandates/:digest", async (req, res) => {
    if (!mandateStore) {
      res.status(503).json({ error: "Durable mandate store unavailable" });
      return;
    }
    try {
      const value = await mandateStore.get(req.params.digest);
      if (value === undefined) res.status(404).json({ error: "Mandate not found" });
      else res.json(value);
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Invalid mandate" });
    }
  });
  const resolutions = deps.catalogDb
    ? createResolutionStore(deps.catalogDb.sqlite)
    : undefined;
  router.post("/content/resolutions", async (req, res) => {
    if (!resolutions) {
      res.status(503).json({ error: "Durable resolution store unavailable" });
      return;
    }
    try {
      res.status(201).json(await resolutions.put(req.body));
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Invalid resolution" });
    }
  });
  router.get("/content/resolutions", (req, res) => {
    if (!resolutions) {
      res.status(503).json({ error: "Durable resolution store unavailable" });
      return;
    }
    try {
      if (typeof req.query.chainId !== "string" || typeof req.query.vaultId !== "string")
        throw new Error("Resolution scope required");
      res.json(resolutions.list(req.query.chainId, req.query.vaultId));
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Invalid scope" });
    }
  });
  router.get("/content/resolutions/:digest", async (req, res) => {
    if (!resolutions) {
      res.status(503).json({ error: "Durable resolution store unavailable" });
      return;
    }
    try {
      const record = await resolutions.get(req.params.digest);
      if (record) res.json(record);
      else res.status(404).json({ error: "Resolution not found" });
    } catch (error) {
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "Invalid resolution" });
    }
  });
  const controller = createContentController(deps);

  router.post("/content/blobs", requireContentWrite(deps.config.contentWriteToken), controller.store);
  router.get("/content/blobs/:scheme/:id", controller.resolve);

  // Local VOD/stream metadata: stored as a content blob, pointer recorded on-chain via the
  // normal goLive/VOD path, resolved back through this host (issue 10).
  router.post("/content/vod", requireContentWrite(deps.config.contentWriteToken), controller.storeVod);
  router.get("/content/vod/:scheme/:id", controller.resolveVod);

  return router;
};
