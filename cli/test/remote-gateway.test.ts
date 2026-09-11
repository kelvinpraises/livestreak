import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionWallet } from "@livestreak/schema";
import { createConsoleEdges } from "../src/gateway/console/edges.js";
import { mergeConsoleDescriptors } from "../src/gateway/console/edge.js";
import { buildDefaultSettings } from "../src/prefs/settings.js";
import { resolveOperator } from "../src/gateway/auth/identity.js";

vi.mock("../src/gateway/auth/session-wallet.js", () => ({
  buildSessionWallet: async (settings: { defaultChain: string }, seed: string | Uint8Array): Promise<SessionWallet> => ({
    chain: settings.defaultChain,
    seed,
    walletInit: {
      chain: "evm",
      seedSource: "signature-derived",
      config: {}
    },
    operatorAddress: `0x${"11".repeat(20)}`
  })
}));

describe("remote console gateway integration", () => {
  it("observe T0 exposes only system:config; options exposes options:config — no cross-package merge", async () => {
    await mkdtemp(join(tmpdir(), "livestreak-remote-e2e-"));
    const settings = buildDefaultSettings();
    const { seed } = resolveOperator("test-password-remote-e2e");
    const { buildSessionWallet } = await import("../src/gateway/auth/session-wallet.js");
    const sessionWallet = await buildSessionWallet(settings, seed);
    const runId = "remote-e2e-test";

    const edges = createConsoleEdges({ settings, sessionWallet, runId });
    expect(edges.map((e) => e.package)).toEqual(["options", "bookmaker", "observe", "steward"]);

    const merged = await mergeConsoleDescriptors(edges);
    const observeFns = merged.filter((f) => f.package === "observe");
    const optionsFns = merged.filter((f) => f.package === "options");

    expect(observeFns.some((f) => f.id === "observe.system.config.configure")).toBe(true);
    expect(observeFns.filter((f) => f.visible !== false).every((f) => f.id.startsWith("observe.system.config"))).toBe(
      true
    );

    expect(optionsFns.some((f) => f.id.includes("options.config") && f.name === "configure")).toBe(true);

    const namesByPackage = new Map<string, Set<string>>();
    for (const fn of merged) {
      const set = namesByPackage.get(fn.package) ?? new Set();
      set.add(fn.name);
      namesByPackage.set(fn.package, set);
    }
    expect(namesByPackage.get("options")?.has("configure")).toBe(true);
    expect(namesByPackage.get("bookmaker")?.has("configure")).toBe(true);
    expect(namesByPackage.get("steward")?.has("configure")).toBe(true);
  });
});
