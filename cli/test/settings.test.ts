import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildDefaultSettings, ensureSettings, loadSettings } from "../src/prefs/settings.js";
import { resolveChainAdapter } from "../src/gateway/auth/chain-registry.js";

describe("prefs/settings", () => {
  it("buildDefaultSettings floats the wallet/contracts blob (deployment ref, no baked addresses)", () => {
    const doc = buildDefaultSettings("http://127.0.0.1:8787");
    expect(doc.host.url).toBe("http://127.0.0.1:8787");
    expect(doc.defaultChain).toBe("eip155:31337");
    const chain = doc.chains["eip155:31337"];
    expect(chain?.deployment).toBe("@livestreak/contracts/evm/deployments/localhost");
    // Contracts are NOT baked into settings.json — the chain adapter derives them from the deployment.
    expect(chain?.contracts).toBeUndefined();
    expect(resolveChainAdapter("eip155:31337").deriveContracts().marketRegistry).toMatch(/^0x/);
  });

  it("ensureSettings auto-creates settings.json on first access", async () => {
    const dir = await mkdtemp(join(tmpdir(), "livestreak-settings-"));
    const path = join(dir, "settings.json");
    const doc = await ensureSettings(path);
    expect(doc.host.url).toBe("http://127.0.0.1:8787");
    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("seed");
    const roundTrip = await loadSettings(path);
    expect(roundTrip.defaultChain).toBe(doc.defaultChain);
  });
});
