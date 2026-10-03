// Pristine-board OPERATOR FLOW for the steward console edge — the post-purge regression guard.
//
// Drives the REAL cli edge (cli/src/adapters/steward-edge.ts): the describeFunctions/dispatch surface
// the gateway relays to the remote console. Pins the invariants the stub purge must not regress:
//
//   1. Pristine T0 (no watched subjects): Configure, Close and rule lookup are visible — no resolve.
//   2. Tree contract: one root group; every action's parentId points at an emitted node.
//   3. No fieldless forms: the revealed resolve action exposes an inputSchema whose properties cover
//      every field submitBridgeAction requires (subjectId + outcome).
//   4. Resolution needs reason and evidence; the old raw plan sink cannot bypass the guard.
import { describe, expect, it } from "vitest";
import type { FunctionDescriptor } from "@livestreak/schema";
import type { StewardActionPlan, StewardActionPlanSink } from "@livestreak/steward";
import { createStewardConsoleEdge } from "../src/adapters/steward-edge.js";
import { packageInit, trustedCaller } from "./helpers/operator-flow.js";

const VAULT_ID = "vault-op-flow";

const recordingSink = (): StewardActionPlanSink & {
  readonly plans: StewardActionPlan[];
} => {
  const plans: StewardActionPlan[] = [];
  return {
    plans,
    submit: (next: readonly StewardActionPlan[]) => {
      plans.push(...next);
    },
  };
};

const makeEdge = (sink: StewardActionPlanSink) =>
  createStewardConsoleEdge({ packageInit: packageInit("steward"), actionPlanSink: sink });

const byName = (
  descriptors: readonly FunctionDescriptor[],
  name: string,
): readonly FunctionDescriptor[] =>
  descriptors.filter((descriptor) => descriptor.name === name);

const fieldNames = (descriptor: FunctionDescriptor | undefined): readonly string[] =>
  (descriptor?.inputSchema?.type === "object"
    ? (descriptor.inputSchema.properties ?? [])
    : []
  ).map((property) => property.name);

describe("steward console edge — pristine operator flow", () => {
  it("pristine T0: Configure, Close and rule lookup are visible (no watched subject)", async () => {
    const edge = makeEdge(recordingSink());
    const descriptors = await edge.describeFunctions();

    const visibleActions = descriptors.filter(
      (d) => d.nodeKind === "action" && d.visible === true,
    );
    expect(visibleActions.map((d) => d.name).sort()).toEqual([
      "close",
      "configure",
      "readMandate",
      "recoverResolution",
    ]);
    expect(descriptors.some((d) => d.name === "resolve" && d.visible === true)).toBe(false);
  });

  it("tree contract: one root group; every action parentId points at an emitted node", async () => {
    const edge = makeEdge(recordingSink());
    const descriptors = await edge.describeFunctions();

    const groups = descriptors.filter((d) => d.nodeKind === "group");
    const root = groups.find((g) => g.id === "steward.root");
    expect(root?.visible).toBe(true);

    const emittedIds = new Set(descriptors.map((d) => d.id));
    for (const action of descriptors.filter((d) => d.nodeKind === "action")) {
      expect(action.package).toBe("steward");
      expect(action.parentId).toBeDefined();
      expect(emittedIds.has(action.parentId!)).toBe(true);
    }
  });

  it("configure(vaultId) reveals resolve; the resolve form exposes subjectId + outcome (no fieldless form)", async () => {
    const edge = makeEdge(recordingSink());

    const t0 = await edge.describeFunctions();
    const configure = byName(t0, "configure")[0];
    expect(configure?.visible).toBe(true);
    expect(fieldNames(configure)).toContain("vaultId");

    await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "configure",
      args: { vaultId: VAULT_ID },
    });

    const configured = await edge.describeFunctions();
    const resolve = byName(configured, "resolve").find((d) => d.visible === true);
    expect(resolve).toBeDefined();
    expect(resolve?.disabled).toBe(false);

    // The fieldless-form guard: resolve must expose the fields submitBridgeAction requires.
    const names = new Set(fieldNames(resolve));
    expect(names.has("subjectId")).toBe(true);
    expect(names.has("outcome")).toBe(true);
    expect(names.has("reason")).toBe(true);
    expect(names.has("evidenceJson")).toBe(true);
  });

  it("does not allow the legacy action-plan sink to bypass evidence-backed resolution", async () => {
    const sink = recordingSink();
    const edge = makeEdge(sink);
    await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "configure",
      args: { vaultId: VAULT_ID },
    });
    await expect(
      edge.dispatch(trustedCaller(), {
        scope: "bridge:action",
        action: "resolve",
        args: { subjectId: VAULT_ID, subjectKind: "vault", outcome: "yes" },
      }),
    ).rejects.toThrow();
    expect(sink.plans).toHaveLength(0);
  });
});
