import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("../..", import.meta.url).pathname;

describe("runtime stop architecture guards", () => {
  it("routes runtime stop through bus callFunction without worker mutation", () => {
    const runtimeSource = readFileSync(path.join(packageRoot, "src/run/runtime.ts"), "utf8");
    const stopSource = readFileSync(path.join(packageRoot, "src/run/kernel.ts"), "utf8");
    const bridgeSource = readFileSync(path.join(packageRoot, "src/bridge/bridge.ts"), "utf8");
    const storeSource = readFileSync(path.join(packageRoot, "src/run/store.ts"), "utf8");

    for (const source of [runtimeSource, stopSource, bridgeSource, storeSource]) {
      expect(source).not.toMatch(/\bWorkerState\b/);
      expect(source).not.toMatch(/\bfailWorker\b/);
      expect(source).not.toMatch(/state\.lifecycle/);
      expect(source).not.toMatch(/setStopRequested/);
      expect(source).not.toMatch(/stopRequested\s*=/);
    }

    expect(stopSource).toContain("callStoredRunFunction");
    expect(stopSource).toContain("systemRunStopScope");
    expect(bridgeSource).toContain("runtime.stopRun");
    expect(bridgeSource).toContain("systemRunStopScope");
  });
});
