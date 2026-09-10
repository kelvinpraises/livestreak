import { bridgeActionScope, type HostCallFrame } from "@livestreak/schema";
import { describe, expect, it, vi } from "vitest";
import { assertNoSeedInFrame, createRelay, type DispatchFn } from "../src/gateway/remote/relay.js";
import { SessionRegistry } from "../src/gateway/session/registry.js";

const callFrame = (sessionId: string, action: string, args: unknown = {}): HostCallFrame => ({
  type: "call",
  callId: `call-${action}`,
  sessionId,
  envelope: { scope: bridgeActionScope, action, args }
});

describe("gateway/relay", () => {
  it("dispatches an authorized call and returns the bridge result (mint → tokenId)", async () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:mint"], ttlMs: 60_000 });
    const dispatch = vi.fn<DispatchFn>(async () => ({ txId: "0xabc", tokenId: "42" }));
    const relay = createRelay({ registry: reg, dispatch });

    const result = await relay.handleCall(callFrame(rec.sessionId, "mint"));
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ txId: "0xabc", tokenId: "42" });
    // Dispatch saw a NON-trusted caller (the seed-bound bridge enforces, the gateway already gated).
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].trusted).toBe(false);
  });

  it("denies an out-of-scope call WITHOUT dispatching (seed never touched)", async () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 60_000 });
    const dispatch = vi.fn<DispatchFn>(async () => ({ txId: "0x" }));
    const relay = createRelay({ registry: reg, dispatch });

    const result = await relay.handleCall(callFrame(rec.sessionId, "withdraw"));
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/not granted/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("denies and does not dispatch when the spend cap would be exceeded", async () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 60_000, spendCapUSDC: 100n });
    const dispatch = vi.fn<DispatchFn>(async () => ({ txId: "0x" }));
    const relay = createRelay({ registry: reg, dispatch });

    const result = await relay.handleCall(callFrame(rec.sessionId, "fund", { deposit: "500" }));
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/spend cap exceeded/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("commits the spend only after a successful dispatch", async () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 60_000, spendCapUSDC: 1_000n });
    const relay = createRelay({ registry: reg, dispatch: async () => ({ txId: "0x1" }) });

    await relay.handleCall(callFrame(rec.sessionId, "fund", { deposit: "400" }));
    expect(reg.get(rec.sessionId)?.spentUSDC).toBe(400n);
  });

  it("surfaces a dispatch error as a failed call_result (no throw)", async () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 60_000 });
    const relay = createRelay({
      registry: reg,
      dispatch: async () => {
        throw new Error("ERC20: transfer amount exceeds balance");
      }
    });
    const result = await relay.handleCall(callFrame(rec.sessionId, "fund"));
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/exceeds balance/);
  });

  it("seed-safety guard rejects any outbound frame containing seed material", () => {
    const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => assertNoSeedInFrame({ type: "ack", sessionId: "x" }, seed)).not.toThrow();
    const leaky = { type: "x", payload: Buffer.from(seed).toString("hex") };
    expect(() => assertNoSeedInFrame(leaky, seed)).toThrow(/seed material/);
    const leakyB64 = { type: "x", payload: Buffer.from(seed).toString("base64") };
    expect(() => assertNoSeedInFrame(leakyB64, seed)).toThrow(/seed material/);
  });
});
