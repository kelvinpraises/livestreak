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

/** createVault result: txId plus the vaultId the runtime produced. */
export interface CreateVaultActionResult {
  readonly txId: import("../chains/types.js").TxId;
  readonly vaultId: import("../chains/types.js").VaultId;
}

/** Any bridge action result — configure/close acks carry no vaultId. */
export interface BookmakerActionResult {
  readonly txId: import("../chains/types.js").TxId;
  readonly vaultId?: import("../chains/types.js").VaultId;
}

export interface CreateBookmakerBridgeInput {
  readonly runtime: import("../runtime/runtime.js").BookmakerRuntime;
  /** REQUIRED clock — bookmaker src never touches the wall clock (determinism gene). */
  readonly now: () => number;
}

export interface BookmakerBridge {
  readonly runtime: import("../runtime/runtime.js").BookmakerRuntime;
  readonly readBoard: (
    caller: BridgeCaller
  ) => Promise<import("../model/watch-source.js").BookmakerPanelView>;
  readonly readControls: (
    caller: BridgeCaller
  ) => Promise<import("./panel/types.js").BookmakerPanelSnapshot>;
  readonly callAction: (
    caller: BridgeCaller,
    envelope: CallActionEnvelope
  ) => Promise<BookmakerActionResult>;
  readonly subscribeBoard: (
    caller: BridgeCaller,
    listener: (board: import("../model/watch-source.js").BookmakerPanelView) => void
  ) => () => void;
}
