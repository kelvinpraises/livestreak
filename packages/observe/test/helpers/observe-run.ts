import { Effect } from "effect";
import { makeObserveRun, type ObserveRun, type ObserveRunConfig } from "#run/run.js";

export const makeObserveRunSync = (config: ObserveRunConfig): ObserveRun =>
  Effect.runSync(makeObserveRun(config));
