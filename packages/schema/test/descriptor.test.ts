import { describe, expect, it } from "vitest";

import type { FunctionDescriptor, JsonSchema } from "../src/descriptor.js";
import { withDescriptorIdentity } from "../src/descriptor.js";

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
    id: "options.fn.fund.vault-1",
    parentId: "options.vault.v1",
    package: "options",
    name: "fundStream",
    label: "Fund stream",
    scope: "bridge:action:fund",
    target: { kind: "vault", vaultId: "v1", side: "yes" },
    disabled: true,
    disabledReason: "vault paused",
    inputSchema: nested,
    visible: true,
    nodeKind: "action"
  };

  it("is structurally JSON.parse(JSON.stringify(x)) stable", () => {
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(JSON.parse(JSON.stringify(nested))).toEqual(nested);
  });

  it("withDescriptorIdentity fills id and package", () => {
    const filled = withDescriptorIdentity(
      {
        name: "configure",
        label: "Configure",
        scope: "observe:system:config",
        disabled: false
      },
      { package: "observe", idPrefix: "system.config" }
    );
    expect(filled.id).toBe("observe.system.config.configure");
    expect(filled.package).toBe("observe");
    expect(filled.visible).toBe(true);
  });
});
