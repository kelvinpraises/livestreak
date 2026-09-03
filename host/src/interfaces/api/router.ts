import type { HostModuleToken } from "@livestreak/host";
import { isModuleEnabled } from "../../config/host.js";
import type { HostRouteDeps } from "./deps.js";
import type { HostModuleRegistration } from "./router-registry.js";
import { aaRoutes } from "./routes/aa.js";
import { contentRoutes } from "./routes/content.js";
import { descriptorRoutes } from "./routes/descriptor.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { mediaRoutes } from "./routes/media.js";
import { memoryRoutes } from "./routes/memory.js";
import { runtimeRoutes } from "./routes/runtime.js";
import { tenancyRoutes } from "./routes/tenancy.js";

// --- exports ---

export { descriptorRoutes } from "./routes/descriptor.js";

export const createHostModules = (deps: HostRouteDeps): HostModuleRegistration[] => [
  {
    token: "aa",
    enabled: isModuleEnabled(deps.config, "aa"),
    routes: aaRoutes()
  },
  {
    token: "media",
    enabled: isModuleEnabled(deps.config, "media"),
    routes: mediaRoutes()
  },
  {
    token: "walrus_memory",
    enabled: isModuleEnabled(deps.config, "walrus_memory"),
    routes: memoryRoutes()
  },
  {
    token: "walrus_content",
    enabled: isModuleEnabled(deps.config, "walrus_content"),
    routes: contentRoutes()
  },
  {
    token: "discovery",
    enabled: isModuleEnabled(deps.config, "discovery"),
    routes: discoveryRoutes()
  },
  {
    token: "runtime",
    enabled: isModuleEnabled(deps.config, "runtime"),
    routes: runtimeRoutes()
  },
  {
    token: "tenancy",
    enabled: isModuleEnabled(deps.config, "tenancy"),
    routes: tenancyRoutes()
  }
];
