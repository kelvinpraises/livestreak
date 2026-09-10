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
/** Configurator scope — operator supplies watched subjects before the action tree becomes visible. */
export const stewardConfigScope = "steward:config" as const;
export const stewardConfigCloseScope = "steward:config:close" as const;

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
