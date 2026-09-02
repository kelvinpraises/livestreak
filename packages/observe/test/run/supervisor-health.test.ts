 
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { LiveStreakRuntimeError } from "@livestreak/core";
import { projectWorkerControlView } from "#run/control/board/index.js";
import {
  defaultControlPause
} from "#run/control/board/index.js";
import { supervisorTurn } from "#run/worker/supervisor.js";
import {
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  type CaptureStageState
} from "#run/worker/state.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("supervisor capture health failure", () => {
  it("fails the worker when capture health read throws", async () => {
    const capture: CaptureStageState = {
      pull: {
        pullNext: () => {
          const emptyFrame: undefined = undefined;
          return Effect.succeed(emptyFrame);
        }
      },
      descriptor: {
        kind: "capture",
        id: "synthetic",
        version: "0.1.0",
        displayName: "Synthetic",
        capabilityScopes: ["capture:synthetic:*"],
        flags: [],
        commands: [],
        sourceType: "synthetic",
        sourceMode: "file"
      },
      readHealth: Effect.fail(
        new LiveStreakRuntimeError({
          message: "capture health read failed in test"
        })
      ),
      exhausted: false,
      eosAppended: true
    };

    const state = createEmptyWorkerState({
      runId: "run_health_failure",
      manifest: createPassthroughVideoManifest(),
      capture,
      sinks: {}
    });
    state.lifecycle = "running";

    const view = projectWorkerControlView({
      revision: 1,
      catalogVersion: "0.1.0",
      cells: {
        "system:run": {
          label: "Run",
          status: ["running", null, Date.now()],
          readonly: { runId: "run_health_failure", prepared: true },
          functions: []
        },
        "system:pause": {
          label: "Pause",
          status: ["idle", null, Date.now()],
          settings: { ...defaultControlPause },
          functions: []
        },
        "system:memory": systemMemoryBoardCell(),
        "system:tick": systemTickBoardCell(),
        "sink:file-export": {
          label: "File Export",
          status: ["idle", null, Date.now()],
          settings: {
            path: "/tmp/out.mp4",
            subscribe: ["publish.video.rendered"],
            required: true
          },
          functions: []
        }
      }
    });

    const turn = await Effect.runPromise(supervisorTurn(state, view));

    expect(turn.lifecycle).toBe("failed");
    expect(turn.shouldContinue).toBe(false);
    expect(state.lifecycle).toBe("failed");
    expect(state.error).toBe("capture health read failed in test");
  });
});
