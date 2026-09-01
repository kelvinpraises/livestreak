import { describe, expect, it } from "vitest";
import {
  normalizeDetectedBrowserTargets,
  parseDetectedBrowserTargetCandidates
} from "#pipeline/capture/browser/page/target-detection.js";

describe("browser target detection", () => {
  it("normalizes, numbers, and limits detected targets", () => {
    const candidates = parseDetectedBrowserTargetCandidates([
      {
        kind: "element",
        label: "Sidebar",
        rect: { x: 0, y: 0, width: 100, height: 100 },
        score: 120
      },
      {
        kind: "video",
        label: "Main video",
        rect: { x: 0, y: 80, width: 1280, height: 720 },
        score: 450
      },
      {
        kind: "canvas",
        rect: { x: 10, y: 10, width: 640, height: 360 },
        score: 320
      }
    ]);

    const targets = normalizeDetectedBrowserTargets(candidates, { width: 1280, height: 720 });

    expect(targets).toHaveLength(3);
    expect(targets[0]?.kind).toBe("video");
    expect(targets[0]?.number).toBe(1);
    expect(targets[0]?.id).toBe("video:0");
    expect(targets[1]?.kind).toBe("canvas");
    expect(targets[1]?.number).toBe(2);
    expect(targets[1]?.label).toBe("canvas 1");
    expect(targets[2]?.kind).toBe("element");
  });
});
