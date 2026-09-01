import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { makeBrowserPageCaptureAdapter } from "#pipeline/capture/browser/index.js";

const noopAsync = async (): Promise<void> => {};

describe("browser page target inspection", () => {
  it("maps evaluate results into numbered viewport targets", async () => {
    const page = {
      goto: vi.fn().mockImplementation(noopAsync),
      setViewportSize: vi.fn().mockImplementation(noopAsync),
      screenshot: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      close: vi.fn().mockImplementation(noopAsync),
      evaluate: vi.fn().mockResolvedValue([
        {
          kind: "video",
          label: "Main video",
          rect: { x: 0, y: 84, width: 1280, height: 720 },
          score: 500
        }
      ])
    };
    const adapter = makeBrowserPageCaptureAdapter(page, {
      kind: "playwright",
      closePage: true
    });

    const targets = await Effect.runPromise(
      Effect.gen(function* () {
        const capturePage = yield* adapter.openPage({
          url: "https://example.com/player",
          viewport: { width: 1280, height: 720 }
        });

        if (capturePage.inspectTargets === undefined) {
          return [];
        }

        return yield* capturePage.inspectTargets();
      })
    );

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(targets).toEqual([
      {
        id: "video:0",
        number: 1,
        kind: "video",
        label: "Main video",
        rect: { x: 0, y: 84, width: 1280, height: 636 },
        confidence: expect.any(Number)
      }
    ]);
  });
});
