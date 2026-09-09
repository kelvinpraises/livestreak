import { Effect } from "effect";
import { createHostMediatedSinkSignaling } from "../../pipeline/publish/sinks/local/host-signaling.js";
import { resolveNodePeerConnectionFactory } from "../../pipeline/publish/sinks/local/node-peer.js";
import { streamFileToWebRtcEffect } from "../../pipeline/publish/sinks/local/file-stream.js";

/**
 * CLI-facing Promise entry for `cli stream --video` (SEAM-WEBRTC).
 *
 * Matches the shape `cli/src/adapters/stream.ts` expects. Ignores the CLI's
 * legacy `FileWebRtcSignaling` (wrong `/webrtc/signal` POST shape) and uses
 * `createHostMediatedSinkSignaling` against the host relay instead.
 */

export interface CliFileWebRtcSignaling {
  readonly postOffer: (input: { readonly marketId: string; readonly sdp: string }) => Promise<void>;
  readonly waitForAnswer: (input: { readonly marketId: string }) => Promise<{ readonly sdp: string }>;
}

export interface CliStreamFileInput {
  readonly videoPath: string;
  readonly marketId: string;
  /** Legacy CLI signaling — ignored; host relay is used instead. */
  readonly signaling: CliFileWebRtcSignaling;
  /** Host relay base URL. Defaults to `$LIVESTREAK_HOST_URL` or `http://127.0.0.1:8787`. */
  readonly hostBaseUrl?: string;
}

export interface CliStreamFileHandle {
  readonly done: Promise<void>;
  stop(): Promise<void>;
}

const defaultHostBaseUrl = (): string =>
  (typeof process !== "undefined" &&
    typeof process.env?.LIVESTREAK_HOST_URL === "string" &&
    process.env.LIVESTREAK_HOST_URL.length > 0)
    ? process.env.LIVESTREAK_HOST_URL
    : "http://127.0.0.1:8787";

let activeAbort: AbortController | undefined;

export const createFileWebRtcStream = async (
  input: CliStreamFileInput
): Promise<CliStreamFileHandle> => {
  const hostBaseUrl = input.hostBaseUrl ?? defaultHostBaseUrl();
  const signaling = createHostMediatedSinkSignaling({
    baseUrl: hostBaseUrl,
    streamId: input.marketId,
    answerTimeoutMs: 120_000
  });

  const factory = await Effect.runPromise(resolveNodePeerConnectionFactory());

  const effect = streamFileToWebRtcEffect({
    filePath: input.videoPath,
    streamId: input.marketId,
    signaling,
    peerConnectionFactory: factory
  });

  const abort = new AbortController();
  activeAbort = abort;

  const done = Effect.runPromise(effect).then(
    () => undefined,
    (error) => {
      throw error;
    }
  );

  return {
    done,
    stop: async () => {
      abort.abort();
      activeAbort = undefined;
    }
  };
};
