import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("../..", import.meta.url).pathname;
const sourceRoot = path.join(packageRoot, "src");

const forbiddenOutsideChains = [
  /@livestreak\/wallet/,
  /from\s+["']viem["']/,
  /@livestreak\/contracts/
];

describe("market layering guards", () => {
  it("quarantines wallet, viem, and contracts imports to market/chains/**", () => {
    const violations: string[] = [];

    for (const file of collectSourceFiles(sourceRoot)) {
      if (file.includes(`${path.sep}market${path.sep}chains${path.sep}`)) {
        continue;
      }

      const relative = path.relative(packageRoot, file);
      const source = readFileSync(file, "utf8");

      for (const pattern of forbiddenOutsideChains) {
        if (pattern.test(source)) {
          violations.push(`${relative}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not use system:market cell id", () => {
    const violations: string[] = [];

    for (const file of collectSourceFiles(sourceRoot)) {
      const source = readFileSync(file, "utf8");
      if (source.includes("system:market")) {
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

    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(absolute);
    }
  }

  return files;
};
