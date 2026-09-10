import { describe, expect, it } from "vitest";
import type { FunctionDescriptor } from "@livestreak/schema";
import { mergeConsoleDescriptors, buildConsoleRoutes } from "../src/gateway/console/edge.js";
import type { ConsoleEdge } from "../src/gateway/console/edge.js";

const edge = (
  pkg: ConsoleEdge["package"],
  fns: readonly FunctionDescriptor[]
): ConsoleEdge => ({
  package: pkg,
  describeFunctions: async () => fns,
  dispatch: async () => ({ txId: "0x1" })
});

describe("console-edge", () => {
  it("mergeConsoleDescriptors dedupes by id not name", async () => {
    const merged = await mergeConsoleDescriptors([
      edge("options", [
        { id: "options.a.fund", package: "options", name: "fund", label: "Fund", scope: "bridge:action:fund" }
      ]),
      edge("bookmaker", [
        { id: "bookmaker.a.fund", package: "bookmaker", name: "fund", label: "Fund", scope: "bridge:action:fund" }
      ])
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((f) => f.id)).toEqual(["options.a.fund", "bookmaker.a.fund"]);
  });

  it("buildConsoleRoutes keys by package:name and id", async () => {
    const routes = await buildConsoleRoutes([
      edge("options", [
        { id: "options.config.configure", package: "options", name: "configure", label: "Configure", scope: "bridge:action:configure" }
      ])
    ]);
    expect(routes.get("options:configure")?.package).toBe("options");
    expect(routes.get("options.config.configure")?.package).toBe("options");
  });
});
