import { LiveStreakConfigError } from "@livestreak/core";
import {
  decodeContentBlobStoreRequest,
  type PointerScheme,
  type StorePointer,
  validationErrorMessage,
} from "@livestreak/host";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { HostRouteDeps } from "../../deps.js";
import { asyncHandler, param, sendRouteResult } from "../../http/respond.js";
import { requireContentWrite } from "../recordings/routes.js";
import type { ContentStore } from "./content.js";
import { createMandateStore } from "./mandates.js";
import { createResolutionStore } from "./resolutions.js";
import {
  handleVodMetadataResolve,
  handleVodMetadataStore
} from "./vod.js";

// --- exports ---

export const createContentRouter = (deps: Pick<HostRouteDeps, "catalogDb" | "config" | "content">): Router => {
  const router = Router();
  const mandateStore = deps.catalogDb
    ? createMandateStore(deps.catalogDb.db)
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
    ? createResolutionStore(deps.catalogDb.db)
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
  router.get("/content/resolutions", async (req, res) => {
    if (!resolutions) {
      res.status(503).json({ error: "Durable resolution store unavailable" });
      return;
    }
    try {
      if (typeof req.query.chainId !== "string" || typeof req.query.vaultId !== "string")
        throw new Error("Resolution scope required");
      res.json(await resolutions.list(req.query.chainId, req.query.vaultId));
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
  const handlers = createContentHandlers(deps);

  router.post("/content/blobs", requireContentWrite(deps.config.contentWriteToken), handlers.store);
  router.get("/content/blobs/:scheme/:id", handlers.resolve);

  // Local VOD/stream metadata: stored as a content blob, pointer recorded on-chain via the
  // normal goLive/VOD path, resolved back through this host (issue 10).
  router.post("/content/vod", requireContentWrite(deps.config.contentWriteToken), handlers.storeVod);
  router.get("/content/vod/:scheme/:id", handlers.resolveVod);

  return router;
};




// --- exports ---

export const createContentHandlers = (deps: Pick<HostRouteDeps, "catalogDb" | "config" | "content">) => ({
  store: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleContentBlobStore(req.body, {
        store: deps.content.store
      }),
      next,
      201
    );
  }),

  resolve: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleContentBlobResolve(param(req.params.scheme), param(req.params.id), {
        store: deps.content.store
      }),
      next
    );
  }),

  storeVod: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleVodMetadataStore(req.body, { store: deps.content.store }),
      next,
      201
    );
  }),

  resolveVod: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    sendRouteResult(
      res,
      await handleVodMetadataResolve(param(req.params.scheme), param(req.params.id), {
        store: deps.content.store
      }),
      next
    );
  })
});

export interface ContentRouteDeps {
  readonly store: ContentStore;
}

export type ContentBlobStoreRouteResponse =
  | { readonly ok: true; readonly status: number; readonly result: StorePointer }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export type ContentBlobResolveRouteResponse =
  | {
      readonly ok: true;
      readonly status: number;
      readonly result: { readonly bytesBase64: string };
    }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleContentBlobStore = async (
  body: unknown,
  deps: ContentRouteDeps,
): Promise<ContentBlobStoreRouteResponse> => {
  // Missing cloud configuration is a typed unavailable response; there is no local fallback.
  if (body === null || typeof body !== "object") {
    return contentFailure(400, "Request body must be a JSON object");
  }

  const decoded = decodeContentBlobStoreRequest(body);
  if (decoded._tag === "Left") {
    return contentFailure(400, validationErrorMessage(decoded.left));
  }

  const bytes = decodeBase64Bytes(decoded.right.bytesBase64);
  if (bytes === null) {
    return contentFailure(400, "bytesBase64 must be valid non-empty base64");
  }

  try {
    const pointer = await deps.store.store(bytes, decoded.right.contentType, {
      persistence: decoded.right.persistence ?? "ephemeral",
    });

    return { ok: true, status: 201, result: pointer };
  } catch (error) {
    return contentFailure(
      503,
      error instanceof Error ? error.message : "content_store_failed",
    );
  }
};

export const handleContentBlobResolve = async (
  scheme: string,
  id: string,
  deps: ContentRouteDeps,
): Promise<ContentBlobResolveRouteResponse> => {
  if (!isPointerScheme(scheme) || id.trim().length === 0) {
    return contentFailure(400, "Invalid content pointer");
  }

  try {
    const bytes = await deps.store.resolve(scheme, id);
    return {
      ok: true,
      status: 200,
      result: { bytesBase64: Buffer.from(bytes).toString("base64") },
    };
  } catch (error) {
    return contentFailure(
      404,
      error instanceof Error ? error.message : "content_resolve_failed",
    );
  }
};

// --- helpers ---

const contentFailure = <
  T extends ContentBlobStoreRouteResponse | ContentBlobResolveRouteResponse,
>(
  status: number,
  message: string,
): T =>
  ({
    ok: false,
    status,
    error: new LiveStreakConfigError({
      message,
      metadata: { retryable: false },
    }),
  }) as T;

const decodeBase64Bytes = (value: string): Uint8Array | null => {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === 0 ? null : new Uint8Array(bytes);
  } catch {
    return null;
  }
};

const isPointerScheme = (value: string): value is PointerScheme => value === "host";
