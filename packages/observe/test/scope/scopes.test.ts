import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  createCapabilityGrant,
  hasAnyScope,
  hasScope,
  requireAnyScope,
  requireScope
} from "#scope/scopes.js";

const baseGrant = createCapabilityGrant({
  id: "grant-1",
  holder: "operator",
  scopes: ["bridge:board:read"]
});

describe("scope authorization", () => {
  it("matches exact scope", () => {
    expect(hasScope(baseGrant, "bridge:board:read")).toBe(true);
    expect(hasScope(baseGrant, "bridge:board:subscribe")).toBe(false);
  });

  it("matches global wildcard", () => {
    const grant = createCapabilityGrant({
      id: "grant-global",
      holder: "admin",
      scopes: ["*"]
    });

    expect(hasScope(grant, "bridge:board:read")).toBe(true);
    expect(hasScope(grant, "capture:browser:setCrop")).toBe(true);
  });

  it("matches prefix wildcard for nested bridge scopes", () => {
    const grant = createCapabilityGrant({
      id: "grant-board",
      holder: "board-operator",
      scopes: ["bridge:board:*"]
    });

    expect(hasScope(grant, "bridge:board:read")).toBe(true);
    expect(hasScope(grant, "bridge:board:subscribe")).toBe(true);
    expect(hasScope(grant, "bridge:artifact:read")).toBe(false);
  });

  it("matches prefix wildcard for capture function scopes", () => {
    const grant = createCapabilityGrant({
      id: "grant-browser",
      holder: "browser-operator",
      scopes: ["capture:browser:*"]
    });

    expect(hasScope(grant, "capture:browser:setCrop")).toBe(true);
    expect(hasScope(grant, "system:pause:setPresentation")).toBe(false);
  });

  it("does not treat shallow prefix wildcards as deep wildcards", () => {
    const grant = createCapabilityGrant({
      id: "grant-shallow",
      holder: "bridge-operator",
      scopes: ["bridge:*"]
    });

    expect(hasScope(grant, "bridge:board:read")).toBe(false);
    expect(hasScope(grant, "bridge:read")).toBe(true);
  });

  it("rejects revoked grants", () => {
    const grant = createCapabilityGrant({
      id: "grant-revoked",
      holder: "operator",
      scopes: ["bridge:board:read"],
      revoked: true
    });

    expect(hasScope(grant, "bridge:board:read")).toBe(false);
  });

  it("rejects expired grants", () => {
    const grant = createCapabilityGrant({
      id: "grant-expired",
      holder: "operator",
      scopes: ["bridge:board:read"],
      expiresAt: Date.now() - 1
    });

    expect(hasScope(grant, "bridge:board:read")).toBe(false);
  });

  it("accepts non-expired grants", () => {
    const grant = createCapabilityGrant({
      id: "grant-active",
      holder: "operator",
      scopes: ["bridge:board:read"],
      expiresAt: Date.now() + 60_000
    });

    expect(hasScope(grant, "bridge:board:read")).toBe(true);
  });

  it("requireScope succeeds for authorized grants", async () => {
    const exit = await Effect.runPromiseExit(requireScope(baseGrant, "bridge:board:read"));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("requireAnyScope succeeds when any grant matches", async () => {
    const exit = await Effect.runPromiseExit(
      requireAnyScope(
        [
          createCapabilityGrant({
            id: "grant-a",
            holder: "operator",
            scopes: ["system:pause:setPresentation"]
          }),
          createCapabilityGrant({
            id: "grant-b",
            holder: "operator",
            scopes: ["bridge:board:read"]
          })
        ],
        "bridge:board:read"
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("requireAnyScope fails with requiredScope metadata", async () => {
    const exit = await Effect.runPromiseExit(
      requireAnyScope([], "bridge:board:read")
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("LiveStreakCapabilityError");
      expect(exit.cause.toString()).toContain("bridge:board:read");
      expect(exit.cause.toString()).toContain("No capability grant authorizes bridge:board:read");
    }
  });

  it("hasAnyScope returns false when no grant matches", () => {
    expect(hasAnyScope([], "bridge:board:read")).toBe(false);
  });
});
