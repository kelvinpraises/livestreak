import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("../..", import.meta.url).pathname;
const architecturePath = path.join(packageRoot, "docs/architecture.md");
const architectureSource = readFileSync(architecturePath, "utf8");

describe("observe config contract documentation", () => {
  it("documents singular public sink and distinguishes internal worker sinks maps", () => {
    expect(architectureSource).toMatch(/Public run config uses singular `sink`/);
    expect(architectureSource).toMatch(/Internal worker snapshots may use `sinks` maps keyed by sink instance id/);
    expect(architectureSource).toContain(
      "Do not expose `sinks[]` in public config until kernel multi-sink attach/finalize support exists"
    );

    const configContractSection = architectureSource.slice(
      architectureSource.indexOf("## Observe Config Contract"),
      architectureSource.indexOf("## Top-Level Model")
    );

    expect(configContractSection).toContain('"sink"');
    expect(configContractSection).not.toMatch(/"sinks"\s*:/);
  });

  it("labels worker snapshot sinks map as internal state, not public config", () => {
    expect(architectureSource).toMatch(/internal worker state \/ run snapshot shape/);
    expect(architectureSource).toMatch(/Not public config \(public config uses singular "sink"\)/);
  });
});
