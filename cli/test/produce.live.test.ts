import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runProduce } from "../src/commands/produce.js";

const liveEnabled = process.env["LIVESTREAK_LIVE"] === "1";
const configPath = process.env["LIVESTREAK_CONFIG"];
const videoPath = process.env["LIVESTREAK_VIDEO"];
const password = process.env["LIVESTREAK_PASSWORD"];

const canRunLive =
  liveEnabled &&
  configPath !== undefined &&
  videoPath !== undefined &&
  password !== undefined;

describe("produce live", () => {
  it.skipIf(!canRunLive)("runs file → VOD → streamState Ended", async () => {
    const title = process.env["LIVESTREAK_TITLE"] ?? "CLI live produce";

    await access(configPath!);
    await access(videoPath!);

    const result = await runProduce({
      title,
      videoPath: videoPath!,
      password: password!,
      configPath: configPath!
    });

    expect(result.marketId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.vodUrl.length).toBeGreaterThan(0);
    expect(result.goLiveTx.length).toBeGreaterThan(0);
    expect(result.setEndedTx.length).toBeGreaterThan(0);
    expect(result.streamState.status).toBe(2);
  });
});

if (liveEnabled && !canRunLive) {
  // eslint-disable-next-line no-console
  console.log(
    "NOT RUN: set LIVESTREAK_CONFIG, LIVESTREAK_VIDEO, and LIVESTREAK_PASSWORD for live produce"
  );
}

if (!liveEnabled) {
  // eslint-disable-next-line no-console
  console.log("NOT RUN: LIVESTREAK_LIVE=1 not set");
}
