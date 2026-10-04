import type { RecordingScope } from "@livestreak/host";
import { Router, type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler } from "../../http/respond.js";

export const requireContentWrite =
  (token: string | null): RequestHandler =>
  (req, res, next) => {
    const value = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (!token) {
      res.status(503).json({ error: "Host cloud writes are not configured" });
      return;
    }
    if (
      Buffer.byteLength(value) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(value), Buffer.from(token))
    ) {
      res.status(401).json({ error: "Host access credential required" });
      return;
    }
    next();
  };
export const createRecordingsRouter = (deps: { recordings: HostRouteDeps["recordings"]; config: Pick<HostRouteDeps["config"], "contentWriteToken"> }): Router => {
  const router = Router();
  const auth = requireContentWrite(deps.config.contentWriteToken);
  router.post(
    "/recordings",
    auth,
    asyncHandler(async (req, res) => {
      try {
        res.status(201).json(await deps.recordings.begin(req.body as RecordingScope));
      } catch (e) {
        res
          .status(409)
          .json({ error: e instanceof Error ? e.message : "Recording unavailable" });
      }
    }),
  );
  router.get(
    "/recordings/by-market/:chain/:marketId",
    asyncHandler(async (req, res) => {
      try {
        const scope = {
          chain: req.params.chain,
          marketId: req.params.marketId,
          runId: req.query.runId,
        } as RecordingScope;
        const value = await deps.recordings.read(scope);
        if (value) res.json(value);
        else res.status(404).json({ error: "Recording not found" });
      } catch (e) {
        res
          .status(503)
          .json({ error: e instanceof Error ? e.message : "Recording unavailable" });
      }
    }),
  );
  router.get(
    "/recordings/:id",
    asyncHandler(async (req, res) => {
      try {
        const value = await deps.recordings.byId(String(req.params.id));
        if (value) res.json(value);
        else res.status(404).json({ error: "Recording not found" });
      } catch (e) {
        res
          .status(503)
          .json({ error: e instanceof Error ? e.message : "Recording unavailable" });
      }
    }),
  );
  router.post(
    "/recordings/:id/retry",
    auth,
    asyncHandler(async (req, res) => {
      try {
        res.json(await deps.recordings.retry(String(req.params.id)));
      } catch (e) {
        res
          .status(409)
          .json({ error: e instanceof Error ? e.message : "Recording not ready" });
      }
    }),
  );
  return router;
};
