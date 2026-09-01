import { Effect, Ref } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type {
  BrowserCaptureCrop,
  BrowserCapturePage,
  BrowserCaptureViewport
} from "#pipeline/capture/browser/page/types.js";
import type { BrowserCaptureRuntimeConfigSnapshot } from "./controls.js";
import {
  dataUriFromBytes,
  previewMimeForEncoding,
  type BrowserCapturePreviewMime
} from "./preview-encoding.js";

export const browserPreviewTargetsArtifactKind = "browser.previewTargets";

export type { BrowserCapturePreviewMime } from "./preview-encoding.js";

export interface BrowserCapturePreview {
  readonly revision: number;
  readonly capturedAtMs: number;
  readonly mime: BrowserCapturePreviewMime;
  readonly width: number;
  readonly height: number;
  readonly viewport: BrowserCaptureViewport;
  readonly dataUri: string;
}

export type BrowserCaptureTargetKind = "video" | "canvas" | "iframe" | "element";

export interface BrowserCaptureTarget {
  readonly id: string;
  readonly number: number;
  readonly kind: BrowserCaptureTargetKind;
  readonly label: string;
  readonly rect: BrowserCaptureCrop;
  readonly confidence?: number;
}

export interface BrowserCaptureTargetInspection {
  readonly preview: BrowserCapturePreview;
  readonly targets: readonly BrowserCaptureTarget[];
}

export interface BrowserPreviewTargetsArtifactPayload {
  readonly preview: BrowserCapturePreview;
  readonly targets: readonly BrowserCaptureTarget[];
}

export interface BrowserCaptureSetTargetPayload {
  readonly targetId: string;
  readonly previewRevision: number;
}

export type BrowserCaptureCropSource = "manual" | "target";

export interface BrowserPreviewSession {
  revision: number;
  targets: readonly BrowserCaptureTarget[];
}

export const browserCaptureGetPreviewScope = "capture:browser:getPreview" as const;
export const browserCaptureInspectTargetsScope = "capture:browser:inspectTargets" as const;
export const browserCaptureSetTargetScope = "capture:browser:setTarget" as const;

export const makeBrowserPreviewArtifactId = (
  runId: string,
  previewRevision: number
): string => `${runId}:browser-preview:${previewRevision}`;

export const makeBrowserPreviewControls = (options: {
  readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
  readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
  readonly page: BrowserCapturePage;
  readonly validateCrop: (
    crop: BrowserCaptureCrop | undefined,
    viewport: BrowserCaptureViewport
  ) => Effect.Effect<BrowserCaptureCrop | undefined, LiveStreakConfigError>;
}): {
  readonly getPreview: Effect.Effect<BrowserCapturePreview, LiveStreakError>;
  readonly inspectTargets: Effect.Effect<BrowserCaptureTargetInspection, LiveStreakError>;
  readonly setTarget: (
    payload: BrowserCaptureSetTargetPayload
  ) => Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError>;
  readonly capturePreviewArtifact: (
    targets: readonly BrowserCaptureTarget[]
  ) => Effect.Effect<BrowserCapturePreview, LiveStreakError>;
  readonly validatePreviewRevision: (
    previewRevision: number
  ) => Effect.Effect<number, LiveStreakConfigError>;
} => ({
  getPreview: capturePreviewOnly(options),
  inspectTargets: inspectTargetsWithPreview(options),
  setTarget: (payload) => applyTargetSelection(options, payload),
  capturePreviewArtifact: (targets) => captureFreshPreview(options, targets),
  validatePreviewRevision: (previewRevision) =>
    validatePreviewRevision(options.previewSessionRef, previewRevision)
});

// --- helpers ---

const capturePreviewOnly = (options: {
  readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
  readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
  readonly page: BrowserCapturePage;
}): Effect.Effect<BrowserCapturePreview, LiveStreakError> =>
  Effect.gen(function* () {
    const preview = yield* captureFreshPreview(options, []);
    return preview;
  });

const inspectTargetsWithPreview = (options: {
  readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
  readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
  readonly page: BrowserCapturePage;
}): Effect.Effect<BrowserCaptureTargetInspection, LiveStreakError> =>
  Effect.gen(function* () {
    const targets =
      options.page.inspectTargets === undefined
        ? []
        : yield* options.page.inspectTargets();
    const preview = yield* captureFreshPreview(options, targets);

    return {
      preview,
      targets
    };
  });

const captureFreshPreview = (
  options: {
    readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
    readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
    readonly page: BrowserCapturePage;
  },
  targets: readonly BrowserCaptureTarget[]
): Effect.Effect<BrowserCapturePreview, LiveStreakError> =>
  Effect.gen(function* () {
    const config = yield* Ref.get(options.configRef);
    const screenshot = yield* options.page.screenshot({
      encoding: config.encoding
    });
    const revision = yield* Ref.modify(options.previewSessionRef, (session) => [
      session.revision + 1,
      {
        revision: session.revision + 1,
        targets: [...targets]
      } satisfies BrowserPreviewSession
    ]);
    const mime = previewMimeForEncoding(screenshot.encoding ?? config.encoding);
    const capturedAtMs = Date.now();

    return {
      revision,
      capturedAtMs,
      mime,
      width: config.viewport.width,
      height: config.viewport.height,
      viewport: { ...config.viewport },
      dataUri: dataUriFromBytes(screenshot.data, mime)
    };
  });

const applyTargetSelection = (
  options: {
    readonly configRef: Ref.Ref<BrowserCaptureRuntimeConfigSnapshot>;
    readonly previewSessionRef: Ref.Ref<BrowserPreviewSession>;
    readonly validateCrop: (
      crop: BrowserCaptureCrop | undefined,
      viewport: BrowserCaptureViewport
    ) => Effect.Effect<BrowserCaptureCrop | undefined, LiveStreakConfigError>;
  },
  payload: BrowserCaptureSetTargetPayload
): Effect.Effect<BrowserCaptureRuntimeConfigSnapshot, LiveStreakConfigError> =>
  Effect.gen(function* () {
    yield* validatePreviewRevision(options.previewSessionRef, payload.previewRevision);
    const session = yield* Ref.get(options.previewSessionRef);
    const target = session.targets.find((candidate) => candidate.id === payload.targetId);

    if (target === undefined) {
      return yield* Effect.fail(
        targetUnavailableError(payload.previewRevision, payload.targetId)
      );
    }

    const current = yield* Ref.get(options.configRef);
    const crop = yield* options.validateCrop({ ...target.rect }, current.viewport);
    const next = {
      ...current,
      crop,
      selectedTargetId: target.id,
      cropSource: "target" as const,
      lastPreviewRevision: payload.previewRevision
    };

    yield* Ref.set(options.configRef, next);
    return snapshotConfig(next);
  });

export const validatePreviewRevision = (
  previewSessionReference: Ref.Ref<BrowserPreviewSession>,
  previewRevision: number
): Effect.Effect<number, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const session = yield* Ref.get(previewSessionReference);
    if (session.revision !== previewRevision) {
      return yield* Effect.fail(stalePreviewRevisionError(session.revision, previewRevision));
    }

    return previewRevision;
  });

export const stalePreviewRevisionError = (
  expectedRevision: number,
  receivedRevision: number
): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: "Browser capture preview revision is stale",
    metadata: {
      cause: {
        expectedRevision,
        receivedRevision
      }
    }
  });

export const targetUnavailableError = (
  previewRevision: number,
  targetId: string
): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: "Browser capture target is not available for the current preview",
    metadata: {
      cause: {
        previewRevision,
        targetId
      }
    }
  });

const snapshotConfig = (
  config: BrowserCaptureRuntimeConfigSnapshot
): BrowserCaptureRuntimeConfigSnapshot => ({
  ...config,
  viewport: { ...config.viewport },
  crop: config.crop === undefined ? undefined : { ...config.crop }
});
