import { Effect } from "effect";
import {
  validateRtmpCaptureConfig,
  rtmpPublishUrl,
  type RtmpCaptureConfig,
} from "#pipeline/capture/rtmp/driver.js";
import type { ControlSurface } from "../bus/types.js";

export const createRtmpCaptureControlSurface = (): ControlSurface => ({
  cell: {
    id: "capture:rtmp",
    cell: {
      label: "RTMP broadcast",
      catalog: "capture:rtmp",
      status: ["idle", null, Date.now()],
      settings: {},
      readonly: { configured: false, sourceType: "stream", sourceMode: "live" },
      functions: ["configure", "close"],
    },
  },
  functions: [
    {
      name: "configure",
      scope: "capture:rtmp:configure",
      call: (envelope, context) =>
        Effect.gen(function* () {
          const payload = (
            typeof envelope.payload === "object" && envelope.payload !== null
              ? envelope.payload
              : {}
          ) as Partial<RtmpCaptureConfig>;
          const config = yield* validateRtmpCaptureConfig({
            ...payload,
            streamName: payload.streamName ?? context.cellId.split(":")[1]!,
          } as RtmpCaptureConfig);
          return {
            boardPatch: {
              cells: {
                [context.cellId]: {
                  settings: { set: { source: "rtmp", ...config } },
                  readonly: {
                    set: {
                      configured: true,
                      sourceType: "stream",
                      sourceMode: "live",
                      publishUrl: rtmpPublishUrl(config),
                      audio: config.audio,
                    },
                  },
                  status: ["configured", null, Date.now()],
                },
              },
            },
          };
        }),
    },
    {
      name: "close",
      scope: "capture:rtmp:close",
      call: (_envelope, context) =>
        Effect.succeed({
          boardPatch: {
            cells: {
              [context.cellId]: {
                readonly: { set: { configured: false } },
                status: ["idle", null, Date.now()],
              },
            },
          },
        }),
    },
  ],
});
