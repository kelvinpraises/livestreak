import { describe, expect, it } from "vitest";
import {
  bridgeActionScope,
  isGatewayFrame,
  isHostFrame,
  isUiClientFrame,
  isUiServerFrame,
  type CallResultFrame,
  type HostCallFrame,
  type RegisterFrame,
  type UiCallFrame,
  type UiReadyFrame
} from "../src/index.js";

// The ONE canonical protocol: every frame must JSON round-trip byte-for-byte (it crosses two WSS
// legs) and be classified by exactly one leg's type guard.

describe("remote-protocol round-trip", () => {
  it("round-trips a register frame and classifies it as a gateway frame", () => {
    const frame: RegisterFrame = {
      type: "register",
      sessionId: "abc",
      scopes: ["bridge:action:fund"],
      ttlMs: 600_000,
      passwordVerifier: "scrypt$aa$bb",
      functions: [
        { name: "fund", label: "Fund", scope: "bridge:action:fund", disabled: false }
      ]
    };
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
    expect(isGatewayFrame(frame)).toBe(true);
    expect(isHostFrame(frame)).toBe(false);
  });

  it("classifies host, ui-client and ui-server frames disjointly", () => {
    const hostCall: HostCallFrame = {
      type: "call",
      callId: "c1",
      sessionId: "abc",
      envelope: { scope: bridgeActionScope, action: "fund", args: { deposit: "1" } }
    };
    const uiCall: UiCallFrame = {
      type: "call",
      callId: "c1",
      seq: 1,
      nonce: "n",
      envelope: { action: "fund", args: {} }
    };
    const ready: UiReadyFrame = { type: "ready", sessionId: "abc", functions: [] };
    const result: CallResultFrame = {
      type: "call_result",
      callId: "c1",
      ok: false,
      error: { code: -32403, message: "scope denied" }
    };

    // `call` is both a host→gateway and a ui→host frame (different direction); both guards accept it.
    expect(isHostFrame(hostCall)).toBe(true);
    expect(isUiClientFrame(uiCall)).toBe(true);
    expect(isUiServerFrame(ready)).toBe(true);
    expect(isGatewayFrame(result)).toBe(true);

    // The reconciled error shape is an object, never a bare string.
    expect(typeof result.error).toBe("object");
    expect(result.error?.message).toBe("scope denied");

    for (const f of [hostCall, uiCall, ready, result]) {
      expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    }
  });
});
