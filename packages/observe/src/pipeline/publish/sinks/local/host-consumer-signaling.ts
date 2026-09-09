import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { ConsumerSignalingChannel, RtcSessionDescription } from "./signaling.js";
import type { SignalingFetch } from "./host-signaling.js";

/**
 * Host-mediated consumer signaling (SEAM-WEBRTC answerer side).
 *
 * The browser peer polls the sink's offer from the host relay, answers it, and
 * posts the answer back — the mirror of `createHostMediatedSinkSignaling`.
 */
export interface HostMediatedConsumerSignalingInput {
  readonly baseUrl: string;
  readonly streamId: string;
  readonly fetch?: SignalingFetch;
  readonly pollIntervalMs?: number;
  readonly offerTimeoutMs?: number;
}

const defaultPollIntervalMs = 250;
const defaultOfferTimeoutMs = 60_000;

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
                "Host-mediated consumer signaling requires a fetch implementation: none on globalThis"
            })
          )
        : Effect.succeed(value)
    )
  );

const parseDescription = (
  raw: string,
  expected: "offer"
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

export const createHostMediatedConsumerSignaling = (
  input: HostMediatedConsumerSignalingInput
): ConsumerSignalingChannel => {
  if (typeof input.baseUrl !== "string" || input.baseUrl.trim().length === 0) {
    throw new LiveStreakConfigError({ message: "Host-mediated consumer signaling requires a baseUrl" });
  }
  if (typeof input.streamId !== "string" || input.streamId.trim().length === 0) {
    throw new LiveStreakConfigError({ message: "Host-mediated consumer signaling requires a streamId" });
  }

  const base = trimBase(input.baseUrl);
  const key = encodeURIComponent(input.streamId);
  const offerUrl = `${base}/webrtc/signal/${key}/offer`;
  const answerUrl = `${base}/webrtc/signal/${key}/answer`;
  const pollIntervalMs = input.pollIntervalMs ?? defaultPollIntervalMs;
  const offerTimeoutMs = input.offerTimeoutMs ?? defaultOfferTimeoutMs;

  const pollOfferOnce = (
    fetchImpl: SignalingFetch
  ): Effect.Effect<RtcSessionDescription | undefined, LiveStreakError> =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetchImpl(offerUrl, { method: "GET" }),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "Failed to GET WebRTC offer from the host relay",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (response.status === 404 || response.status === 204) {
        return undefined;
      }
      if (!response.ok) {
        return yield* Effect.fail(
          new LiveStreakRuntimeError({
            message: `Host relay offer poll failed (status ${response.status})`
          })
        );
      }
      const raw = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "Failed to read the host relay offer body",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (raw.trim().length === 0) {
        return undefined;
      }
      return yield* parseDescription(raw, "offer");
    });

  const awaitOffer: Effect.Effect<RtcSessionDescription, LiveStreakError> = Effect.gen(function* () {
    const fetchImpl = yield* resolveFetch(input.fetch);
    const poll: Effect.Effect<RtcSessionDescription, LiveStreakError> = Effect.gen(function* () {
      const offer = yield* pollOfferOnce(fetchImpl);
      if (offer !== undefined) {
        return offer;
      }
      yield* Effect.sleep(`${pollIntervalMs} millis`);
      return yield* poll;
    });
    return yield* poll;
  }).pipe(
    Effect.timeoutFail({
      duration: `${offerTimeoutMs} millis`,
      onTimeout: () =>
        new LiveStreakRuntimeError({
          message: `Timed out waiting ${offerTimeoutMs}ms for the sink's WebRTC offer`
        })
    })
  );

  const publishAnswer = (answer: RtcSessionDescription): Effect.Effect<void, LiveStreakError> =>
    Effect.gen(function* () {
      const fetchImpl = yield* resolveFetch(input.fetch);
      const response = yield* Effect.tryPromise({
        try: () =>
          fetchImpl(answerUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: answer.type, sdp: answer.sdp })
          }),
        catch: (cause) =>
          new LiveStreakRuntimeError({
            message: "Failed to POST WebRTC answer to the host relay",
            metadata: { details: cause instanceof Error ? cause.message : String(cause) }
          })
      });
      if (!response.ok) {
        return yield* Effect.fail(
          new LiveStreakRuntimeError({
            message: `Host relay rejected the answer (status ${response.status})`
          })
        );
      }
    });

  return { awaitOffer, publishAnswer };
};
