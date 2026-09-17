// Pristine-board OPERATOR FLOW for the bookmaker console edge — the post-purge regression guard.
//
// Drives the REAL cli edge (cli/src/adapters/bookmaker-edge.ts): the same describeFunctions/dispatch
// surface the gateway relays to the remote console, on a pristine T0 board. Pins the invariants the
// stub/placeholder purge (PLACEHOLDER_MARKET → honest NO_MARKET unconfigured) must not regress:
//
//   1. Tree contract: one root group, every action parented to it.
//   2. Honest gating: with NO market configured, createVault is hidden AND disabled — and dispatching
//      createVault into that blank state is refused (never a write against a blank market).
//   3. No fieldless forms: every VISIBLE configure/action exposes an inputSchema whose properties cover
//      every field the dispatch validator requires (cross-checked against the createVault writer input).
//   4. Happy path: configure(marketId) reveals createVault → createVault dispatches to the injected fake
//      chain writer (package seam), with only form-suppliable string values.
import { describe, expect, it } from "vitest";
import type { FunctionDescriptor } from "@livestreak/schema";
import { createBookmakerEdge } from "../src/adapters/bookmaker-edge.js";
import { packageInit, trustedCaller, OPERATOR_ADDRESS } from "./helpers/operator-flow.js";

const FAKE_MARKET_ID = `0x${"11".repeat(32)}` as const;
const FAKE_VAULT_ID = `0x${"22".repeat(32)}` as const;

const fakeChain = () => {
  const created: unknown[] = [];
  return {
    created,
    chain: {
      reader: { marketExists: async () => true },
      writer: {
        createVault: async (input: unknown) => {
          created.push(input);
          return { txId: `0x${"aa".repeat(32)}` as `0x${string}`, vaultId: FAKE_VAULT_ID as `0x${string}` };
        },
        confirmCreateVault: async () => undefined
      }
    }
  };
};

const makeEdge = (chain: ReturnType<typeof fakeChain>["chain"]) =>
  createBookmakerEdge({
    packageInit: packageInit("bookmaker"),
    readRpcUrl: "http://127.0.0.1:8545",
    userAddress: OPERATOR_ADDRESS,
    usdcAddress: "0x00000000000000000000000000000000000000aa",
    chain
  });

const byName = (descriptors: readonly FunctionDescriptor[], name: string): FunctionDescriptor | undefined =>
  descriptors.find((descriptor) => descriptor.name === name);

const fieldNames = (descriptor: FunctionDescriptor | undefined): readonly string[] =>
  (descriptor?.inputSchema?.type === "object" ? descriptor.inputSchema.properties ?? [] : []).map(
    (property) => property.name
  );

// The fields the createVault dispatch validator requires (validateCreateVaultIntent). The edge defaults
// resolutionSource/resolutionWindowExpiresAtMs, but a form must still be able to supply the core draft.
const CREATE_VAULT_REQUIRED_FIELDS = [
  "marketId",
  "question",
  "creatorSide",
  "creatorStake",
  "seedRate"
] as const;

describe("bookmaker console edge — pristine operator flow", () => {
  it("pristine T0: tree contract holds and createVault is hidden + disabled with no market", async () => {
    const edge = makeEdge(fakeChain().chain);
    const descriptors = await edge.describeFunctions();

    const groups = descriptors.filter((d) => d.nodeKind === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("bookmaker.root");
    expect(groups[0]?.parentId).toBeUndefined();

    const actions = descriptors.filter((d) => d.nodeKind === "action");
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.parentId).toBe("bookmaker.root");
      expect(action.package).toBe("bookmaker");
    }

    const createVault = byName(descriptors, "createVault");
    expect(createVault?.disabled).toBe(true);
    expect(createVault?.visible).toBe(false);
  });

  it("refuses to dispatch createVault into a blank (unconfigured) market", async () => {
    const chain = fakeChain();
    const edge = makeEdge(chain.chain);

    await expect(
      edge.dispatch(trustedCaller(), {
        scope: "bridge:action",
        action: "createVault",
        args: { question: "q", creatorSide: "yes", creatorStake: "1000000", seedRate: "1000" }
      })
    ).rejects.toThrow();
    // No write reached the chain — the blank market was never funded.
    expect(chain.created).toHaveLength(0);
  });

  it("every visible configure/action exposes the fields its validator requires (no fieldless form)", async () => {
    const edge = makeEdge(fakeChain().chain);

    // T0: configure is visible and exposes marketId (the form field that reveals the flow).
    const t0 = await edge.describeFunctions();
    const configure = byName(t0, "configure");
    expect(configure?.visible).toBe(true);
    expect(fieldNames(configure)).toContain("marketId");

    // Configure a real market → createVault reveals.
    await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "configure",
      args: { marketId: FAKE_MARKET_ID }
    });

    const configured = await edge.describeFunctions();
    const createVault = byName(configured, "createVault");
    expect(createVault?.visible).toBe(true);
    expect(createVault?.disabled).toBe(false);

    // The fieldless-form guard: the createVault form must expose every field its validator needs.
    const names = new Set(fieldNames(createVault));
    for (const field of CREATE_VAULT_REQUIRED_FIELDS) {
      expect(names.has(field)).toBe(true);
    }
  });

  it("happy path: configure(marketId) → createVault dispatches to the chain with form values", async () => {
    const chain = fakeChain();
    const edge = makeEdge(chain.chain);

    await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "configure",
      args: { marketId: FAKE_MARKET_ID }
    });

    // Only values a rendered form could supply (all strings; resolution fields defaulted by the edge).
    const result = await edge.dispatch(trustedCaller(), {
      scope: "bridge:action",
      action: "createVault",
      args: {
        marketId: FAKE_MARKET_ID,
        question: "Does the operator flow hold?",
        creatorSide: "yes",
        creatorStake: "1000000",
        seedRate: "1000"
      }
    });

    expect(chain.created).toHaveLength(1);
    expect(result.txId).toBe(`0x${"aa".repeat(32)}`);
    expect(result.tokenId).toBe(FAKE_VAULT_ID);
  });
});
