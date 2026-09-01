export interface ObserveRunStageConfig {
  readonly driverId: string;
  readonly config: unknown;
}

export interface ObserveRunSinkConfig extends ObserveRunStageConfig {
  readonly instanceId?: string;
}

export interface ObserveRunProcessConfig {
  readonly packId: string;
  readonly config: unknown;
}

export interface ObserveRunConfig {
  readonly runId: string;
  readonly capture: ObserveRunStageConfig;
  readonly sink: ObserveRunSinkConfig;
  readonly process: null | ObserveRunProcessConfig;
}
