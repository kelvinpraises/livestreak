// --- exports ---

export { createBookmakerBridge } from "./bridge.js";
export { authorizeBridgeCaller, requireAnyScope } from "./scope.js";
export type {
  BookmakerBridge,
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateBookmakerBridgeInput
} from "./types.js";
export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";
export { projectBookmakerPanel, projectBookmakerDescriptors } from "./panel/index.js";
export type { BookmakerPanelSnapshot } from "./panel/index.js";
