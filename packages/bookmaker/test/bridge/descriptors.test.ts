import { describe, expect, it } from "vitest";

import type { FunctionDescriptor, JsonSchema } from "@livestreak/schema";

import { projectBookmakerPanel } from "../../src/bridge/panel/project.js";
import { projectBookmakerDescriptors } from "../../src/bridge/panel/descriptors.js";
import { marketContext, watchSource } from "../helpers/fixtures.js";

const panelWith = (marketId: string) =>
  projectBookmakerPanel({
    runtimeId: "bookmaker-1",
    marketContext: { ...marketContext(), marketId },
    watchSource: watchSource(),
    updatedAtMs: 1
  });

const byName = (
  descriptors: readonly FunctionDescriptor[],
  name: string
): FunctionDescriptor | undefined => descriptors.find((descriptor) => descriptor.name === name);

describe("projectBookmakerDescriptors — canonical FunctionDescriptors", () => {
  it("round-trips as JSON (wire-safe for WSS leg B)", () => {
    const descriptors = projectBookmakerDescriptors(panelWith("market-1"));

    expect(descriptors.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
  });

  it("emits the configure action under the single root with tree identity fields", () => {
    const configure = byName(projectBookmakerDescriptors(panelWith("market-1")), "configure");

    expect(configure).toMatchObject({
      id: "bookmaker.config.configure",
      package: "bookmaker",
      parentId: "bookmaker.root",
      scope: "bridge:action:configure",
      nodeKind: "action",
      visible: true
    });
    expect(configure?.inputSchema?.properties?.map((entry) => entry.name)).toEqual([
      "marketId",
      "runId"
    ]);
  });

  it("emits close as an always-visible configurator action under the root", () => {
    const descriptors = projectBookmakerDescriptors(panelWith("market-1"));
    const close = byName(descriptors, "close");

    expect(close).toMatchObject({
      id: "bookmaker.config.close",
      package: "bookmaker",
      parentId: "bookmaker.root",
      scope: "bridge:action:close",
      nodeKind: "action",
      visible: true
    });
  });

  it("emits a single root group that parents configure + every action (flat console model)", () => {
    const descriptors = projectBookmakerDescriptors(panelWith("market-1"));
    const groups = descriptors.filter((descriptor) => descriptor.nodeKind === "group");

    // Flat model (mirrors options): ONE "Bookmaker" container; actions hang directly off it.
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "bookmaker.root",
      package: "bookmaker",
      scope: "bridge:controls:read",
      visible: true
    });
    expect(groups[0]?.parentId).toBeUndefined();

    const actions = descriptors.filter((descriptor) => descriptor.nodeKind === "action");
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.parentId).toBe("bookmaker.root");
      expect(action.package).toBe("bookmaker");
    }
  });

  it("emits createVault as an action child of the root with granular scope, board-first reveal", () => {
    const createVault = byName(projectBookmakerDescriptors(panelWith("market-1")), "createVault");

    expect(createVault).toMatchObject({
      id: "bookmaker.root.action.createVault",
      package: "bookmaker",
      parentId: "bookmaker.root",
      scope: "bridge:action:createVault",
      nodeKind: "action",
      // Board-first: createVault lights up once configure sets a market.
      visible: true,
      disabled: false
    });
    expect(createVault?.target).toEqual({ kind: "vault", marketId: "market-1" });
  });

  it("inputSchema mirrors CreateVaultInput (side enum + bigint-as-string stake/rate + resolution)", () => {
    const createVault = byName(projectBookmakerDescriptors(panelWith("market-1")), "createVault");
    const props = createVault?.inputSchema?.properties ?? [];
    const prop = (name: string): JsonSchema | undefined =>
      props.find((entry) => entry.name === name)?.value;

    expect(props.map((entry) => entry.name)).toEqual([
      "marketId",
      "question",
      "creatorSide",
      "creatorStake",
      "seedRate",
      "resolutionSource",
      "resolutionWindowExpiresAtMs"
    ]);
    expect(prop("creatorSide")?.type).toBe("enum");
    expect(prop("creatorSide")?.values).toEqual(["yes", "no"]);
    expect(prop("creatorStake")?.type).toBe("string");
    expect(prop("seedRate")?.type).toBe("string");
    expect(prop("resolutionSource")?.type).toBe("string");
    expect(prop("resolutionSource")?.default).toBe("manual");
    expect(prop("resolutionWindowExpiresAtMs")?.type).toBe("integer");
  });

  it("disables createVault when there is no market context", () => {
    const createVault = byName(projectBookmakerDescriptors(panelWith("")), "createVault");

    expect(createVault?.disabled).toBe(true);
    expect(createVault?.disabledReason).toBe("No market context");
    expect(createVault?.target).toEqual({ kind: "vault" });
  });
});
