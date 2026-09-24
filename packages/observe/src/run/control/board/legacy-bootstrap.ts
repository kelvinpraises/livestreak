import type { ObserveRunConfig } from "#run/config/index.js";
import type { Board } from "./model.js";
import { incrementBoardRevision } from "./model.js";
import { defaultControlPause, defaultControlRun } from "./settings.js";

const captureCellIdFor = (driverId: string): string =>
  driverId === "synthetic" ? "capture:synthetic" : `capture:${driverId}`;

// MUST mirror the kernel's resolveSinkInstanceId — a mismatch would mint a second sink cell
// and the worker's policy scan would see a phantom sink.
const sinkCellIdFor = (config: ObserveRunConfig): string => {
  if (config.sink.instanceId !== undefined) {
    return `sink:${config.sink.instanceId}`;
  }
  if (config.sink.driverId === "file") {
    return "sink:file-export";
  }
  if (config.sink.driverId === "memory") {
    return "sink:memory-sink";
  }
  return `sink:${config.sink.driverId}`;
};

const sinkCatalogFor = (config: ObserveRunConfig): string => {
  if (config.sink.driverId === "live") {
    return "sink:live";
  }
  if (config.sink.driverId === "direct") {
    return "sink:direct";
  }
  return "sink:file-export";
};

/** Code-first runs skip Add observation: mount the canonical single-run cells that mirror the
 *  given config, so board reads (worker view, prepared flag, pause) see one coherent world. */
export const bootstrapLegacyObserveBoard = (board: Board, config: ObserveRunConfig): Board => {
  if (
    board.cells["system:run"] !== undefined ||
    Object.keys(board.cells).some((id) => id.startsWith("obs:"))
  ) {
    return board;
  }

  const nowMs = Date.now();
  const configCell = board.cells["system:config"];
  const capturePath = (config.capture.config as { path?: unknown } | undefined)?.path;

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      ...(configCell === undefined
        ? {}
        : {
            "system:config": {
              ...configCell,
              status: ["configured", null, nowMs]
            }
          }),
      "system:run": {
        label: "Run",
        catalog: "system:run",
        status: ["created", null, nowMs],
        settings: { ...defaultControlRun },
        readonly: { runId: config.runId, prepared: false },
        functions: ["prepare", "start", "await", "stop"]
      },
      "system:pause": {
        label: "Pause",
        catalog: "system:pause",
        status: ["idle", null, nowMs],
        settings: { ...defaultControlPause },
        functions: ["pause", "resume", "setPresentation"]
      },
      "system:memory": {
        label: "Memory",
        catalog: "system:memory",
        status: ["idle", null, nowMs],
        readonly: {},
        functions: []
      },
      "system:tick": {
        label: "Tick",
        catalog: "system:tick",
        status: ["idle", null, nowMs],
        readonly: {},
        functions: []
      },
      [captureCellIdFor(config.capture.driverId)]: {
        label: "Capture",
        catalog: captureCellIdFor(config.capture.driverId),
        status: ["configured", null, nowMs],
        settings: {
          maxPumpMs: 4,
          ...(typeof capturePath === "string" ? { path: capturePath } : {})
        },
        readonly: { configured: true },
        functions: ["configure", "close"]
      },
      [sinkCellIdFor(config)]: {
        label: "Publish",
        catalog: sinkCatalogFor(config),
        status: ["configured", null, nowMs],
        settings: { subscribe: ["publish.video.rendered"], required: true },
        readonly: { configured: true },
        functions: ["configure", "close"]
      },
      market: {
        label: "Market",
        catalog: "market",
        status: ["none", null, nowMs],
        readonly: { registrationState: "none" },
        functions: ["register", "goLive", "setEnded", "close"]
      }
    }
  });
};
