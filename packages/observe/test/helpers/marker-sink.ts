import { Effect } from "effect";
import type { TimelineMarkerKind } from "#pipeline/timeline/index.js";
import type {
  MarkerSinkDeliveryItem,
  SinkAttachment,
  SinkDriver,
  SinkFinalizeResult,
  SinkStageHealth
} from "#pipeline/publish/index.js";

export interface MarkerSinkMarkerRecord {
  readonly kind: TimelineMarkerKind;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs?: number;
}

export type MarkerSinkDeliveryLabel =
  | `video:${number}`
  | `marker:${TimelineMarkerKind}`;

export interface MarkerSinkRecording {
  videos: number[];
  markers: MarkerSinkMarkerRecord[];
  deliveries: MarkerSinkDeliveryLabel[];
  finalized: boolean;
}

export interface MarkerRecordingSinkDriverResult {
  readonly driver: SinkDriver<{ readonly path: string }>;
  readonly recording: MarkerSinkRecording;
}

export const createMarkerRecordingSinkDriver = (): MarkerRecordingSinkDriverResult => {
  const recording: MarkerSinkRecording = {
    videos: [],
    markers: [],
    deliveries: [],
    finalized: false
  };

  const driver: SinkDriver<{ readonly path: string }> = {
    descriptor: {
      kind: "publish",
      id: "memory",
      version: "0.1.0",
      displayName: "Marker Recording Sink",
      summary: "Records video and marker deliveries for tests.",
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
          label: "Marker Recording Sink",
          catalog: "sink:memory",
           
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
      Effect.succeed({
        id: "marker-recording-sink",
        deliver: (item) =>
          Effect.sync(() => {
            if (item.kind === "video") {
              recording.videos.push(item.sequence);
              recording.deliveries.push(`video:${item.sequence}`);
              return;
            }

            recordMarkerDelivery(recording, item);
          }),
        finalize: Effect.sync(() => {
          recording.finalized = true;
          return {
            deliveredItems: recording.videos.length + recording.markers.length,
            output: { kind: "memory" }
          } satisfies SinkFinalizeResult;
        }),
        health: Effect.succeed({
          stage: "publish",
          descriptorId: "memory",
          status: "running",
          updatedAtMs: Date.now(),
          deliveredItems: recording.videos.length + recording.markers.length
        } satisfies SinkStageHealth),
        detach: Effect.void
      } satisfies SinkAttachment)
  };

  return { driver, recording };
};

// --- helpers ---

const recordMarkerDelivery = (
  recording: MarkerSinkRecording,
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
