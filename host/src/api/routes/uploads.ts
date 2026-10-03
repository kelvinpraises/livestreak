import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import type { HostRouteDeps } from "../../deps.js";
import { requireContentWrite } from "./recordings.js";
import { asyncHandler } from "../middleware/respond.js";
export const createUploadsRouter = (deps: { content: Pick<HostRouteDeps["content"], "objects">; config: Pick<HostRouteDeps["config"], "contentWriteToken"> }): Router => {
  const router = Router();
  router.post(
    "/content/uploads",
    requireContentWrite(deps.config.contentWriteToken),
    asyncHandler(async (req, res) => {
      const objects = deps.content.objects;
      if (!objects) {
        res.status(503).json({ error: "Cloud storage is not configured" });
        return;
      }
      const expected = req.header("x-content-sha256");
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) {
        res
          .status(400)
          .json({ error: "x-content-sha256 must identify the completed bytes" });
        return;
      }
      const temp = `uploads/${randomUUID()}`;
      const hash = createHash("sha256");
      let size = 0;
      const body = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > 1024 * 1024 * 1024) {
            callback(new Error("Upload exceeds 1GiB"));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      req.on("aborted", () => body.destroy(new Error("Upload disconnected")));
      try {
        req.pipe(body);
        await objects.upload(
          temp,
          body,
          req.header("content-type") ?? "application/octet-stream",
        );
        if (!size || hash.digest("hex") !== expected)
          throw new Error("Upload digest mismatch");
        const storedHash = createHash("sha256");
        for await (const chunk of await objects.open(temp)) storedHash.update(chunk);
        if (storedHash.digest("hex") !== expected)
          throw new Error("Cloud upload integrity mismatch");
        await objects.promote(
          temp,
          `content/${expected}`,
          req.header("content-type") ?? "application/octet-stream",
        );
        const publishedHash = createHash("sha256");
        for await (const chunk of await objects.open(`content/${expected}`)) publishedHash.update(chunk);
        if (publishedHash.digest("hex") !== expected) throw new Error("Published content integrity mismatch");
        res
          .status(201)
          .json({
            scheme: "host",
            id: expected,
            url: objects.publicUrl(`content/${expected}`),
          });
      } catch (error) {
        res
          .status(400)
          .json({ error: error instanceof Error ? error.message : "Cloud upload failed" });
      } finally {
        req.unpipe(body);
        body.destroy();
        await objects.remove(temp).catch(() => undefined);
      }
    }),
  );
  return router;
};
