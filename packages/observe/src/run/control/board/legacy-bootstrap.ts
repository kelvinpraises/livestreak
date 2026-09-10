import {
  captureConfiguratorId,
  marketConfiguratorId,
  publishConfiguratorId,
  systemRunConfiguratorId
} from "#flows/permutations.js";
import type { ObserveRunConfig } from "#run/config/index.js";
import type { Board } from "./model.js";
import { incrementBoardRevision } from "./model.js";
import { defaultControlPause, defaultControlRun } from "./settings.js";

const captureConfiguratorKey = (driverId: string): string => {
  if (driverId === "synthetic") {
    return "synthetic";
  }

  return driverId;
};

const publishConfiguratorKey = (config: ObserveRunConfig): string => {
  if (config.sink.instanceId !== undefined) {
    return config.sink.instanceId;
  }

  if (config.sink.driverId === "file") {
    return "file-export";
  }

  if (config.sink.driverId === "local") {
    return "local";
  }

  if (config.sink.driverId === "memory") {
    return "memory-sink";
  }

  return config.sink.driverId;
};

/** Mount system cells and live configurators when legacy callers skip system:config.configure. */
export const bootstrapLegacyObserveBoard = (board: Board, config: ObserveRunConfig): Board => {
  if (board.cells["system:run"] !== undefined) {
    return board;
  }

  const nowMs = Date.now();
  const capture = captureConfiguratorKey(config.capture.driverId);
  const publish = publishConfiguratorKey(config);
  const liveConfigurators = [
    captureConfiguratorId(capture),
    publishConfiguratorId(publish),
    systemRunConfiguratorId,
    marketConfiguratorId
  ];

  const configCell = board.cells["system:config"];

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      ...(configCell === undefined
        ? {}
        : {
            "system:config": {
              ...configCell,
              readonly: {
                ...configCell.readonly,
                liveConfigurators
              },
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
