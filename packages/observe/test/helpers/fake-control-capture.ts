/* eslint-disable unicorn/no-null -- BoardCell.status tuple uses null for absent message */
import { Effect, Stream } from "effect";
import type { CaptureDriver, CaptureDriverDescriptor, FrameSource } from "#pipeline/capture/index.js";
import type { ControlCellDefinition, ControlSurface } from "#run/control/bus/index.js";

export const fakeControlCaptureScope = "capture:fake:ping" as const;

export interface FakeControlCaptureConfig {
  readonly label?: string;
}

export const fakeControlCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "fake-control",
  version: "0.1.0",
  displayName: "Fake Control Capture",
  summary: "Test capture driver with a fake control surface.",
  capabilityScopes: ["capture:fake-control:*"],
  flags: [],
  commands: [
    {
      name: "ping",
      scope: fakeControlCaptureScope,
      help: "Returns a board patch from the fake control surface.",
      resultKind: "state-patch"
    }
  ],
  sourceType: "synthetic",
  sourceMode: "file"
};

export const createFakeControlCaptureDriver = (): CaptureDriver<FakeControlCaptureConfig> => ({
  descriptor: fakeControlCaptureDescriptor,
  validate: (config) => Effect.succeed(config),
  describeControl: (config, context) =>
    Effect.succeed(describeFakeControlCell(config, context)),
  create: () =>
    Effect.succeed({
      descriptor: fakeControlCaptureDescriptor,
      frames: Stream.empty,
      health: Effect.succeed({
        stage: "capture",
        descriptorId: fakeControlCaptureDescriptor.id,
        status: "running",
        updatedAtMs: Date.now(),
        sourceId: "capture:fake-control",
        frameCount: 0,
        droppedFrames: 0
      }),
      control: createFakeControlCaptureSurface()
    } satisfies FrameSource)
});

export const createFakeControlCaptureSurface = (): ControlSurface => ({
  cell: {
    id: "capture:fake-control",
    cell: {
      label: "Fake Control Capture",
      catalog: "capture:fake-control",
      status: ["idle", null, Date.now()],
      functions: ["ping"]
    }
  },
  functions: [
    {
      name: "ping",
      scope: fakeControlCaptureScope,
      call: () =>
        Effect.succeed({
          boardPatch: {
            cells: {
              "capture:fake-control": {
                settings: {
                  set: { lastPingMs: Date.now() }
                }
              }
            }
          }
        })
    }
  ]
});

const describeFakeControlCell = (
  config: FakeControlCaptureConfig,
  context: { readonly runId: string; readonly nowMs?: number }
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();

  return {
    id: "capture:fake-control",
    cell: {
      label: config.label ?? "Fake Control Capture",
      catalog: "capture:fake-control",
      status: ["idle", null, nowMs],
      settings: {},
      readonly: {
        sourceType: "synthetic",
        sourceMode: "file"
      },
      functions: ["ping"]
    }
  };
};
