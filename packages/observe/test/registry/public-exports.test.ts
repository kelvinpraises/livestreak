import { describe, expect, it } from "vitest";
import * as Builtins from "#builtins.js";
import * as Public from "#index.js";

const publicExport = (name: string): unknown =>
  (Public as Record<string, unknown>)[name];

const builtinExport = (name: string): unknown =>
  (Builtins as Record<string, unknown>)[name];

describe("observe public exports", () => {
  it("exposes product-facing run, bridge, scope, and browser APIs", () => {
    expect(publicExport("makeObserveRun")).toBeTypeOf("function");
    expect(publicExport("browserCaptureRunConfig")).toBeTypeOf("function");
    expect(publicExport("fileCaptureRunConfig")).toBeTypeOf("function");
    expect(publicExport("validateObserveRunConfig")).toBeTypeOf("function");
    expect(publicExport("prepareObserveRun")).toBeTypeOf("function");
    expect(publicExport("startObserveRun")).toBeTypeOf("function");
    expect(publicExport("startObserveRunAsync")).toBeTypeOf("function");
    expect(publicExport("createObserveRuntime")).toBeTypeOf("function");
    expect(publicExport("createRunStore")).toBeTypeOf("function");
    expect(publicExport("createObserveBridge")).toBeTypeOf("function");
    expect(publicExport("evaluateBridgeAuthorization")).toBeTypeOf("function");
    expect(publicExport("createCapabilityGrant")).toBeTypeOf("function");
    expect(publicExport("requireAnyScope")).toBeTypeOf("function");
    expect(publicExport("hasAnyScope")).toBeTypeOf("function");
    expect(publicExport("hasScope")).toBeTypeOf("function");
    expect(publicExport("requireScope")).toBeTypeOf("function");
    expect(publicExport("createBrowserCaptureDriver")).toBeTypeOf("function");
    expect(publicExport("browserCaptureDescriptor")).toBeDefined();
    expect(publicExport("makeBrowserPageCaptureAdapter")).toBeTypeOf("function");
    expect(publicExport("buildControlCatalog")).toBeTypeOf("function");
    expect(publicExport("projectBoardControls")).toBeTypeOf("function");
    expect(publicExport("projectControlPanelControls")).toBeTypeOf("function");
    expect(publicExport("projectRefs")).toBeUndefined();
    expect(publicExport("createInitialBoard")).toBeTypeOf("function");
    expect(publicExport("callStoredRunFunction")).toBeTypeOf("function");
    expect(publicExport("bridgeBoardReadScope")).toBe("bridge:board:read");
    expect(publicExport("bridgeControlsReadScope")).toBe("bridge:controls:read");
    expect(publicExport("bridgeArtifactReadScope")).toBe("bridge:artifact:read");
    expect(publicExport("bridgeBoardSubscribeScope")).toBe("bridge:board:subscribe");
    expect(publicExport("bridgeArtifactSubscribeScope")).toBe("bridge:artifact:subscribe");
    expect(publicExport("bridgeRunAwaitScope")).toBe("bridge:run:await");
    expect(publicExport("systemRunStopScope")).toBeDefined();
    expect(publicExport("systemPausePauseScope")).toBe("system:pause:pause");
    expect(publicExport("systemPauseResumeScope")).toBe("system:pause:resume");
    expect(publicExport("systemPauseSetPresentationScope")).toBeDefined();
    expect(publicExport("browserCaptureInspectTargetsScope")).toBeDefined();
  });

  it("exposes runtime and bridge entrypoints for CLI hosts", () => {
    expect(publicExport("createObserveRuntime")).toBeTypeOf("function");
    expect(publicExport("createObserveBridge")).toBeTypeOf("function");
    expect(publicExport("browserCaptureRunConfig")).toBeTypeOf("function");
    expect(publicExport("fileCaptureRunConfig")).toBeTypeOf("function");
    expect(publicExport("validateObserveRunConfig")).toBeTypeOf("function");
    expect(publicExport("createBrowserCaptureDriver")).toBeTypeOf("function");
    expect(publicExport("projectControlPanelControls")).toBeTypeOf("function");
    expect(publicExport("projectBoardControls")).toBeTypeOf("function");
    expect(publicExport("ObserveRuntime")).toBeUndefined();
    expect(publicExport("ObserveBridge")).toBeUndefined();
  });

  it("does not expose file capture or file sink concrete factories from root", () => {
    expect(publicExport("createFileCaptureDriver")).toBeUndefined();
    expect(publicExport("createFileSinkDriver")).toBeUndefined();
    expect(publicExport("fileCaptureDescriptor")).toBeUndefined();
    expect(publicExport("fileSinkDescriptor")).toBeUndefined();
    expect(publicExport("FileCaptureConfig")).toBeUndefined();
    expect(publicExport("FileSinkConfig")).toBeUndefined();
  });

  it("does not expose control bus or board mutation internals from root", () => {
    expect(publicExport("createControlBus")).toBeUndefined();
    expect(publicExport("stageCellSurface")).toBeUndefined();
    expect(publicExport("mountSurfaceRegistry")).toBeUndefined();
    expect(publicExport("buildSurfaceFunctionIndex")).toBeUndefined();
    expect(publicExport("findSurfaceFunctionByScope")).toBeUndefined();
    expect(publicExport("mergeBoardCellOnSurfaceMount")).toBeUndefined();
    expect(publicExport("applyBoardPatch")).toBeUndefined();
    expect(publicExport("boardSettingsChanged")).toBeUndefined();
    expect(publicExport("validateBoardSettings")).toBeUndefined();
    expect(publicExport("projectWorkerControlView")).toBeUndefined();
    expect(publicExport("applyWorkerSnapshotToBoard")).toBeUndefined();
    expect(publicExport("defaultControlRun")).toBeUndefined();
    expect(publicExport("defaultControlPause")).toBeUndefined();
    expect(publicExport("defaultControlMemory")).toBeUndefined();
    expect(publicExport("defaultControlTick")).toBeUndefined();
    expect(publicExport("createSystemRunSurface")).toBeUndefined();
    expect(publicExport("createSystemPauseSurface")).toBeUndefined();
    expect(publicExport("failIfActiveHandleExists")).toBeUndefined();
    expect(publicExport("assertCatalogFunctionAdvertised")).toBeUndefined();
  });

  it("does not expose synthetic capture or browser implementation internals from root", () => {
    expect(publicExport("createSyntheticCaptureDriver")).toBeUndefined();
    expect(publicExport("syntheticCaptureDescriptor")).toBeUndefined();
    expect(publicExport("describeBrowserCaptureCell")).toBeUndefined();
    expect(publicExport("createBrowserCaptureFrameSource")).toBeUndefined();
    expect(publicExport("createBrowserCaptureControlSurface")).toBeUndefined();
    expect(publicExport("browserCaptureSurfaceCellId")).toBeUndefined();
    expect(publicExport("isBrowserCaptureControlConfig")).toBeUndefined();
    expect(publicExport("browserCaptureControlConfigKeys")).toBeUndefined();
    expect(publicExport("BrowserCaptureControlConfig")).toBeUndefined();
    expect(publicExport("BrowserCaptureClock")).toBeUndefined();
    expect(publicExport("defaultBrowserCaptureClock")).toBeUndefined();
    expect(publicExport("countLateCadenceDrops")).toBeUndefined();
    expect(publicExport("decodeSetTargetPayload")).toBeUndefined();
    expect(publicExport("decodeSetCropPayload")).toBeUndefined();
    expect(publicExport("decodeSetCaptureFpsPayload")).toBeUndefined();
  });

  it("does not expose removed or legacy control APIs from root", () => {
    expect(publicExport("createDefaultBridgeScopeEvaluator")).toBeUndefined();
    expect(publicExport("createControlTargetRegistry")).toBeUndefined();
    expect(publicExport("createBrowserCaptureControlTarget")).toBeUndefined();
    expect(publicExport("applyCaptureConfigPatch")).toBeUndefined();
    expect(publicExport("ControlState")).toBeUndefined();
    expect(publicExport("ControlCommandEnvelope")).toBeUndefined();
    expect(publicExport("createOpaqueArtifactId")).toBeUndefined();
    expect(publicExport("resetOpaqueArtifactIdSequenceForTests")).toBeUndefined();
  });

  it("builtins.ts is resolver/registry only", () => {
    expect(Builtins.builtInObserveRegistry).toBeDefined();
    expect(Builtins.getBuiltInCaptureDriver).toBeTypeOf("function");
    expect(Builtins.getBuiltInSinkDriver).toBeTypeOf("function");
    expect(builtinExport("createBrowserCaptureDriver")).toBeUndefined();
    expect(builtinExport("browserCaptureDescriptor")).toBeUndefined();
    expect(builtinExport("createFileCaptureDriver")).toBeUndefined();
  });

  it("exposes capture pause presentation contracts from the package root", () => {
    expect(publicExport("pausePresentationValues")).toBeDefined();
    expect(publicExport("capturePausePresentationEqual")).toBeTypeOf("function");
    expect(publicExport("defaultCapturePausePresentation")).toBeDefined();
    expect(publicExport("isPausePresentation")).toBeTypeOf("function");
    expect(publicExport("TimelineMarker")).toBeUndefined();
    expect(publicExport("TimelineMarkerKind")).toBeUndefined();
  });
});
