import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { runConfigFromBoard } from "#run/board-run-config.js";
import type { Board } from "#run/control/board/index.js";

/**
 * P4 wiring: the console-configured board maps to the encode-once fMP4 `live` sink keyed to the market id
 * (the viewer key over the host `/live/watch/:streamId` endpoint). Proves the demo loop reaches the new
 * transport, and that missing prerequisites fail with operator-facing messages.
 */

// Family board: one observation, its cells carrying the pipeline state the config derives from.
const OBS = "obs-test";
const boardWith = (over: {
  capturePath?: string;
  publish?: string;
  marketId?: string;
}): Board =>
  ({
    revision: 1,
    catalogVersion: "0.1.0",
    cells: {
      "system:config": {
        readonly: {
          observations: { [OBS]: { title: "Test", chain: "eip155:31337", createdAtMs: 1 } }
        }
      },
      [`obs:${OBS}:capture`]: {
        settings: over.capturePath === undefined ? {} : { path: over.capturePath }
      },
      [`obs:${OBS}:publish`]: {
        readonly: over.publish === undefined ? {} : { kind: over.publish }
      },
      [`obs:${OBS}:market`]: {
        readonly: over.marketId === undefined ? {} : { marketId: over.marketId }
      }
    }
  }) as unknown as Board;

describe("runConfigFromBoard → live fMP4 sink", () => {
  it("wires the live sink + host ingest transport keyed to the market id", async () => {
    const config = await Effect.runPromise(
      runConfigFromBoard({
        runId: "run1",
        board: boardWith({ capturePath: "/tmp/clip.mp4", publish: "live", marketId: "market-xyz" }),
        hostBaseUrl: "http://127.0.0.1:8787"
      })
    );

    expect(config.sink.driverId).toBe("live");
    expect(config.sink.instanceId).toBe("live");
    const sinkConfig = config.sink.config as { streamId: string; transport: unknown };
    expect(sinkConfig.streamId).toBe("market-xyz");
    // The transport is the single ingest connection object (sendInit/sendFragment/end).
    const transport = sinkConfig.transport as Record<string, unknown>;
    expect(typeof transport.sendInit).toBe("function");
    expect(typeof transport.sendFragment).toBe("function");
    expect(typeof transport.end).toBe("function");
    // Capture decodes straight to I420 for the encode.
    expect((config.capture.config as { pixelFormat: string }).pixelFormat).toBe("yuv420p");
  });

  it("fails when the market is not registered", async () => {
    const result = await Effect.runPromise(
      runConfigFromBoard({
        runId: "run1",
        board: boardWith({ capturePath: "/tmp/clip.mp4", publish: "live" }),
        hostBaseUrl: "http://127.0.0.1:8787"
      }).pipe(
        Effect.map(() => "ok"),
        Effect.catchAll((e) => Effect.succeed(e.message))
      )
    );
    expect(result).toContain("Register a market");
  });

  it("fails when the capture file is not set", async () => {
    const result = await Effect.runPromise(
      runConfigFromBoard({
        runId: "run1",
        board: boardWith({ publish: "live", marketId: "m" }),
        hostBaseUrl: "http://127.0.0.1:8787"
      }).pipe(
        Effect.map(() => "ok"),
        Effect.catchAll((e) => Effect.succeed(e.message))
      )
    );
    expect(result).toContain("capture media file");
  });
});
