import { describe, expect, it } from "vitest";

import type { FunctionDescriptor, JsonSchema } from "@livestreak/schema";

import { asMarketId } from "../src/model/index.js";
import { projectOptionsPanel } from "../src/bridge/panel/project.js";
import { projectOptionsDescriptors } from "../src/bridge/panel/descriptors.js";
import { readUserOptionsSnapshot } from "../src/flows/snapshot.js";
import { createFakeOptionsReader, fixtureSeed, fixtureUser } from "./helpers/fake-chain.js";

const buildDescriptors = async (): Promise<readonly FunctionDescriptor[]> => {
  const user = fixtureUser();
  const transport = createFakeOptionsReader(fixtureSeed(user));
  const snapshot = await readUserOptionsSnapshot(transport, user, asMarketId("market_01"));
  return projectOptionsDescriptors(projectOptionsPanel(snapshot));
};

const byName = (
  descriptors: readonly FunctionDescriptor[],
  name: string
): FunctionDescriptor | undefined => descriptors.find((descriptor) => descriptor.name === name);

describe("projectOptionsDescriptors — canonical FunctionDescriptors", () => {
  it("round-trips as JSON (wire-safe for WSS leg B)", async () => {
    const descriptors = await buildDescriptors();
    expect(descriptors.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
  });

  it("emits the configure root with tree identity fields", async () => {
    const descriptors = await buildDescriptors();
    const configure = descriptors.find((descriptor) => descriptor.name === "configure");

    expect(configure).toMatchObject({
      id: "options.config.configure",
      package: "options",
      parentId: "options.root",
      scope: "bridge:action:configure",
      nodeKind: "action",
      visible: true
    });
    expect(configure?.inputSchema?.properties?.map((entry) => entry.name)).toEqual(["marketId"]);
  });

  it("emits a single root group that parents configure + every action (flat console model)", async () => {
    const descriptors = await buildDescriptors();
    const groups = descriptors.filter((descriptor) => descriptor.nodeKind === "group");

    // Flat model: ONE "Options" container; actions hang directly off it (no per-entity sub-groups).
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "options.root", package: "options", visible: true });

    const actions = descriptors.filter((descriptor) => descriptor.nodeKind === "action");
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.parentId).toBe("options.root");
    }
  });

  it("emits action children with id, package, parentId, and bridge:action:<name> scope", async () => {
    const descriptors = await buildDescriptors();
    const actions = descriptors.filter((descriptor) => descriptor.nodeKind === "action" && descriptor.name !== "configure");

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.id.length).toBeGreaterThan(0);
      expect(action.package).toBe("options");
      expect(action.parentId).toBe("options.root");
      // Visibility is the board-first reveal (configured && !disabled), not a fixed flag.
      expect(typeof action.visible).toBe("boolean");
      expect(action.scope.startsWith("bridge:action:")).toBe(true);
    }
  });

  it("emits a real inputSchema for every arg-bearing action (and none for no-arg ones)", async () => {
    const descriptors = await buildDescriptors();
    const noArg = new Set(["close", "claimDividends"]);
    const actions = descriptors.filter(
      (descriptor) =>
        descriptor.nodeKind === "action" && descriptor.name !== "configure" && !noArg.has(descriptor.name)
    );

    expect(actions.length).toBeGreaterThan(0);
    for (const descriptor of actions) {
      expect(typeof descriptor.inputSchema).toBe("object");
      expect(descriptor.inputSchema?.type).toBe("object");
      expect(Array.isArray(descriptor.inputSchema?.properties)).toBe(true);
    }
    for (const name of noArg) {
      expect(byName(descriptors, name)?.inputSchema).toBeUndefined();
    }
  });

  it("fund.inputSchema mirrors FundStreamInput (side enum + bigint-as-string fields)", async () => {
    const fund = byName(await buildDescriptors(), "fund");
    const props = fund?.inputSchema?.properties ?? [];
    const prop = (name: string): JsonSchema | undefined =>
      props.find((entry) => entry.name === name)?.value;

    expect(props.map((entry) => entry.name)).toEqual([
      "tokenId",
      "vaultId",
      "side",
      "rate",
      "deposit"
    ]);
    expect(prop("side")?.type).toBe("enum");
    expect(prop("side")?.values).toEqual(["yes", "no"]);
    expect(prop("rate")?.type).toBe("string");
    expect(prop("deposit")?.type).toBe("string");
  });

  it("includes both mint and mintWithSalt; salt is modelled as uint64 integer (contract + CLI)", async () => {
    const descriptors = await buildDescriptors();
    const mint = byName(descriptors, "mint");
    const mintWithSalt = byName(descriptors, "mintWithSalt");

    expect(mint).toBeDefined();
    expect(mintWithSalt).toBeDefined();
    // mintWithSalt shares mint's target gating.
    expect(mintWithSalt?.target).toEqual(mint?.target);

    const salt = mintWithSalt?.inputSchema?.properties?.find((entry) => entry.name === "salt");
    expect(salt?.value.type).toBe("integer");
  });

  it("emits the unified granular console scope bridge:action:<name> and disabled state", async () => {
    const descriptors = await buildDescriptors();
    const setApprovalForAll = byName(descriptors, "setApprovalForAll");

    expect(setApprovalForAll?.scope).toBe("bridge:action:setApprovalForAll");
    expect(byName(descriptors, "fund")?.scope).toBe("bridge:action:fund");
    expect(byName(descriptors, "mintWithSalt")?.scope).toBe("bridge:action:mintWithSalt");

    const actions = descriptors.filter(
      (descriptor) => descriptor.nodeKind === "action" && descriptor.name !== "configure"
    );
    for (const descriptor of actions) {
      expect(typeof descriptor.disabled).toBe("boolean");
      expect(descriptor.scope.startsWith("bridge:action:")).toBe(true);
    }
  });
});
