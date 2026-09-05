import type { BookmakerDecision, BookmakerSkipReason } from "./decision.js";
import type { Detection } from "./detection.js";
import type { BookmakerMarketContext } from "./market-context.js";
import type { SimilarityCandidate, SimilarityResult } from "./similarity.js";
import type { VaultDraft, VaultResolutionWindow } from "./vault-draft.js";
import type { BookmakerWatchSource } from "./watch-source.js";
import type { BookmakerWriteIntent, CreateVaultIntent } from "./write-intent.js";

// --- exports ---

export type ValidationSuccess<T> = {
  readonly ok: true;
  readonly value: T;
};

export type ValidationFailure = {
  readonly ok: false;
  readonly issues: readonly string[];
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export const validationSuccess = <T>(value: T): ValidationSuccess<T> => ({
  ok: true,
  value
});

export const validationFailure = (...issues: readonly string[]): ValidationFailure => ({
  ok: false,
  issues
});

export const validateBookmakerDecision = (input: unknown): ValidationResult<BookmakerDecision> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerDecision must be an object");
  }

  const value = input as Record<string, unknown>;

  if (value.action === "createVault") {
    return validateCreateVaultDecision(value);
  }

  if (value.action === "joinVault") {
    return validateJoinVaultDecision(value);
  }

  if (value.action === "skip") {
    return validateSkipDecision(value);
  }

  return validationFailure('action must be "createVault", "joinVault", or "skip"');
};

export const validateDetection = (input: unknown): ValidationResult<Detection> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("Detection must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const detectorId = requireNonEmptyString(value.detectorId, "detectorId", issues);
  const question = requireNonEmptyString(value.question, "question", issues);
  const vaultType = requireNonEmptyString(value.vaultType, "vaultType", issues);

  if (typeof value.confidence !== "number" || Number.isFinite(value.confidence) === false) {
    issues.push("confidence must be a finite number");
  } else if (value.confidence < 0 || value.confidence > 1) {
    issues.push("confidence must be between 0 and 1");
  }

  if (
    typeof value.durationSeconds !== "number" ||
    Number.isFinite(value.durationSeconds) === false ||
    value.durationSeconds <= 0
  ) {
    issues.push("durationSeconds must be a positive finite number");
  }

  requireOptionalSide(value.suggestedSide, "suggestedSide", issues);
  requireOptionalPositiveBigInt(value.suggestedStake, "suggestedStake", issues);
  requireOptionalNonEmptyString(value.observationRef, "observationRef", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    detectorId: detectorId!,
    confidence: value.confidence as number,
    question: question!,
    vaultType: vaultType!,
    durationSeconds: value.durationSeconds as number,
    ...(optionalSide(value.suggestedSide) === undefined
      ? {}
      : { suggestedSide: optionalSide(value.suggestedSide) }),
    ...(optionalPositiveBigInt(value.suggestedStake) === undefined
      ? {}
      : { suggestedStake: optionalPositiveBigInt(value.suggestedStake) }),
    ...(optionalString(value.observationRef) === undefined
      ? {}
      : { observationRef: optionalString(value.observationRef) })
  });
};

export const validateBookmakerMarketContext = (
  input: unknown
): ValidationResult<BookmakerMarketContext> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerMarketContext must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const observeRunId = requireNonEmptyString(value.observeRunId, "observeRunId", issues);
  const observer = requireNonEmptyString(value.observer, "observer", issues);

  requireOptionalNonEmptyString(value.endpointManifestUri, "endpointManifestUri", issues);
  requireOptionalNonEmptyString(value.subjectRef, "subjectRef", issues);
  requireOptionalNonEmptyString(value.category, "category", issues);
  requireOptionalNonEmptyString(value.title, "title", issues);
  requireOptionalNonEmptyString(value.rulesetId, "rulesetId", issues);
  requireOptionalFiniteNumber(value.startedAtMs, "startedAtMs", issues);
  requireOptionalStringArray(value.evidenceRefs, "evidenceRefs", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    observeRunId: observeRunId!,
    observer: observer!,
    ...(optionalString(value.endpointManifestUri) === undefined
      ? {}
      : { endpointManifestUri: optionalString(value.endpointManifestUri) }),
    ...(optionalString(value.subjectRef) === undefined
      ? {}
      : { subjectRef: optionalString(value.subjectRef) }),
    ...(optionalString(value.category) === undefined ? {} : { category: optionalString(value.category) }),
    ...(optionalString(value.title) === undefined ? {} : { title: optionalString(value.title) }),
    ...(optionalString(value.rulesetId) === undefined
      ? {}
      : { rulesetId: optionalString(value.rulesetId) }),
    ...(optionalFiniteNumber(value.startedAtMs) === undefined
      ? {}
      : { startedAtMs: optionalFiniteNumber(value.startedAtMs) }),
    ...(optionalStringArray(value.evidenceRefs) === undefined
      ? {}
      : { evidenceRefs: optionalStringArray(value.evidenceRefs) })
  });
};

export const validateSimilarityResult = (input: unknown): ValidationResult<SimilarityResult> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("SimilarityResult must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);

  if (!Array.isArray(value.candidates)) {
    issues.push("candidates must be an array");
  }

  const candidates: SimilarityCandidate[] = [];

  if (Array.isArray(value.candidates)) {
    for (const [index, candidate] of value.candidates.entries()) {
      const parsed = validateCandidate(candidate, `candidates[${index}]`, marketId, issues);
      if (parsed !== undefined) {
        candidates.push(parsed);
      }
    }
  }

  requireOptionalDuplicateRisk(value.duplicateRisk, issues);
  requireOptionalStringArray(value.stewardWarnings, "stewardWarnings", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    candidates,
    ...(optionalDuplicateRisk(value.duplicateRisk) === undefined
      ? {}
      : { duplicateRisk: optionalDuplicateRisk(value.duplicateRisk) }),
    ...(optionalStringArray(value.stewardWarnings) === undefined
      ? {}
      : { stewardWarnings: optionalStringArray(value.stewardWarnings) })
  });
};

export const validateVaultDraft = (input: unknown): ValidationResult<VaultDraft> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("VaultDraft must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const question = requireNonEmptyString(value.question, "question", issues);
  const resolutionSource = requireNonEmptyString(value.resolutionSource, "resolutionSource", issues);
  const fundingToken = requireNonEmptyString(value.fundingToken, "fundingToken", issues);

  if (value.outcomeKind !== "binary") {
    issues.push('outcomeKind must be "binary"');
  }

  if (!isBinarySides(value.sides)) {
    issues.push('sides must be ["yes", "no"]');
  }

  const resolutionWindow = validateResolutionWindow(value.resolutionWindow, issues);

  requireOptionalNonEmptyString(value.vaultType, "vaultType", issues);
  requireOptionalSide(value.creatorSide, "creatorSide", issues);
  requireOptionalPositiveBigInt(value.creatorStake, "creatorStake", issues);
  requireOptionalPositiveBigInt(value.seedRate, "seedRate", issues);
  requireOptionalStringArray(value.evidenceRefs, "evidenceRefs", issues);
  requireOptionalNonEmptyString(value.observationRef, "observationRef", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    question: question!,
    outcomeKind: "binary",
    sides: ["yes", "no"],
    resolutionSource: resolutionSource!,
    resolutionWindow: resolutionWindow!,
    fundingToken: fundingToken!,
    ...(optionalString(value.vaultType) === undefined ? {} : { vaultType: optionalString(value.vaultType) }),
    ...(optionalSide(value.creatorSide) === undefined ? {} : { creatorSide: optionalSide(value.creatorSide) }),
    ...(optionalPositiveBigInt(value.creatorStake) === undefined
      ? {}
      : { creatorStake: optionalPositiveBigInt(value.creatorStake) }),
    ...(optionalPositiveBigInt(value.seedRate) === undefined
      ? {}
      : { seedRate: optionalPositiveBigInt(value.seedRate) }),
    ...(optionalStringArray(value.evidenceRefs) === undefined
      ? {}
      : { evidenceRefs: optionalStringArray(value.evidenceRefs) }),
    ...(optionalString(value.observationRef) === undefined
      ? {}
      : { observationRef: optionalString(value.observationRef) })
  });
};

export interface ValidateVaultDraftForCreateOptions {
  /**
   * Chain streaming minimum seed rate (resolved per-chain from config, never a
   * constant). A seed rate below this would round funding to zero per cycle, so
   * it is rejected with a clear error. Defaults to 1n — the absolute floor that
   * guarantees a non-zero stream.
   */
  readonly minSeedRate?: bigint;
}

export const validateVaultDraftForCreate = (
  draft: VaultDraft,
  nowMs: number,
  options: ValidateVaultDraftForCreateOptions = {}
): ValidationResult<VaultDraft> => {
  const base = validateVaultDraft(draft);
  if (base.ok === false) {
    return base;
  }

  const issues: string[] = [];
  const minSeedRate = options.minSeedRate ?? 1n;

  if (typeof nowMs !== "number" || Number.isFinite(nowMs) === false) {
    issues.push("nowMs must be a finite number");
  } else if (base.value.resolutionWindow.expiresAtMs <= nowMs) {
    issues.push("resolutionWindow.expiresAtMs must be after nowMs");
  }

  if (base.value.creatorStake === undefined || base.value.creatorStake <= 0n) {
    issues.push("creatorStake must be a positive bigint for createVault");
  }

  if (base.value.seedRate === undefined || base.value.seedRate <= 0n) {
    issues.push("seedRate must be a positive bigint for createVault");
  } else if (base.value.seedRate < minSeedRate) {
    // B10: the seed rate underflowed the chain streaming minimum (e.g. a small
    // stake over a long resolution window divided down toward zero). Reject with
    // an actionable message instead of silently streaming zero per cycle.
    issues.push(
      `seedRate ${base.value.seedRate} is below the chain streaming minimum ${minSeedRate}; ` +
        "funding would round to zero per cycle — increase creatorStake or shorten the resolution window"
    );
  }

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return base;
};

export const validateBookmakerWatchSource = (input: unknown): ValidationResult<BookmakerWatchSource> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerWatchSource must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);

  requireOptionalNonEmptyString(value.watchUrl, "watchUrl", issues);
  requireOptionalNonEmptyString(value.webrtcUrl, "webrtcUrl", issues);
  requireOptionalNonEmptyString(value.observationEndpoint, "observationEndpoint", issues);
  requireOptionalNonEmptyString(value.endpointManifestUri, "endpointManifestUri", issues);
  requireOptionalStringArray(value.cacheReceiptRefs, "cacheReceiptRefs", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    ...(optionalString(value.watchUrl) === undefined ? {} : { watchUrl: optionalString(value.watchUrl) }),
    ...(optionalString(value.webrtcUrl) === undefined ? {} : { webrtcUrl: optionalString(value.webrtcUrl) }),
    ...(optionalString(value.observationEndpoint) === undefined
      ? {}
      : { observationEndpoint: optionalString(value.observationEndpoint) }),
    ...(optionalString(value.endpointManifestUri) === undefined
      ? {}
      : { endpointManifestUri: optionalString(value.endpointManifestUri) }),
    ...(optionalStringArray(value.cacheReceiptRefs) === undefined
      ? {}
      : { cacheReceiptRefs: optionalStringArray(value.cacheReceiptRefs) })
  });
};

export const validateCreateVaultIntent = (
  input: unknown,
  nowMs: number
): ValidationResult<CreateVaultIntent> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("CreateVaultIntent must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  if (value.action !== "createVault") {
    issues.push('action must be "createVault"');
  }

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const question = requireNonEmptyString(value.question, "question", issues);
  const creatorSide = requireSide(value.creatorSide, "creatorSide", issues);
  const creatorStake = requirePositiveBigInt(value.creatorStake, "creatorStake", issues);
  const seedRate = requirePositiveBigInt(value.seedRate, "seedRate", issues);

  const resolutionSource = requireNonEmptyString(value.resolutionSource, "resolutionSource", issues);
  const resolutionWindowExpiresAtMs = requirePositiveNumber(
    value.resolutionWindowExpiresAtMs,
    "resolutionWindowExpiresAtMs",
    issues
  );

  if (typeof nowMs !== "number" || Number.isFinite(nowMs) === false) {
    issues.push("nowMs must be a finite number");
  }

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    action: "createVault",
    marketId: marketId!,
    question: question!,
    creatorSide: creatorSide!,
    creatorStake: creatorStake!,
    seedRate: seedRate!,
    resolutionSource: resolutionSource!,
    resolutionWindowExpiresAtMs: resolutionWindowExpiresAtMs!
  });
};

export const validateBookmakerWriteIntent = (
  input: unknown,
  nowMs: number
): ValidationResult<BookmakerWriteIntent> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerWriteIntent must be an object");
  }

  const value = input as Record<string, unknown>;

  if (value.action === "createVault") {
    return validateCreateVaultIntent(input, nowMs);
  }

  if (value.action === "joinExistingVault") {
    const issues: string[] = [];
    const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
    const vaultId = requireNonEmptyString(value.vaultId, "vaultId", issues);

    if (issues.length > 0) {
      return validationFailure(...issues);
    }

    return validationSuccess({
      action: "joinExistingVault",
      marketId: marketId!,
      vaultId: vaultId!
    });
  }

  return validationFailure('action must be "createVault" or "joinExistingVault"');
};

// --- helpers ---

const validateCreateVaultDecision = (
  value: Record<string, unknown>
): ValidationResult<BookmakerDecision> => {
  const draft = validateVaultDraft(value.draft);
  if (draft.ok === false) {
    return validationFailure(...draft.issues.map((issue) => `draft.${issue}`));
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    return validationFailure(...detection.issues.map((issue) => `detection.${issue}`));
  }

  return validationSuccess({
    action: "createVault",
    draft: draft.value,
    detection: detection.value
  });
};

const validateJoinVaultDecision = (
  value: Record<string, unknown>
): ValidationResult<BookmakerDecision> => {
  if (typeof value.vaultId !== "string" || value.vaultId.trim().length === 0) {
    return validationFailure("vaultId must be a non-empty string");
  }

  const draft = validateVaultDraft(value.draft);
  if (draft.ok === false) {
    return validationFailure(...draft.issues.map((issue) => `draft.${issue}`));
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    return validationFailure(...detection.issues.map((issue) => `detection.${issue}`));
  }

  return validationSuccess({
    action: "joinVault",
    vaultId: value.vaultId.trim(),
    draft: draft.value,
    detection: detection.value
  });
};

const validateSkipDecision = (value: Record<string, unknown>): ValidationResult<BookmakerDecision> => {
  const allowedReasons = [
    "no_detectors",
    "no_detection",
    "below_confidence_threshold",
    "duplicate_vault",
    "steward_warning",
    "invalid_draft",
    "market_not_found",
    "market_inactive"
  ] as const;

  if (typeof value.reason !== "string" || !allowedReasons.includes(value.reason as (typeof allowedReasons)[number])) {
    return validationFailure("reason must be a known BookmakerSkipReason");
  }

  if (value.detection === undefined) {
    return validationSuccess({
      action: "skip",
      reason: value.reason as BookmakerSkipReason
    });
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    return validationFailure(...detection.issues.map((issue) => `detection.${issue}`));
  }

  return validationSuccess({
    action: "skip",
    reason: value.reason as BookmakerSkipReason,
    detection: detection.value
  });
};

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

const requireOptionalNonEmptyString = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${fieldPath} must be a non-empty string when provided`);
  }
};

const requireOptionalSide = (value: unknown, fieldPath: string, issues: string[]): void => {
  if (value === undefined) {
    return;
  }

  if (value !== "yes" && value !== "no") {
    issues.push(`${fieldPath} must be "yes" or "no" when provided`);
  }
};

const requireOptionalPositiveBigInt = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "bigint" || value <= 0n) {
    issues.push(`${fieldPath} must be a positive bigint when provided`);
  }
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const optionalSide = (value: unknown): "yes" | "no" | undefined =>
  value === "yes" || value === "no" ? value : undefined;

const optionalPositiveBigInt = (value: unknown): bigint | undefined =>
  typeof value === "bigint" && value > 0n ? value : undefined;

const requireOptionalFiniteNumber = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || Number.isFinite(value) === false) {
    issues.push(`${fieldPath} must be a finite number when provided`);
  }
};

const requireOptionalStringArray = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    issues.push(`${fieldPath} must be an array of strings when provided`);
    return;
  }

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(`${fieldPath}[${index}] must be a non-empty string`);
    }
  }
};

const optionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const optionalStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return entries.length > 0 ? entries : undefined;
};

const validateCandidate = (
  input: unknown,
  fieldPath: string,
  expectedMarketId: string | undefined,
  issues: string[]
): SimilarityCandidate | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push(`${fieldPath} must be an object`);
    return undefined;
  }

  const value = input as Record<string, unknown>;

  if (value.kind !== "vault") {
    issues.push(`${fieldPath}.kind must be "vault"`);
  }

  const vaultId = requireNonEmptyString(value.vaultId, `${fieldPath}.vaultId`, issues);
  const candidateMarketId = requireNonEmptyString(value.marketId, `${fieldPath}.marketId`, issues);
  const reason = requireNonEmptyString(value.reason, `${fieldPath}.reason`, issues);

  if (
    expectedMarketId !== undefined &&
    candidateMarketId !== undefined &&
    candidateMarketId !== expectedMarketId
  ) {
    issues.push(`${fieldPath}.marketId must match SimilarityResult.marketId`);
  }

  if (typeof value.score !== "number" || Number.isFinite(value.score) === false) {
    issues.push(`${fieldPath}.score must be a finite number`);
  } else if (value.score < 0 || value.score > 1) {
    issues.push(`${fieldPath}.score must be between 0 and 1`);
  }

  if (
    value.suggestedAction !== "join-existing" &&
    value.suggestedAction !== "create-new" &&
    value.suggestedAction !== "skip"
  ) {
    issues.push(`${fieldPath}.suggestedAction must be join-existing, create-new, or skip`);
  }

  if (
    vaultId === undefined ||
    candidateMarketId === undefined ||
    reason === undefined ||
    typeof value.score !== "number" ||
    (value.suggestedAction !== "join-existing" &&
      value.suggestedAction !== "create-new" &&
      value.suggestedAction !== "skip")
  ) {
    return undefined;
  }

  return {
    kind: "vault",
    vaultId,
    marketId: candidateMarketId,
    score: value.score,
    reason,
    suggestedAction: value.suggestedAction,
    ...(optionalNonEmptyString(value.vaultKey) === undefined
      ? {}
      : { vaultKey: optionalNonEmptyString(value.vaultKey) })
  };
};

const requireOptionalDuplicateRisk = (value: unknown, issues: string[]): void => {
  if (value === undefined) {
    return;
  }

  if (value !== "low" && value !== "medium" && value !== "high") {
    issues.push('duplicateRisk must be "low", "medium", or "high" when provided');
  }
};

const optionalDuplicateRisk = (
  value: unknown
): "low" | "medium" | "high" | undefined =>
  value === "low" || value === "medium" || value === "high" ? value : undefined;

const optionalNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const validateResolutionWindow = (
  value: unknown,
  issues: string[]
): VaultResolutionWindow | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push("resolutionWindow must be an object");
    return undefined;
  }

  const window = value as Record<string, unknown>;

  if (window.expiresAtMs === undefined) {
    issues.push("resolutionWindow.expiresAtMs is required");
    return undefined;
  }

  if (typeof window.expiresAtMs !== "number" || Number.isFinite(window.expiresAtMs) === false) {
    issues.push("resolutionWindow.expiresAtMs must be a finite number");
    return undefined;
  }

  if (window.opensAtMs !== undefined) {
    if (typeof window.opensAtMs !== "number" || Number.isFinite(window.opensAtMs) === false) {
      issues.push("resolutionWindow.opensAtMs must be a finite number when provided");
      return undefined;
    }

    if (window.opensAtMs >= window.expiresAtMs) {
      issues.push("resolutionWindow.opensAtMs must be before expiresAtMs");
      return undefined;
    }
  }

  return {
    expiresAtMs: window.expiresAtMs,
    ...(window.opensAtMs === undefined ? {} : { opensAtMs: window.opensAtMs })
  };
};

const isBinarySides = (value: unknown): value is readonly ["yes", "no"] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value[0] === "yes" &&
  value[1] === "no";

const requireSide = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): "yes" | "no" | undefined => {
  if (value !== "yes" && value !== "no") {
    issues.push(`${fieldPath} must be "yes" or "no"`);
    return undefined;
  }

  return value;
};

const requirePositiveBigInt = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): bigint | undefined => {
  if (typeof value !== "bigint" || value <= 0n) {
    issues.push(`${fieldPath} must be a bigint > 0`);
    return undefined;
  }

  return value;
};

const requirePositiveNumber = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false || value <= 0) {
    issues.push(`${fieldPath} must be a finite number > 0`);
    return undefined;
  }

  return value;
};
