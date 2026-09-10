// --- exports ---

import { LiveStreakCapabilityError, LiveStreakConfigError } from "@livestreak/core";

export type CapabilityScope =
  | `${string}:${string}`
  | `${string}:${string}:${string}`
  | "*";

export interface CapabilityGrant {
  readonly id: string;
  readonly sessionId: string;
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly expiresAt?: number;
  readonly revoked: boolean;
}

export const bridgeBoardReadScope = "bridge:board:read" as const;
export const bridgeControlsReadScope = "bridge:controls:read" as const;
export const bridgeActionScope = "bridge:action" as const;
export const bridgeBoardSubscribeScope = "bridge:board:subscribe" as const;
/** Configurator scope — operator supplies marketId before the action tree becomes visible. */
export const optionsConfigScope = "options:config" as const;

export interface BridgeCaller {
  readonly id: string;
  readonly label?: string;
  readonly trusted?: boolean;
  readonly grants?: readonly CapabilityGrant[];
}

export interface CallActionEnvelope {
  readonly scope: typeof bridgeActionScope;
  readonly action: string;
  readonly args: unknown;
}

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
