import { Data } from "effect";

export interface ErrorMetadata {
  readonly details?: string;
  readonly cause?: unknown;
  readonly retryable?: boolean;
  readonly documentationPath?: string;
}

type SanitizedErrorMetadata = Pick<
  ErrorMetadata,
  "details" | "retryable" | "documentationPath"
>;

export class LiveStreakConfigError extends Data.TaggedError("LiveStreakConfigError")<{
  readonly message: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class LiveStreakRuntimeError extends Data.TaggedError("LiveStreakRuntimeError")<{
  readonly message: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class LiveStreakCapabilityError extends Data.TaggedError("LiveStreakCapabilityError")<{
  readonly message: string;
  readonly requiredScope?: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class LiveStreakRegistryError extends Data.TaggedError("LiveStreakRegistryError")<{
  readonly message: string;
  readonly registryId?: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class LiveStreakCommandError extends Data.TaggedError("LiveStreakCommandError")<{
  readonly message: string;
  readonly commandScope: string;
  readonly metadata?: ErrorMetadata;
}> {}

export class LiveStreakNotImplementedError extends Data.TaggedError("LiveStreakNotImplementedError")<{
  readonly component: string;
  readonly message: string;
  readonly metadata?: ErrorMetadata;
}> {}

export type LiveStreakError =
  | LiveStreakConfigError
  | LiveStreakRuntimeError
  | LiveStreakCapabilityError
  | LiveStreakRegistryError
  | LiveStreakCommandError
  | LiveStreakNotImplementedError;

const liveStreakErrorTags = [
  "LiveStreakConfigError",
  "LiveStreakRuntimeError",
  "LiveStreakCapabilityError",
  "LiveStreakRegistryError",
  "LiveStreakCommandError",
  "LiveStreakNotImplementedError"
] as const satisfies readonly LiveStreakError["_tag"][];

export type LiveStreakErrorTag = (typeof liveStreakErrorTags)[number];

const liveStreakErrorTagSet = new Set<string>(liveStreakErrorTags);

export const isLiveStreakError = (value: unknown): value is LiveStreakError => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.message !== "string") {
    return false;
  }

  if (isValidErrorMetadata(value.metadata) === false) {
    return false;
  }

  const tag = value._tag;
  if (typeof tag !== "string" || liveStreakErrorTagSet.has(tag) === false) {
    return false;
  }

  switch (tag) {
    case "LiveStreakConfigError":
    case "LiveStreakRuntimeError":
      return true;
    case "LiveStreakCapabilityError":
      return isOptionalString(value.requiredScope);
    case "LiveStreakRegistryError":
      return isOptionalString(value.registryId);
    case "LiveStreakCommandError":
      return typeof value.commandScope === "string";
    case "LiveStreakNotImplementedError":
      return typeof value.component === "string";
    default:
      return false;
  }
};

export type LiveStreakErrorShortName =
  | "config"
  | "runtime"
  | "capability"
  | "registry"
  | "command"
  | "not-implemented";

export interface SerializedLiveStreakError {
  readonly tag: LiveStreakErrorTag;
  readonly shortName: LiveStreakErrorShortName;
  readonly title: string;
  readonly message: string;
  readonly description: string;
  readonly retryable: boolean;
  readonly details?: string;
  readonly documentationPath?: string;
  readonly context?: {
    readonly requiredScope?: string;
    readonly registryId?: string;
    readonly commandScope?: string;
    readonly component?: string;
  };
}

export interface SerializedUnknownError {
  readonly tag: "UnknownError";
  readonly shortName: "unknown";
  readonly title: "Unknown error";
  readonly message: string;
  readonly description: string;
  readonly retryable: false;
}

export type SerializedError = SerializedLiveStreakError | SerializedUnknownError;

export const serializeUnknownError = (error: unknown): SerializedError => {
  if (isLiveStreakError(error)) {
    return serializeLiveStreakError(error);
  }

  return {
    tag: "UnknownError",
    shortName: "unknown",
    title: "Unknown error",
    message: unknownErrorMessage(error),
    description: "An unexpected error occurred.",
    retryable: false
  };
};

export const serializeLiveStreakError = (error: LiveStreakError): SerializedLiveStreakError => {
  const metadata = metadataFromError(error);
  const base = serializedBase(error, metadata);

  switch (error._tag) {
    case "LiveStreakConfigError":
      return {
        ...base,
        shortName: "config",
        title: "Configuration error",
        description:
          "The request could not be accepted because configuration or input was invalid."
      };
    case "LiveStreakRuntimeError":
      return {
        ...base,
        shortName: "runtime",
        title: "Runtime error",
        description: "The operation failed while the system was running."
      };
    case "LiveStreakCapabilityError": {
      const requiredScope = stringField(error, "requiredScope");
      return {
        ...base,
        shortName: "capability",
        title: "Permission denied",
        description: "The caller is not authorized to perform this operation.",
        ...contextField(requiredScope === undefined ? undefined : { requiredScope })
      };
    }
    case "LiveStreakRegistryError": {
      const registryId = stringField(error, "registryId");
      return {
        ...base,
        shortName: "registry",
        title: "Registry error",
        description: "A requested registry entry could not be resolved or used.",
        ...contextField(registryId === undefined ? undefined : { registryId })
      };
    }
    case "LiveStreakCommandError": {
      const commandScope = stringField(error, "commandScope");
      return {
        ...base,
        shortName: "command",
        title: "Command error",
        description: "The command could not be executed.",
        ...contextField(
          commandScope === undefined ? undefined : { commandScope }
        )
      };
    }
    case "LiveStreakNotImplementedError": {
      const component = stringField(error, "component");
      return {
        ...base,
        shortName: "not-implemented",
        title: "Not implemented",
        description: "The requested component or operation has not been implemented.",
        ...contextField(component === undefined ? undefined : { component })
      };
    }
  }
};

/** @deprecated Use {@link serializeLiveStreakError} — canonical typed error JSON for CLI, web, and Gateway. */
export const toCliError = serializeLiveStreakError;

// --- helpers ---

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isValidErrorMetadata = (value: unknown): boolean => {
  if (value === undefined) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  if ("details" in value && value.details !== undefined && typeof value.details !== "string") {
    return false;
  }

  if ("retryable" in value && value.retryable !== undefined && typeof value.retryable !== "boolean") {
    return false;
  }

  if (
    "documentationPath" in value &&
    value.documentationPath !== undefined &&
    typeof value.documentationPath !== "string"
  ) {
    return false;
  }

  return true;
};

const metadataFromError = (error: LiveStreakError): SanitizedErrorMetadata | undefined => {
  if (!("metadata" in error)) {
    return undefined;
  }

  const metadata = error.metadata;
  if (!isValidErrorMetadata(metadata) || !isRecord(metadata)) {
    return undefined;
  }

  return {
    ...(typeof metadata.details === "string" ? { details: metadata.details } : {}),
    ...(typeof metadata.retryable === "boolean" ? { retryable: metadata.retryable } : {}),
    ...(typeof metadata.documentationPath === "string"
      ? { documentationPath: metadata.documentationPath }
      : {})
  };
};

const messageFromError = (error: LiveStreakError): string => {
  if (typeof error.message !== "string") {
    return "LiveStreak failed";
  }

  const trimmed = error.message.trim();
  return trimmed.length > 0 ? trimmed : "LiveStreak failed";
};

const unknownErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (typeof error === "string") {
    const trimmed = error.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return "Unknown error";
};

const stringField = (error: LiveStreakError, field: string): string | undefined => {
  const record = error as unknown as Record<string, unknown>;
  if (!(field in record)) {
    return undefined;
  }

  const value = record[field];
  return typeof value === "string" ? value : undefined;
};

const retryableFromMetadata = (metadata: SanitizedErrorMetadata | undefined): boolean =>
  metadata?.retryable === true;

const serializedBase = (
  error: LiveStreakError,
  metadata: SanitizedErrorMetadata | undefined
): Pick<
  SerializedLiveStreakError,
  "tag" | "message" | "retryable" | "details" | "documentationPath"
> => ({
  tag: error._tag,
  message: messageFromError(error),
  retryable: retryableFromMetadata(metadata),
  ...(typeof metadata?.details === "string" ? { details: metadata.details } : {}),
  ...(typeof metadata?.documentationPath === "string"
    ? { documentationPath: metadata.documentationPath }
    : {})
});

const contextField = (
  context: SerializedLiveStreakError["context"]
): Pick<SerializedLiveStreakError, "context"> | Record<string, never> =>
  context === undefined ? {} : { context };
