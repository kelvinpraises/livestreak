// --- exports ---

// Capability types + bridge scope constants are the CANONICAL ones from @livestreak/schema
// (re-exported so downstream imports from bridge/types.js keep compiling unchanged).
import type { BridgeCaller, CallActionEnvelope } from "@livestreak/schema";

export type {
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope
} from "@livestreak/schema";
export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "@livestreak/schema";

/** Configurator scope — operator supplies watched subjects before the action tree becomes visible. */
export const stewardConfigScope = "steward:config" as const;
export const stewardConfigCloseScope = "steward:config:close" as const;

export interface CreateStewardBridgeInput {
  readonly runtime: import("../runtime/runtime.js").StewardRuntime;
}

export interface StewardBridge {
  readonly runtime: import("../runtime/runtime.js").StewardRuntime;
  readonly readBoard: (caller: BridgeCaller) => Promise<import("../runtime/board.js").StewardBoard>;
  readonly readControls: (
    caller: BridgeCaller
  ) => Promise<import("./panel/types.js").StewardControlsView>;
  readonly callAction: (
    caller: BridgeCaller,
    envelope: CallActionEnvelope
  ) => Promise<import("../model/action-plan.js").StewardActionPlan>;
  readonly subscribeBoard: (
    caller: BridgeCaller,
    listener: (board: import("../runtime/board.js").StewardBoard) => void
  ) => () => void;
}
