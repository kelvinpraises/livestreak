import { LiveStreakConfigError } from "@livestreak/core";

import type { StewardActionContext } from "../action/types.js";
import type { StewardDecisionPolicy } from "../decision/types.js";
import type { StewardSubject } from "../model/subject.js";
import type { StewardRuleset } from "../rules/types.js";
import { isStewardSubject, validateStewardSubject } from "../validate/subject.js";
import type { ContractFactSource, HostFactSource, ObserveFactSource } from "./sources.js";
import type { StewardActionPlanSink } from "./sink.js";

// --- exports ---

export interface StewardRuntimeConfig {
  readonly runtimeId: string;
  readonly watchedSubjects: readonly StewardSubject[];
  readonly ruleset: StewardRuleset;
  readonly decisionPolicy: StewardDecisionPolicy;
  readonly actionContext?: StewardActionContext;
  readonly refreshIntervalMs?: number;
}

export interface StewardRuntimeInput {
  readonly config: unknown;
  readonly contractFactSource: ContractFactSource;
  readonly hostFactSource: HostFactSource;
  readonly observeFactSource: ObserveFactSource;
  readonly actionPlanSink: StewardActionPlanSink;
}

export const validateStewardRuntimeConfig = (input: unknown): StewardRuntimeConfig => {
  if (!isPlainObject(input)) {
    throw new LiveStreakConfigError({
      message: "Steward runtime config must be a plain object",
      metadata: { details: describeValue(input) }
    });
  }

  const runtimeId = requireNonEmptyString(input.runtimeId, "runtimeId");
  const watchedSubjects = readSubjectArray(input.watchedSubjects, "watchedSubjects");
  const ruleset = readRuleset(input.ruleset);
  const decisionPolicy = readDecisionPolicy(input.decisionPolicy);
  const actionContext = readOptionalActionContext(input.actionContext);
  const refreshIntervalMs = readOptionalPositiveFiniteNumber(
    input.refreshIntervalMs,
    "refreshIntervalMs"
  );

  return {
    runtimeId,
    watchedSubjects,
    ruleset,
    decisionPolicy,
    ...(actionContext === undefined ? {} : { actionContext }),
    ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs })
  };
};

// --- helpers ---

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const describeValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
};

const requireNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: `Steward runtime config requires a non-empty ${field}`,
      metadata: { details: describeValue(value) }
    });
  }

  return value.trim();
};

const readSubjectArray = (value: unknown, field: string): readonly StewardSubject[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new LiveStreakConfigError({
      message: `Steward runtime config requires a non-empty ${field} array`,
      metadata: { details: describeValue(value) }
    });
  }

  return value.map((entry, index) => {
    if (!isStewardSubject(entry)) {
      throw new LiveStreakConfigError({
        message: `Steward runtime config ${field}[${index}] is not a valid subject`,
        metadata: { details: describeValue(entry) }
      });
    }

    return validateStewardSubject(entry);
  });
};

const readRuleset = (value: unknown): StewardRuleset => {
  if (!isPlainObject(value) || typeof value.id !== "string" || value.id.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: "Steward runtime config requires a ruleset with id and rules",
      metadata: { details: describeValue(value) }
    });
  }

  if (!Array.isArray(value.rules)) {
    throw new LiveStreakConfigError({
      message: "Steward runtime config ruleset.rules must be an array",
      metadata: { details: value.id }
    });
  }

  return value as unknown as StewardRuleset;
};

const readDecisionPolicy = (value: unknown): StewardDecisionPolicy => {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    !Array.isArray(value.mappings)
  ) {
    throw new LiveStreakConfigError({
      message: "Steward runtime config requires a decisionPolicy with id and mappings",
      metadata: { details: describeValue(value) }
    });
  }

  return value as unknown as StewardDecisionPolicy;
};

const readOptionalActionContext = (value: unknown): StewardActionContext | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new LiveStreakConfigError({
      message: "Steward runtime config actionContext must be a plain object",
      metadata: { details: describeValue(value) }
    });
  }

  return value as StewardActionContext;
};

const readOptionalPositiveFiniteNumber = (
  value: unknown,
  field: string
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new LiveStreakConfigError({
      message: `Steward runtime ${field} must be a positive finite number`,
      metadata: { details: String(value) }
    });
  }

  return value;
};
