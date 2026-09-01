import { LiveStreakConfigError } from "@livestreak/core";

import type {
  AnnotationPayload,
  AppendMessagePayload,
  OpenThreadPayload,
  StewardActionPlan,
  StewardContractCall,
  StewardHostAction
} from "../model/action-plan.js";
import { isStewardSubject } from "./subject.js";
import { isStewardDecision, validateStewardDecision } from "./decision.js";

// --- exports ---

export const isStewardActionPlan = (value: unknown): value is StewardActionPlan => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (!isStewardDecision(record.decision)) {
    return false;
  }

  if (!Array.isArray(record.contractCalls)) {
    return false;
  }

  if (!Array.isArray(record.hostActions)) {
    return false;
  }

  for (const call of record.contractCalls) {
    if (!isStewardContractCall(call)) {
      return false;
    }
  }

  for (const action of record.hostActions) {
    if (!isStewardHostAction(action)) {
      return false;
    }
  }

  return true;
};

export const validateStewardActionPlan = (value: unknown): StewardActionPlan => {
  if (!isStewardActionPlan(value)) {
    throw new LiveStreakConfigError({
      message: "Invalid steward action plan",
      metadata: { details: "Action plan requires decision, contractCalls, and hostActions" }
    });
  }

  return {
    ...value,
    decision: validateStewardDecision(value.decision)
  };
};

// --- helpers ---

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isOptionalNonEmptyString = (value: unknown): boolean =>
  value === undefined || isNonEmptyString(value);

const isStewardContractCall = (value: unknown): value is StewardContractCall => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.contract !== "vault" && record.contract !== "stewardRegistry") {
    return false;
  }

  if (!isNonEmptyString(record.functionName) || !Array.isArray(record.args)) {
    return false;
  }

  if (record.contract === "vault") {
    return validateVaultContractCall(record.functionName, record.args);
  }

  return validateStewardRegistryContractCall(record.functionName, record.args);
};

const validateVaultContractCall = (functionName: string, args: unknown[]): boolean => {
  if (args.length !== 2) {
    return false;
  }

  if (functionName === "triggerHot" || functionName === "resolve") {
    return isNonEmptyString(args[0]) && isNonEmptyString(args[1]);
  }

  return false;
};

const validateStewardRegistryContractCall = (functionName: string, args: unknown[]): boolean => {
  switch (functionName) {
    case "challengeProposal":
      return args.length === 2 && isNonEmptyString(args[0]) && isFiniteNumber(args[1]);
    case "proposePenalty":
    case "vetoSteward":
      return args.length === 2 && isNonEmptyString(args[0]) && isNonEmptyString(args[1]);
    case "challengeStewardDecision":
      return (
        args.length === 3 &&
        isNonEmptyString(args[0]) &&
        isNonEmptyString(args[1]) &&
        isNonEmptyString(args[2])
      );
    default:
      return false;
  }
};

const isStewardHostAction = (value: unknown): value is StewardHostAction => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.kind === "openThread") {
    return isOpenThreadPayload(record.payload);
  }

  if (record.kind === "appendMessage") {
    return isAppendMessagePayload(record.payload);
  }

  if (record.kind === "annotate") {
    return isAnnotationPayload(record.payload);
  }

  return false;
};

const isOpenThreadPayload = (value: unknown): value is OpenThreadPayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isStewardSubject(record.subject) &&
    isNonEmptyString(record.title) &&
    isOptionalNonEmptyString(record.stewardId) &&
    isOptionalNonEmptyString(record.findingId)
  );
};

const isAppendMessagePayload = (value: unknown): value is AppendMessagePayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isStewardSubject(record.subject) &&
    isNonEmptyString(record.message) &&
    isOptionalNonEmptyString(record.findingId) &&
    isOptionalNonEmptyString(record.threadId) &&
    isOptionalNonEmptyString(record.stewardId)
  );
};

const isAnnotationPayload = (value: unknown): value is AnnotationPayload => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isStewardSubject(record.subject) &&
    isNonEmptyString(record.message) &&
    isNonEmptyString(record.findingId) &&
    isOptionalNonEmptyString(record.stewardId)
  );
};
