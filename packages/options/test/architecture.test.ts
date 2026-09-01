import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("..", import.meta.url).pathname;
const sourceRoot = path.join(packageRoot, "src");

const forbiddenEffectPatterns = [
  /Effect\.runSync\s*\(/,
  /Effect\.runPromise\s*\(/,
  /Effect\.run\s*\(/,
  /NodeRuntime\.runMain\s*\(/
];

const forbiddenNodePatterns = [/from\s+["']node:/, /require\(\s*["']node:/];

const forbiddenImportPatterns = [
  /@livestreak\/observe/,
  /@livestreak\/bookmaker/,
  /@livestreak\/steward/,
  /cli\//,
  /host\/src/,
  /\.\.\/observe/,
  /\.\.\/bookmaker/,
  /\.\.\/steward/
];

const staleTermPatterns = [
  /\bcreateVault\b/,
  /\bcreateMarket\b/,
  /\bcreateOption\b/,
  /\bmakeLiveStreakClient\b/
];

describe("options architecture guards", () => {
  it("src/index.ts is re-export only", () => {
    const indexSource = readFileSync(path.join(sourceRoot, "index.ts"), "utf8").trim();

    expect(indexSource).not.toMatch(/\bfunction\b/);
    expect(indexSource).not.toMatch(/\bclass\b/);
    expect(indexSource).toMatch(/^export /m);
  });

  it("src/ does not call Effect.run* or NodeRuntime.runMain", () => {
    expect(collectViolations(sourceRoot, forbiddenEffectPatterns)).toEqual([]);
  });

  it("src/ does not import node:* modules", () => {
    expect(collectViolations(sourceRoot, forbiddenNodePatterns)).toEqual([]);
  });

  it("src/ does not import observe, bookmaker, steward, cli, or host server code", () => {
    expect(collectViolations(sourceRoot, forbiddenImportPatterns)).toEqual([]);
  });

  it("src/ does not use stale creation-center terms", () => {
    const violations = collectViolations(sourceRoot, staleTermPatterns).filter(
      (entry) => entry.includes("index.ts") === false
    );

    expect(violations).toEqual([]);
  });

  it("has no empty source or test files", () => {
    const roots = [sourceRoot, path.join(packageRoot, "test")];
    const emptyFiles: string[] = [];

    for (const root of roots) {
      for (const file of collectSourceFiles(root)) {
        if (readFileSync(file, "utf8").trim().length === 0) {
          emptyFiles.push(path.relative(packageRoot, file));
        }
      }
    }

    expect(emptyFiles).toEqual([]);
  });
});

const collectViolations = (directory: string, patterns: RegExp[]): string[] => {
  const violations: string[] = [];

  for (const file of collectSourceFiles(directory)) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");

    for (const [index, line] of lines.entries()) {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          violations.push(`${path.relative(packageRoot, file)}:${index + 1}: ${line.trim()}`);
        }
      }
    }
  }

  return violations;
};

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
