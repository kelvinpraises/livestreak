import { describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const packageRoot = new URL("../..", import.meta.url).pathname;

const readTextFiles = (directory: string): readonly string[] => {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      files.push(...readTextFiles(filePath));
      continue;
    }
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      files.push(filePath);
    }
  }

  return files;
};

const collectMatches = (
  files: readonly string[],
  pattern: RegExp
): readonly string[] => {
  const matches: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const [index, line] of content.split("\n").entries()) {
      if (pattern.test(line)) {
        matches.push(`${path.relative(packageRoot, file)}:${index + 1}:${line.trim()}`);
      }
    }
  }

  return matches;
};

describe("bridge panel architecture guards", () => {
  it("keeps bridge/panel pure and free of pipeline, worker, builtins, effect, and artifact payload imports", () => {
    const panelFiles = readTextFiles(path.join(packageRoot, "src/bridge/panel"));

    expect(collectMatches(panelFiles, /#pipeline/)).toEqual([]);
    expect(collectMatches(panelFiles, /#run\/worker/)).toEqual([]);
    expect(collectMatches(panelFiles, /#builtins/)).toEqual([]);
    expect(collectMatches(panelFiles, /#run\/control\/bus\/artifacts/)).toEqual([]);
    expect(collectMatches(panelFiles, /from "effect"/)).toEqual([]);
    expect(collectMatches(panelFiles, /from 'effect'/)).toEqual([]);
    expect(collectMatches(panelFiles, /Effect\./)).toEqual([]);
    expect(collectMatches(panelFiles, /Effect\.run/)).toEqual([]);
    expect(collectMatches(panelFiles, /NodeRuntime\.runMain/)).toEqual([]);
    expect(collectMatches(panelFiles, /#cli/)).toEqual([]);
    expect(collectMatches(panelFiles, /gateway/i)).toEqual([]);
  });

  it("does not reintroduce top-level controls paths", () => {
    expect(existsSync(path.join(packageRoot, "src/controls"))).toBe(false);

    const repoFiles = [
      ...readTextFiles(path.join(packageRoot, "src")),
      ...readTextFiles(path.join(packageRoot, "test"))
    ];

    expect(collectMatches(repoFiles, /#controls\//)).toEqual([]);
  });

  it("does not export internal panel helpers from project.ts", () => {
    const projectSource = readFileSync(path.join(packageRoot, "src/bridge/panel/project.ts"), "utf8");

    expect(projectSource).not.toMatch(/export const projectRefs/);
    expect(projectSource).not.toMatch(/export const projectReferences/);
  });
});
