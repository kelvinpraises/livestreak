// The worker's sink policies come from STAGE cells (id `sink:<kind>`, kernel-mounted at attach)
// and NEVER from family publish cells (`obs:<id>:publish`) — those share the sink catalog but are
// configuration, consumed by prepare's run-config derivation. Matching family cells by catalog
// sliced `obs:<uuid>:publish` into a garbage sinkId and killed worker prepare with
// "unknown sink <uuid-minus-one-char>:publish" (found live 2026-07-22).
import { describe, expect, it } from "vitest";
import { projectWorkerControlView } from "#run/control/board/worker-view.js";
import type { Board } from "#run/control/board/model.js";

const OBS = "a7fc0d82-6f91-42ff-8d78-399fec60613e";

const board: Board = {
  revision: 9,
  catalogVersion: "0.1.0",
  cells: {
    "system:config": {
      label: "Session",
      catalog: "system:config",
      status: ["configured", null, 1],
      settings: {},
      readonly: { runId: "run-1" },
      functions: ["configure"]
    },
    // The observation's CONFIG cell: configured, carries the sink catalog + subscribe — the
    // exact shape that used to be mis-projected into a policy.
    [`obs:${OBS}:publish`]: {
      label: "Publish",
      catalog: "sink:live",
      status: ["configured", null, 1],
      settings: { subscribe: ["publish.video.rendered"], required: true },
      readonly: { obsId: OBS, kind: "live", configured: true },
      functions: ["configure", "close"]
    },
    [`obs:${OBS}:run`]: {
      label: "Run",
      catalog: "system:run",
      status: ["starting", null, 1],
      settings: {},
      readonly: { runId: "run-1", obsId: OBS },
      functions: ["prepare", "start"]
    },
    // The STAGE cell the kernel mounts at attach (and marks configured) — the worker's actual sink.
    "sink:live": {
      label: "Live Stream",
      catalog: "sink:live",
      status: ["configured", null, 1],
      settings: { subscribe: ["publish.video.rendered"], required: true },
      readonly: { configured: true },
      functions: ["configure", "close"]
    }
  }
};

describe("projectWorkerControlView sink policies", () => {
  it("projects stage sink cells only — a configured family publish cell adds NO policy", () => {
    const view = projectWorkerControlView(board, OBS);
    expect(view.sinks.map((s) => s.sinkId)).toEqual(["live"]);
    expect(view.sinks[0]).toMatchObject({
      kind: "live",
      subscribe: ["publish.video.rendered"],
      required: true
    });
  });
});
