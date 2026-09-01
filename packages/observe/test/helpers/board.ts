/* eslint-disable unicorn/no-null -- BoardCell.status tuple uses null for absent message */
import type { BrowserCaptureConfig } from "#pipeline/capture/browser/index.js";
import { browserCaptureFunctionNames } from "#pipeline/capture/browser/control/surface.js";
import { createInitialBoard, type Board } from "#run/control/board/index.js";
import type { BoardCell } from "#run/control/bus/index.js";
import { mergeBoardCellOnSurfaceMount } from "#run/control/bus/index.js";

export interface BrowserBoardCaptureSettings {
  readonly url: string;
  readonly captureFps: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly crop?: BrowserCaptureConfig["crop"];
  readonly encoding: "jpeg" | "png";
  readonly interactive?: boolean;
  readonly debug?: boolean;
  readonly maxFrames?: number;
  readonly selectedTargetId?: string;
  readonly cropSource?: string;
  readonly lastPreviewRevision?: number;
}

export const browserCaptureBoardCell = (
  settings: BrowserBoardCaptureSettings
): BoardCell => ({
  label: "Browser Capture",
  catalog: "capture:browser",
  status: ["idle", null, Date.now()],
  settings: {
    maxPumpMs: 4,
    ...settings
  },
  readonly: {
    sourceType: "browser",
    sourceMode: "live"
  },
  functions: [...browserCaptureFunctionNames]
});

export const fileCaptureBoardCell = (capturePath: string): BoardCell => ({
  label: "File Capture",
  catalog: "capture:file",
  status: ["idle", null, Date.now()],
  settings: {
    path: capturePath,
    maxPumpMs: 4
  },
  readonly: {
    sourceType: "file",
    sourceMode: "file"
  },
  functions: []
});

export const fileSinkBoardCell = (sinkPath: string): BoardCell => ({
  label: "File Export",
  catalog: "sink:file",
  status: ["idle", null, Date.now()],
  settings: {
    path: sinkPath,
    subscribe: ["publish.video.rendered"],
    required: true
  },
  readonly: {},
  functions: []
});

export const systemMemoryBoardCell = (): BoardCell => ({
  label: "Memory",
  catalog: "system:memory",
  status: ["idle", null, Date.now()],
  readonly: {},
  functions: []
});

export const systemTickBoardCell = (): BoardCell => ({
  label: "Tick",
  catalog: "system:tick",
  status: ["idle", null, Date.now()],
  readonly: {},
  functions: []
});

export const extendBoardWithCells = (
  board: Board,
  cells: Record<string, BoardCell>
): Board =>
  ({
    ...board,
    cells: {
      ...board.cells,
      ...cells
    }
  });

export const createBrowserBoardFixture = (
  runId: string,
  capture: Partial<BrowserBoardCaptureSettings> = {},
  sinkPath = "/tmp/out.mp4"
): Board =>
  extendBoardWithCells(createInitialBoard({ runId }), {
    "capture:browser": browserCaptureBoardCell({
      url: capture.url ?? "https://example.com",
      captureFps: capture.captureFps ?? 30,
      viewport: capture.viewport ?? { width: 640, height: 480 },
      encoding: capture.encoding ?? "jpeg",
      ...(capture.crop === undefined ? {} : { crop: capture.crop }),
      ...(capture.interactive === undefined ? {} : { interactive: capture.interactive }),
      ...(capture.debug === undefined ? {} : { debug: capture.debug }),
      ...(capture.maxFrames === undefined ? {} : { maxFrames: capture.maxFrames }),
      ...(capture.selectedTargetId === undefined
        ? {}
        : { selectedTargetId: capture.selectedTargetId }),
      ...(capture.cropSource === undefined ? {} : { cropSource: capture.cropSource }),
      ...(capture.lastPreviewRevision === undefined
        ? {}
        : { lastPreviewRevision: capture.lastPreviewRevision })
    }),
    "sink:file-export": fileSinkBoardCell(sinkPath)
  });

export const createFileBoardFixture = (
  runId: string,
  capturePath: string,
  sinkPath = "/tmp/out.mp4"
): Board =>
  extendBoardWithCells(createInitialBoard({ runId }), {
    "capture:file": fileCaptureBoardCell(capturePath),
    "sink:file-export": fileSinkBoardCell(sinkPath)
  });

export const mountBrowserCaptureCell = (
  board: Board,
  settings: BrowserBoardCaptureSettings
): Board =>
  mergeBoardCellOnSurfaceMount(board, {
    id: "capture:browser",
    cell: browserCaptureBoardCell(settings)
  }).board;

export const mountFileCaptureCell = (board: Board, capturePath: string): Board =>
  mergeBoardCellOnSurfaceMount(board, {
    id: "capture:file",
    cell: fileCaptureBoardCell(capturePath)
  }).board;

export const mountFileSinkCell = (
  board: Board,
  sinkPath: string,
  instanceId = "file-export"
): Board =>
  mergeBoardCellOnSurfaceMount(board, {
    id: `sink:${instanceId}`,
    cell: fileSinkBoardCell(sinkPath)
  }).board;

/** Mount path that bumps revision — use fixtures when tests expect revision 1. */
export const createBrowserBoard = (
  runId: string,
  capture: Partial<BrowserBoardCaptureSettings> = {},
  sinkPath = "/tmp/out.mp4"
): Board => {
  const board = createInitialBoard({ runId });

  return mountFileSinkCell(
    mountBrowserCaptureCell(board, {
      url: capture.url ?? "https://example.com",
      captureFps: capture.captureFps ?? 30,
      viewport: capture.viewport ?? { width: 640, height: 480 },
      encoding: capture.encoding ?? "jpeg",
      ...(capture.crop === undefined ? {} : { crop: capture.crop }),
      ...(capture.interactive === undefined ? {} : { interactive: capture.interactive }),
      ...(capture.debug === undefined ? {} : { debug: capture.debug }),
      ...(capture.maxFrames === undefined ? {} : { maxFrames: capture.maxFrames }),
      ...(capture.selectedTargetId === undefined
        ? {}
        : { selectedTargetId: capture.selectedTargetId }),
      ...(capture.cropSource === undefined ? {} : { cropSource: capture.cropSource }),
      ...(capture.lastPreviewRevision === undefined
        ? {}
        : { lastPreviewRevision: capture.lastPreviewRevision })
    }),
    sinkPath
  );
};

export const createFileBoard = (
  runId: string,
  capturePath: string,
  sinkPath = "/tmp/out.mp4"
): Board => mountFileSinkCell(mountFileCaptureCell(createInitialBoard({ runId }), capturePath), sinkPath);
