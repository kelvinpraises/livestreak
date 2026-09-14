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

export interface CreateOptionsBridgeInput {
  readonly runtime: import("../runtime/runtime.js").OptionsRuntime;
}

export interface OptionsBridge {
  readonly runtime: import("../runtime/runtime.js").OptionsRuntime;
  readonly readBoard: (caller: BridgeCaller) => Promise<import("../runtime/board.js").OptionsBoard>;
  readonly readControls: (caller: BridgeCaller) => Promise<import("./panel/types.js").OptionsControlsView>;
  readonly readClaims: (
    caller: BridgeCaller
  ) => Promise<import("../model/claims.js").OptionsClaimsView>;
  readonly readPnl: (
    caller: BridgeCaller,
    investedUSDC?: bigint
  ) => Promise<import("../model/math/pnl.js").OptionsSessionPnlView>;
  readonly readStreamState: (
    caller: BridgeCaller,
    marketId: import("../model/ids.js").MarketId
  ) => Promise<import("../model/stream.js").OptionsStreamState>;
  readonly previewAccrual: (
    caller: BridgeCaller,
    input: import("../model/math/accrual.js").PreviewAccrualInput
  ) => Promise<import("../model/math/accrual.js").OptionsAccrualPreview>;
  readonly callAction: (
    caller: BridgeCaller,
    envelope: CallActionEnvelope
  ) => Promise<
    import("../chains/types.js").TxId | import("../chains/types.js").MintResult
  >;
  readonly subscribeBoard: (
    caller: BridgeCaller,
    listener: (board: import("../runtime/board.js").OptionsBoard) => void
  ) => () => void;
  readonly watch: (
    caller: BridgeCaller,
    key: string,
    listener: (value: unknown) => void
  ) => () => void;
}
