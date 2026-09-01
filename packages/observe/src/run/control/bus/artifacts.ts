import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";

export const createOpaqueArtifactId = (): string => `art_${randomUUID()}`;

const artifactIdRequiredMessage = "artifactId must be a non-empty string";

export const validateArtifactIdInput = (
  artifactId: unknown
): Effect.Effect<string, LiveStreakConfigError> => {
  if (typeof artifactId !== "string") {
    return Effect.fail(
      new LiveStreakConfigError({
        message: artifactIdRequiredMessage
      })
    );
  }

  const trimmed = artifactId.trim();
  if (trimmed.length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: artifactIdRequiredMessage
      })
    );
  }

  return Effect.succeed(trimmed);
};
