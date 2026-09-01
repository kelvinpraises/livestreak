import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { createBrowserBoardFixture, createFileBoardFixture } from "#test/helpers/board.js";
import { validateBoardSettings } from "#run/control/board/index.js";
import type { Board } from "#run/control/board/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";

const baseBoard = createBrowserBoardFixture("run_settings", {
  url: "https://example.com",
  captureFps: 30,
  viewport: { width: 640, height: 360 },
  crop: { x: 0, y: 0, width: 640, height: 360 },
  encoding: "jpeg"
});

const withRunSettings = (settings: Record<string, unknown>) => ({
  ...baseBoard,
  cells: {
    ...baseBoard.cells,
    "system:run": {
      ...baseBoard.cells["system:run"]!,
      settings: {
        ...baseBoard.cells["system:run"]!.settings,
        ...settings
      }
    }
  }
});

const withPauseSettings = (settings: Record<string, unknown>) => ({
  ...baseBoard,
  cells: {
    ...baseBoard.cells,
    "system:pause": {
      ...baseBoard.cells["system:pause"]!,
      settings: {
        ...baseBoard.cells["system:pause"]!.settings,
        ...settings
      }
    }
  }
});

const withPauseSettingsOnly = (settings: Record<string, unknown>) => ({
  ...baseBoard,
  cells: {
    ...baseBoard.cells,
    "system:pause": {
      ...baseBoard.cells["system:pause"]!,
      settings
    }
  }
});

const fileBoard = createFileBoardFixture("run_file_settings", "/tmp/in.mp4");

const withCellSettingsValue = (board: Board, cellId: string, settings: unknown): Board =>
  ({
    ...board,
    cells: {
      ...board.cells,
      [cellId]: {
        ...board.cells[cellId as keyof typeof board.cells]!,
        settings
      }
    }
  }) as unknown as Board;

const withBrowserSettings = (settings: Record<string, unknown>) => ({
  ...baseBoard,
  cells: {
    ...baseBoard.cells,
    "capture:browser": {
      ...baseBoard.cells["capture:browser"]!,
      settings: {
        ...baseBoard.cells["capture:browser"]!.settings,
        ...settings
      }
    }
  }
});

describe("validateBoardSettings", () => {
  it("accepts a board with default pause settings", async () => {
    const exit = await Effect.runPromiseExit(validateBoardSettings(baseBoard));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it.each([
    ["mode", "stop-source"],
    ["fill", "gap"],
    ["markDiscontinuity", true]
  ] as const)(
    "rejects legacy system:pause.settings.%s",
    async (field, value) => {
      const board = withPauseSettings({ [field]: value });
      const exit = await Effect.runPromiseExit(validateBoardSettings(board));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain(
          `system:pause.settings.${field} is no longer supported`
        );
      }
    }
  );

  it("rejects invalid system:pause.settings.whilePaused", async () => {
    const board = withPauseSettings({ whilePaused: "hold-forever" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "system:pause.settings.whilePaused must be one of: hold, slate"
      );
    }
  });

  it("rejects slate whilePaused without slateAssetId", async () => {
    const board = withPauseSettings({ whilePaused: "slate" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        'system:pause.settings.slateAssetId is required when whilePaused is "slate"'
      );
    }
  });

  it("rejects stale slateAssetId when whilePaused is not slate", async () => {
    const board = withPauseSettings({ whilePaused: "hold", slateAssetId: "asset1" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        'system:pause.settings.whilePaused must be "slate" when slateAssetId is set'
      );
    }
  });

  it("rejects system:pause.settings with slateAssetId when whilePaused is omitted", async () => {
    const board = withPauseSettingsOnly({
      requested: false,
      slateAssetId: "asset1"
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        'system:pause.settings.whilePaused must be "slate" when slateAssetId is set'
      );
    }
  });

  it("accepts system:pause.settings with whilePaused slate and valid slateAssetId", async () => {
    const board = withPauseSettings({ whilePaused: "slate", slateAssetId: "asset1" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects capture:browser.settings.livePause", async () => {
    const board = withBrowserSettings({ livePause: { mode: "stop-source" } });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.livePause is no longer supported"
      );
    }
  });

  it("projectWorkerControlView omits stale slateAssetId when whilePaused is hold", () => {
    const board = withPauseSettings({ whilePaused: "hold", slateAssetId: "asset1" });
    const view = projectWorkerControlView(board);

    expect(view.pause.whilePaused).toBe("hold");
    expect(view.pause.slateAssetId).toBeUndefined();
  });

  it("rejects invalid system:run.settings.stopRequested", async () => {
    const board = withRunSettings({ stopRequested: "yes" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "system:run.settings.stopRequested must be a boolean"
      );
    }
  });

  it.each(["", " ".repeat(3)])(
    "rejects system:run.settings.stopReason when value is empty or whitespace (%j)",
    async (stopReason) => {
      const board = withRunSettings({ stopReason });
      const exit = await Effect.runPromiseExit(validateBoardSettings(board));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain(
          "system:run.settings.stopReason must be a non-empty string"
        );
      }
    }
  );

  it("rejects invalid system:run.settings.stopReason type", async () => {
    const board = withRunSettings({ stopReason: 42 });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "system:run.settings.stopReason must be a non-empty string"
      );
    }
  });

  it("accepts system:run.settings.stopReason with non-empty trimmed content", async () => {
    const board = withRunSettings({ stopReason: "  operator stop  " });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects system:pause.settings when value is not an object", async () => {
    const board = {
      ...baseBoard,
      cells: {
        ...baseBoard.cells,
        "system:pause": {
          ...baseBoard.cells["system:pause"]!,
          settings: "bad"
        }
      }
    } as unknown as Board;
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("system:pause.settings must be a plain object");
    }
  });

  it("rejects system:pause.settings when value is a Date", async () => {
    const board = {
      ...baseBoard,
      cells: {
        ...baseBoard.cells,
        "system:pause": {
          ...baseBoard.cells["system:pause"]!,
          settings: new Date()
        }
      }
    } as unknown as Board;
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("system:pause.settings must be a plain object");
    }
  });

  it("rejects non-plain system:run.settings", async () => {
    const board = withCellSettingsValue(baseBoard, "system:run", new Date());
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("system:run.settings must be a plain object");
    }
  });

  it("rejects non-plain capture:browser.settings", async () => {
    const board = withCellSettingsValue(baseBoard, "capture:browser", []);
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("capture:browser.settings must be a plain object");
    }
  });

  it("rejects non-plain capture:file.settings", async () => {
    const board = withCellSettingsValue(fileBoard, "capture:file", 123);
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("capture:file.settings must be a plain object");
    }
  });

  it("rejects non-plain sink:file-export.settings", async () => {
    const board = withCellSettingsValue(baseBoard, "sink:file-export", new Map());
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("sink:file-export.settings must be a plain object");
    }
  });

  it("rejects system:pause.settings.requested when non-boolean", async () => {
    const board = withPauseSettings({ requested: "yes" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("system:pause.settings.requested must be a boolean");
    }
  });

  it.each([
    ["string", "bad"],
    ["array", []],
    ["Date", new Date()]
  ])("rejects capture:browser.settings.viewport when value is %s", async (_label, viewport) => {
    const board = withBrowserSettings({ viewport });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.viewport must be a plain object"
      );
    }
  });

  it("rejects invalid capture:browser.settings.viewport width", async () => {
    const board = withBrowserSettings({
      viewport: { width: 0, height: 360 }
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.viewport.width must be greater than 0"
      );
    }
  });

  it("rejects invalid capture:browser.settings.viewport height", async () => {
    const board = withBrowserSettings({
      viewport: { width: 640, height: -1 }
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.viewport.height must be greater than 0"
      );
    }
  });

  it.each([
    ["string", "bad"],
    ["array", []],
    ["Date", new Date()]
  ])("rejects capture:browser.settings.crop when value is %s", async (_label, crop) => {
    const board = withBrowserSettings({ crop });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("capture:browser.settings.crop must be a plain object");
    }
  });

  /* eslint-disable unicorn/no-null -- validating null crop is required */
  it("accepts capture:browser.settings.crop when null", async () => {
    const board = withBrowserSettings({ crop: null });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects invalid capture:browser.settings.crop width", async () => {
    const board = withBrowserSettings({
      crop: { x: 0, y: 0, width: 0, height: 360 }
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.crop.width must be greater than 0"
      );
    }
  });

  it("rejects invalid capture:browser.settings.crop height", async () => {
    const board = withBrowserSettings({
      crop: { x: 0, y: 0, width: 640, height: 0 }
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.crop.height must be greater than 0"
      );
    }
  });

  it("rejects invalid capture:browser.settings.encoding", async () => {
    const board = withBrowserSettings({ encoding: "webp" });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.encoding must be one of: jpeg, png"
      );
    }
  });

  it("rejects invalid capture:browser.settings.captureFps", async () => {
    const board = withBrowserSettings({ captureFps: 0 });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.captureFps must be greater than 0"
      );
    }
  });

  it("rejects invalid capture:browser.settings.maxFrames", async () => {
    const board = withBrowserSettings({ maxFrames: -3 });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.maxFrames must be greater than 0"
      );
    }
  });

  it("rejects sink subscribe when not an array", async () => {
    const board = withCellSettingsValue(baseBoard, "sink:file-export", {
      ...baseBoard.cells["sink:file-export"]!.settings,
      subscribe: "publish.video.rendered"
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "sink:file-export.settings.subscribe must be an array"
      );
    }
  });

  it("rejects sink subscribe with non-string member", async () => {
    const board = withCellSettingsValue(baseBoard, "sink:file-export", {
      ...baseBoard.cells["sink:file-export"]!.settings,
      subscribe: ["publish.video.rendered", 42]
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "sink:file-export.settings.subscribe must be an array of strings"
      );
    }
  });

  it("rejects sink required when non-boolean", async () => {
    const board = withCellSettingsValue(baseBoard, "sink:file-export", {
      ...baseBoard.cells["sink:file-export"]!.settings,
      required: "yes"
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "sink:file-export.settings.required must be a boolean"
      );
    }
  });

  it("rejects sink path when non-string", async () => {
    const board = withCellSettingsValue(baseBoard, "sink:file-export", {
      ...baseBoard.cells["sink:file-export"]!.settings,
      path: 42
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain("sink:file-export.settings.path must be a string");
    }
  });

  it("rejects capture:browser.settings.captureFps when Infinity", async () => {
    const board = withBrowserSettings({ captureFps: Infinity });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.captureFps must be a finite number"
      );
    }
  });

  it("rejects capture:browser.settings.viewport.width when -Infinity", async () => {
    const board = withBrowserSettings({
      viewport: { width: -Infinity, height: 360 }
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.viewport.width must be a finite number"
      );
    }
  });

  it("rejects capture:browser.settings.crop.x when NaN", async () => {
    const board = withBrowserSettings({
      crop: { x: Number.NaN, y: 0, width: 640, height: 360 }
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:browser.settings.crop.x must be a finite number"
      );
    }
  });

  it("rejects capture:file.settings.maxPumpMs when Infinity", async () => {
    const board = withCellSettingsValue(fileBoard, "capture:file", {
      ...fileBoard.cells["capture:file"]!.settings,
      maxPumpMs: Infinity
    });
    const exit = await Effect.runPromiseExit(validateBoardSettings(board));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(
        "capture:file.settings.maxPumpMs must be a finite number"
      );
    }
  });
});
