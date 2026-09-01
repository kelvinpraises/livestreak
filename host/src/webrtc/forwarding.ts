import type { EndpointKind } from "@livestreak/host";

// --- exports ---

export interface WebRtcForwardRequest {
  readonly sessionId: string;
  readonly endpointKind: EndpointKind;
}

export interface WebRtcForwardResult {
  readonly status: "stub";
  readonly sessionId: string;
  readonly endpointKind: EndpointKind;
  readonly message: string;
}

export const forwardWebRtcSession = (
  request: WebRtcForwardRequest
): WebRtcForwardResult => ({
  status: "stub",
  sessionId: request.sessionId,
  endpointKind: request.endpointKind,
  message: "WebRTC forwarding provider is not configured"
});
