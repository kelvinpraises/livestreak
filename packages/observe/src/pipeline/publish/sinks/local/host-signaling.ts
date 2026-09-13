import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { RtcSessionDescription, SinkSignalingChannel } from "./signaling.js";

/**
 * Host-mediated signaling (SEAM-WEBRTC).
 *
 * The in-process `LocalSignalingHub` (see `signaling.ts`) only rendezvouses two
 * peers inside ONE process — fine for tests, useless across processes. At
 * runtime the sink (this package, driven by the CLI) and the answering browser
 * peer (the app) live in different processes, so they exchange SDP through the
 * host relay (agent-2 owns `host/**`).
 *
 * Shape this builds to (agent-2's published `/webrtc/signal` relay; coded to the
 * AGREED shape and FLAGGED until merged):
 *   - POST `${baseUrl}/webrtc/signal/${streamId}/offer`  body `{ type, sdp }`
 *   - GET  `${baseUrl}/webrtc/signal/${streamId}/answer` → 200 `{ type, sdp }`
 *       once the browser has answered, 404/204 while pending.
 *
 * The channel is keyed by stream/market id end-to-end so each stream is its own
 * feed (issue 7): a distinct `streamId` ⇒ a distinct relay slot ⇒ a distinct
 * peer connection.
 */

/** Minimal `fetch` surface the channel needs; injectable for tests. */
export type SignalingFetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: string;
  }
) => Promise<SignalingResponse>;

export interface SignalingResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly text: () => Promise<string>;
}

export interface HostMediatedSinkSignalingInput {
  /** Host relay base URL, e.g. `http://127.0.0.1:8787`. */
  readonly baseUrl: string;
  /** Stream/market id keying the relay slot (the per-stream feed key). */
  readonly streamId: string;
  /** Injectable fetch (defaults to the global `fetch`). */
  readonly fetch?: SignalingFetch;
  /** Poll interval while waiting for the browser's answer (ms, default 250). */
  readonly pollIntervalMs?: number;
  /** Overall budget to wait for the answer (ms, default 30000). */
  readonly answerTimeoutMs?: number;
}

const defaultPollIntervalMs = 250;
const defaultAnswerTimeoutMs = 30_000;

const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

const resolveFetch = (
  injected: SignalingFetch | undefined
): Effect.Effect<SignalingFetch, LiveStreakError> =>
  Effect.sync(() => {
    if (injected !== undefined) {
      return injected;
    }
    const globalFetch = (globalThis as { fetch?: unknown }).fetch;
    if (typeof globalFetch !== "function") {
      return undefined;
    }
    const wrapped: SignalingFetch = async (url, init) => {
      const response = (await (globalFetch as (u: string, i: unknown) => Promise<unknown>)(
        url,
        init
      )) as { status: number; ok: boolean; text: () => Promise<string> };
      return { status: response.status, ok: response.ok, text: () => response.text() };
    };
    return wrapped;
  }).pipe(
    Effect.flatMap((value) =>
      value === undefined
        ? Effect.fail(
            new LiveStreakRuntimeError({
              message:
                "Host-mediated signaling requires a fetch implementation: none on globalThis"
            })
          )
        : Effect.succeed(value)
    )
  );

const parseDescription = (
  raw: string,
  expected: "answer"
): Effect.Effect<RtcSessionDescription, LiveStreakError> =>
  Effect.try({
    try: () => JSON.parse(raw) as Partial<RtcSessionDescription>,
    catch: (cause) =>
      new LiveStreakRuntimeError({
        message: "Host relay returned a non-JSON SDP payload",
        metadata: { details: cause instanceof Error ? cause.message : String(cause) }
      })
  }).pipe(
    Effect.flatMap((parsed) =>
      parsed.type === expected && typeof parsed.sdp === "string"
        ? Effect.succeed({ type: parsed.type, sdp: parsed.sdp })
        : Effect.fail(
            new LiveStreakRuntimeError({
              message: `Host relay returned a malformed ${expected} description`
            })
          )
    )
  );

export const createHostMediatedSinkSignaling = (
  input: HostMediatedSinkSignalingInput
): SinkSignalingChannel => {
  if (typeof input.baseUrl !== "string" || input.baseUrl.trim().length === 0) {
    throw new LiveStreakConfigError({ message: "Host-mediated signaling requires a baseUrl" });
  }
  if (typeof input.streamId !== "string" || input.streamId.trim().length === 0) {
    throw new LiveStreakConfigError({ message: "Host-mediated signaling requires a streamId" });
  }

  const base = trimBase(input.baseUrl);
  const key = encodeURIComponent(input.streamId);
  const viewersUrl = `${base}/webrtc/signal/${key}/viewers`;
  const offerUrlFor = (viewerId: string): string =>
    `${viewersUrl}/${encodeURIComponent(viewerId)}/offer`;
  const answerUrlFor = (viewerId: string): string =>
    `${viewersUrl}/${encodeURIComponent(viewerId)}/answer`;
  const pollIntervalMs = input.pollIntervalMs ?? defaultPollIntervalMs;
  const answerTimeoutMs = input.answerTimeoutMs ?? defaultAnswerTimeoutMs;

  // Poll the viewers registered for this stream — the producer spins a peer per new id.
  const listViewers: Effect.Effect<readonly string[], LiveStreakError> = Effect.gen(function* () {
    const fetchImpl = yield* resolveFetch(input.fetch);
    const response = yield* Effect.tryPromise({
      try: () => fetchImpl(viewersUrl, { method: "GET" }),
      catch: (cause) =>
        new LiveStreakRuntimeError({
          message: "Failed to GET viewers from the host relay",
          metadata: { details: cause instanceof Error ? cause.message : String(cause) }
        })
    });
    if (!response.ok) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({
          message: `Host relay viewers poll failed (status ${response.status})`
        })
      );
    }
    const raw = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new LiveStreakRuntimeError({
          message: "Failed to read the host relay viewers body",
          metadata: { details: cause instanceof Error ? cause.message : String(cause) }
        })
    });
    return yield* Effect.try({
      try: () => {
        const parsed = JSON.parse(raw) as { viewers?: unknown };
        return Array.isArray(parsed.viewers)
          ? parsed.viewers.filter((v): v is string => typeof v === "string")
          : [];
      },
      catch: () =>
        new LiveStreakRuntimeError({ message: "Host relay returned a malformed viewers list" })
    });
  });

  const publishOfferFor = (
    viewerId: string,
    offer: RtcSessionDescription
  ): Effect.Effect<void, LiveStreakError> =>
    Effect.gen(function* () {
      const fetchImpl = yield* resolveFetch(input.fetch);
      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(offerUrlFor(viewerId), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: offer.type, sdp: offer.sdp })
          }),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "Failed to POST WebRTC offer to the host relay",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (!response.ok) {
        return yield* Effect.fail(
          new LiveStreakRuntimeError({
            message: `Host relay rejected the offer (status ${response.status})`
          })
        );
      }
    });

  const pollAnswerOnce = (
    fetchImpl: SignalingFetch,
    viewerId: string
  ): Effect.Effect<RtcSessionDescription | undefined, LiveStreakError> =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetchImpl(answerUrlFor(viewerId), { method: "GET" }),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "Failed to GET WebRTC answer from the host relay",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (response.status === 404 || response.status === 204) {
        return undefined;
      }
      if (!response.ok) {
        return yield* Effect.fail(
          new LiveStreakRuntimeError({
            message: `Host relay answer poll failed (status ${response.status})`
          })
        );
      }
      const raw = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "Failed to read the host relay answer body",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (raw.trim().length === 0) {
        return undefined;
      }
      return yield* parseDescription(raw, "answer");
    });

  const awaitAnswerFor = (
    viewerId: string
  ): Effect.Effect<RtcSessionDescription, LiveStreakError> =>
    Effect.gen(function* () {
      const fetchImpl = yield* resolveFetch(input.fetch);
      const poll: Effect.Effect<RtcSessionDescription, LiveStreakError> = Effect.gen(function* () {
        const answer = yield* pollAnswerOnce(fetchImpl, viewerId);
        if (answer !== undefined) {
          return answer;
        }
        yield* Effect.sleep(`${pollIntervalMs} millis`);
        return yield* poll;
      });
      return yield* poll;
    }).pipe(
      Effect.timeoutFail({
        duration: `${answerTimeoutMs} millis`,
        onTimeout: () =>
          new LiveStreakRuntimeError({
            message: `Timed out waiting ${answerTimeoutMs}ms for viewer ${viewerId}'s WebRTC answer`
          })
      })
    );

  return { listViewers, publishOfferFor, awaitAnswerFor };
};
