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

/** Configurator scope — operator supplies market/run context before the action tree becomes visible. */
export const bookmakerConfigScope = "bookmaker:config" as const;
export const bookmakerConfigCloseScope = "bookmaker:config:close" as const;

/**
 * Result of a createVault bridge action. The runtime already produces the new
 * vaultId; the bridge now returns it alongside the txId (previously dropped) so
 * the CLI/console can reference the created vault without a second lookup.
 */
export interface CreateVaultActionResult {
  readonly txId: import("../chains/types.js").TxId;
  readonly vaultId: import("../chains/types.js").VaultId;
}

export interface CreateBookmakerBridgeInput {
  readonly runtime: import("../runtime/runtime.js").BookmakerRuntime;
}

export interface BookmakerBridge {
  readonly runtime: import("../runtime/runtime.js").BookmakerRuntime;
  readonly readBoard: (
    caller: BridgeCaller,
    nowMs: number
  ) => Promise<import("../model/watch-source.js").BookmakerPanelView>;
  readonly readControls: (
    caller: BridgeCaller,
    nowMs: number
  ) => Promise<import("./panel/types.js").BookmakerPanelSnapshot>;
  readonly callAction: (
    caller: BridgeCaller,
    envelope: CallActionEnvelope,
    nowMs: number
  ) => Promise<CreateVaultActionResult>;
  readonly subscribeBoard: (
    caller: BridgeCaller,
    listener: (board: import("../model/watch-source.js").BookmakerPanelView) => void,
    nowMs: number
  ) => () => void;
}
