import { describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileSinkDescriptor } from "#pipeline/publish/sinks/file/driver.js";
import { syntheticCaptureDescriptor } from "#pipeline/capture/synthetic/driver.js";

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
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx") || filePath.endsWith(".md")) {
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

const isAllowedPortVocabularyLine = (line: string): boolean => {
  if (/porting/i.test(line)) {
    return true;
  }
  if (/\bto port:/i.test(line) || /\bDo not port:/i.test(line)) {
    return true;
  }
  if (/\| Port \/ ControlPort \|/.test(line) || /\| registerPort \|/.test(line)) {
    return true;
  }
  if (/\bport-owned function\b/.test(line)) {
    return true;
  }
  if (/ControlPort\|registerPort/.test(line)) {
    return true;
  }
  return false;
};

describe("control surface architecture guards", () => {
  it("kernel does not import browser control modules", () => {
    const kernel = readFileSync(path.join(packageRoot, "src/run/kernel.ts"), "utf8");
    expect(kernel).not.toMatch(/pipeline\/capture\/browser/);
    expect(kernel).not.toMatch(/isBrowserCaptureFrameSource/);
    expect(kernel).not.toMatch(/createBrowserCapture/);
  });

  it("run, bridge, and scope do not import browser control modules", () => {
    const runFiles = readTextFiles(path.join(packageRoot, "src/run")).filter(
      (file) => !file.includes("/pipeline/")
    );
    const bridgeFiles = readTextFiles(path.join(packageRoot, "src/bridge"));
    const scopeFiles = readTextFiles(path.join(packageRoot, "src/scope"));

    const forbidden = collectMatches(
      [...runFiles, ...bridgeFiles, ...scopeFiles],
      /#pipeline\/capture\/browser\/control/
    );

    expect(forbidden).toEqual([]);
  });

  it("pipeline imports only protocol-safe run control modules", () => {
    const pipelineFiles = readTextFiles(path.join(packageRoot, "src/pipeline"));
    const violations = collectMatches(
      pipelineFiles,
      /#run\/(kernel|worker|store|run|bridge)|#run\/control\/(board|catalog|system|bus\/(bus|registry|index))/
    );

    expect(violations).toEqual([]);
  });

  it("uses current capability scope prefixes for synthetic capture and file sink", () => {
    expect(syntheticCaptureDescriptor.capabilityScopes).toEqual(["capture:synthetic:*"]);
    expect(fileSinkDescriptor.capabilityScopes).toEqual(["sink:file:*"]);
  });

  it("does not retain stale capability scope prefixes", () => {
    const files = [
      ...readTextFiles(path.join(packageRoot, "src")),
      ...readTextFiles(path.join(packageRoot, "test")),
      ...readTextFiles(path.join(packageRoot, "docs"))
    ].filter((file) => !file.endsWith("test/architecture/control-surface.test.ts"));

    const stale = collectMatches(files, /source:synthetic|output:file/);

    expect(stale).toEqual([]);
  });

  it("does not retain removed browser capture frame source type guard", () => {
    const files = readTextFiles(path.join(packageRoot, "src"));

    const stale = collectMatches(files, /\bisBrowserCaptureFrameSource\b|\bBrowserCaptureFrameSource\b/);

    expect(stale).toEqual([]);
  });

  it("does not retain stale port vocabulary in src, test, or docs", () => {
    const files = [
      ...readTextFiles(path.join(packageRoot, "src")),
      ...readTextFiles(path.join(packageRoot, "test")),
      ...readTextFiles(path.join(packageRoot, "docs"))
    ].filter((file) => !file.endsWith("test/architecture/control-surface.test.ts"));

    const forbiddenPatterns = [
      /\b(ControlPort|registerPort|createBrowserCapturePort|createSystemRunPort|createSystemPausePort)\b/,
      /ports:\s*\[/,
      /\bPort-owned\b/,
      /\bport-owned\b/,
      /\blive Port\b/,
      /\bcapture:browser Port\b/,
      /\bbrowser port\b/i,
      /\bregister ports\b/i,
      /\bcreate ports\b/i,
      /\bbus ports\b/i,
      /\bsystem port\b/i,
      /\bCapture port\b/,
      /\bSink port\b/,
      /\bport context\b/i,
      /\bport factories\b/i,
      /\bport facts\b/i,
      /control\/port\.ts/,
      /isBrowserCaptureFrameSource\b/,
      /\bBrowserCaptureFrameSource\b/
    ];

    const stale = forbiddenPatterns.flatMap((pattern) => collectMatches(files, pattern));

    expect(stale.filter((match) => !isAllowedPortVocabularyLine(match.split(":").slice(2).join(":")))).toEqual(
      []
    );
  });

  it("does not retain top-level controls or stale board file paths", () => {
    expect(existsSync(path.join(packageRoot, "src/controls"))).toBe(false);
    expect(existsSync(path.join(packageRoot, "src/run/control/board.ts"))).toBe(false);
    expect(existsSync(path.join(packageRoot, "src/run/control/board/model.ts"))).toBe(true);
    expect(existsSync(path.join(packageRoot, "src/run/control/board/index.ts"))).toBe(true);
    expect(existsSync(path.join(packageRoot, "src/bridge/panel/project.ts"))).toBe(true);

    const files = [
      ...readTextFiles(path.join(packageRoot, "src")),
      ...readTextFiles(path.join(packageRoot, "test")),
      ...readTextFiles(path.join(packageRoot, "docs"))
    ].filter((file) => !file.endsWith("test/architecture/control-surface.test.ts"));

    expect(collectMatches(files, /#controls\//)).toEqual([]);
    expect(collectMatches(files, /#run\/control\/board\.js/)).toEqual([]);
  });

  it("splits browser capture driver ownership across stage modules", () => {
    for (const relativePath of [
      "src/pipeline/capture/browser/descriptor.ts",
      "src/pipeline/capture/browser/config.ts",
      "src/pipeline/capture/browser/cell.ts",
      "src/pipeline/capture/browser/source.ts",
      "src/pipeline/capture/browser/driver.ts"
    ]) {
      expect(existsSync(path.join(packageRoot, relativePath))).toBe(true);
    }

    const driverLines = readFileSync(
      path.join(packageRoot, "src/pipeline/capture/browser/driver.ts"),
      "utf8"
    ).split("\n").length;

    expect(driverLines).toBeLessThanOrEqual(120);
  });

  it("delegates bridge authorization to scope and keeps scope pure", () => {
    const bridgeSource = readFileSync(path.join(packageRoot, "src/bridge/bridge.ts"), "utf8");
    expect(bridgeSource).toMatch(/#scope\/scopes\.js/);
    expect(bridgeSource).not.toMatch(/grants\.includes\(requiredScope\)/);
    expect(bridgeSource).not.toMatch(/BridgeScopeEvaluator/);
    expect(bridgeSource).not.toMatch(/scopeEvaluator/);
    expect(bridgeSource).not.toMatch(/createDefaultBridgeScopeEvaluator/);

    const scopeFiles = readTextFiles(path.join(packageRoot, "src/scope"));
    expect(collectMatches(scopeFiles, /#bridge|#run\/|#pipeline\//)).toEqual([]);
    expect(collectMatches(scopeFiles, /Effect\.run|Effect\.runPromise|Effect\.runSync|NodeRuntime\.runMain/)).toEqual(
      []
    );

    const pipelineScopeImports = collectMatches(
      readTextFiles(path.join(packageRoot, "src/pipeline")),
      /from "#scope\/scopes\.js"/
    );
    for (const match of pipelineScopeImports) {
      const line = match.split(":").slice(2).join(":");
      expect(line.startsWith("import type") || line.includes("export type")).toBe(true);
    }

    expect(existsSync(path.join(packageRoot, "src/gateway"))).toBe(false);
  });

  it("defines CapabilityScope in scope, not pipeline shared", () => {
    const scopeSource = readFileSync(path.join(packageRoot, "src/scope/scopes.ts"), "utf8");
    const sharedSource = readFileSync(path.join(packageRoot, "src/pipeline/shared.ts"), "utf8");

    expect(scopeSource).toMatch(/export type CapabilityScope/);
    expect(scopeSource).not.toMatch(/#pipeline\//);
    expect(sharedSource).not.toMatch(/^export type CapabilityScope/m);
    expect(sharedSource).toMatch(/from "#scope\/scopes\.js"/);
  });
});
