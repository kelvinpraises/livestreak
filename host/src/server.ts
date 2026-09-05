import express, { type Express } from "express";
import { bootstrapAaFromConfig, readAaServerConfig } from "./services/aa/chains.js";
import { bootstrapHostServerConfig, defaultHostServerConfig, isModuleEnabled } from "./config/host.js";
import { bootstrapHostRouteDeps, createHostRouteDeps, type HostRouteDeps } from "./deps.js";
import {
  errorHandler,
  malformedJsonHandler,
  notFoundHandler,
  payloadTooLargeHandler
} from "./api/middleware/errorHandler.js";
import { createAaRouter } from "./api/routes/aa.js";
import { createContentRouter } from "./api/routes/content.js";
import { createDescriptorRouter } from "./api/routes/descriptor.js";
import { createDiscoveryRouter } from "./api/routes/discovery.js";
import { createMediaRouter } from "./api/routes/media.js";
import { createMemoryRouter } from "./api/routes/memory.js";
import {
  createCorsMiddleware,
  createModuleDisabledHandler,
  createRateLimit,
  securityHeaders
} from "./api/middleware/posture.js";
import type { HostModuleToken } from "@livestreak/host";

// --- exports ---

export { createHostRouteDeps, bootstrapHostRouteDeps, type HostRouteDeps } from "./deps.js";
export { bootstrapHostServerConfig } from "./config/host.js";

// H6: blob uploads carry base64 payloads (manifests, evidence, media chunks)
// that exceed the default 100kb JSON limit. Raise the cap for `/content/blobs`
// ONLY — every other route keeps the conservative 100kb default so the larger
// body limit is not a global DoS surface.
const CONTENT_BLOB_BODY_LIMIT = "16mb";

export const createApp = (deps: HostRouteDeps): Express => {
  const app = express();

  // Part C: security headers + CORS allowlist on every request.
  app.set("trust proxy", true);
  app.use(securityHeaders);
  app.use(createCorsMiddleware(deps.config));

  const defaultJson = express.json();
  const blobJson = express.json({ limit: CONTENT_BLOB_BODY_LIMIT });
  app.use((req, res, next) => {
    if (req.method === "POST" && req.path === "/content/blobs") {
      blobJson(req, res, next);
      return;
    }
    defaultJson(req, res, next);
  });

  app.use(createDescriptorRouter(deps));

  // Part C: per-IP rate limit on the money / auth surfaces (paymaster, bundler,
  // content uploads) to bound free-gas drain and brute force.
  const moneyRateLimit = createRateLimit({ capacity: 120, windowMs: 60_000 });
  app.use("/aa", moneyRateLimit);
  app.use("/content", moneyRateLimit);

  // Each module either mounts its router (enabled) or a typed `503 module_disabled`
  // stub at its path prefix (disabled) so callers can tell "off" from "missing".
  mountModule(app, deps.config, "aa", "/aa", () => createAaRouter(deps.aa));
  mountModule(app, deps.config, "media", "/media", () => createMediaRouter(deps));
  mountModule(app, deps.config, "walrus_memory", "/memory", () => createMemoryRouter(deps));
  mountModule(app, deps.config, "walrus_content", "/content", () => createContentRouter(deps));
  mountModule(app, deps.config, "discovery", "/discovery", () => createDiscoveryRouter(deps));

  app.use(notFoundHandler);
  app.use(payloadTooLargeHandler);
  app.use(malformedJsonHandler);
  app.use(errorHandler);

  return app;
};

const mountModule = (
  app: Express,
  config: HostRouteDeps["config"],
  token: HostModuleToken,
  pathPrefix: string,
  buildRouter: () => ReturnType<typeof createAaRouter>
): void => {
  if (isModuleEnabled(config, token)) {
    app.use(buildRouter());
    return;
  }

  app.use(pathPrefix, createModuleDisabledHandler(token));
};

export interface BootstrappedHost {
  readonly config: ReturnType<typeof defaultHostServerConfig>;
  readonly deps: HostRouteDeps;
  readonly app: Express;
}

export const bootstrapHostServer = async (
  config: ReturnType<typeof defaultHostServerConfig> = defaultHostServerConfig()
): Promise<BootstrappedHost> => {
  const resolved = await bootstrapHostServerConfig(config);
  const aa = readAaServerConfig(resolved);
  await bootstrapAaFromConfig(aa);
  const deps = await bootstrapHostRouteDeps(resolved);
  const app = createApp(deps);
  return { config: resolved, deps, app };
};
