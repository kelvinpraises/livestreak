import express, { type Express } from "express";
import { bootstrapAaFromConfig, readAaServerConfig } from "../services/aa/chains.js";
import { bootstrapHostServerConfig, defaultHostServerConfig, isModuleEnabled } from "../config/host.js";
import { createHostRouteDeps, type HostRouteDeps } from "./deps.js";
import {
  errorHandler,
  malformedJsonHandler,
  notFoundHandler
} from "./middleware/errorHandler.js";
import { createAaRouter } from "./routes/aa.js";
import { createContentRouter } from "./routes/content.js";
import { createDescriptorRouter } from "./routes/descriptor.js";
import { createDiscoveryRouter } from "./routes/discovery.js";
import { createMediaRouter } from "./routes/media.js";
import { createMemoryRouter } from "./routes/memory.js";

// --- exports ---

export { createHostRouteDeps, type HostRouteDeps } from "./deps.js";
export { bootstrapHostServerConfig } from "../config/host.js";

export const createApp = (deps: HostRouteDeps): Express => {
  const app = express();
  app.use(express.json());
  app.use(createDescriptorRouter(deps));

  if (isModuleEnabled(deps.config, "aa")) {
    app.use(createAaRouter(deps.aa));
  }

  if (isModuleEnabled(deps.config, "media")) {
    app.use(createMediaRouter(deps));
  }

  if (isModuleEnabled(deps.config, "walrus_memory")) {
    app.use(createMemoryRouter(deps));
  }

  if (isModuleEnabled(deps.config, "walrus_content")) {
    app.use(createContentRouter(deps));
  }

  if (isModuleEnabled(deps.config, "discovery")) {
    app.use(createDiscoveryRouter(deps));
  }

  app.use(notFoundHandler);
  app.use(malformedJsonHandler);
  app.use(errorHandler);

  return app;
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
  const deps = createHostRouteDeps(resolved);
  const app = createApp(deps);
  return { config: resolved, deps, app };
};
