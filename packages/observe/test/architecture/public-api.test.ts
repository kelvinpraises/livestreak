import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const packageRoot = new URL("../..", import.meta.url).pathname;
const indexSource = readFileSync(path.join(packageRoot, "src/index.ts"), "utf8");
const browserIndexSource = readFileSync(
  path.join(packageRoot, "src/pipeline/capture/browser/index.ts"),
  "utf8"
);

const forbiddenBrowserInternalSymbols = [
  "createBrowserCaptureControlSurface",
  "browserCaptureSurfaceCellId",
  "isBrowserCaptureControlConfig",
  "browserCaptureControlConfigKeys",
  "BrowserCaptureControlConfig",
  "createBrowserCaptureFrameSource",
  "BrowserCaptureClock",
  "defaultBrowserCaptureClock",
  "countLateCadenceDrops"
];

const forbiddenWholesaleExports = [
  /export \* from "\.\/run\/control\/bus\/index\.js"/,
  /export \* from "\.\/run\/control\/board\/index\.js"/,
  /export \* from "\.\/run\/worker/,
  /export \* from "\.\/pipeline\/capture\/synthetic/,
  /export \* from "\.\/pipeline\/publish\/sinks\/file/,
  /export \* from "\.\/pipeline\/capture\/file/
];

const forbiddenInternalSymbols = [
  "createControlBus",
  "stageCellSurface",
  "mountSurfaceRegistry",
  "buildSurfaceFunctionIndex",
  "findSurfaceFunctionByScope",
  "mergeBoardCellOnSurfaceMount",
  "applyBoardPatch",
  "validateBoardSettings",
  "projectWorkerControlView",
  "applyWorkerSnapshotToBoard",
  "createSystemRunSurface",
  "createSystemPauseSurface",
  "createBrowserCaptureControlSurface",
  "browserCaptureSurfaceCellId",
  "isBrowserCaptureControlConfig",
  "browserCaptureControlConfigKeys",
  "BrowserCaptureControlConfig",
  "BrowserCaptureClock",
  "defaultBrowserCaptureClock",
  "countLateCadenceDrops",
  "createBrowserCaptureFrameSource",
  "describeBrowserCaptureCell",
  "createSyntheticCaptureDriver",
  "failIfActiveHandleExists"
];

describe("public API barrel", () => {
  it("does not wholesale-export internal bus, board, worker, or concrete file modules", () => {
    for (const pattern of forbiddenWholesaleExports) {
      expect(indexSource).not.toMatch(pattern);
    }
  });

  it("does not re-export internal implementation helpers from index.ts", () => {
    for (const symbol of forbiddenInternalSymbols) {
      expect(indexSource).not.toMatch(new RegExp(String.raw`\b${symbol}\b`));
    }
  });

  it("exports product APIs through curated barrels without internal bus/board modules", () => {
    expect(indexSource).toMatch(/createObserveRuntime/);
    expect(indexSource).toMatch(/createObserveBridge/);
    expect(indexSource).toMatch(/evaluateBridgeAuthorization/);
    expect(indexSource).toMatch(/from "\.\/run\/control\/board\/index\.js"/);
    expect(indexSource).toMatch(/from "\.\/run\/control\/bus\/index\.js"/);
    expect(indexSource).toMatch(/from "\.\/run\/control\/index\.js"/);
    expect(indexSource).not.toMatch(/from "\.\/run\/control\/bus\/bus\.js"/);
    expect(indexSource).not.toMatch(/from "\.\/run\/control\/board\/patch\.js"/);
    expect(indexSource).not.toMatch(/from "\.\/run\/control\/board\/settings\.js"/);
    expect(indexSource).not.toMatch(/from "\.\/run\/control\/board\/worker-view\.js"/);
    expect(indexSource).not.toMatch(/from "\.\/run\/control\/board\/worker-snapshot\.js"/);
  });

  it("does not export internal browser timing or control helpers from browser/index.ts", () => {
    for (const symbol of forbiddenBrowserInternalSymbols) {
      expect(browserIndexSource).not.toMatch(new RegExp(String.raw`\b${symbol}\b`));
    }
  });
});
