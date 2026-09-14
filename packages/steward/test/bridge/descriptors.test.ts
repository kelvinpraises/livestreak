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

  it("emits the steward.root group that every child's parentId points at (sibling contract)", () => {
    const descriptors = projectStewardDescriptors(snapshot);
    const root = descriptors.find((descriptor) => descriptor.id === "steward.root");

    expect(root).toMatchObject({
      id: "steward.root",
      package: "steward",
      nodeKind: "group",
      visible: true
    });
    // Every steward.root-parented child now points at a node that is actually emitted.
    const children = descriptors.filter((descriptor) => descriptor.parentId === "steward.root");
    expect(children.length).toBeGreaterThan(0);
  });

  it("emits the configure action under the root with tree identity fields", () => {
    const configure = byName(projectStewardDescriptors(snapshot), "configure");

    expect(configure).toMatchObject({
      id: "steward.config.configure",
      package: "steward",
      parentId: "steward.root",
      scope: "bridge:action:configure",
      nodeKind: "action",
      visible: true
    });
    expect(configure?.inputSchema?.properties?.map((entry) => entry.name)).toEqual([
      "marketId",
      "vaultId"
    ]);
  });

  it("emits close as an always-visible configurator action", () => {
    const close = byName(projectStewardDescriptors(snapshot), "close");

    expect(close).toMatchObject({
      id: "steward.config.close",
      package: "steward",
      parentId: "steward.root",
      scope: "bridge:action:close",
      nodeKind: "action",
      visible: true
    });
  });

  it("reveals vault/market subject groups (board-first), hides the steward-self group", () => {
    const descriptors = projectStewardDescriptors(snapshot);
    const groups = descriptors.filter((descriptor) => descriptor.nodeKind === "group");
    const vaultGroup = groups.find((group) => group.id === "steward.subject.vault_1");
    const stewardGroup = groups.find((group) => group.id === "steward.subject.steward_bad");

    expect(vaultGroup?.parentId).toBe("steward.root");
    expect(vaultGroup?.visible).toBe(true);
    expect(stewardGroup?.visible).toBe(false);
    for (const group of groups) {
      expect(group.package).toBe("steward");
    }
  });

  it("emits action children with identity + granular console scopes; reveals the enabled vault resolve action", () => {
    const descriptors = projectStewardDescriptors(snapshot);
    const actions = descriptors.filter(
      (descriptor) => descriptor.nodeKind === "action" && descriptor.name !== "configure" && descriptor.name !== "close"
    );

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.id.length).toBeGreaterThan(0);
      expect(action.package).toBe("steward");
      expect(action.parentId).toBeDefined();
      expect(action.scope).toBe(`bridge:action:${action.name}`);
    }

    // The watched vault subject's resolve action is revealed (board-first) and enabled.
    const resolve = actions.find(
      (action) => action.name === "resolve" && action.parentId === "steward.subject.vault_1"
    );
    expect(resolve?.visible).toBe(true);
    expect(resolve?.disabled).toBe(false);

    // Steward-self subject actions stay hidden.
    const stewardAction = actions.find((action) => action.parentId === "steward.subject.steward_bad");
    expect(stewardAction?.visible).toBe(false);
  });

  it("projects per-subject disabled rules on triggerHot", () => {
    const triggerHot = projectStewardDescriptors(snapshot).find(
      (descriptor) => descriptor.name === "triggerHot" && descriptor.parentId === "steward.subject.steward_bad"
    );

    expect(triggerHot?.disabled).toBe(true);
    expect(triggerHot?.disabledReason).toBe("Subject is not a vault");
  });
});
