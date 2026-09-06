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

// WAVE 5 (BUILD decision): the steward runtime now CONSUMES the owning packages' published surfaces
// for its injected-port adapters (@livestreak/contracts reads, @livestreak/host descriptor types,
// @livestreak/observe board, @livestreak/wallet for Sui). Those package-root imports are sanctioned.
// What stays forbidden is reaching into another package's INTERNALS (deep `#run`/`#worker`/`#bridge`
// subpaths, `host/src`, `packages/options|bookmaker` source) and pulling in options/bookmaker at all.
const forbiddenImportPatterns = [
  /@livestreak\/options/,
  /@livestreak\/bookmaker/,
  /@flowstream\/contracts/,
  /packages\/options/,
  /packages\/bookmaker/,
  /#run/,
  /#worker/,
  /#bridge/,
  /host\/src/
];

const forbiddenCreationPatterns = [/\bcreateMarket\b/, /\bcreateVault\b/, /\bstoreForumThread\b/];

describe("steward architecture guards", () => {
  it("keeps top-level src folders in house shape", () => {
    const topLevel = readdirSync(sourceRoot).filter((entry) => {
      const absolute = path.join(sourceRoot, entry);
      return statSync(absolute).isDirectory();
    });

    expect(topLevel.sort()).toEqual(["bridge", "model", "runtime", "validate", "workflow"]);
    expect(readdirSync(sourceRoot)).not.toContain("panel");
  });

  it("src/index.ts is re-export only", () => {
    const indexSource = readFileSync(path.join(sourceRoot, "index.ts"), "utf8").trim();

    expect(indexSource).not.toMatch(/\bfunction\b/);
    expect(indexSource).not.toMatch(/\bclass\b/);
    expect(indexSource).toMatch(/^export /m);
  });

  it("src/ does not call Effect.run* or NodeRuntime.runMain", () => {
    expect(collectViolations(sourceRoot, forbiddenEffectPatterns)).toEqual([]);
  });

  it("src/ does not import options/bookmaker, or reach into another package's internals", () => {
    expect(collectViolations(sourceRoot, forbiddenImportPatterns)).toEqual([]);
  });

  it("src/ does not define market, vault, or forum storage creation APIs", () => {
    expect(collectViolations(sourceRoot, forbiddenCreationPatterns)).toEqual([]);
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

  it("typechecks tests via tsconfig.json and builds src via tsconfig.build.json", () => {
    const tsconfig = JSON.parse(readFileSync(path.join(packageRoot, "tsconfig.json"), "utf8")) as {
      include?: string[];
      compilerOptions?: { noEmit?: boolean };
    };
    const buildConfig = JSON.parse(
      readFileSync(path.join(packageRoot, "tsconfig.build.json"), "utf8")
    ) as { include?: string[] };

    expect(tsconfig.include).toEqual(expect.arrayContaining(["src", "test"]));
    expect(tsconfig.compilerOptions?.noEmit).toBe(true);
    expect(buildConfig.include).toEqual(["src"]);
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
