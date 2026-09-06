import { describe, expect, it } from "vitest";
import type { FunctionDescriptor } from "@livestreak/schema";
import { projectConsoleFunctions } from "../src/gateway/console-functions.js";

// Scope-unification (wave 5): package descriptors already carry the granular console scope
// `bridge:action:<name>` — the gateway only filters by the session's grants now.
const raw: readonly FunctionDescriptor[] = [
  { name: "fund", label: "Fund", scope: "bridge:action:fund", disabled: false },
  { name: "withdraw", label: "Withdraw", scope: "bridge:action:withdraw", disabled: false }
];

describe("projectConsoleFunctions", () => {
  it("filters by session scopes without remapping the descriptor scope", () => {
    const out = projectConsoleFunctions(raw, ["bridge:action:fund"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("fund");
    expect(out[0]!.scope).toBe("bridge:action:fund");
  });

  it("a bridge:action:* grant authorizes every action", () => {
    const out = projectConsoleFunctions(raw, ["bridge:action:*"]);
    expect(out.map((f) => f.name)).toEqual(["fund", "withdraw"]);
  });

  it("no matching scope yields no functions", () => {
    expect(projectConsoleFunctions(raw, ["bridge:board:read"])).toHaveLength(0);
  });
});
