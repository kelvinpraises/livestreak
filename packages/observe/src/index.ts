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
  configureObserveBoard,
  defaultFileExportConfigure,
  defaultFileLocalConfigure,
  mountObserveT0Bus,
  prepareObserveRunBoardFirst,
  startObserveRunBoardFirst,
  type SystemConfigConfigurePayload
} from "./run/board-first.js";

export {
  runConfigFromBoard,
  type RunConfigFromBoardInput
} from "./run/board-run-config.js";

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
export {
  systemRunStopScope,
  systemRunPrepareScope,
  systemRunStartScope,
  systemRunAwaitScope
} from "./run/control/index.js";
export {
  systemConfigConfigureScope,
  systemConfigCloseScope
} from "./run/control/index.js";
export {
  marketRegisterScope,
  marketGoLiveScope,
  marketSetEndedScope,
  marketCloseScope
} from "#market/control.js";
export { flowPermutationsV0, isValidFlowPermutation } from "./flows/index.js";

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

export { projectObserveDescriptors, descriptorId } from "./bridge/panel/descriptors.js";

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

// --- Local WebRTC preview sink + file→WebRTC streaming (SEAM-WEBRTC) ---
export {
  createLocalSinkDriver,
  localSinkDescriptor,
  validateLocalSinkConfig,
  type LocalSinkConfig,
  type LocalSinkDriverOptions
} from "./pipeline/publish/sinks/local/driver.js";

export {
  createHostMediatedConsumerSignaling,
  type HostMediatedConsumerSignalingInput
} from "./pipeline/publish/sinks/local/host-consumer-signaling.js";

export { resolveNodePeerConnectionFactory } from "./pipeline/publish/sinks/local/node-peer.js";

export {
  createHostMediatedSinkSignaling,
  type HostMediatedSinkSignalingInput,
  type SignalingFetch,
  type SignalingResponse
} from "./pipeline/publish/sinks/local/host-signaling.js";

export {
  createLocalSignalingHub,
  createLoopbackNetwork,
  LocalSignalingHub,
  type ConsumerSignalingChannel,
  type SinkSignalingChannel,
  type LoopbackNetwork,
  type RtcPeerConnectionLike,
  type RtcPeerConnectionFactory,
  type RtcSessionDescription,
  type RtcSdpType,
  type RtcVideoFrame,
  type RtcVideoTrackHandle,
  type RtcTrackEvent
} from "./pipeline/publish/sinks/local/signaling.js";

// --- Per-stream feed resolution (issue 7) ---
export {
  resolveStreamFeed,
  streamFeedSignalPath,
  type StreamFeed,
  type LiveStreamFeed,
  type VodStreamFeed,
  type VodPointer,
  type ResolveStreamFeedInput
} from "./market/feed.js";

export type {
  MarketFailurePhase,
  MarketLifecycleState,
  MarketLifecycleStatus,
  MarketLifecycleTxResult,
  MarketStorageScheme,
  MarketRegistrar,
  MarketRegisterInput,
  MarketRegisterResult,
  ObserveRunMarketConfig,
  ObserveRunMarketOptions,
  StreamId,
  SuiMarketRegistryConfig,
  EvmAddress,
  MarketLifecycleWriteInput,
  MarketLifecycleWriteResult
} from "./market/index.js";

export { observeRunStreamId, writeMarketLifecycle } from "./market/index.js";
export { createMarketControlSurface } from "./market/control.js";
