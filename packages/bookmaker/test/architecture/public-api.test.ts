import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as bookmaker from "../../src/index.js";

const packageRoot = new URL("../..", import.meta.url).pathname;
const indexSource = readFileSync(path.join(packageRoot, "src/index.ts"), "utf8");

const requiredExports = [
  "findSimilar",
  "detectOpportunity",
  "buildVaultDraft",
  "chooseVaultAction",
  "buildCreateVaultIntent",
  "buildWriteIntentsFromDecision",
  "projectBookmakerPanel",
  "buildObservationSubscriptionInput",
  "validateObservationEvent",
  "similarityQueryToHostRequest",
  "hostSimilarityResultToBookmaker",
  "vaultDraftToHostSimilarityDraft",
  "createHostDiscoveryClient",
  "DISCOVERY_FIND_PATH",
  "validateBookmakerRuntimeConfig",
  "createBookmakerChain",
  "validateBookmakerChainConfig",
  "hasBookmakerChainAddresses",
  "originateVault",
  "createBookmakerRuntime",
  "createVaultOnce",
  "createIdempotencyStore",
  "idempotencyKeyFor",
  "idempotencyKeyFromDraft",
  "createBookmakerBridge",
  "validateBookmakerMarketContext",
  "validateBookmakerWatchSource",
  "validateVaultDraft",
  "validateCreateVaultIntent",
  "validateDetection",
  "validateSimilarityResult",
  "validateBookmakerDecision"
] as const;

const forbiddenPatterns = [
  /@livestreak\/options/,
  /packages\/options/,
  /#options/,
  /#run/,
  /#worker/,
  /host\/src/,
  /Effect\.runSync\s*\(/,
  /Effect\.runPromise\s*\(/,
  /Effect\.run\s*\(/,
  /NodeRuntime\.runMain\s*\(/
];

describe("bookmaker public API", () => {
  it("exports the workflow surface from the package root", () => {
    for (const symbol of requiredExports) {
      expect(bookmaker).toHaveProperty(symbol);
    }
  });

  it("uses explicit re-exports rather than wholesale barrels", () => {
    expect(indexSource).toMatch(/export \{ buildVaultDraft \}/);
    expect(indexSource).toMatch(/export \{ chooseVaultAction \}/);
    expect(indexSource).not.toMatch(/export \* from/);
  });
});

describe("bookmaker architecture import guards", () => {
  it("src/ and test/ avoid forbidden imports and Effect execution", () => {
    const violations: string[] = [];

    for (const file of collectSourceFiles(path.join(packageRoot, "src"))) {
      scanFile(file, violations);
    }

    for (const file of collectSourceFiles(path.join(packageRoot, "test"))) {
      scanFile(file, violations);
    }

    expect(violations).toEqual([]);
  });

  it("has no empty source or test files", () => {
    const emptyFiles: string[] = [];

    for (const file of [
      ...collectSourceFiles(path.join(packageRoot, "src")),
      ...collectSourceFiles(path.join(packageRoot, "test"))
    ]) {
      if (readFileSync(file, "utf8").trim().length === 0) {
        emptyFiles.push(path.relative(packageRoot, file));
      }
    }

    expect(emptyFiles).toEqual([]);
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

const scanFile = (file: string, violations: string[]) => {
  const relative = path.relative(packageRoot, file);
  if (relative === "test/architecture/public-api.test.ts") {
    return;
  }

  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  const isSource = relative.startsWith("src/");

  for (const [index, line] of lines.entries()) {
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line) === false) {
        continue;
      }

      if (
        isSource &&
        (pattern.source.includes("Effect\\.run") || pattern.source.includes("NodeRuntime"))
      ) {
        violations.push(`${relative}:${index + 1}: ${line.trim()}`);
        continue;
      }

      if (
        pattern.source.includes("options") ||
        pattern.source.includes("#run") ||
        pattern.source.includes("#worker") ||
        pattern.source.includes("host\\/src")
      ) {
        violations.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
    }
  }
};
