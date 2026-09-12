// Canonical Remote Bridge Console wire protocol (Objective 4 — the ONE shared shape).
//
// Promoted here from three drifting per-package copies (host `services/remote/protocol.ts`, cli
// `gateway/protocol.ts`, app `utils/remote-transport.ts`) so host + cli + app import ONE definition
// and can never drift again. `@livestreak/schema` is the home because it is the only package all
// three already depend on, and it already owns every payload type these frames carry
// (`CapabilityGrant`, `CapabilityScope`, `CallActionEnvelope`, `FunctionDescriptor`).
//
// Two encrypted WSS legs:
//   leg A  gateway (cli)  ⇄ host   — register / call_result / board_patch / revoke ⇄ ack / call / session_closed
//   leg B  browser (app)  ⇄ host   — ui.hello / call ⇄ ready / functions / call_result / board_patch / revoked / error
//
// SCOPE MODEL: the remote console authorizes on GRANULAR `bridge:action:<action>` (writes) and
// `bridge:board:read` (reads) — the model the cli gateway already enforces (it rejects the coarse
// `bridge:action` and `*`). Each package's internal catalog scope (e.g. options' `options:vault:fund`)
// is normalized to the console scope `bridge:action:<name>` at the gateway projection boundary, so
// console authz is uniform and package-agnostic. The operator grants e.g. `bridge:action:fund` (one
// action) or `bridge:action:*` (all actions); the depth-guarded matcher authorizes accordingly.

import type { CallActionEnvelope, CapabilityGrant, CapabilityScope } from "./capability.js";
import type { FunctionDescriptor } from "./descriptor.js";

// Shared payloads -------------------------------------------------------------
export interface RemoteCallError {
  readonly code?: string | number;
  readonly message: string;
}
export interface RemoteCallOutcome {
  readonly txId?: string;
  readonly tokenId?: string;
}
export type SessionClosedReason = "ttl_expired" | "revoked" | "gateway_down";

// ── leg A: gateway → host ────────────────────────────────────────────────────
export interface RegisterFrame {
  readonly type: "register";
  readonly sessionId: string;
  readonly scopes: readonly CapabilityScope[];
  readonly ttlMs: number;
  // scrypt verifier `scrypt$<saltHex>$<hashHex>` — the host verifies `/join` against it and NEVER
  // sees the pairing password plaintext.
  readonly passwordVerifier: string;
  // The gateway's scope-filtered, console-normalized function catalog (the UI renders from these).
  readonly functions?: readonly FunctionDescriptor[];
  // Optional leg-A auth: when the host sets a gateway token, register must present a matching value.
  readonly gatewayToken?: string;
}
export interface RevokeFrame {
  readonly type: "revoke";
  readonly sessionId: string;
}
export interface CallResultFrame {
  readonly type: "call_result";
  readonly callId: string;
  readonly sessionId?: string;
  readonly ok: boolean;
  readonly result?: RemoteCallOutcome;
  readonly error?: RemoteCallError;
}
export interface BoardPatchFrame {
  readonly type: "board_patch";
  readonly sessionId: string;
  readonly target?: string;
  readonly board: unknown;
}
// Sent when a board change reveals/hides actions (board-first reveal) so the gateway can re-project
// and re-push the catalog. The host forwards it to the UI as a UiFunctionsFrame (scope-filtered).
export interface GatewayFunctionsFrame {
  readonly type: "functions";
  readonly sessionId: string;
  readonly functions: readonly FunctionDescriptor[];
}
export type GatewayFrame =
  | RegisterFrame
  | RevokeFrame
  | CallResultFrame
  | BoardPatchFrame
  | GatewayFunctionsFrame;

// ── leg A: host → gateway ────────────────────────────────────────────────────
export interface AckFrame {
  readonly type: "ack";
  readonly sessionId: string;
  readonly remoteUrl?: string;
}
export interface HostCallFrame {
  readonly type: "call";
  readonly callId: string;
  readonly sessionId: string;
  readonly target?: string;
  readonly envelope: CallActionEnvelope;
}
export interface SessionClosedFrame {
  readonly type: "session_closed";
  readonly sessionId: string;
  readonly reason: SessionClosedReason;
}
export type HostFrame = AckFrame | HostCallFrame | SessionClosedFrame;

// ── leg B: UI → host ─────────────────────────────────────────────────────────
export interface UiHelloFrame {
  readonly type: "ui.hello";
  readonly sessionId: string;
  readonly grant: CapabilityGrant;
  readonly seq: number;
}
export interface UiCallFrame {
  readonly type: "call";
  readonly callId: string;
  readonly seq: number;
  readonly nonce: string;
  readonly target?: string;
  readonly envelope: {
    readonly scope?: string;
    readonly action: string;
    readonly id?: string;
    readonly args?: unknown;
  };
}
export type UiClientFrame = UiHelloFrame | UiCallFrame;

// ── leg B: host → UI ─────────────────────────────────────────────────────────
export interface UiReadyFrame {
  readonly type: "ready";
  readonly sessionId: string;
  readonly functions?: readonly FunctionDescriptor[];
}
export interface UiFunctionsFrame {
  readonly type: "functions";
  readonly functions: readonly FunctionDescriptor[];
}
export interface UiCallResultFrame {
  readonly type: "call_result";
  readonly callId: string;
  readonly ok: boolean;
  readonly result?: RemoteCallOutcome;
  readonly error?: RemoteCallError;
}
export interface UiBoardPatchFrame {
  readonly type: "board_patch";
  readonly target?: string;
  readonly board: unknown;
}
export interface UiRevokedFrame {
  readonly type: "revoked";
}
export interface UiServerErrorFrame {
  readonly type: "error";
  readonly code: number;
  readonly message: string;
}
export type UiServerFrame =
  | UiReadyFrame
  | UiFunctionsFrame
  | UiCallResultFrame
  | UiBoardPatchFrame
  | UiRevokedFrame
  | UiServerErrorFrame;

// Type guards (cheap `type` discriminators; full validation stays at each boundary) ----------------
const typeOf = (value: unknown): string | undefined =>
  value !== null && typeof value === "object"
    ? (value as { type?: unknown }).type as string | undefined
    : undefined;

const GATEWAY_TYPES = new Set(["register", "revoke", "call_result", "board_patch", "functions"]);
const HOST_TYPES = new Set(["ack", "call", "session_closed"]);
const UI_CLIENT_TYPES = new Set(["ui.hello", "call"]);
const UI_SERVER_TYPES = new Set([
  "ready",
  "functions",
  "call_result",
  "board_patch",
  "revoked",
  "error"
]);

export const isGatewayFrame = (value: unknown): value is GatewayFrame =>
  GATEWAY_TYPES.has(typeOf(value) ?? "");
export const isHostFrame = (value: unknown): value is HostFrame =>
  HOST_TYPES.has(typeOf(value) ?? "");
export const isUiClientFrame = (value: unknown): value is UiClientFrame =>
  UI_CLIENT_TYPES.has(typeOf(value) ?? "");
export const isUiServerFrame = (value: unknown): value is UiServerFrame =>
  UI_SERVER_TYPES.has(typeOf(value) ?? "");
