import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import {
  buildControlCatalog,
  createObserveBridge,
  createObserveRuntime,
  projectControlPanelControls,
  type BridgeCaller,
  type ControlCatalog,
  type ControlCellView,
  type ControlFunctionView
} from "#index.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

const trustedCaller: BridgeCaller = { id: "trusted-cli-contract", trusted: true };

const WORKER_ISOLATION_FORBIDDEN = [
  '"tracks"',
  '"cursors"',
  '"pauseCycle"',
  '"lifecycle"',
  '"payload"',
  '"data:image"'
] as const;

const assertCellShape = (cell: ControlCellView): void => {
  expect(typeof cell.id).toBe("string");
  expect(typeof cell.kind).toBe("string");
  expect(typeof cell.label).toBe("string");
  expect(typeof cell.order).toBe("number");
  expect(Array.isArray(cell.status)).toBe(true);
  expect(typeof cell.state).toBe("string");
  expect(cell.message === null || typeof cell.message === "string").toBe(true);
  expect(typeof cell.updatedAtMs).toBe("number");
  expect(cell.settings).toBeTypeOf("object");
  expect(cell.readonly).toBeTypeOf("object");
  expect(cell.refs).toBeTypeOf("object");
  expect(Array.isArray(cell.functions)).toBe(true);

  for (const value of Object.values(cell.refs)) {
    expect(typeof value).toBe("string");
  }

  for (const functionView of cell.functions) {
    expect(typeof functionView.name).toBe("string");
    expect(typeof functionView.scope).toBe("string");
    expect(typeof functionView.disabled).toBe("boolean");
    if (functionView.disabled === false) {
      expect(functionView.disabledReason).toBeUndefined();
    }
    if (functionView.disabled === true) {
      expect(typeof functionView.disabledReason).toBe("string");
    }
  }
};

describe("bridge panel CLI contract", () => {
  it("projects a golden controls shape through runtime and bridge readControls", async () => {
    const { options } = createSyntheticKernelOptions(4);
    const runId = "run_cli_panel_contract";

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime({ defaultKernelOptions: options });
          const bridge = createObserveBridge({ runtime });

          yield* runtime.prepareRun(syntheticCaptureRunConfig(runId, "/tmp/cli-contract.mp4"));

          return yield* bridge.readControls({ caller: trustedCaller, runId });
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) {
      return;
    }

    const controls = exit.value;

    expect(controls.runId).toBe(runId);
    expect(typeof controls.revision).toBe("number");
    expect(Array.isArray(controls.cells)).toBe(true);
    expect(controls.cells.length).toBeGreaterThan(0);

    const cellIds = controls.cells.map((cell) => cell.id);
    expect(cellIds).toContain("system:run");
    expect(cellIds).toContain("system:pause");
    expect(cellIds.some((id) => id.startsWith("capture:"))).toBe(true);
    expect(cellIds.some((id) => id.startsWith("sink:"))).toBe(true);

    for (const cell of controls.cells) {
      assertCellShape(cell);
    }

    const pauseCell = controls.cells.find((cell) => cell.id === "system:pause");
    expect(pauseCell).toBeDefined();
    const pauseFunctionNames = pauseCell!.functions.map((functionView) => functionView.name);
    expect(pauseFunctionNames).toEqual(expect.arrayContaining(["pause", "resume", "setPresentation"]));

    const setPresentation = pauseCell!.functions.find(
      (functionView) => functionView.name === "setPresentation"
    ) as ControlFunctionView;

    expect(setPresentation.scope).toBe("system:pause:setPresentation");
    expect(setPresentation.label).toBe("Set pause presentation");
    expect(setPresentation.description).toBe("Update the presentation used by future pauses.");
    expect(setPresentation.resultKind).toBe("patch");
    expect(setPresentation.input?.type).toBe("object");
    expect(setPresentation.input?.properties?.some((entry) => entry.name === "whilePaused")).toBe(true);
    expect(setPresentation.disabled).toBe(false);
    expect(setPresentation.disabledReason).toBeUndefined();

    const serialized = JSON.stringify(controls);
    for (const forbidden of WORKER_ISOLATION_FORBIDDEN) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("enriches board functions from catalog and omits catalog-only functions", () => {
    const catalog = buildControlCatalog();
    const catalogWithExtra: ControlCatalog = {
      ...catalog,
      cells: {
        ...catalog.cells,
        "system:pause": {
          ...catalog.cells["system:pause"]!,
          functions: {
            ...catalog.cells["system:pause"]!.functions,
            hiddenAction: {
              scope: "system:pause:hiddenAction",
              label: "Hidden",
              description: "Not on board.",
              result: "patch"
            }
          }
        }
      }
    };

    const board = {
      revision: 1,
      catalogVersion: "0.1.0",
      cells: {
        "system:run": {
          label: "Run",
          catalog: "system:run",
          // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
          status: ["prepared", null, Date.now()] as const,
          readonly: { runId: "run_catalog_enrichment" },
          functions: []
        },
        "system:pause": {
          label: "Pause",
          catalog: "system:pause",
          // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
          status: ["idle", null, Date.now()] as const,
          functions: ["pause", "resume", "setPresentation", "orphanAction"]
        }
      }
    };

    const controls = projectControlPanelControls({ board, catalog: catalogWithExtra });
    const pauseFunctions = controls.cells.find((cell) => cell.id === "system:pause")?.functions ?? [];
    const pauseNames = pauseFunctions.map((functionView) => functionView.name);

    expect(pauseNames).toContain("setPresentation");
    expect(pauseNames).not.toContain("hiddenAction");
    expect(pauseNames).toContain("orphanAction");

    const enriched = pauseFunctions.find((functionView) => functionView.name === "setPresentation");
    expect(enriched).toMatchObject({
      scope: "system:pause:setPresentation",
      label: "Set pause presentation",
      resultKind: "patch",
      disabled: false
    });

    const orphan = pauseFunctions.find((functionView) => functionView.name === "orphanAction");
    expect(orphan).toEqual({
      name: "orphanAction",
      scope: "system:pause:orphanAction",
      disabled: false
    });
  });
});
