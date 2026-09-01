import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { TimelineMarkerKind } from "#pipeline/timeline/index.js";
import type {
  MarkerSinkDeliveryItem,
  SinkAttachment,
  SinkDriver,
  SinkFinalizeResult,
  SinkPausePresentation,
  SinkPresentationControls,
  SinkStageHealth
} from "#pipeline/publish/index.js";

export type MarkerSinkDeliveryLabel =
  | `video:${number}`
  | `marker:${TimelineMarkerKind}`;

export interface MarkerSinkMarkerRecord {
  readonly kind: TimelineMarkerKind;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs?: number;
}

export interface PresentationSinkRecording {
  readonly presentationCalls: string[];
  readonly videos: number[];
  readonly markers: MarkerSinkMarkerRecord[];
  readonly deliveries: MarkerSinkDeliveryLabel[];
  finalized: boolean;
}

export interface PresentationRecordingSinkDriverResult {
  readonly driver: SinkDriver<{ readonly path: string }>;
  readonly recording: PresentationSinkRecording;
}

export interface PresentationRecordingSinkOptions {
  readonly presentationCalls?: string[];
  readonly deliveredVideos?: number[];
  readonly pausePresentation?: (
    presentation: SinkPausePresentation
  ) => Effect.Effect<void, LiveStreakError>;
  readonly resumePresentation?: Effect.Effect<void, LiveStreakError>;
  readonly deliver?: SinkAttachment["deliver"];
}

export const createPresentationRecordingSinkDriver = (
  options: PresentationRecordingSinkOptions = {}
): PresentationRecordingSinkDriverResult => {
  const recording: PresentationSinkRecording = {
    presentationCalls: options.presentationCalls ?? [],
    videos: options.deliveredVideos ?? [],
    markers: [],
    deliveries: [],
    finalized: false
  };

  const driver: SinkDriver<{ readonly path: string }> = {
    descriptor: {
      kind: "publish",
      id: "memory",
      version: "0.1.0",
      displayName: "Presentation Recording Sink",
      summary: "Records sink deliveries and presentation hook calls for tests.",
      capabilityScopes: [],
      flags: [],
      commands: [],
      mode: "file",
      requiresHost: false,
      debugOnly: true
    },
    mode: "file",
    validate: (config) => Effect.succeed(config),
    describeControl: (config, context) => {
      const nowMs = context.nowMs ?? Date.now();
      const instanceId = context.instanceId ?? "file-export";

      return Effect.succeed({
        id: `sink:${instanceId}`,
        cell: {
          label: "Presentation Recording Sink",
          catalog: "sink:memory",
          // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
          status: ["idle", null, nowMs],
          settings: {
            path: config.path,
            subscribe: ["publish.video.rendered"],
            required: true
          },
          readonly: {},
          functions: []
        }
      });
    },
    attach: () =>
      Effect.succeed(
        createPresentationRecordingAttachment({
          presentationCalls: recording.presentationCalls,
          deliveredVideos: recording.videos,
          ...(options.pausePresentation === undefined
            ? {}
            : { pausePresentation: options.pausePresentation }),
          ...(options.resumePresentation === undefined
            ? {}
            : { resumePresentation: options.resumePresentation }),
          deliver: (item) =>
            Effect.sync(() => {
              if (item.kind === "video") {
                recording.videos.push(item.sequence);
                recording.deliveries.push(`video:${item.sequence}`);
                return;
              }

              recordMarkerDelivery(recording, item);
            })
        })
      )
  };

  return { driver, recording };
};

export const createPresentationRecordingAttachment = (
  options: PresentationRecordingSinkOptions = {}
): SinkAttachment => {
  const presentationCalls = options.presentationCalls ?? [];
  const deliveredVideos = options.deliveredVideos ?? [];

  const presentation: SinkPresentationControls = {
    pausePresentation: (presentationInput) =>
      (options.pausePresentation ?? defaultPausePresentationRecorder(presentationCalls))(
        presentationInput
      ),
    resumePresentation:
      options.resumePresentation ??
      Effect.sync(() => {
        presentationCalls.push("resume");
      })
  };

  return {
    id: "presentation-recording-sink",
    deliver:
      options.deliver ??
      ((item) =>
        Effect.sync(() => {
          if (item.kind === "video") {
            deliveredVideos.push(item.sequence);
          }
        })),
    finalize: Effect.succeed({
      deliveredItems: deliveredVideos.length,
      output: { kind: "memory" }
    } satisfies SinkFinalizeResult),
    health: Effect.succeed({
      stage: "publish",
      descriptorId: "memory",
      status: "running",
      updatedAtMs: Date.now(),
      deliveredItems: deliveredVideos.length
    } satisfies SinkStageHealth),
    detach: Effect.void,
    presentation
  };
};

const defaultPausePresentationRecorder =
  (presentationCalls: string[]) =>
  (presentation: SinkPausePresentation): Effect.Effect<void, LiveStreakError> =>
    Effect.sync(() => {
      if (presentation.whilePaused === "slate") {
        presentationCalls.push(`pause:slate:${presentation.slateAssetId ?? ""}`);
        return;
      }

      presentationCalls.push(`pause:${presentation.whilePaused}`);
    });

export const formatPresentationCall = (presentation: SinkPausePresentation): string =>
  presentation.whilePaused === "slate"
    ? `pause:slate:${presentation.slateAssetId ?? ""}`
    : `pause:${presentation.whilePaused}`;

const recordMarkerDelivery = (
  recording: Pick<PresentationSinkRecording, "markers" | "deliveries">,
  item: MarkerSinkDeliveryItem
): void => {
  recording.markers.push({
    kind: item.marker.kind,
    sequence: item.sequence,
    epoch: item.epoch,
    ...(item.mediaTimeMs === undefined ? {} : { mediaTimeMs: item.mediaTimeMs })
  });
  recording.deliveries.push(`marker:${item.marker.kind}`);
};
