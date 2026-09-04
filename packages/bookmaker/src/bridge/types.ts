// --- exports ---

import { LiveStreakCapabilityError } from "@livestreak/core";

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

export interface CreateBookmakerBridgeInput {
  readonly runtime: import("../runtime/runtime.js").BookmakerRuntime;
}

export interface BookmakerBridge {
  readonly runtime: import("../runtime/runtime.js").BookmakerRuntime;
  readonly readBoard: (
    caller: BridgeCaller,
    nowMs: number
  ) => Promise<import("../model/panel.js").BookmakerPanelView>;
  readonly readControls: (
    caller: BridgeCaller,
    nowMs: number
  ) => Promise<import("./panel/types.js").BookmakerPanelSnapshot>;
  readonly callAction: (
    caller: BridgeCaller,
    envelope: CallActionEnvelope,
    nowMs: number
  ) => Promise<import("../chains/types.js").TxId>;
  readonly subscribeBoard: (
    caller: BridgeCaller,
    listener: (board: import("../model/panel.js").BookmakerPanelView) => void,
    nowMs: number
  ) => () => void;
}
