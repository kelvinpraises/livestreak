import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVaultDraft } from "../../src/pipeline/draft/build.js";
import { projectBookmakerPanel } from "../../src/bridge/panel/project.js";
import { detection, marketContext } from "../helpers/fixtures.js";

const packageRoot = new URL("../..", import.meta.url).pathname;

describe("bookmaker time determinism", () => {
  it("builds vault draft expiry from explicit nowMs", () => {
    const draft = buildVaultDraft(detection({ durationSeconds: 120 }), marketContext(), {
      fundingToken: "0xusdc",
      nowMs: 2_000
    });

    expect(draft.resolutionWindow).toEqual({
      opensAtMs: 2_000,
      expiresAtMs: 122_000
    });
  });

  it("projects panel updatedAtMs without wall-clock fallback", () => {
    const panel = projectBookmakerPanel({
      runtimeId: "bookmaker-1",
      marketContext: marketContext()
    });

    expect(panel.updatedAtMs).toBe(0);
  });

  it("does not call Date.now() anywhere in src/", () => {
    const violations: string[] = [];

    for (const file of collectSourceFiles(path.join(packageRoot, "src"))) {
      const source = readFileSync(file, "utf8");
      if (source.includes("Date.now(")) {
        violations.push(path.relative(packageRoot, file));
      }
    }

    expect(violations).toEqual([]);
  });
});

const collectSourceFiles = (directory: string): string[] => {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry);
    const stats = statSync(absolute);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(absolute));
      continue;
    }

    if (entry.endsWith(".ts") && entry.endsWith(".d.ts") === false) {
      files.push(absolute);
    }
  }

  return files;
};
