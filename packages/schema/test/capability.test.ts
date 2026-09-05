import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  capabilityGrantSigningBytes,
  createCapabilityGrant,
  hasAnyScope,
  hasScope,
  scopeMatchesGrant,
  type CapabilityGrant
} from "../src/capability.js";

describe("scopeMatchesGrant — depth-guarded semantics (the security-critical regression)", () => {
  it("wildcard `*` matches everything", () => {
    expect(scopeMatchesGrant("*", "a:b")).toBe(true);
    expect(scopeMatchesGrant("*", "a:b:c")).toBe(true);
  });

  it("exact equality matches", () => {
    expect(scopeMatchesGrant("a:b:c", "a:b:c")).toBe(true);
    expect(scopeMatchesGrant("a:b", "a:b")).toBe(true);
  });

  it("`a:b:*` matches `a:b:c` (depth+1) ONLY — NOT deeper, NOT shorter", () => {
    expect(scopeMatchesGrant("a:b:*", "a:b:c")).toBe(true);
    // the depth guard the 3 loose copies lacked: must NOT over-grant to a:b:c:d
    expect(scopeMatchesGrant("a:b:*", "a:b:c:d" as never)).toBe(false);
    expect(scopeMatchesGrant("a:b:*", "a:b" as never)).toBe(false);
  });

  it("non-wildcard non-equal does not match", () => {
    expect(scopeMatchesGrant("a:b", "a:c")).toBe(false);
    expect(scopeMatchesGrant("a:b:c", "a:b:d")).toBe(false);
  });
});

describe("hasScope / hasAnyScope", () => {
  const base = createCapabilityGrant({ id: "g1", holder: "h", scopes: ["a:b:*"] });

  it("matches via the grant's scopes", () => {
    expect(hasScope(base, "a:b:c")).toBe(true);
    expect(hasScope(base, "a:b:c:d" as never)).toBe(false);
  });

  it("revoked grant never matches", () => {
    const revoked = createCapabilityGrant({ id: "g", holder: "h", scopes: ["*"], revoked: true });
    expect(hasScope(revoked, "a:b")).toBe(false);
  });

  it("expired grant never matches; non-expired does", () => {
    const now = 1_000;
    const g = createCapabilityGrant({ id: "g", holder: "h", scopes: ["*"], expiresAt: now });
    expect(hasScope(g, "a:b", now)).toBe(false); // expiresAt <= now => expired
    expect(hasScope(g, "a:b", now - 1)).toBe(true);
  });

  it("hasAnyScope spans multiple grants", () => {
    const g2 = createCapabilityGrant({ id: "g2", holder: "h", scopes: ["x:y"] });
    expect(hasAnyScope([base, g2], "x:y")).toBe(true);
    expect(hasAnyScope([base, g2], "z:z")).toBe(false);
  });
});

describe("capabilityGrantSigningBytes — deterministic + host sign→verify round-trip", () => {
  const grant: CapabilityGrant = {
    id: "g1",
    sessionId: "s1",
    holder: "0xabc",
    scopes: ["bridge:action", "a:b:*"],
    expiresAt: 123,
    revoked: false,
    hostKeyId: "host-key-1"
  };

  it("is deterministic regardless of property insertion order", () => {
    const reordered: CapabilityGrant = {
      revoked: false,
      scopes: ["bridge:action", "a:b:*"],
      hostKeyId: "host-key-1",
      holder: "0xabc",
      expiresAt: 123,
      sessionId: "s1",
      id: "g1"
    };
    expect(capabilityGrantSigningBytes(grant)).toEqual(capabilityGrantSigningBytes(reordered));
  });

  it("excludes `sig` from the signed payload", () => {
    const signed: CapabilityGrant = { ...grant, sig: "deadbeef" };
    expect(capabilityGrantSigningBytes(signed)).toEqual(capabilityGrantSigningBytes(grant));
  });

  it("a host Ed25519 signature over the bytes verifies (and a tampered grant fails)", async () => {
    const keyPair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify"
    ])) as CryptoKeyPair;

    const bytes = capabilityGrantSigningBytes(grant);
    const sig = await webcrypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, bytes);

    expect(
      await webcrypto.subtle.verify({ name: "Ed25519" }, keyPair.publicKey, sig, bytes)
    ).toBe(true);

    // tamper: escalate scope -> signature must no longer verify over the new bytes
    const tampered = capabilityGrantSigningBytes({ ...grant, scopes: ["*"] });
    expect(
      await webcrypto.subtle.verify({ name: "Ed25519" }, keyPair.publicKey, sig, tampered)
    ).toBe(false);
  });
});
