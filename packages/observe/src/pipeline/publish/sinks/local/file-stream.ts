import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { SinkDeliveryItem } from "#pipeline/publish/index.js";
import { createLocalSinkDriver, type LocalSinkConfig } from "./driver.js";
import type { RtcPeerConnectionFactory, SinkSignalingChannel } from "./signaling.js";

/**
 * SEAM-WEBRTC entry — stream a REAL local file to a browser over WebRTC with NO
 * transforms (file → WebRTC; the user said no transcoding).
 *
 * Byte→peer mapping (permutated in the reply): the raw container bytes are
 * chunked and pushed over the local sink's WebRTC **data channel** — NOT an
 * encoded media track. A media track would force a decode→RTP transcode, which
 * the prompt forbids. The data channel carries the file verbatim; the answering
 * browser peer (agent-1) reassembles and feeds it to a `MediaSource` /
 * `<video>` so the UI renders it. The bar is "the browser receives and the UI
 * can render it," not an SFU.
 *
 * The entry is signaling-agnostic: pass the in-process `LocalSignalingHub.sink`
 * (tests) or `createHostMediatedSinkSignaling(...)` (runtime, cross-process via
 * the host relay). Each `streamId` ⇒ its own relay slot ⇒ its own feed (issue 7).
 */
export interface StreamFileToWebRtcInput {
  /** Path to the local media file to stream (read verbatim, no transcode). */
  readonly filePath: string;
  /** Stream/market id — keys the feed end-to-end. */
  readonly streamId: string;
  /** Sink-side signaling (in-process hub for tests, host-mediated at runtime). */
  readonly signaling: SinkSignalingChannel;
  /** Optional peer factory; defaults to the runtime's global RTCPeerConnection. */
  readonly peerConnectionFactory?: RtcPeerConnectionFactory;
  /** Data channel label; defaults to `livestreak-video:<streamId>`. */
  readonly channelLabel?: string;
  /** Chunk size in bytes for the file→data-channel transfer (default 16 KiB). */
  readonly chunkBytes?: number;
  /** Milliseconds to wait for the data channel to open; defaults to the sink default. */
  readonly connectTimeoutMs?: number;
  /** Injectable file reader (defaults to node:fs/promises readFile). Test seam. */
  readonly readFile?: (path: string) => Promise<Uint8Array>;
}

export interface StreamFileToWebRtcResult {
  readonly streamId: string;
  readonly totalBytes: number;
  readonly deliveredChunks: number;
}

const defaultChunkBytes = 16 * 1024;

const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

interface NodeFsPromises {
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

const defaultReadFile = async (path: string): Promise<Uint8Array> => {
  const fs = (await importNode("node:fs/promises")) as NodeFsPromises;
  const buffer = await fs.readFile(path);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
};

const makeChunkItem = (
  streamId: string,
  sequence: number,
  bytes: Uint8Array
): SinkDeliveryItem => ({
  kind: "video",
  sinkId: "local-preview",
  trackId: `publish.video.file:${streamId}`,
  role: "publish.video.rendered",
  sequence,
  epoch: 0,
  mediaTimeMs: sequence,
  wallTimeMs: Date.now(),
  payloadBytes: bytes.byteLength,
  payload: {
    // The local sink reads `payload.data` (Uint8Array) and sends it verbatim.
    data: bytes,
    byteFormat: "container",
    encoding: "raw"
  }
});

export const streamFileToWebRtcEffect = (
  input: StreamFileToWebRtcInput
): Effect.Effect<StreamFileToWebRtcResult, LiveStreakError> =>
  Effect.scoped(
    Effect.gen(function* () {
      if (typeof input.filePath !== "string" || input.filePath.trim().length === 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: "streamFileToWebRtc requires a filePath" })
        );
      }
      if (typeof input.streamId !== "string" || input.streamId.trim().length === 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: "streamFileToWebRtc requires a streamId" })
        );
      }
      const chunkBytes = input.chunkBytes ?? defaultChunkBytes;
      if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: "streamFileToWebRtc chunkBytes must be a positive integer" })
        );
      }

      const readFile = input.readFile ?? defaultReadFile;
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(input.filePath),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "streamFileToWebRtc failed to read the source file",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (bytes.byteLength === 0) {
        return yield* Effect.fail(
          new LiveStreakConfigError({ message: "streamFileToWebRtc received an empty file" })
        );
      }

      const sinkConfig: LocalSinkConfig = {
        signaling: input.signaling,
        streamId: input.streamId,
        channelLabel: input.channelLabel ?? `livestreak-video:${input.streamId}`,
        ...(input.peerConnectionFactory === undefined
          ? {}
          : { peerConnectionFactory: input.peerConnectionFactory }),
        ...(input.connectTimeoutMs === undefined
          ? {}
          : { connectTimeoutMs: input.connectTimeoutMs })
      };

      const driver = createLocalSinkDriver();
      const attachment = yield* driver.attach(sinkConfig);

      let deliveredChunks = 0;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
        const end = Math.min(offset + chunkBytes, bytes.byteLength);
        const chunk = bytes.subarray(offset, end);
        yield* attachment.deliver(makeChunkItem(input.streamId, deliveredChunks, chunk));
        deliveredChunks += 1;
      }

      yield* attachment.finalize;

      return {
        streamId: input.streamId,
        totalBytes: bytes.byteLength,
        deliveredChunks
      } satisfies StreamFileToWebRtcResult;
    })
  );
