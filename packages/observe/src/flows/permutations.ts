/**
 * v0 flow permutation table — valid (capture × publish) pairs for system:config.configure.
 * Process is always null in v0.
 */

export interface FlowPermutation {
  readonly capture: string;
  readonly publish: string;
  readonly process: null;
}

export const flowPermutationsV0: readonly FlowPermutation[] = [
  { capture: "file", publish: "file-export", process: null },
  { capture: "file", publish: "local", process: null }
] as const;

export interface FlowPermutationInput {
  readonly capture: string;
  readonly publish: string;
  readonly process: null | string;
}

export const isValidFlowPermutation = (input: FlowPermutationInput): boolean => {
  if (input.process !== null) {
    return false;
  }

  return flowPermutationsV0.some(
    (row) => row.capture === input.capture && row.publish === input.publish
  );
};

export const captureCellId = (capture: string): string => `capture:${capture}`;

export const publishCellId = (publish: string): string => `sink:${publish}`;

export const captureConfiguratorId = (capture: string): string =>
  `observe.capture.${capture}`;

export const publishConfiguratorId = (publish: string): string =>
  `observe.sink.${publish}`;

export const systemConfigConfiguratorId = "observe.system.config" as const;

export const systemRunConfiguratorId = "observe.system.run" as const;

export const marketConfiguratorId = "observe.market" as const;
