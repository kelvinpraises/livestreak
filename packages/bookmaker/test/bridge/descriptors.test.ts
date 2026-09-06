import { describe, expect, it } from "vitest";

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

describe("projectBookmakerDescriptors — canonical FunctionDescriptors", () => {
  it("emits a createVault descriptor that round-trips as JSON (WSS leg B)", () => {
    const descriptors = projectBookmakerDescriptors(panelWith("market-1"));

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.name).toBe("createVault");
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
  });

  it("inputSchema mirrors CreateVaultInput (side enum + bigint-as-string stake/rate)", () => {
    const [descriptor] = projectBookmakerDescriptors(panelWith("market-1"));
    const props = descriptor?.inputSchema?.properties ?? [];
    const prop = (name: string) => props.find((entry) => entry.name === name)?.value;

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

  it("targets the active market and uses the granular bridge:action:createVault scope", () => {
    const [descriptor] = projectBookmakerDescriptors(panelWith("market-1"));

    expect(descriptor?.scope).toBe("bridge:action:createVault");
    expect(descriptor?.target).toEqual({ kind: "vault", marketId: "market-1" });
    expect(descriptor?.disabled).toBe(false);
  });

  it("disables createVault when there is no market context", () => {
    const [descriptor] = projectBookmakerDescriptors(panelWith(""));

    expect(descriptor?.disabled).toBe(true);
    expect(descriptor?.disabledReason).toBe("No market context");
    expect(descriptor?.target).toEqual({ kind: "vault" });
  });
});
