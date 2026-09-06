import { describe, expect, it } from "vitest";

import { projectControlPanelControls, projectObserveDescriptors } from "#index.js";
import { buildControlCatalog } from "#run/control/index.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";

const browserBoardSettings = {
  url: "https://example.com",
  captureFps: 30,
  viewport: { width: 640, height: 480 },
  encoding: "jpeg" as const
};

const buildDescriptors = () => {
  const board = createBrowserBoardFixture("run_descriptors", browserBoardSettings);
  const catalog = buildControlCatalog();
  return projectObserveDescriptors(projectControlPanelControls({ board, catalog }));
};

describe("projectObserveDescriptors — canonical FunctionDescriptors", () => {
  it("flattens cell functions into descriptors and round-trips as JSON (WSS leg B)", () => {
    const descriptors = buildDescriptors();

    expect(descriptors.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
  });

  it("maps observe's catalog JsonSchema onto the canonical inputSchema", () => {
    const setPresentation = buildDescriptors().find(
      (descriptor) => descriptor.name === "setPresentation"
    );

    // Scope-unification (wave 5): descriptors emit the uniform granular console scope.
    expect(setPresentation?.scope).toBe("bridge:action:setPresentation");
    expect(setPresentation?.inputSchema?.type).toBe("object");
    const whilePaused = setPresentation?.inputSchema?.properties?.find(
      (entry) => entry.name === "whilePaused"
    );
    expect(whilePaused?.value.type).toBe("enum");
    expect((whilePaused?.value.values ?? []).length).toBeGreaterThan(0);
  });

  it("carries cell kind as the descriptor target and preserves disabled state", () => {
    const descriptors = buildDescriptors();

    for (const descriptor of descriptors) {
      expect(typeof descriptor.target?.kind).toBe("string");
      expect(typeof descriptor.disabled).toBe("boolean");
      expect(descriptor.label.length).toBeGreaterThan(0);
    }
  });
});
