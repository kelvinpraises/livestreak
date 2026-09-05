import type { BookmakerVaultPolicy } from "../pipeline/decision/choose.js";
import type { BookmakerRuntimeConfig } from "./config.js";
import type { BookmakerSimilarityClient } from "../pipeline/similarity/client.js";
import { hasBookmakerChainAddresses } from "../chains/config.js";
import type { ValidationResult } from "../model/validate.js";
import {
  validateDetection,
  validateBookmakerMarketContext,
  validateBookmakerWatchSource,
  validationFailure,
  validationSuccess
} from "../model/validate.js";

// --- exports ---

export const validateBookmakerRuntimeConfig = (
  input: unknown
): ValidationResult<BookmakerRuntimeConfig> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerRuntimeConfig must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const runtimeId = requireNonEmptyString(value.runtimeId, "runtimeId", issues);
  const fundingToken = requireNonEmptyString(value.fundingToken, "fundingToken", issues);

  const marketContext = validateNested(value.marketContext, validateBookmakerMarketContext, "marketContext");
  if (marketContext.ok === false) {
    issues.push(...marketContext.issues.map((issue) => `marketContext.${issue}`));
  }

  const watchSource = validateNested(value.watchSource, validateBookmakerWatchSource, "watchSource");
  if (watchSource.ok === false) {
    issues.push(...watchSource.issues.map((issue) => `watchSource.${issue}`));
  }

  if (
    marketContext.ok &&
    watchSource.ok &&
    watchSource.value.marketId !== marketContext.value.marketId
  ) {
    issues.push("watchSource.marketId must match marketContext.marketId");
  }

  const policy = validatePolicy(value.policy, issues);

  if (value.similarityClient !== undefined && isSimilarityClientShape(value.similarityClient) === false) {
    issues.push("similarityClient must provide a findSimilar function when provided");
  }

  if (value.addresses === undefined || hasBookmakerChainAddresses(value.addresses) === false) {
    issues.push("addresses must include vaultDriver, marketRegistry, vault, and usdc");
  }

  if (!isPlainObject(value.walletInit) || typeof (value.walletInit as { chain?: unknown }).chain !== "string") {
    issues.push("walletInit with chain is required");
  }

  if (typeof value.seed !== "string" && !(value.seed instanceof Uint8Array)) {
    issues.push("seed must be a string or Uint8Array");
  }

  if (value.chainId !== undefined) {
    if (typeof value.chainId !== "number" || Number.isFinite(value.chainId) === false) {
      issues.push("chainId must be a finite number when provided");
    }
  }

  if (value.readRpcUrl !== undefined) {
    requireNonEmptyString(value.readRpcUrl, "readRpcUrl", issues);
  }

  if (issues.length > 0 || runtimeId === undefined || fundingToken === undefined || policy === undefined) {
    return validationFailure(...issues);
  }

  if (marketContext.ok === false || watchSource.ok === false) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    runtimeId,
    marketContext: marketContext.value,
    watchSource: watchSource.value,
    policy,
    fundingToken,
    walletInit: value.walletInit as BookmakerRuntimeConfig["walletInit"],
    seed: value.seed as BookmakerRuntimeConfig["seed"],
    addresses: value.addresses as BookmakerRuntimeConfig["addresses"],
    ...(value.similarityClient === undefined || isSimilarityClientShape(value.similarityClient) === false
      ? {}
      : { similarityClient: value.similarityClient }),
    ...(typeof value.chainId === "number" && Number.isFinite(value.chainId)
      ? { chainId: value.chainId }
      : {}),
    ...(typeof value.readRpcUrl === "string" && value.readRpcUrl.trim().length > 0
      ? { readRpcUrl: value.readRpcUrl.trim() }
      : {})
  });
};

// --- helpers ---

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateNested = <T>(
  input: unknown,
  validator: (value: unknown) => ValidationResult<T>,
  fieldPath: string
): ValidationResult<T> => {
  if (input === undefined) {
    return validationFailure(`${fieldPath} is required`);
  }

  return validator(input);
};

const validatePolicy = (
  input: unknown,
  issues: string[]
): BookmakerVaultPolicy | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push("policy must be an object");
    return undefined;
  }

  const value = input as Record<string, unknown>;

  if (
    value.duplicatePolicy !== "skip-on-high" &&
    value.duplicatePolicy !== "always-create" &&
    value.duplicatePolicy !== "prefer-join"
  ) {
    issues.push('policy.duplicatePolicy must be "skip-on-high", "always-create", or "prefer-join"');
    return undefined;
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    issues.push(...detection.issues.map((issue) => `policy.detection.${issue}`));
    return undefined;
  }

  if (value.joinScoreThreshold !== undefined) {
    if (
      typeof value.joinScoreThreshold !== "number" ||
      Number.isFinite(value.joinScoreThreshold) === false ||
      value.joinScoreThreshold < 0 ||
      value.joinScoreThreshold > 1
    ) {
      issues.push("policy.joinScoreThreshold must be between 0 and 1 when provided");
    }
  }

  return {
    duplicatePolicy: value.duplicatePolicy,
    detection: detection.value,
    ...(typeof value.joinScoreThreshold === "number" &&
    Number.isFinite(value.joinScoreThreshold) &&
    value.joinScoreThreshold >= 0 &&
    value.joinScoreThreshold <= 1
      ? { joinScoreThreshold: value.joinScoreThreshold }
      : {})
  };
};

const isSimilarityClientShape = (value: unknown): value is BookmakerSimilarityClient =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as BookmakerSimilarityClient).findSimilar === "function";

const requireNonEmptyString = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${fieldPath} must be a non-empty string`);
    return undefined;
  }

  return value.trim();
};
