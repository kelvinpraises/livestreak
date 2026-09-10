import type { Board } from "#run/control/board/model.js";
import { systemConfigConfiguratorId } from "#flows/permutations.js";

export const defaultLiveConfigurators = (): readonly string[] => [systemConfigConfiguratorId];

export const readLiveConfigurators = (board: Board): readonly string[] => {
  const raw = board.cells["system:config"]?.readonly?.liveConfigurators;
  if (!Array.isArray(raw)) {
    return defaultLiveConfigurators();
  }

  return raw.filter((entry): entry is string => typeof entry === "string");
};

export const isConfiguratorVisible = (
  configuratorId: string,
  liveConfigurators: readonly string[]
): boolean => liveConfigurators.includes(configuratorId);

export const isDescriptorVisibleForBoard = (
  descriptorId: string,
  board: Board
): boolean => {
  const live = readLiveConfigurators(board);

  if (descriptorId === "observe.system.config.configure" || descriptorId === "observe.system.config.close") {
    return live.includes(systemConfigConfiguratorId);
  }

  if (descriptorId.startsWith("observe.system.config.")) {
    return live.includes(systemConfigConfiguratorId);
  }

  if (descriptorId.startsWith("observe.capture.")) {
    const captureId = descriptorId.split(".")[2];
    if (captureId === undefined) {
      return false;
    }
    return live.includes(`observe.capture.${captureId}`);
  }

  if (descriptorId.startsWith("observe.sink.")) {
    const sinkId = descriptorId.split(".")[2];
    if (sinkId === undefined) {
      return false;
    }
    return live.includes(`observe.sink.${sinkId}`);
  }

  if (descriptorId.startsWith("observe.market.")) {
    return live.includes("observe.market");
  }

  if (descriptorId.startsWith("observe.system.run.")) {
    return live.includes("observe.system.run");
  }

  if (descriptorId.startsWith("observe.system.pause.")) {
    return board.cells["system:pause"] !== undefined;
  }

  if (descriptorId.startsWith("observe.system.")) {
    const cellKey = descriptorId.split(".")[2];
    if (cellKey === undefined) {
      return false;
    }
    return board.cells[`system:${cellKey}`] !== undefined;
  }

  return board.cells[descriptorId.replace(/^observe\./, "").replace(/\./g, ":")] !== undefined;
};
