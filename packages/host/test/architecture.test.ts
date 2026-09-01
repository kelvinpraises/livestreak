import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(packageDirectory, "../src");

const forbiddenPatterns = [
  /\bnode:http\b/,
  /\bnode:https\b/,
  /\bfrom\s+["'][^"']*host\/src/,
  /\bfetch\s*\(/,
  /\bcreateServer\b/,
  /\bEffect\.runPromise\b/,
  /\bEffect\.runSync\b/,
  /\bNodeRuntime\.runMain\b/
];

const listSourceFiles = (directory: string): string[] => {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
};

describe("packages/host import boundaries", () => {
  it("does not import server, fetch, or Effect execution helpers", () => {
    const violations: string[] = [];

    for (const filePath of listSourceFiles(sourceDirectory)) {
      const source = readFileSync(filePath, "utf8");
      const relativePath = path.relative(sourceDirectory, filePath);

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(source)) {
          violations.push(`${relativePath}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
