// Pristine-board OPERATOR FLOW for the options console edge — the post-purge regression guard.
//
// Drives the REAL cli edge (cli/src/adapters/options-edge.ts): the describeFunctions/dispatch surface
// the gateway relays to the remote console. Pins the invariants the stub purge must not regress:
//
//   1. Pristine T0 (unconfigured lens): only Configure + Close are visible — no mint/fund/withdraw.
//   2. Tree contract: one root group, every action parented to it.
//   3. No fieldless forms: every VISIBLE action exposes an inputSchema whose properties cover every
//      field its writer requires (cross-checked against the options writer inputs).
//   4. Happy path: configure(marketId) reveals mint → mint dispatches to the injected fake chain writer
//      (package seam), with only form-suppliable string values; close collapses back to Configure+Close.
import { describe, expect, it } from "vitest";
import type { FunctionDescriptor } from "@livestreak/schema";
import { asUserAddress } from "@livestreak/options";
import { createOptionsConsoleEdge } from "../src/adapters/options-edge.js";
import { packageInit, trustedCaller, OPERATOR_ADDRESS } from "./helpers/operator-flow.js";
import { createFakeOptionsChain, FAKE_MARKET_ID } from "./helpers/fake-options-chain.js";

const USER = asUserAddress(OPERATOR_ADDRESS);

const makeEdge = () => {
  const fake = createFakeOptionsChain();
  const edge = createOptionsConsoleEdge({
    packageInit: packageInit("options"),
    readRpcUrl: "http://127.0.0.1:8545",
    userAddress: USER,
    chain: fake.chain
  });
  return { edge, fake };
};

const byName = (descriptors: readonly FunctionDescriptor[], name: string): FunctionDescriptor | undefined =>
  descriptors.find((descriptor) => descriptor.name === name);

const fieldNames = (descriptor: FunctionDescriptor | undefined): readonly string[] =>
  (descriptor?.inputSchema?.type === "object" ? descriptor.inputSchema.properties ?? [] : []).map(
    (property) => property.name
  );

// The fields each writer input requires, by action. Any VISIBLE action must expose a superset.
const WRITER_REQUIRED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  mint: ["marketId", "to"],
  mintWithSalt: ["marketId", "salt", "to"],
  setApprovalForAll: ["operator", "approved"]
};

describe("options console edge — pristine operator flow", () => {
  it("pristine T0: only Configure + Close are visible (no market lens)", async () => {
    const { edge } = makeEdge();
    const descriptors = await edge.describeFunctions();

    const visibleActions = descriptors.filter((d) => d.nodeKind === "action" && d.visible === true);
    expect(visibleActions.map((d) => d.name).sort()).toEqual(["close", "configure"]);
    // With no market lens, no mint is even projected — and certainly none is visible.
    expect(descriptors.some((d) => d.name === "mint" && d.visible === true)).toBe(false);
  });

  it("tree contract: one root group, every action parented to it", async () => {
    const { edge } = makeEdge();
    const descriptors = await edge.describeFunctions();

    const groups = descriptors.filter((d) => d.nodeKind === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("options.root");

    const actions = descriptors.filter((d) => d.nodeKind === "action");
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.parentId).toBe("options.root");
      expect(action.package).toBe("options");
    }
  });

  it("configure(marketId) reveals mint; every visible action exposes its writer's fields (no fieldless form)", async () => {
    const { edge } = makeEdge();

    // T0: configure exposes marketId (the field that reveals the flow).
    const t0 = await edge.describeFunctions();
    const configure = byName(t0, "configure");
    expect(configure?.visible).toBe(true);
    expect(fieldNames(configure)).toContain("marketId");

    await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "configure",
      args: { marketId: FAKE_MARKET_ID }
    });

    const configured = await edge.describeFunctions();
    const mint = byName(configured, "mint");
    expect(mint?.visible).toBe(true);
    expect(mint?.disabled).toBe(false);

    // No fieldless forms: every visible action's schema must cover its writer's required fields, AND
    // every visible arg-bearing action must expose a NON-EMPTY schema (the class of bug where a catalog
    // action has no schema entry → the form renders zero fields).
    const noArgActions = new Set(["close", "claimDividends"]);
    for (const action of configured.filter((d) => d.nodeKind === "action" && d.visible === true)) {
      if (!noArgActions.has(action.name) && action.name !== "configure") {
        expect(fieldNames(action).length).toBeGreaterThan(0);
      }
      const required = WRITER_REQUIRED_FIELDS[action.name];
      if (required === undefined) continue;
      const names = new Set(fieldNames(action));
      for (const field of required) {
        expect(names.has(field)).toBe(true);
      }
    }
  });

  it("happy path: configure → mint dispatches to the chain writer with form values; close collapses", async () => {
    const { edge, fake } = makeEdge();

    await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "configure",
      args: { marketId: FAKE_MARKET_ID }
    });

    const result = await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "mint",
      args: { marketId: FAKE_MARKET_ID, to: OPERATOR_ADDRESS }
    });

    expect(fake.writes.map((w) => w.action)).toContain("mint");
    expect(result.txId).toBe("0xfake_user_op_hash");
    expect(result.tokenId).toBe("1");

    // Close is the inverse of configure: the lens drops, mint hides again.
    await edge.dispatch(trustedCaller(), { scope: "bridge:action", action: "close", args: {} });
    const afterClose = await edge.describeFunctions();
    const visibleActions = afterClose.filter((d) => d.nodeKind === "action" && d.visible === true);
    expect(visibleActions.map((d) => d.name).sort()).toEqual(["close", "configure"]);
  });
});
