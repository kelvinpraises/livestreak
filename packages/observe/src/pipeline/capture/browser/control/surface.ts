import { Effect, pipe } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/calls.js";
import type {
  BoardPatch,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/types.js";
import type { BrowserCaptureCrop } from "#pipeline/capture/browser/page/types.js";
import {
  browserCaptureGetPreviewScope,
  browserCaptureInspectTargetsScope,
  browserCaptureSetTargetScope,
  browserPreviewTargetsArtifactKind,
  type BrowserPreviewTargetsArtifactPayload
} from "#pipeline/capture/browser/control/preview.js";
import type {
  BrowserCaptureControls,
  BrowserCaptureSetCropPayload
} from "#pipeline/capture/browser/control/controls.js";
import {
  browserCaptureClearCropScope,
  browserCaptureSetCaptureFpsScope,
  browserCaptureSetCropScope
} from "#pipeline/capture/browser/control/controls.js";
import {
  decodeSetCaptureFpsPayload,
  decodeSetCropPayload,
  decodeSetTargetPayload
} from "#pipeline/capture/browser/control/payloads.js";

export const browserCaptureSurfaceCellId = "capture:browser" as const;

export const browserCaptureFunctionNames = [
  "getPreview",
  "inspectTargets",
  "setTarget",
  "setCrop",
  "clearCrop",
  "setCaptureFps"
] as const;

/* eslint-disable unicorn/no-null -- BoardCell.status tuple uses null for absent message */
export const createBrowserCaptureControlSurface = (
  controls: BrowserCaptureControls
): ControlSurface => ({
  cell: {
    id: browserCaptureSurfaceCellId,
    cell: {
      label: "Browser Capture",
      catalog: browserCaptureSurfaceCellId,
      status: ["idle", null, Date.now()],
      functions: [...browserCaptureFunctionNames]
    }
  },
  functions: browserCaptureFunctionEntries(controls)
});

export const browserCaptureFunctionEntries = (
  controls: BrowserCaptureControls
): readonly ControlFunctionEntry[] => [
  previewFunction("getPreview", browserCaptureGetPreviewScope, () =>
    controls.getPreview.pipe(Effect.map((preview) => ({ preview, targets: [] as const })))
  ),
  previewFunction("inspectTargets", browserCaptureInspectTargetsScope, () =>
    controls.inspectTargets
  ),
  mutatingFunction("setTarget", browserCaptureSetTargetScope, (envelope) =>
    pipe(
      decodeSetTargetPayload(envelope.payload),
      Effect.flatMap((payload) => controls.setTarget(payload)),
      Effect.map((snapshot) =>
        settingsPatch({
          crop: snapshot.crop,
          selectedTargetId: snapshot.selectedTargetId,
          cropSource: snapshot.cropSource,
          lastPreviewRevision: snapshot.lastPreviewRevision
        })
      )
    )
  ),
  mutatingFunction("setCrop", browserCaptureSetCropScope, (envelope) =>
    pipe(
      decodeSetCropPayload(envelope.payload),
      Effect.flatMap((payload) =>
        controls.setCrop(payload).pipe(
          Effect.map((snapshot) => ({
            payload,
            snapshot
          }))
        )
      ),
      Effect.map(({ payload, snapshot }) => boardPatchForSetCrop(payload, snapshot.crop))
    )
  ),
  mutatingFunction("setCaptureFps", browserCaptureSetCaptureFpsScope, (envelope) =>
    pipe(
      decodeSetCaptureFpsPayload(envelope.payload),
      Effect.flatMap((payload) => controls.setCaptureFps(payload)),
      Effect.map((snapshot) =>
        settingsPatch({
          captureFps: snapshot.captureFps
        })
      )
    )
  ),
  mutatingFunction("clearCrop", browserCaptureClearCropScope, () =>
    pipe(
      controls.clearCrop,
      Effect.map(() =>
        settingsPatch(undefined, [
          "crop",
          "selectedTargetId",
          "cropSource",
          "lastPreviewRevision"
        ])
      )
    )
  )
];

const previewFunction = (
  name: string,
  scope: string,
  run: () => Effect.Effect<
    {
      preview: BrowserPreviewTargetsArtifactPayload["preview"];
      targets: BrowserPreviewTargetsArtifactPayload["targets"];
    },
    LiveStreakError
  >
): ControlFunctionEntry => ({
  name,
  scope,
  call: () =>
    pipe(
      run(),
      Effect.map(({ preview, targets }) => ({
        artifact: {
          kind: browserPreviewTargetsArtifactKind,
          ownerCell: browserCaptureSurfaceCellId,
          function: name,
          createdAtMs: preview.capturedAtMs,
          payload: {
            preview,
            targets
          } satisfies BrowserPreviewTargetsArtifactPayload
        }
      }))
    )
});

const mutatingFunction = (
  name: string,
  scope: string,
  run: (envelope: ControlCallEnvelope) => Effect.Effect<BoardPatch, LiveStreakError>
): ControlFunctionEntry => ({
  name,
  scope,
  call: (envelope) =>
    pipe(
      run(envelope),
      Effect.map((boardPatch) => ({ boardPatch }))
    )
});

const settingsPatch = (
  set?: Record<string, unknown>,
  unset?: readonly string[]
): BoardPatch => ({
  cells: {
    [browserCaptureSurfaceCellId]: {
      settings: {
        ...(set === undefined ? {} : { set }),
        ...(unset === undefined ? {} : { unset })
      }
    }
  }
});

const boardPatchForSetCrop = (
  payload: BrowserCaptureSetCropPayload,
  crop: BrowserCaptureCrop | undefined
): BoardPatch => {
  const hasPreviewRevision =
    typeof payload === "object" && payload !== null && "previewRevision" in payload;

  if (hasPreviewRevision) {
    return settingsPatch(
      {
        crop,
        cropSource: "manual",
        lastPreviewRevision: payload.previewRevision
      },
      ["selectedTargetId"]
    );
  }

  return settingsPatch(
    {
      crop,
      cropSource: "manual"
    },
    ["selectedTargetId", "lastPreviewRevision"]
  );
};

export const failUnsupportedBrowserFunction = (
  scope: string
): Effect.Effect<never, LiveStreakRuntimeError> =>
  Effect.fail(
    new LiveStreakRuntimeError({
      message: `Unsupported browser capture function scope: ${scope}`
    })
  );
