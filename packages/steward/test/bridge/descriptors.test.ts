import { describe, expect, it } from "vitest";

import type { FunctionDescriptor } from "@livestreak/schema";

import { projectStewardDescriptors } from "../../src/bridge/panel/descriptors.js";

const vaultSubject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1",
  vaultId: "vault-1"
};

const stewardSubject = {
  kind: "steward" as const,
  id: "steward-bad"
};

const snapshot = {
  runtimeId: "runtime-descriptors",
  watchedSubjects: [vaultSubject, stewardSubject],
  latestFindings: [],
  pendingActionPlans: [],
  latestDecisions: []
};

const byName = (
  descriptors: readonly FunctionDescriptor[],
  name: string
): FunctionDescriptor | undefined => descriptors.find((descriptor) => descriptor.name === name);

describe("projectStewardDescriptors — canonical FunctionDescriptors", () => {
  it("round-trips as JSON (wire-safe for WSS leg B)", () => {
    const descriptors = projectStewardDescriptors(snapshot);

    expect(descriptors.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
  });

  it("emits the steward:config configure root with tree identity fields", () => {
    const configure = byName(projectStewardDescriptors(snapshot), "configure");

    expect(configure).toMatchObject({
      id: "steward.config.configure",
      package: "steward",
      scope: "steward:config",
      nodeKind: "action",
      visible: true
    });
    expect(configure?.inputSchema?.properties?.map((entry) => entry.name)).toEqual(["marketId"]);
  });

  it("emits configure + close configurator roots", () => {
    const close = byName(projectStewardDescriptors(snapshot), "close");

    expect(close).toMatchObject({
      id: "steward.config.close",
      package: "steward",
      scope: "steward:config:close",
      nodeKind: "action",
      visible: true
    });
  });

  it("emits per-subject groups with parentId and visible:false", () => {
    const descriptors = projectStewardDescriptors(snapshot);
    const groups = descriptors.filter((descriptor) => descriptor.nodeKind === "group");
    const vaultGroup = groups.find((group) => group.id === "steward.subject.vault_1");

    expect(vaultGroup?.parentId).toBe("steward.config.configure");
    for (const group of groups) {
      expect(group.package).toBe("steward");
      expect(group.visible).toBe(false);
    }
  });

  it("emits action children with id, package, parentId, and granular steward scopes", () => {
    const descriptors = projectStewardDescriptors(snapshot);
    const actions = descriptors.filter(
      (descriptor) => descriptor.nodeKind === "action" && descriptor.name !== "configure" && descriptor.name !== "close"
    );

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.id.length).toBeGreaterThan(0);
      expect(action.package).toBe("steward");
      expect(action.parentId).toBeDefined();
      expect(action.visible).toBe(false);
      expect(action.scope.startsWith("steward:")).toBe(true);
    }
  });

  it("projects per-subject disabled rules on triggerHot", () => {
    const triggerHot = projectStewardDescriptors(snapshot).find(
      (descriptor) => descriptor.name === "triggerHot" && descriptor.parentId === "steward.subject.steward_bad"
    );

    expect(triggerHot?.disabled).toBe(true);
    expect(triggerHot?.disabledReason).toBe("Subject is not a vault");
  });
});
