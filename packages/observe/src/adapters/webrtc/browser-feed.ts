import { Effect } from "effect";
import { LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import { createHostMediatedConsumerSignaling } from "../../pipeline/publish/sinks/local/host-consumer-signaling.js";
import type { SignalingFetch } from "../../pipeline/publish/sinks/local/host-signaling.js";
import type { RtcPeerConnectionFactory } from "../../pipeline/publish/sinks/local/signaling.js";
import { resolveDefaultPeerFactory } from "../../pipeline/publish/sinks/local/signaling.js";

/**
 * Browser WebRTC feed consumer (SEAM-WEBRTC answerer + reassembly).
 *
 * Polls the host relay for the sink's offer, answers it, receives the file bytes
 * over the data channel in delivery order, and exposes a blob URL the UI can set
 * on a `<video src>` — no transcode, verbatim container bytes.
 */

export type BrowserWebRtcFeedState = "idle" | "connecting" | "receiving" | "complete" | "failed";

export interface BrowserWebRtcFeedInput {
  readonly hostBaseUrl: string;
  readonly streamId: string;
  readonly mimeType?: string;
  readonly fetch?: SignalingFetch;
  readonly peerConnectionFactory?: RtcPeerConnectionFactory;
  readonly pollIntervalMs?: number;
  readonly offerTimeoutMs?: number;
  readonly onStateChange?: (state: BrowserWebRtcFeedState) => void;
  readonly onBytesReceived?: (totalBytes: number) => void;
}

export interface BrowserWebRtcFeedHandle {
  readonly state: BrowserWebRtcFeedState;
  readonly done: Promise<void>;
  readonly objectUrl: Promise<string>;
  stop(): void;
}

const defaultMimeType = "video/mp4";

const createBlobUrl = (bytes: Uint8Array, mimeType: string): string => {
  const g = globalThis as {
    Blob?: new (parts: unknown[], options?: { type?: string }) => unknown;
    URL?: { createObjectURL: (b: unknown) => string };
  };
  if (g.Blob === undefined || g.URL?.createObjectURL === undefined) {
    throw new Error("startBrowserWebRtcFeed requires Blob and URL.createObjectURL (browser runtime)");
  }
  return g.URL.createObjectURL(new g.Blob([bytes], { type: mimeType }));
};

const setState = (
  handle: { state: BrowserWebRtcFeedState; onStateChange?: (s: BrowserWebRtcFeedState) => void },
  next: BrowserWebRtcFeedState
): void => {
  handle.state = next;
  handle.onStateChange?.(next);
};

const concatChunks = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

const runBrowserFeed = (
  input: BrowserWebRtcFeedInput,
  chunks: Uint8Array[],
  totalBytes: { value: number },
  resolveObjectUrl: (url: string) => void,
  rejectObjectUrl: (error: Error) => void,
  resolveDone: () => void,
  rejectDone: (error: Error) => void,
  handle: BrowserWebRtcFeedHandle & { peer?: { close: () => void }; objectUrlValue?: string }
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    setState(handle, "connecting");

    const signaling = createHostMediatedConsumerSignaling({
      baseUrl: input.hostBaseUrl,
      streamId: input.streamId,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.pollIntervalMs === undefined ? {} : { pollIntervalMs: input.pollIntervalMs }),
      ...(input.offerTimeoutMs === undefined ? {} : { offerTimeoutMs: input.offerTimeoutMs })
    });

    const factory =
      input.peerConnectionFactory ?? (yield* resolveDefaultPeerFactory());
    const peer = factory();
    handle.peer = peer;

    const mimeType = input.mimeType ?? defaultMimeType;
    let objectUrlResolved = false;
    let doneResolved = false;

    const maybeResolveObjectUrl = (): void => {
      if (objectUrlResolved || chunks.length === 0) {
        return;
      }
      const bytes = concatChunks(chunks);
      const url = createBlobUrl(bytes, mimeType);
      handle.objectUrlValue = url;
      objectUrlResolved = true;
      resolveObjectUrl(url);
    };

    const finish = (error?: Error): void => {
      if (!doneResolved) {
        doneResolved = true;
        if (error) {
          setState(handle, "failed");
          rejectObjectUrl(error);
          rejectDone(error);
        } else {
          setState(handle, "complete");
          maybeResolveObjectUrl();
          resolveDone();
        }
      }
    };

    peer.ondatachannel = (event) => {
      setState(handle, "receiving");
      const channel = event.channel;
      channel.onmessage = (message) => {
        chunks.push(message.data);
        totalBytes.value += message.data.byteLength;
        input.onBytesReceived?.(totalBytes.value);
        if (!objectUrlResolved && chunks.length > 0) {
          maybeResolveObjectUrl();
        }
      };
      channel.onclose = () => finish();
    };

    const offer = yield* signaling.awaitOffer;
    yield* Effect.tryPromise({
      try: () => peer.setRemoteDescription(offer),
      catch: (cause) =>
        new LiveStreakRuntimeError({
          message: "Browser feed failed to set the remote description",
          metadata: { details: cause instanceof Error ? cause.message : String(cause) }
        })
    });
    const answer = yield* Effect.tryPromise({
      try: () => peer.createAnswer(),
      catch: (cause) =>
        new LiveStreakRuntimeError({
          message: "Browser feed failed to create an answer",
          metadata: { details: cause instanceof Error ? cause.message : String(cause) }
        })
    });
    yield* Effect.tryPromise({
      try: () => peer.setLocalDescription(answer),
      catch: (cause) =>
        new LiveStreakRuntimeError({
          message: "Browser feed failed to set the local description",
          metadata: { details: cause instanceof Error ? cause.message : String(cause) }
        })
    });
    yield* signaling.publishAnswer(answer);
  });

export const startBrowserWebRtcFeed = (input: BrowserWebRtcFeedInput): BrowserWebRtcFeedHandle => {
  const chunks: Uint8Array[] = [];
  const totalBytes = { value: 0 };
  let objectUrlResolve!: (url: string) => void;
  let objectUrlReject!: (error: Error) => void;
  let doneResolve!: () => void;
  let doneReject!: (error: Error) => void;

  const objectUrl = new Promise<string>((resolve, reject) => {
    objectUrlResolve = resolve;
    objectUrlReject = reject;
  });
  const done = new Promise<void>((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });

  const handle: BrowserWebRtcFeedHandle & {
    state: BrowserWebRtcFeedState;
    peer?: { close: () => void };
    objectUrlValue?: string;
    onStateChange?: (s: BrowserWebRtcFeedState) => void;
  } = {
    state: "idle",
    done,
    objectUrl,
    onStateChange: input.onStateChange,
    stop: () => {
      if (handle.objectUrlValue !== undefined) {
        const revoke = (globalThis as { URL?: { revokeObjectURL: (u: string) => void } }).URL
          ?.revokeObjectURL;
        revoke?.(handle.objectUrlValue);
      }
      handle.peer?.close();
      setState(handle, "failed");
    }
  };

  void Effect.runPromise(
    runBrowserFeed(
      input,
      chunks,
      totalBytes,
      objectUrlResolve,
      objectUrlReject,
      doneResolve,
      doneReject,
      handle
    )
  ).catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    setState(handle, "failed");
    objectUrlReject(err);
    doneReject(err);
  });

  return handle;
};
