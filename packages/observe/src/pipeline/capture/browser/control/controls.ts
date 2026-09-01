import { Effect, Ref } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { CapabilityScope } from "#scope/scopes.js";
import type {
  BrowserCaptureCrop,
  BrowserCaptureImageEncoding,
  BrowserCapturePage,
  BrowserCaptureViewport
} from "#pipeline/capture/browser/page/types.js";
import {
  makeBrowserPreviewControls,
  validatePreviewRevision,
  type BrowserCaptureCropSource,
  type BrowserCapturePreview,
  type BrowserCaptureSetTargetPayload,
  type BrowserCaptureTargetInspection
} from "./preview.js";
import type { BrowserPreviewSession } from "./preview.js";

export const browserCaptureSetCropScope =
  "capture:browser:setCrop" satisfies CapabilityScope;

export const browserCaptureSetCaptureFpsScope =
  "capture:browser:setCaptureFps" satisfies CapabilityScope;

export const browserCaptureClearCropScope =
  "capture:browser:clearCrop" satisfies CapabilityScope;

export interface BrowserCaptureRuntimeConfigSnapshot {
  readonly url: string;
  readonly captureFps: number;
  readonly viewport: BrowserCaptureViewport;
  readonly crop?: BrowserCaptureCrop;
  readonly encoding: BrowserCaptureImageEncoding;
  readonly interactive?: boolean;
  readonly debug?: boolean;
  readonly maxFrames?: number;
  readonly selectedTargetId?: string;
  readonly cropSource?: BrowserCaptureCropSource;
  readonly lastPreviewRevision?: number;
}

export type BrowserCaptureSetCropPayload =
  | BrowserCaptureCrop
  | {
      readonly crop: BrowserCaptureCrop;
      readonly previewRevision: number;
    };

export type BrowserCaptureSetCaptureFpsPayload =
  | number
  | { readonly captureFps: number };

export interface BrowserCaptureControls {
  readonly snapshot: Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakError>;
  readonly getPreview: Effect.Effect<BrowserCapturePreview, LiveStreakError>;
  readonly inspectTargets: Effect.Effect<BrowserCaptureTargetInspection, LiveStreakError>;
  readonly setTarget: (
    payload: BrowserCaptureSetTargetPayload
  ) => Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError>;
  readonly setCrop: (
    payload: BrowserCaptureSetCropPayload
  ) => Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError>;
  readonly clearCrop: Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakError>;
  readonly setCaptureFps: (
    payload: BrowserCaptureSetCaptureFpsPayload
  ) => Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError>;
}

export const makeBrowserCaptureControls = (options: {
  readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
  readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
  readonly page: BrowserCapturePage;
  readonly validateCrop: (
    crop: BrowserCaptureCrop | undefined,
    viewport: BrowserCaptureViewport
  ) => Effect.Effect<BrowserCaptureCrop | undefined, LiveStreakConfigError>;
  readonly validateCaptureFps: (
    captureFps: unknown
  ) => Effect.Effect<number, LiveStreakConfigError>;
}): BrowserCaptureControls => {
  const previewControls = makeBrowserPreviewControls(options);

  return {
    snapshot: Ref.get(options.configRef).pipe(Effect.map((config) => snapshotConfig(config))),
    getPreview: previewControls.getPreview,
    inspectTargets: previewControls.inspectTargets,
    setTarget: previewControls.setTarget,
    setCrop: (payload) => applyManualCrop(options, payload),
    clearCrop: clearCropSelection(options),
    setCaptureFps: (payload) => applyCaptureFps(options, payload)
  };
};

// --- helpers ---

const snapshotConfig = (
  config: BrowserCaptureRuntimeConfigSnapshot
): BrowserCaptureRuntimeConfigSnapshot => ({
  ...config,
  viewport: { ...config.viewport },
  crop: config.crop === undefined ? undefined : { ...config.crop }
});

const captureFpsFromPayload = (payload: BrowserCaptureSetCaptureFpsPayload): unknown =>
  typeof payload === "number" ? payload : payload.captureFps;

const cropFromPayload = (
  payload: BrowserCaptureSetCropPayload
): { readonly crop: BrowserCaptureCrop; readonly previewRevision?: number } => {
  if ("crop" in payload) {
    return payload;
  }

  return { crop: payload };
};

const applyManualCrop = (
  options: {
    readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
    readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
    readonly validateCrop: (
      crop: BrowserCaptureCrop | undefined,
      viewport: BrowserCaptureViewport
    ) => Effect.Effect<BrowserCaptureCrop | undefined, LiveStreakConfigError>;
  },
  payload: BrowserCaptureSetCropPayload
): Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const parsed = cropFromPayload(payload);
    if (parsed.previewRevision !== undefined) {
      yield* validatePreviewRevision(options.previewSessionRef, parsed.previewRevision);
    }

    const current = yield* Ref.get(options.configRef);
    const nextCrop = yield* options.validateCrop(parsed.crop, current.viewport);
    const next = {
      ...current,
      crop: nextCrop,
      selectedTargetId: undefined,
      cropSource: "manual" as const,
      lastPreviewRevision: parsed.previewRevision
    };

    yield* Ref.set(options.configRef, next);
    return snapshotConfig(next);
  });

const clearCropSelection = (options: {
  readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
}): Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakError> =>
  Ref.updateAndGet(options.configRef, (current) => ({
    ...current,
    crop: undefined,
    selectedTargetId: undefined,
    cropSource: undefined,
    lastPreviewRevision: undefined
  })).pipe(Effect.map((config) => snapshotConfig(config)));

const applyCaptureFps = (
  options: {
    readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
    readonly validateCaptureFps: (
      captureFps: unknown
    ) => Effect.Effect<number, LiveStreakConfigError>;
  },
  payload: BrowserCaptureSetCaptureFpsPayload
): Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const captureFps = yield* options.validateCaptureFps(captureFpsFromPayload(payload));
    const next = yield* Ref.updateAndGet(options.configRef, (current) => ({
      ...current,
      captureFps
    }));

    return snapshotConfig(next);
  });

export type { BrowserCaptureCropSource } from "./preview.js";
