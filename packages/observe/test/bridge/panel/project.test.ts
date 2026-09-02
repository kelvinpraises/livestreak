import { describe, expect, it } from "vitest";
import {
  projectBoardControls,
  projectControlPanelControls
} from "#index.js";
import { buildControlCatalog, type ControlCatalog } from "#run/control/index.js";
import type { Board } from "#run/control/board/index.js";
import { createBrowserBoardFixture } from "#test/helpers/board.js";

const browserBoardSettings = {
  url: "https://example.com",
  captureFps: 30,
  viewport: { width: 640, height: 480 },
  encoding: "jpeg" as const
};

describe("projectBoardControls", () => {
  const board = createBrowserBoardFixture("run_controls", browserBoardSettings);

  it("projects runId and revision", () => {
    const controls = projectBoardControls(board);

    expect(controls.runId).toBe("run_controls");
    expect(controls.revision).toBe(board.revision);
  });

  it("orders cells stably: system, capture, sink, then unknown", () => {
    const shuffledBoard = {
      ...board,
      cells: {
        "sink:file-export": board.cells["sink:file-export"],
        "process:football": {
          label: "Football",
          catalog: "process:football",
           
          status: ["idle", null, Date.now()] as const,
          functions: ["analyze"]
        },
        "system:tick": board.cells["system:tick"],
        "capture:browser": board.cells["capture:browser"],
        "system:memory": board.cells["system:memory"],
        "system:pause": board.cells["system:pause"],
        "system:run": board.cells["system:run"],
        "future:widget": {
          label: "Widget",
           
          status: ["idle", null, Date.now()] as const,
          functions: []
        }
      }
    };

    const ids = projectBoardControls(shuffledBoard).cells.map((cell) => cell.id);

    expect(ids).toEqual([
      "system:run",
      "system:pause",
      "system:memory",
      "system:tick",
      "capture:browser",
      "process:football",
      "sink:file-export",
      "future:widget"
    ]);
    expect(projectBoardControls(shuffledBoard).cells.map((cell) => cell.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7
    ]);
  });

  it("derives state, message, updatedAtMs, and catalog from board cells", () => {
    const updatedAtMs = Date.now();
    const boardWithStatus = {
      ...board,
      cells: {
        ...board.cells,
        "system:run": {
          ...board.cells["system:run"],
          catalog: "system:run",
          status: ["running", "All good", updatedAtMs] as const
        }
      }
    };

    const runCell = projectBoardControls(boardWithStatus).cells.find((cell) => cell.id === "system:run");

    expect(runCell).toMatchObject({
      catalog: "system:run",
      state: "running",
      message: "All good",
      updatedAtMs
    });
    expect(runCell?.status).toEqual(["running", "All good", updatedAtMs]);
  });

  it("projects known system, capture, and sink cells", () => {
    const controls = projectBoardControls(board);
    const ids = controls.cells.map((cell) => cell.id);

    expect(ids).toContain("system:run");
    expect(ids).toContain("system:pause");
    expect(ids).toContain("capture:browser");
    expect(ids).toContain("sink:file-export");
  });

  it("uses empty objects and arrays for missing optional sections", () => {
    const sparseBoard = {
      ...board,
      cells: {
        ...board.cells,
        "system:memory": {
          label: "Memory",
           
          status: ["idle", null, Date.now()] as const,
          functions: []
        }
      }
    };

    const memoryCell = projectBoardControls(sparseBoard).cells.find(
      (cell) => cell.id === "system:memory"
    );

    expect(memoryCell?.settings).toEqual({});
    expect(memoryCell?.readonly).toEqual({});
    expect(memoryCell?.refs).toEqual({});
    expect(memoryCell?.functions).toEqual([]);
  });

  it("preserves unknown future cells", () => {
    const extendedBoard = {
      ...board,
      cells: {
        ...board.cells,
        "process:football": {
          label: "Football",
          catalog: "process:football",
           
          status: ["idle", null, Date.now()] as const,
          settings: { mode: "live" },
          functions: ["analyze"]
        }
      }
    };

    const football = projectBoardControls(extendedBoard).cells.find(
      (cell) => cell.id === "process:football"
    );

    expect(football).toMatchObject({
      id: "process:football",
      kind: "process",
      label: "Football",
      settings: { mode: "live" },
      functions: [{ name: "analyze", scope: "process:football:analyze", disabled: false }]
    });
  });

  it("projects artifact refs as ids only without embedding payloads", () => {
    const boardWithReferences = {
      ...board,
      cells: {
        ...board.cells,
        "capture:browser": {
          ...board.cells["capture:browser"],
          refs: {
            latestPreviewArtifactId: "art_123",
            previewBlob: { data: "data:image/jpeg;base64,abc" },
            previewRevision: 2
          }
        }
      }
    } as unknown as Board;

    const controls = projectBoardControls(boardWithReferences);
    const browserCell = controls.cells.find((cell) => cell.id === "capture:browser");

    expect(browserCell?.refs).toEqual({ latestPreviewArtifactId: "art_123" });
    expect(JSON.stringify(controls)).not.toContain("data:image");
    expect(JSON.stringify(controls)).not.toContain('"payload"');
  });

  it("projects refs as string artifact ids only", () => {
    const boardWithReferences = {
      ...board,
      cells: {
        ...board.cells,
        "capture:browser": {
          ...board.cells["capture:browser"],
          refs: {
            latestPreviewArtifactId: "art_123",
            previewBlob: { data: "blob" },
            revision: 4
          }
        }
      }
    } as unknown as Board;

    expect(
      projectBoardControls(boardWithReferences).cells.find((cell) => cell.id === "capture:browser")?.refs
    ).toEqual({ latestPreviewArtifactId: "art_123" });
  });

  it("is pure for the same board input", () => {
    const first = projectBoardControls(board);
    const second = projectBoardControls(board);

    expect(first).toEqual(second);
  });

  it("does not mutate the source board or nested records", () => {
    const mutableBoard = createBrowserBoardFixture("run_mutation", browserBoardSettings);
    const browserSourceCell = mutableBoard.cells["capture:browser"];
    const settings = browserSourceCell.settings ?? {};
    const readonlySection = browserSourceCell.readonly ?? {};
    const references = { latestPreviewArtifactId: "art_before" };
    const nextCells = {
      ...mutableBoard.cells,
      "capture:browser": {
        ...browserSourceCell,
        settings: { ...settings },
        readonly: { ...readonlySection },
        refs: references
      }
    };
    const boardForProjection: typeof mutableBoard = {
      ...mutableBoard,
      cells: nextCells
    };

    const boardSnapshot = structuredClone(boardForProjection);
    const controls = projectBoardControls(boardForProjection);
    const browserCell = controls.cells.find((cell) => cell.id === "capture:browser");

    (browserCell!.settings as Record<string, unknown>).mutatedKey = "changed";
    (browserCell!.readonly as Record<string, unknown>).mutatedKey = "changed";
    (browserCell!.refs as Record<string, string>).latestPreviewArtifactId = "art_after";

    expect(boardForProjection).toEqual(boardSnapshot);
    expect(boardForProjection.cells["capture:browser"]?.settings).not.toHaveProperty("mutatedKey");
    expect(boardForProjection.cells["capture:browser"]?.readonly).not.toHaveProperty("mutatedKey");
    expect(boardForProjection.cells["capture:browser"]?.refs).toEqual({
      latestPreviewArtifactId: "art_before"
    });
  });
});

describe("projectControlPanelControls", () => {
  const board = createBrowserBoardFixture("run_controls_panel", browserBoardSettings);

  it("matches board-only projection when catalog is absent", () => {
    const boardOnly = projectBoardControls(board);
    const panelOnly = projectControlPanelControls({ board });

    expect(panelOnly).toEqual(boardOnly);
  });

  it("enriches system:pause:setPresentation with catalog metadata", () => {
    const catalog = buildControlCatalog();
    const controls = projectControlPanelControls({ board, catalog });
    const setPresentation = controls.cells
      .find((cell) => cell.id === "system:pause")
      ?.functions.find((functionView) => functionView.name === "setPresentation");

    expect(setPresentation).toMatchObject({
      name: "setPresentation",
      scope: "system:pause:setPresentation",
      label: "Set pause presentation",
      description: "Update the presentation used by future pauses.",
      resultKind: "patch",
      disabled: false
    });
    expect(setPresentation?.input?.type).toBe("object");
    expect(setPresentation?.input?.properties?.some((entry) => entry.name === "whilePaused")).toBe(true);
  });

  it("does not show catalog-only functions that are not listed on the board cell", () => {
    const catalog = buildControlCatalog();
    const catalogWithExtra: ControlCatalog = {
      ...catalog,
      cells: {
        ...catalog.cells,
        "system:pause": {
          ...catalog.cells["system:pause"],
          functions: {
            ...catalog.cells["system:pause"].functions,
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

    const pauseFunctions = projectControlPanelControls({ board, catalog: catalogWithExtra }).cells
      .find((cell) => cell.id === "system:pause")
      ?.functions.map((functionView) => functionView.name);

    expect(pauseFunctions).not.toContain("hiddenAction");
  });

  it("uses the board catalog key when enriching aliased runtime cells", () => {
    const baseCatalog = buildControlCatalog();
    const catalog: ControlCatalog = {
      ...baseCatalog,
      cells: {
        ...baseCatalog.cells,
        "sink:file": {
          label: "File Sink",
          registryKind: "sink",
          registryId: "file",
          functions: {
            flush: {
              scope: "sink:file:flush",
              label: "Flush",
              description: "Flush buffered file output.",
              result: "patch"
            }
          }
        }
      }
    };
    const aliasedBoard = {
      ...board,
      cells: {
        ...board.cells,
        "sink:file-export": {
          ...board.cells["sink:file-export"],
          catalog: "sink:file",
          functions: ["flush"]
        }
      }
    };

    const flush = projectControlPanelControls({ board: aliasedBoard, catalog }).cells
      .find((cell) => cell.id === "sink:file-export")
      ?.functions.find((functionView) => functionView.name === "flush");

    expect(flush).toMatchObject({
      name: "flush",
      scope: "sink:file:flush",
      label: "Flush",
      description: "Flush buffered file output.",
      resultKind: "patch",
      disabled: false
    });
  });

  it("falls back to derived scope when catalog entry is missing", () => {
    const catalog = buildControlCatalog();
    const extendedBoard = {
      ...board,
      cells: {
        ...board.cells,
        "process:football": {
          label: "Football",
          catalog: "process:football",
           
          status: ["idle", null, Date.now()] as const,
          functions: ["analyze"]
        }
      }
    };

    const analyze = projectControlPanelControls({ board: extendedBoard, catalog }).cells
      .find((cell) => cell.id === "process:football")
      ?.functions.find((functionView) => functionView.name === "analyze");

    expect(analyze).toEqual({
      name: "analyze",
      scope: "process:football:analyze",
      disabled: false
    });
  });

  it("preserves unknown future cells with catalog present", () => {
    const catalog = buildControlCatalog();
    const extendedBoard = {
      ...board,
      cells: {
        ...board.cells,
        "process:football": {
          label: "Football",
          catalog: "process:football",
           
          status: ["idle", null, Date.now()] as const,
          functions: ["analyze"]
        }
      }
    };

    const football = projectControlPanelControls({ board: extendedBoard, catalog }).cells.find(
      (cell) => cell.id === "process:football"
    );

    expect(football?.id).toBe("process:football");
    expect(football?.functions).toHaveLength(1);
  });
});

describe("panel disabled reasons", () => {
  const board = createBrowserBoardFixture("run_disabled", browserBoardSettings);
  const catalog = buildControlCatalog();

  const withRunStatus = (runStatus: string) => ({
    ...board,
    cells: {
      ...board.cells,
      "system:run": {
        ...board.cells["system:run"],
         
        status: [runStatus, null, Date.now()] as const
      }
    }
  });

  it("disables all functions when the cell failed", () => {
    const failedBoard = {
      ...board,
      cells: {
        ...board.cells,
        "capture:browser": {
          ...board.cells["capture:browser"],
          status: ["failed", "Capture crashed", Date.now()] as const
        }
      }
    };

    const browserFunctions = projectControlPanelControls({ board: failedBoard, catalog }).cells
      .find((cell) => cell.id === "capture:browser")
      ?.functions;

    expect(browserFunctions?.every((functionView) => functionView.disabled === true)).toBe(true);
    expect(browserFunctions?.every((functionView) => functionView.disabledReason === "Cell is failed")).toBe(
      true
    );
  });

  it("disables patch functions when the run is stopped but keeps artifact functions enabled", () => {
    const stoppedBoard = withRunStatus("stopped");
    const browserCell = projectControlPanelControls({ board: stoppedBoard, catalog }).cells.find(
      (cell) => cell.id === "capture:browser"
    );

    const setCrop = browserCell?.functions.find((functionView) => functionView.name === "setCrop");
    const getPreview = browserCell?.functions.find((functionView) => functionView.name === "getPreview");

    expect(setCrop).toMatchObject({
      disabled: true,
      disabledReason: "Run is stopped",
      resultKind: "patch"
    });
    expect(getPreview?.disabled).toBe(false);
    expect(getPreview?.resultKind).toBe("artifact");
    expect(getPreview?.disabledReason).toBeUndefined();
  });

  it("uses Run failed when the run failed", () => {
    const failedRunBoard = withRunStatus("failed");
    const setPresentation = projectControlPanelControls({ board: failedRunBoard, catalog }).cells
      .find((cell) => cell.id === "system:pause")
      ?.functions.find((functionView) => functionView.name === "setPresentation");

    expect(setPresentation).toMatchObject({
      disabled: true,
      disabledReason: "Run failed"
    });
  });

  it("keeps functions enabled while the run is active", () => {
    const runningBoard = withRunStatus("running");
    const browserFunctions = projectControlPanelControls({ board: runningBoard, catalog }).cells
      .find((cell) => cell.id === "capture:browser")
      ?.functions;

    expect(browserFunctions?.every((functionView) => functionView.disabled === false)).toBe(true);
    expect(browserFunctions?.every((functionView) => functionView.disabledReason === undefined)).toBe(true);
  });

  it("does not invent disabled reasons when catalog metadata is missing", () => {
    const stoppedBoard = {
      ...withRunStatus("stopped"),
      cells: {
        ...withRunStatus("stopped").cells,
        "process:football": {
          label: "Football",
          catalog: "process:football",
           
          status: ["idle", null, Date.now()] as const,
          functions: ["analyze"]
        }
      }
    };

    const analyze = projectControlPanelControls({ board: stoppedBoard, catalog }).cells
      .find((cell) => cell.id === "process:football")
      ?.functions.find((functionView) => functionView.name === "analyze");

    expect(analyze).toEqual({
      name: "analyze",
      scope: "process:football:analyze",
      disabled: false
    });
    expect(analyze?.disabledReason).toBeUndefined();
  });
});
