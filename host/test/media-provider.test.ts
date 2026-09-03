import { describe, expect, it } from "vitest";
import { createLiveKitMediaProvider } from "#infrastructure/livekit.js";

describe("media provider", () => {
  it("returns 503 when LiveKit API key is absent", async () => {
    const provider = createLiveKitMediaProvider(undefined);
    const result = await provider.bind({
      sessionId: "session_test_01",
      contentId: "cnt_01",
      observer: "obs_01"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.error).toBe("media_provider_not_configured");
    }
  });
});
