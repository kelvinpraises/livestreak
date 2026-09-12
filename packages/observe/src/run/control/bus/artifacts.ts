import { v4 as uuidv4 } from "uuid";
import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";

// `uuid` is isomorphic (works in Node and the browser) — needed because this module is reached from the
// app (webrtc-consumer → observe store/bus) and Vite externalizes `node:crypto` for the browser build.
export const createOpaqueArtifactId = (): string => `art_${uuidv4()}`;

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
