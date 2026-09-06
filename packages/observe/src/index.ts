export * from "./builtins.js";

export {
  makeObserveRun,
  browserCaptureRunConfig,
  fileCaptureRunConfig,
  validateObserveRunConfig,
  type ObserveRun,
  type ObserveRunConfig,
  type ObserveRunProcessConfig,
  type ObserveRunStageConfig,
  type ObserveRunSinkConfig,
  type BrowserCaptureConfig,
  type BrowserCaptureCrop,
  type BrowserCaptureImageEncoding,
  type BrowserCaptureViewport
} from "./run/run.js";

export {
  prepareObserveRun,
  startObserveRun,
  startObserveRunAsync,
  defaultObserveRunMaxTurns,
  type ObserveRunOutcome,
  type ObserveRunResult,
  type ObserveRunKernelOptions,
  type StartObserveRunAsyncInput,
  type WorkerRunOutcome
} from "./run/kernel.js";

export {
  callStoredRunFunction,
  createRunStore,
  getStoredRunArtifact,
  readStoredRunBoard,
  readStoredRunPanel,
  subscribeStoredRunArtifacts,
  subscribeStoredRunBoard,
  type ObserveRunHandle,
  type RunStore
} from "./run/store.js";

export {
  createObserveRuntime,
  defaultStopTimeoutMs,
  type CreateObserveRuntimeInput,
  type ObserveRuntime,
  type RuntimeKernelOptions,
  type StopRunOptions
} from "./run/runtime.js";

export {
  createInitialBoard,
  type Board,
  type BoardCell,
  type BoardCellId,
  type BoardCellStatus,
  type BoardRunStatus,
  type CreateInitialBoardInput
} from "./run/control/board/index.js";

export type {
  ControlCallEnvelope,
  ControlCallResult,
  ControlArtifact
} from "./run/control/bus/index.js";

export type {
  ArtifactSubscription,
  BoardSubscription,
  BoardPatch,
  BoardCellPatch,
  BoardSectionPatch,
  ControlCellDefinition,
  ControlFunctionResult,
  ControlPanel,
  ControlSurface,
  DescribeControlContext
} from "./run/control/bus/index.js";

export {
  buildControlCatalog,
  defaultControlCatalogVersion,
  findCatalogFunctionByScope,
  type CatalogCell,
  type CatalogFunction,
  type CatalogFunctionResult,
  type CatalogRegistryKind,
  type ControlCatalog,
  type JsonSchema
} from "./run/control/index.js";

export {
  systemPausePauseScope,
  systemPauseResumeScope,
  systemPauseSetPresentationScope
} from "./run/control/index.js";
export { systemRunStopScope } from "./run/control/index.js";

export {
  createObserveBridge,
  evaluateBridgeAuthorization,
  bridgeBoardReadScope,
  bridgeControlsReadScope,
  bridgeArtifactReadScope,
  bridgeBoardSubscribeScope,
  bridgeArtifactSubscribeScope,
  bridgeRunAwaitScope,
  type BridgeCaller,
  type BridgeRunInput,
  type BridgeCallInput,
  type BridgeArtifactInput,
  type BridgeSubscribeBoardInput,
  type BridgeSubscribeArtifactsInput,
  type BridgeStopRunInput,
  type CreateObserveBridgeInput,
  type ObserveBridge
} from "./bridge/index.js";

export {
  projectBoardControls,
  projectControlPanelControls
} from "./bridge/panel/project.js";

export { projectObserveDescriptors } from "./bridge/panel/descriptors.js";

export type {
  ControlsView,
  ControlCellView,
  ControlFunctionView
} from "./bridge/panel/types.js";

export * from "./scope/scopes.js";

export {
  browserCaptureDescriptor,
  createBrowserCaptureDriver,
  validateBrowserCaptureConfig,
  validateCaptureFps,
  validateCrop,
  validateEncoding,
  validateViewport,
  browserCaptureClearCropScope,
  browserCaptureGetPreviewScope,
  browserCaptureInspectTargetsScope,
  browserCaptureSetCaptureFpsScope,
  browserCaptureSetCropScope,
  browserCaptureSetTargetScope,
  browserPreviewTargetsArtifactKind,
  makeBrowserPageCaptureAdapter,
  makeBrowserPageFactoryCaptureAdapter,
  validateBrowserCapturePageReadiness
} from "./pipeline/capture/browser/index.js";

export type {
  BrowserCaptureControls,
  BrowserCaptureRuntimeConfigSnapshot,
  BrowserCaptureSetCaptureFpsPayload,
  BrowserCaptureSetCropPayload,
  BrowserCapturePreview,
  BrowserCaptureSetTargetPayload,
  BrowserCaptureTarget,
  BrowserCaptureTargetInspection,
  BrowserPreviewTargetsArtifactPayload,
  BrowserCaptureAdapter,
  BrowserCaptureOpenOptions,
  BrowserCapturePage,
  BrowserCaptureScreenshot,
  BrowserCaptureScreenshotOptions,
  BrowserCaptureBridgeError,
  BrowserCapturePageReadiness,
  BrowserCaptureReadinessError,
  BrowserPageCaptureAdapterKind,
  BrowserPageCaptureAdapterOptions,
  BrowserPageCaptureFactory,
  ResolvedBrowserPageCaptureAdapterKind
} from "./pipeline/capture/browser/index.js";

export * from "./pipeline/capture/index.js";
export type {
  TimelineMarker,
  TimelineMarkerKind,
  TimelineMarkerPayload
} from "./pipeline/timeline/index.js";
export * from "./pipeline/process/index.js";
export * from "./pipeline/publish/index.js";
export * from "./pipeline/registry.js";
export * from "./pipeline/shared.js";

export type {
  MarketFailurePhase,
  MarketLifecycleState,
  MarketLifecycleStatus,
  MarketRegistrar,
  MarketRegisterInput,
  MarketRegisterResult,
  ObserveRunMarketConfig,
  ObserveRunMarketOptions,
  StreamId
} from "./market/index.js";

export { observeRunStreamId } from "./market/index.js";
