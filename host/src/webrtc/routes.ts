import { LiveStreakConfigError } from "@livestreak/core";
import { forwardWebRtcSession, type WebRtcForwardRequest } from "./forwarding.js";

// --- exports ---

export type WebRtcRouteResponse =
  | { readonly ok: true; readonly result: ReturnType<typeof forwardWebRtcSession> }
  | { readonly ok: false; readonly status: number; readonly error: LiveStreakConfigError };

export const handleWebRtcForward = (body: unknown): WebRtcRouteResponse => {
  if (!isWebRtcForwardRequest(body)) {
    return {
      ok: false,
      status: 400,
      error: new LiveStreakConfigError({
        message: "Request body must include sessionId and endpointKind",
        metadata: { retryable: false }
      })
    };
  }

  return {
    ok: true,
    result: forwardWebRtcSession(body)
  };
};

// --- helpers ---

const endpointKinds = new Set([
  "watch",
  "webrtc",
  "state",
  "telemetry",
  "archive",
  "control"
]);

const isWebRtcForwardRequest = (value: unknown): value is WebRtcForwardRequest => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    record.sessionId.length > 0 &&
    typeof record.endpointKind === "string" &&
    endpointKinds.has(record.endpointKind)
  );
};
