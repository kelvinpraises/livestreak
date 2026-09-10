import { bridgeActionScope, type CallActionEnvelope } from "@livestreak/schema";
import { describe, expect, it } from "vitest";
import {
  SessionRegistry,
  parseScopes,
  parseTtlMs,
  requiredScopeForAction,
  spendAmountOfEnvelope
} from "../src/gateway/session/registry.js";

const envelope = (action: string, args: unknown = {}): CallActionEnvelope => ({
  scope: bridgeActionScope,
  action,
  args
});

describe("gateway/session — scopes & ttl parsing", () => {
  it("parses granular scopes and rejects sudo / coarse grants", () => {
    expect(parseScopes("bridge:action:fund, bridge:board:read")).toEqual([
      "bridge:action:fund",
      "bridge:board:read"
    ]);
    expect(() => parseScopes("*")).toThrow(/refusing to grant/i);
    expect(() => parseScopes("bridge:action")).toThrow(/granular/i);
    expect(() => parseScopes("")).toThrow(/at least one/i);
  });

  it("parses ttl units", () => {
    expect(parseTtlMs("90s")).toBe(90_000);
    expect(parseTtlMs("30m")).toBe(1_800_000);
    expect(parseTtlMs("2h")).toBe(7_200_000);
    expect(parseTtlMs("500ms")).toBe(500);
    expect(() => parseTtlMs("nope")).toThrow(/invalid --ttl/i);
  });

  it("maps actions to granular scopes and detects spends", () => {
    expect(requiredScopeForAction("fund")).toBe("bridge:action:fund");
    expect(spendAmountOfEnvelope(envelope("fund", { deposit: "1000000" }))).toBe(1_000_000n);
    expect(spendAmountOfEnvelope(envelope("setLanes", { addDeposit: 5n }))).toBe(5n);
    expect(spendAmountOfEnvelope(envelope("withdraw", { to: "0x0" }))).toBe(0n);
  });
});

describe("gateway/session — authorization", () => {
  it("mints an expiring session and denies unknown / expired", () => {
    const reg = new SessionRegistry();
    const now = 1_000;
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 100, nowMs: now });
    expect(rec.expiresAt).toBe(1_100);
    expect(reg.authorize("nope", envelope("fund"), now).ok).toBe(false);
    expect(reg.authorize(rec.sessionId, envelope("fund"), now).ok).toBe(true);
    expect(reg.authorize(rec.sessionId, envelope("fund"), 2_000).ok).toBe(false); // expired
  });

  it("denies actions outside the granted granular scope (fund grant cannot withdraw)", () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 60_000 });
    expect(reg.authorize(rec.sessionId, envelope("fund", { deposit: "1" })).ok).toBe(true);
    const denied = reg.authorize(rec.sessionId, envelope("withdraw"));
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/bridge:action:withdraw not granted/);
  });

  it("honors a wildcard action scope but stays depth-guarded", () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:*"], ttlMs: 60_000 });
    expect(reg.authorize(rec.sessionId, envelope("fund")).ok).toBe(true);
    expect(reg.authorize(rec.sessionId, envelope("withdraw")).ok).toBe(true);
  });

  it("enforces and accumulates a per-session spend cap", () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({
      scopes: ["bridge:action:fund"],
      ttlMs: 60_000,
      spendCapUSDC: 1_000n
    });
    const first = envelope("fund", { deposit: "600" });
    expect(reg.authorize(rec.sessionId, first).ok).toBe(true);
    reg.commitSpend(rec.sessionId, first);
    expect(rec.spentUSDC).toBe(600n);
    // 600 + 600 > 1000 → denied.
    const second = envelope("fund", { deposit: "600" });
    const decision = reg.authorize(rec.sessionId, second);
    expect(decision.ok).toBe(false);
    expect(decision.error).toMatch(/spend cap exceeded/);
    // A smaller spend that fits is allowed.
    expect(reg.authorize(rec.sessionId, envelope("fund", { deposit: "400" })).ok).toBe(true);
  });

  it("builds a NON-trusted caller carrying the granular scopes + coarse bridge:action", () => {
    const reg = new SessionRegistry();
    const rec = reg.mint({ scopes: ["bridge:action:fund"], ttlMs: 60_000 });
    const caller = reg.callerFor(rec);
    expect(caller.trusted).toBe(false);
    const grant = caller.grants?.[0];
    expect(grant?.scopes).toContain("bridge:action:fund");
    expect(grant?.scopes).toContain("bridge:action"); // so the options bridge admits the call
    expect(grant?.expiresAt).toBe(rec.expiresAt);
  });
});
