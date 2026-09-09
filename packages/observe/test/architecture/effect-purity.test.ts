import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("../..", import.meta.url).pathname;
const sourceRoot = path.join(packageRoot, "src");

const forbiddenPatterns = [
  /Effect\.runSync\s*\(/,
  /Effect\.runPromise\s*\(/,
  /Effect\.run\s*\(/,
  /NodeRuntime\.runMain\s*\(/
];

describe("observe library effect purity", () => {
  it("src/ does not call Effect.run*, Effect.runSync, Effect.runPromise, or NodeRuntime.runMain", () => {
    const violations: string[] = [];

    for (const file of collectSourceFiles(sourceRoot)) {
      if (file.includes(`${path.sep}adapters${path.sep}`)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");

      for (const [index, line] of lines.entries()) {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push(`${path.relative(packageRoot, file)}:${index + 1}: ${line.trim()}`);
          }
        }
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
