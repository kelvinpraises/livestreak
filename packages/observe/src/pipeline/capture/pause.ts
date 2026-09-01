import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";

export const pausePresentationValues = ["hold", "slate"] as const;

export type PausePresentation = (typeof pausePresentationValues)[number];

export interface CapturePausePresentation {
  readonly whilePaused: PausePresentation;
  readonly slateAssetId?: string;
}

export const defaultCapturePausePresentation = {
  whilePaused: "hold"
} as const satisfies CapturePausePresentation;

export interface CaptureLivePauseState {
  readonly paused: boolean;
  readonly revision: number;
}

export const isPausePresentation = (value: unknown): value is PausePresentation =>
  typeof value === "string" && (pausePresentationValues as readonly string[]).includes(value);

export const formatPauseAllowedValues = (values: readonly string[]): string => values.join(", ");

export const assertPausePresentationValue = (
  value: unknown,
  field: string
): Effect.Effect<PausePresentation, LiveStreakConfigError> => {
  if (typeof value !== "string") {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${field} must be a string`
      })
    );
  }

  if (!isPausePresentation(value)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: `${field} must be one of: ${formatPauseAllowedValues(pausePresentationValues)}`
      })
    );
  }

  return Effect.succeed(value);
};

export const capturePausePresentationEqual = (
  left: CapturePausePresentation | undefined,
  right: CapturePausePresentation
): boolean => {
  if (left === undefined) {
    return false;
  }

  return left.whilePaused === right.whilePaused && left.slateAssetId === right.slateAssetId;
};
