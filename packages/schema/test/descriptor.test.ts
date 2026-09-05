import { describe, expect, it } from "vitest";

import type { FunctionDescriptor, JsonSchema } from "../src/descriptor.js";

describe("JsonSchema / FunctionDescriptor — wire-safe (JSON round-trip stable for WSS leg B)", () => {
  const nested: JsonSchema = {
    type: "object",
    properties: [
      { name: "side", value: { type: "enum", values: ["yes", "no"] }, help: "market side" },
      {
        name: "legs",
        value: { type: "array", items: { type: "integer", required: true } },
        help: "leg sizes"
      }
    ]
  };

  const descriptor: FunctionDescriptor = {
    name: "fundStream",
    label: "Fund stream",
    scope: "bridge:action",
    target: { kind: "vault", vaultId: "v1", side: "yes" },
    disabled: true,
    disabledReason: "vault paused",
    inputSchema: nested
  };

  it("is structurally JSON.parse(JSON.stringify(x)) stable", () => {
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(JSON.parse(JSON.stringify(nested))).toEqual(nested);
  });
});
