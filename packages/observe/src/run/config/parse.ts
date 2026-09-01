import { LiveStreakConfigError } from "@livestreak/core";
import type {
  ObserveRunConfig,
  ObserveRunProcessConfig,
  ObserveRunSinkConfig,
  ObserveRunStageConfig
} from "./types.js";

export type ObserveRunConfigValidationResult =
  | { readonly ok: true; readonly value: ObserveRunConfig }
  | { readonly ok: false; readonly error: LiveStreakConfigError };

export const parseObserveRunConfig = (input: unknown): ObserveRunConfigValidationResult => {
  const root = requirePlainObject(input, "observe run config");
  if (root.ok === false) {
    return root;
  }

  const runId = requireNonEmptyString(root.value.runId, "runId");
  if (runId.ok === false) {
    return runId;
  }

  const capture = validateCaptureStage(root.value.capture);
  if (capture.ok === false) {
    return capture;
  }

  const process = validateProcess(root.value.process);
  if (process.ok === false) {
    return process;
  }

  const sink = validateSinkStage(root.value.sink);
  if (sink.ok === false) {
    return sink;
  }

  return {
    ok: true,
    value: {
      runId: runId.value,
      capture: capture.value,
      process: process.value,
      sink: sink.value
    }
  };
};

// --- helpers ---

type ValidationSuccess<T> = { readonly ok: true; readonly value: T };
type ValidationFailure = { readonly ok: false; readonly error: LiveStreakConfigError };
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const configError = (message: string): ValidationFailure => ({
  ok: false,
  error: new LiveStreakConfigError({ message })
});

const requirePlainObject = (
  value: unknown,
  fieldPath: string
): ValidationResult<Readonly<Record<string, unknown>>> => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return configError(`${fieldPath} must be a plain object`);
  }

  return { ok: true, value: value as Readonly<Record<string, unknown>> };
};

const requireNonEmptyString = (value: unknown, fieldPath: string): ValidationResult<string> => {
  if (typeof value !== "string") {
    return configError(`${fieldPath} must be a non-empty string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return configError(`${fieldPath} must be a non-empty string`);
  }

  return { ok: true, value: trimmed };
};

const requireDefined = (value: unknown, fieldPath: string): ValidationResult<unknown> => {
  if (value === undefined) {
    return configError(`${fieldPath} is required`);
  }

  return { ok: true, value };
};

const validateCaptureStage = (value: unknown): ValidationResult<ObserveRunStageConfig> => {
  const capture = requirePlainObject(value, "capture");
  if (capture.ok === false) {
    return capture;
  }

  const driverId = requireNonEmptyString(capture.value.driverId, "capture.driverId");
  if (driverId.ok === false) {
    return driverId;
  }

  const config = requireDefined(capture.value.config, "capture.config");
  if (config.ok === false) {
    return config;
  }

  return {
    ok: true,
    value: {
      driverId: driverId.value,
      config: config.value
    }
  };
};

const validateSinkStage = (value: unknown): ValidationResult<ObserveRunSinkConfig> => {
  const sink = requirePlainObject(value, "sink");
  if (sink.ok === false) {
    return sink;
  }

  const driverId = requireNonEmptyString(sink.value.driverId, "sink.driverId");
  if (driverId.ok === false) {
    return driverId;
  }

  const config = requireDefined(sink.value.config, "sink.config");
  if (config.ok === false) {
    return config;
  }

  if (sink.value.instanceId === undefined) {
    return {
      ok: true,
      value: {
        driverId: driverId.value,
        config: config.value
      }
    };
  }

  const instanceId = requireNonEmptyString(sink.value.instanceId, "sink.instanceId");
  if (instanceId.ok === false) {
    return instanceId;
  }

  return {
    ok: true,
    value: {
      driverId: driverId.value,
      instanceId: instanceId.value,
      config: config.value
    }
  };
};

const validateProcess = (value: unknown): ValidationResult<null | ObserveRunProcessConfig> => {
  if (value === undefined) {
    return configError("process is required");
  }

  if (value === null) {
    // eslint-disable-next-line unicorn/no-null -- passthrough signal
    return { ok: true, value: null };
  }

  return validateProcessPack(value);
};

const validateProcessPack = (value: unknown): ValidationResult<ObserveRunProcessConfig> => {
  const process = requirePlainObject(value, "process");
  if (process.ok === false) {
    return process;
  }

  const packId = requireNonEmptyString(process.value.packId, "process.packId");
  if (packId.ok === false) {
    return packId;
  }

  const config = requireDefined(process.value.config, "process.config");
  if (config.ok === false) {
    return config;
  }

  return {
    ok: true,
    value: {
      packId: packId.value,
      config: config.value
    }
  };
};
