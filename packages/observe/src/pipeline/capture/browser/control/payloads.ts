import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import type { BrowserCaptureCrop } from "#pipeline/capture/browser/page/types.js";
import type {
  BrowserCaptureSetCaptureFpsPayload,
  BrowserCaptureSetCropPayload
} from "./controls.js";
import type { BrowserCaptureSetTargetPayload } from "./preview.js";

const payloadError = (message: string): LiveStreakConfigError =>
  new LiveStreakConfigError({ message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const decodeCrop = (value: unknown): Effect.Effect<BrowserCaptureCrop, LiveStreakConfigError> => {
  if (!isRecord(value)) {
    return Effect.fail(payloadError("Browser capture crop payload must be an object"));
  }

  const { x, y, width, height } = value;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return Effect.fail(
      payloadError("Browser capture crop payload requires numeric x, y, width, and height")
    );
  }

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return Effect.fail(payloadError("Browser capture crop payload must use finite numbers"));
  }

  return Effect.succeed({ x, y, width, height });
};

export const decodeSetTargetPayload = (
  payload: unknown
): Effect.Effect<BrowserCaptureSetTargetPayload, LiveStreakConfigError> => {
  if (!isRecord(payload)) {
    return Effect.fail(payloadError("Browser capture setTarget payload is required"));
  }

  const { targetId, previewRevision } = payload;

  if (typeof targetId !== "string" || targetId.length === 0) {
    return Effect.fail(payloadError("Browser capture setTarget payload requires targetId"));
  }

  if (typeof previewRevision !== "number" || !Number.isFinite(previewRevision)) {
    return Effect.fail(
      payloadError("Browser capture setTarget payload requires previewRevision")
    );
  }

  return Effect.succeed({ targetId, previewRevision });
};

export const decodeSetCropPayload = (
  payload: unknown
): Effect.Effect<BrowserCaptureSetCropPayload, LiveStreakConfigError> => {
  if (payload === undefined || payload === null) {
    return Effect.fail(payloadError("Browser capture setCrop payload is required"));
  }

  if (isRecord(payload) && "crop" in payload) {
    const previewRevision = payload.previewRevision;

    if (typeof previewRevision !== "number" || !Number.isFinite(previewRevision)) {
      return Effect.fail(
        payloadError("Browser capture setCrop payload requires previewRevision when crop is wrapped")
      );
    }

    return decodeCrop(payload.crop).pipe(
      Effect.map((crop) => ({ crop, previewRevision }))
    );
  }

  return decodeCrop(payload);
};

export const decodeSetCaptureFpsPayload = (
  payload: unknown
): Effect.Effect<BrowserCaptureSetCaptureFpsPayload, LiveStreakConfigError> => {
  if (typeof payload === "number") {
    if (!Number.isFinite(payload)) {
      return Effect.fail(payloadError("Browser capture setCaptureFps payload must be a finite number"));
    }

    return Effect.succeed(payload);
  }

  if (!isRecord(payload)) {
    return Effect.fail(payloadError("Browser capture setCaptureFps payload is required"));
  }

  const captureFps = payload.captureFps;

  if (typeof captureFps !== "number" || !Number.isFinite(captureFps)) {
    return Effect.fail(
      payloadError("Browser capture setCaptureFps payload requires captureFps")
    );
  }

  return Effect.succeed({ captureFps });
};
