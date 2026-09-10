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

  it("emits the bookmaker:config configure root with tree identity fields", () => {
    const configure = byName(projectBookmakerDescriptors(panelWith("market-1")), "configure");

    expect(configure).toMatchObject({
      id: "bookmaker.config.configure",
      package: "bookmaker",
      scope: "bookmaker:config",
      nodeKind: "action",
      visible: true
    });
    expect(configure?.inputSchema?.properties?.map((entry) => entry.name)).toEqual([
      "marketId",
      "runId"
    ]);
  });

  it("emits configure + close configurator roots", () => {
    const descriptors = projectBookmakerDescriptors(panelWith("market-1"));
    const close = byName(descriptors, "close");

    expect(close).toMatchObject({
      id: "bookmaker.config.close",
      package: "bookmaker",
      scope: "bookmaker:config:close",
      nodeKind: "action",
      visible: true
    });
  });

  it("emits entity groups with parentId and visible:false", () => {
    const descriptors = projectBookmakerDescriptors(panelWith("market-1"));
    const groups = descriptors.filter((descriptor) => descriptor.nodeKind === "group");
    const global = groups.find((group) => group.id === "bookmaker.global");

    expect(global?.parentId).toBe("bookmaker.config.configure");
    for (const group of groups) {
      expect(group.package).toBe("bookmaker");
      expect(group.visible).toBe(false);
    }
  });

  it("emits createVault as an action child with id, package, parentId, and granular scope", () => {
    const createVault = byName(projectBookmakerDescriptors(panelWith("market-1")), "createVault");

    expect(createVault).toMatchObject({
      id: "bookmaker.global.action.createVault",
      package: "bookmaker",
      parentId: "bookmaker.global",
      scope: "bridge:action:createVault",
      nodeKind: "action",
      visible: false,
      disabled: false
    });
    expect(createVault?.target).toEqual({ kind: "vault", marketId: "market-1" });
  });

  it("inputSchema mirrors CreateVaultInput (side enum + bigint-as-string stake/rate)", () => {
    const createVault = byName(projectBookmakerDescriptors(panelWith("market-1")), "createVault");
    const props = createVault?.inputSchema?.properties ?? [];
    const prop = (name: string): JsonSchema | undefined =>
      props.find((entry) => entry.name === name)?.value;

    expect(props.map((entry) => entry.name)).toEqual([
      "marketId",
      "question",
      "creatorSide",
      "creatorStake",
      "seedRate"
    ]);
    expect(prop("creatorSide")?.type).toBe("enum");
    expect(prop("creatorSide")?.values).toEqual(["yes", "no"]);
    expect(prop("creatorStake")?.type).toBe("string");
    expect(prop("seedRate")?.type).toBe("string");
  });

  it("disables createVault when there is no market context", () => {
    const createVault = byName(projectBookmakerDescriptors(panelWith("")), "createVault");

    expect(createVault?.disabled).toBe(true);
    expect(createVault?.disabledReason).toBe("No market context");
    expect(createVault?.target).toEqual({ kind: "vault" });
  });
});
