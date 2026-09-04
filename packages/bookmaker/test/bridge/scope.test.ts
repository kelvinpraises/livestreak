import { describe, expect, it } from "vitest";
import { authorizeBridgeCaller } from "../../src/bridge/scope.js";
import { bridgeActionScope } from "../../src/bridge/types.js";

describe("bookmaker bridge scope", () => {
  it("rejects callAction without scope", () => {
    expect(() =>
      authorizeBridgeCaller(
        {
          id: "agent-1",
          grants: [
            {
              id: "grant-1",
              sessionId: "session-1",
              holder: "agent-1",
              scopes: ["bridge:board:read"],
              revoked: false
            }
          ]
        },
        bridgeActionScope,
        1_700_000_000_000
      )
    ).toThrow(/No capability grant authorizes bridge:action/);
  });

  it("allows trusted callers without grants", () => {
    expect(() =>
      authorizeBridgeCaller(
        {
          id: "trusted-agent",
          trusted: true
        },
        bridgeActionScope,
        1_700_000_000_000
      )
    ).not.toThrow();
  });
});
