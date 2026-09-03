import type { MediaProvider, MediaProviderBindRequest, MediaProviderBindResult } from "../services/media/provider.js";

// --- exports ---

export const createLiveKitMediaProvider = (apiKey: string | undefined): MediaProvider => ({
  async bind(request: MediaProviderBindRequest): Promise<MediaProviderBindResult> {
    if (apiKey === undefined || apiKey.length === 0) {
      return {
        ok: false,
        status: 503,
        error: "media_provider_not_configured"
      };
    }

    return {
      ok: true,
      watchUrl: `livekit://stub/${request.sessionId}`,
      webrtcUrl: `livekit://stub/${request.sessionId}/webrtc`
    };
  }
});
