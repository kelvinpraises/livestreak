import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  type CapabilityScope,
  type RegisterFrame,
  type UiCallFrame,
  type UiHelloFrame
} from "@livestreak/schema";

// --- Remote Bridge Console wire protocol (host view) ---
//
// The frame TYPES are now the ONE canonical set in `@livestreak/schema`
// (`remote-protocol.ts`), imported by host + cli + app. This file keeps only the
// host-local helpers: byte/object decoding and the server-side required-scope
// derivation. The host re-derives the required scope from the call — it NEVER
// trusts the UI's self-asserted `envelope.scope`.

// Host-local aliases onto the canonical frames (kept so the relay reads cleanly).
export type GwRegisterMsg = RegisterFrame;
export type UiHelloMsg = UiHelloFrame;
export type UiCallMsg = UiCallFrame;

export const parseJson = (raw: unknown): Record<string, unknown> | null => {
  // Already a decoded object (in-process callers / tests) — pass through.
  if (raw !== null && typeof raw === "object" && !Buffer.isBuffer(raw) && !ArrayBuffer.isView(raw)) {
    return raw as Record<string, unknown>;
  }
  try {
    const text = typeof raw === "string" ? raw : decodeBytes(raw);
    if (text === null) {
      return null;
    }
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const decodeBytes = (raw: unknown): string | null => {
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  return null;
};

// The host re-derives the required scope from the call type — it NEVER trusts the
// UI's self-asserted `envelope.scope`. Writes require the GRANULAR
// `bridge:action:<action>` (the canonical console scope model the cli gateway also
// enforces); board reads/subscribes require their board scopes. A grant of
// `bridge:action:fund` authorizes only fund; `bridge:action:*` authorizes all.
export const requiredScopeForCall = (msg: UiCallMsg): CapabilityScope => {
  const action = msg.envelope.action ?? "";
  if (action === "board" || action === "read") {
    return bridgeBoardReadScope;
  }
  if (action === "subscribe") {
    return bridgeBoardSubscribeScope;
  }
  return `${bridgeActionScope}:${action}` as CapabilityScope;
};
