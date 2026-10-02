import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createExecutionOwner } from "#run/control/bus/execution.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { systemPausePauseScope, systemRunStopScope } from "#run/control/index.js";
import {
  readObservationIndex,
  systemConfigCloseScope,
  systemConfigRemoveScope
} from "#run/control/system/config.js";
import type { ControlBus } from "#run/control/bus/index.js";
import { applyWorkerSnapshotToBoard } from "#run/control/board/index.js";
import { systemConfigConfigureScope } from "#run/control/index.js";
import { observationCellId } from "#run/control/system/config.js";

/**
 * B-F02-02 execution ownership: per-observation admission leases, generation-fenced writes,
 * and lifetime-bound wake fan-out. One observation's lifecycle never leaks into another's.
 */

const RUN = "run_execution";
const makeBus = () =>
  createControlBus({
    runId: RUN,
    board: createInitialBoard({ runId: RUN, nowMs: 1 }),
    catalog: buildControlCatalog(),
    surfaces: createObserveControlSurfaces({})
  });

describe("execution owner", () => {
  it("reserves, reports active/current, and retires on matching release", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const execution = yield* createExecutionOwner();
        const key = `${RUN}#a`;

        expect(yield* execution.isActive(key)).toBe(false);
        const token = yield* execution.reserve(key);
        expect(yield* execution.isActive(key)).toBe(true);
        expect(yield* execution.isCurrent(key, token)).toBe(true);

        yield* execution.release(key, token);
        expect(yield* execution.isActive(key)).toBe(false);
        expect(yield* execution.isCurrent(key, token)).toBe(false);
      })
    );
  });

  it("refuses a second reserve while active, then advances the generation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const execution = yield* createExecutionOwner();
        const key = `${RUN}#a`;

        const first = yield* execution.reserve(key);
        const refused = yield* Effect.exit(execution.reserve(key));
        expect(Exit.isFailure(refused)).toBe(true);
        if (Exit.isFailure(refused)) {
          expect(refused.cause.toString()).toContain("already has an active execution");
        }

        yield* execution.release(key, first);
        const second = yield* execution.reserve(key);
        expect(second).not.toBe(first);
        expect(yield* execution.isCurrent(key, first)).toBe(false);
        expect(yield* execution.isCurrent(key, second)).toBe(true);
      })
    );
  });

  it("ignores a stale release so old-handle cleanup cannot retire a successor", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const execution = yield* createExecutionOwner();
        const key = `${RUN}#a`;

        const first = yield* execution.reserve(key);
        yield* execution.release(key, first);
        const second = yield* execution.reserve(key);

        // Late cleanup from the first generation arrives now — must be a silent no-op.
        yield* execution.release(key, first);
        expect(yield* execution.isActive(key)).toBe(true);
        expect(yield* execution.isCurrent(key, second)).toBe(true);
      })
    );
  });

  it("tracks observations independently", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const execution = yield* createExecutionOwner();
        const tokenA = yield* execution.reserve(`${RUN}#a`);
        const tokenB = yield* execution.reserve(`${RUN}#b`);

        expect(yield* execution.isActive(`${RUN}#a`)).toBe(true);
        expect(yield* execution.isActive(`${RUN}#b`)).toBe(true);

        yield* execution.release(`${RUN}#a`, tokenA);
        expect(yield* execution.isActive(`${RUN}#a`)).toBe(false);
        expect(yield* execution.isActive(`${RUN}#b`)).toBe(true);
        expect(yield* execution.isCurrent(`${RUN}#b`, tokenB)).toBe(true);
      })
    );
  });
});

describe("generation-fenced board writes", () => {
  it("commits with a current lease and rejects a stale one", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const key = `${RUN}#a`;

        const token = yield* bus.execution.reserve(key);
        const committed = yield* bus.commitGuardedUpdate(
          { kind: "owner", lease: { obsKey: key, token } },
          { kind: "lifecycle", obsId: "a" },
          (current) => Effect.succeed({ ...current })
        );
        expect(committed.revision).toBeGreaterThan(0);

        yield* bus.execution.release(key, token);
        const stale = yield* Effect.exit(
          bus.commitGuardedUpdate(
            { kind: "owner", lease: { obsKey: key, token } },
            { kind: "lifecycle", obsId: "a" },
            (current) => Effect.succeed({ ...current })
          )
        );
        expect(Exit.isFailure(stale)).toBe(true);
        if (Exit.isFailure(stale)) {
          expect(stale.cause.toString()).toContain("Stale owner write");
        }
      })
    );
  });

  it("preserves both sibling snapshots derived from the same base revision", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const ids = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        );
        const a = ids[0]!;
        const obsB = ids[1]!;
        const keyA = `${RUN}#${a}`;
        const keyB = `${RUN}#${obsB}`;
        const tokenA = yield* bus.execution.reserve(keyA);
        const tokenB = yield* bus.execution.reserve(keyB);

        // Two worker snapshots projected from the CURRENT board inside the guard (the old
        // whole-board race derived both from one stale base and dropped the second).
        const snapshotFor = (frameCount: number) => ({
          runId: RUN,
          lifecycle: "running" as const,
          controlRevision: 1,
          trackDepths: {},
          capture: {
            descriptorId: "file",
            sourceType: "file" as const,
            exhausted: false,
            eosAppended: false,
            health: {
              stage: "capture" as const,
              descriptorId: "file",
              status: "running" as const,
              updatedAtMs: 7,
              sourceId: "capture:file",
              frameCount,
              droppedFrames: 0
            }
          },
          sinks: {}
        });
        yield* bus.commitGuardedUpdate(
          { kind: "owner", lease: { obsKey: keyA, token: tokenA } },
          { kind: "snapshot", obsId: a },
          (current) => Effect.succeed(applyWorkerSnapshotToBoard(current, snapshotFor(3), a))
        );
        yield* bus.commitGuardedUpdate(
          { kind: "owner", lease: { obsKey: keyB, token: tokenB } },
          { kind: "snapshot", obsId: obsB },
          (current) => Effect.succeed(applyWorkerSnapshotToBoard(current, snapshotFor(9), obsB))
        );
        const final = yield* bus.readBoard();
        // Both families' capture facts survived on their owners — neither write dropped.
        expect(final.cells[observationCellId(a, "capture")]?.readonly).toMatchObject({
          sourceType: "file"
        });
        expect(
          (final.cells[observationCellId(a, "capture")]?.readonly as { health?: { frameCount?: number } })
            ?.health
        ).toMatchObject({ frameCount: 3 });
        expect(
          (final.cells[observationCellId(obsB, "capture")]?.readonly as { health?: { frameCount?: number } })
            ?.health
        ).toMatchObject({ frameCount: 9 });
        yield* bus.execution.release(keyA, tokenA);
        yield* bus.execution.release(keyB, tokenB);
      })
    );
  });
});

describe("lifetime-bound wake fan-out", () => {
  it("notifies every subscriber; unsubscribing one leaves the other", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        let first = 0;
        let second = 0;
        const firstSub = yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            first += 1;
          })
        );
        yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            second += 1;
          })
        );

        const board = yield* bus.readBoard();
        yield* bus.commitBoard({ ...board, revision: board.revision + 1 });
        expect(first).toBe(1);
        expect(second).toBe(1);

        yield* firstSub.unsubscribe();
        const later = yield* bus.readBoard();
        yield* bus.commitBoard({ ...later, revision: later.revision + 1 });
        expect(first).toBe(1);
        expect(second).toBe(2);
      })
    );
  });

  it("contains a failing subscriber so peers still fire and the notifier survives", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        let peer = 0;
        yield* bus.registerWakeWorker(() => Effect.fail(new LiveStreakConfigError({ message: "boom" })));
        yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            peer += 1;
          })
        );

        const current = yield* bus.readBoard();
        yield* bus.commitBoard({ ...current, revision: current.revision + 1 });
        return peer;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(1);
    }
  });

  it("starting a second worker never silences the first (no replacement)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        let first = 0;
        let second = 0;
        yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            first += 1;
          })
        );
        yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            second += 1;
          })
        );

        const current = yield* bus.readBoard();
        yield* bus.commitBoard({ ...current, revision: current.revision + 1 });
        expect(first).toBe(1);
        expect(second).toBe(1);
      })
    );
  });
});

const addObservation = (bus: {
  callFunction: (envelope: {
    callId: string;
    runId: string;
    scope: string;
    payload?: unknown;
  }) => Effect.Effect<unknown, unknown>;
}) =>
  bus.callFunction({
    callId: `add-${RUN}-${Math.random().toString(36).slice(2)}`,
    runId: RUN,
    scope: systemConfigConfigureScope,
    payload: { title: "exec show", chain: "eip155:31337" }
  });

describe("mutation admission during execution", () => {

  it("refuses configure on an executing observation's capture cell", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;

        const key = `${RUN}#${obsId}`;
        const token = yield* bus.execution.reserve(key);
        try {
          const refused = yield* Effect.exit(
            bus.callFunction({
              callId: "cap-exec",
              runId: RUN,
              cellId: observationCellId(obsId, "capture"),
              scope: "capture:file:configure",
              payload: { path: "/tmp/other.mp4" }
            })
          );
          expect(Exit.isFailure(refused)).toBe(true);
          if (Exit.isFailure(refused)) {
            expect(refused.cause.toString()).toContain("already has an active execution");
          }
        } finally {
          yield* bus.execution.release(key, token);
        }

        // Retired execution configures fine — admission was the only blocker.
        const afterRelease = yield* Effect.exit(
          bus.callFunction({
            callId: "cap-after",
            runId: RUN,
            cellId: observationCellId(obsId, "capture"),
            scope: "capture:file:configure",
            payload: { path: "/tmp/other.mp4" }
          })
        );
        expect(Exit.isSuccess(afterRelease)).toBe(true);
      })
    );
  });

  it("still allows pause and reads on an executing observation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;

        const key = `${RUN}#${obsId}`;
        const token = yield* bus.execution.reserve(key);
        try {
          const paused = yield* Effect.exit(
            bus.callFunction({
              callId: `pause-${RUN}`,
              runId: RUN,
              cellId: observationCellId(obsId, "pause"),
              scope: systemPausePauseScope,
              payload: {}
            })
          );
          expect(Exit.isSuccess(paused)).toBe(true);
        } finally {
          yield* bus.execution.release(key, token);
        }
      })
    );
  });

  it("rejects a configure addressed at a mismatched catalog cell", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;

        // The family capture cell serves capture:file — an ingest configure must not land there.
        const refused = yield* Effect.exit(
          bus.callFunction({
            callId: "cap-cross",
            runId: RUN,
            cellId: observationCellId(obsId, "capture"),
            scope: "capture:ingest:configure",
            payload: { port: 4999 }
          })
        );
        expect(Exit.isFailure(refused)).toBe(true);
        if (Exit.isFailure(refused)) {
          expect(refused.cause.toString()).toContain("switch the cell kind");
        }
      })
    );
  });
});

describe("atomic acquisition", () => {
  it("two simultaneous reserve contenders yield exactly one winner", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const key = `${RUN}#race`;
        const exits = yield* Effect.all(
          [Effect.exit(bus.execution.reserve(key)), Effect.exit(bus.execution.reserve(key))],
          { concurrency: 2 }
        );
        // Atomic check-and-set: no scheduler interleaving can mint two tokens.
        expect(exits.filter((exit) => Exit.isSuccess(exit)).length).toBe(1);
        expect(exits.filter((exit) => Exit.isFailure(exit)).length).toBe(1);
      })
    );
  });

  it("preparing claims block configuration and session close, then release cleanly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        const key = `${RUN}#${obsId}`;

        const token = yield* bus.execution.claimPrepare(key);
        expect(yield* bus.execution.isActive(key)).toBe(true);
        expect(yield* bus.execution.anyOwned()).toBe(true);

        // Same-family configure is refused while preparing (names the phase).
        const refused = yield* Effect.exit(
          bus.callFunction({
            callId: "cap-prep",
            runId: RUN,
            cellId: observationCellId(obsId, "capture"),
            scope: "capture:file:configure",
            payload: { path: "/tmp/x.mp4" }
          })
        );
        expect(Exit.isFailure(refused)).toBe(true);
        if (Exit.isFailure(refused)) {
          expect(refused.cause.toString()).toContain("already preparing");
        }

        // Session close sees the protected phase and refuses.
        const closeRefused = yield* Effect.exit(
          bus.callFunction({ callId: "close-prep", runId: RUN, scope: systemConfigCloseScope })
        );
        expect(Exit.isFailure(closeRefused)).toBe(true);

        yield* bus.execution.release(key, token);
        expect(yield* bus.execution.anyOwned()).toBe(false);
      })
    );
  });

  it("an admitted ticket goes stale when any reserve/retire happens before commit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const key = `${RUN}#ticket`;
        const entry = yield* bus.execution.readEntry(key);
        // Rival acquisition + retirement (even back to inactive) advances the generation.
        const rival = yield* bus.execution.reserve(key);
        yield* bus.execution.release(key, rival);
        const stale = yield* Effect.exit(
          bus.commitGuardedUpdate(
            { kind: "ticket", ticket: { obsKey: key, token: entry.token } },
            { kind: "lifecycle" },
            (current) => Effect.succeed({ ...current })
          )
        );
        expect(Exit.isFailure(stale)).toBe(true);
      })
    );
  });
});

describe("validated dispatch binding", () => {
  it("denies a call on a cell with an explicitly empty function list", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* bus.applyBoardPatch({
          cells: {
            "capture:file": {
              create: {
                label: "File",
                catalog: "capture:file",
                status: ["idle", null, 1],
                settings: {},
                readonly: {},
                functions: []
              }
            }
          }
        });
        const denied = yield* Effect.exit(
          bus.callFunction({
            callId: "cap-empty",
            runId: RUN,
            cellId: "capture:file",
            scope: "capture:file:configure",
            payload: { path: "/tmp/x.mp4" }
          })
        );
        expect(Exit.isFailure(denied)).toBe(true);
        if (Exit.isFailure(denied)) {
          expect(denied.cause.toString()).toContain("does not advertise function");
        }
      })
    );
  });

  it("fails closed on unknown explicit cells and unknown target catalogs", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const unknownCell = yield* Effect.exit(
          bus.callFunction({
            callId: "stop-ghost",
            runId: RUN,
            cellId: "obs:nope:run",
            scope: systemRunStopScope,
            payload: {}
          })
        );
        expect(Exit.isFailure(unknownCell)).toBe(true);
        const unknownScope = yield* Effect.exit(
          bus.callFunction({ callId: "bogus", runId: RUN, scope: "capture:nope:configure" })
        );
        expect(Exit.isFailure(unknownScope)).toBe(true);
      })
    );
  });

  it("rejects a surface result patch that configures another family", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const ids = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        );
        const [a, b] = [ids[0]!, ids[1]!];
        // A rogue file-configure implementation serving the canonical cell but patching B.
        yield* bus.mountSurface({
          cell: {
            id: "capture:file",
            cell: {
              label: "File",
              catalog: "capture:file",
              status: ["idle", null, 1],
              settings: {},
              readonly: {},
              functions: ["configure", "close"]
            }
          },
          functions: [
            {
              name: "configure",
              scope: "capture:file:configure",
              call: () =>
                Effect.succeed({
                  boardPatch: {
                    cells: {
                      [observationCellId(b, "capture")]: {
                        settings: { set: { path: "/tmp/evil.mp4" } }
                      }
                    }
                  }
                })
            }
          ]
        });
        const rejected = yield* Effect.exit(
          bus.callFunction({
            callId: "cap-cross",
            runId: RUN,
            cellId: observationCellId(a, "capture"),
            scope: "capture:file:configure",
            payload: { path: "/tmp/a.mp4" }
          })
        );
        expect(Exit.isFailure(rejected)).toBe(true);
        if (Exit.isFailure(rejected)) {
          expect(rejected.cause.toString()).toContain("writes foreign cell");
        }
        // B's cell is untouched.
        expect(
          (yield* bus.readBoard()).cells[observationCellId(b, "capture")]?.settings
        ).toMatchObject({});
      })
    );
  });

  it("rejects a configure admitted before a rival acquisition commits after it", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        const gate = yield* Deferred.make<void>();
        // A slow pause implementation: admitted on a ticket, gated mid-flight.
        const pauseCell = (yield* bus.readBoard()).cells[observationCellId(obsId, "pause")]!;
        yield* bus.mountSurface({
          cell: { id: "system:pause", cell: { ...pauseCell, functions: ["pause", "resume"] } },
          functions: [
            {
              name: "pause",
              scope: systemPausePauseScope,
              call: (_envelope, context) =>
                Effect.gen(function* () {
                  yield* Deferred.await(gate);
                  return {
                    boardPatch: {
                      cells: {
                        [context.cellId]: { settings: { set: { requested: true } } }
                      }
                    }
                  };
                })
            }
          ]
        });
        const fiber = yield* Effect.fork(
          bus.callFunction({
            callId: "pause-slow",
            runId: RUN,
            cellId: observationCellId(obsId, "pause"),
            scope: systemPausePauseScope,
            payload: {}
          })
        );
        yield* Effect.yieldNow();
        // Rival acquisition + retirement while the admitted call is in flight.
        const rival = yield* bus.execution.reserve(`${RUN}#${obsId}`);
        yield* bus.execution.release(`${RUN}#${obsId}`, rival);
        yield* Deferred.succeed(gate, void 0);
        const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(String(exit.cause)).toContain("Stale owner write");
        }
      })
    );
  });
});

describe("session operations", () => {
  it("concurrent adds both land with siblings preserved", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const add = (title: string) =>
          bus.callFunction({
            callId: `add-${title}`,
            runId: RUN,
            scope: systemConfigConfigureScope,
            payload: { title, chain: "eip155:31337" }
          });
        const exits = yield* Effect.all([Effect.exit(add("one")), Effect.exit(add("two"))], {
          concurrency: 2
        });
        expect(exits.every((exit) => Exit.isSuccess(exit))).toBe(true);
        const index = readObservationIndex(yield* bus.readBoard());
        expect(Object.keys(index).length).toBe(2);
      })
    );
  });

  it("remove during execution is refused; session close refuses while owned", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        const key = `${RUN}#${obsId}`;
        const token = yield* bus.execution.reserve(key);
        try {
          const removeRefused = yield* Effect.exit(
            bus.callFunction({
              callId: "rm-exec",
              runId: RUN,
              scope: systemConfigRemoveScope,
              payload: { obsId }
            })
          );
          expect(Exit.isFailure(removeRefused)).toBe(true);
          const closeRefused = yield* Effect.exit(
            bus.callFunction({ callId: "close-exec", runId: RUN, scope: systemConfigCloseScope })
          );
          expect(Exit.isFailure(closeRefused)).toBe(true);
          if (Exit.isFailure(closeRefused)) {
            expect(closeRefused.cause.toString()).toContain("protected phase");
          }
        } finally {
          yield* bus.execution.release(key, token);
        }
        // Free session closes cleanly.
        const closed = yield* Effect.exit(
          bus.callFunction({ callId: "close-free", runId: RUN, scope: systemConfigCloseScope })
        );
        expect(Exit.isSuccess(closed)).toBe(true);
      })
    );
  });
});

describe("market lifecycle fencing (no chain)", () => {
  const registeredBoard = (bus: ControlBus) =>
    Effect.gen(function* () {
      yield* addObservation(bus);
      const board = yield* bus.readBoard();
      const obsId = Object.keys(
        (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
      )[0]!;
      yield* bus.applyBoardPatch({
        cells: {
          [observationCellId(obsId, "market")]: {
            readonly: { set: { marketId: "0xmarket", registrationState: "registered" } }
          }
        }
      });
      return obsId;
    });

  it("rejects an explicit foreign payload marketId before any registrar call", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const obsId = yield* registeredBoard(bus);
        const rejected = yield* Effect.exit(
          bus.callFunction({
            callId: "golive-foreign",
            runId: RUN,
            cellId: observationCellId(obsId, "market"),
            scope: "market:goLive",
            payload: { marketId: "0xforeign" }
          })
        );
        expect(Exit.isFailure(rejected)).toBe(true);
        if (Exit.isFailure(rejected)) {
          expect(rejected.cause.toString()).toContain("does not match registered");
        }
      })
    );
  });

  it("rejects a delayed goLive commit over an ended market without invoking the chain", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const obsId = yield* registeredBoard(bus);
        const target = observationCellId(obsId, "market");
        // Drive the cell to ended through the guarded path shape (no chain involved).
        yield* bus.applyBoardPatch({
          cells: { [target]: { status: ["ended", "settled", 2] } }
        });
        const token = yield* bus.execution.reserve(`${RUN}#${obsId}`);
        try {
          const rejected = yield* Effect.exit(
            bus.commitGuardedUpdate(
              { kind: "ticket", ticket: { obsKey: `${RUN}#${obsId}`, token } },
              {
                kind: "call",
                scope: "market:goLive",
                targetCell: target,
                obsId,
                patchCellIds: [target],
                payload: {}
              },
              (current) =>
                Effect.succeed({
                  ...current,
                  cells: {
                    ...current.cells,
                    [target]: {
                      ...current.cells[target]!,
                      status: ["live", "go-live", 3] as [string, string | null, number],
                      readonly: {
                        ...current.cells[target]?.readonly,
                        marketId: "0xmarket"
                      }
                    }
                  }
                })
            )
          );
          expect(Exit.isFailure(rejected)).toBe(true);
          if (Exit.isFailure(rejected)) {
            expect(rejected.cause.toString()).toContain("back to live");
          }
        } finally {
          yield* bus.execution.release(`${RUN}#${obsId}`, token);
        }
      })
    );
  });
});

describe("wake isolation and registration identity", () => {
  it("contains a synchronous throw so peers still fire", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        let peer = 0;
        yield* bus.registerWakeWorker(() => {
          throw new Error("sync boom");
        });
        yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            peer += 1;
          })
        );
        const current = yield* bus.readBoard();
        yield* bus.commitBoard({ ...current, revision: current.revision + 1 });
        return peer;
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toBe(1);
    }
  });

  it("unsubscribing one duplicate-callback receipt leaves the other", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        let calls = 0;
        const callback = () =>
          Effect.sync(() => {
            calls += 1;
          });
        const first = yield* bus.registerWakeWorker(callback);
        yield* bus.registerWakeWorker(callback);
        yield* first.unsubscribe();
        const current = yield* bus.readBoard();
        yield* bus.commitBoard({ ...current, revision: current.revision + 1 });
        expect(calls).toBe(1);
      })
    );
  });
});

describe("session structural exactness", () => {
  // Mount a rogue system:config surface returning a caller-supplied patch.
  const mountRogueSessionSurface = (
    bus: ControlBus,
    scope: string,
    name: string,
    patch: Record<string, unknown>
  ) =>
    bus.mountSurface({
      cell: {
        id: "system:config",
        cell: {
          label: "Session",
          catalog: "system:config",
          status: ["idle", null, 1],
          settings: {},
          readonly: {},
          functions: [name]
        }
      },
      functions: [
        {
          name,
          scope,
          call: () => Effect.succeed({ boardPatch: patch })
        }
      ]
    });

  const freshSessionBus = () =>
    Effect.gen(function* () {
      const bus = yield* makeBus();
      yield* addObservation(bus);
      return bus;
    });

  it("rejects a partial birth with no board/index mutation and no orphan owner", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        const before = yield* bus.readBoard();
        const indexBefore = Object.keys(readObservationIndex(before));
        // Only a run cell plus an index entry: not a family.
        yield* mountRogueSessionSurface(bus, systemConfigConfigureScope, "configure", {
          cells: {
            "system:config": {
              readonly: { set: { observations: { rogue: { title: "R", chain: "c", createdAtMs: 1 } } } },
              status: ["configured", null, 1]
            },
            "obs:rogue:run": {
              create: {
                label: "Run",
                catalog: "system:run",
                status: ["created", null, 1],
                settings: {},
                readonly: {},
                functions: ["prepare", "start", "await", "stop"]
              }
            }
          }
        });
        const rejected = yield* Effect.exit(
          bus.callFunction({
            callId: "add-partial",
            runId: RUN,
            scope: systemConfigConfigureScope,
            payload: { title: "R", chain: "c" }
          })
        );
        expect(Exit.isFailure(rejected)).toBe(true);
        const after = yield* bus.readBoard();
        expect(Object.keys(readObservationIndex(after))).toEqual(indexBefore);
        expect(after.cells["obs:rogue:run"]).toBe(undefined);
        expect(yield* bus.execution.anyOwned()).toBe(false);
      })
    );
  });

  it("rejects malformed births with no mutation, leak, or claim", async () => {
    const fixedTs = 1700000000000;
    const rogueId = "rogue-birth";
    const validPatch = () => ({
      cells: {
        "system:config": {
          readonly: {
            set: {
              observations: {
                [rogueId]: { title: "Real", chain: "c", createdAtMs: fixedTs }
              }
            }
          },
          status: ["configured", null, fixedTs]
        },
        [`obs:${rogueId}:run`]: {
          create: {
            label: "Run",
            catalog: "system:run",
            status: ["created", null, fixedTs],
            settings: { stopRequested: false },
            readonly: { runId: RUN, obsId: rogueId, prepared: false },
            functions: ["prepare", "start", "await", "stop"]
          }
        },
        [`obs:${rogueId}:pause`]: {
          create: {
            label: "Pause",
            catalog: "system:pause",
            status: ["idle", null, fixedTs],
            settings: { requested: false, whilePaused: "hold" },
            readonly: { obsId: rogueId },
            functions: ["pause", "resume", "setPresentation"]
          }
        },
        [`obs:${rogueId}:market`]: {
          create: {
            label: "Market",
            catalog: "market",
            status: ["none", null, fixedTs],
            readonly: {
              registrationState: "none",
              obsId: rogueId,
              title: "Real",
              chain: "c"
            },
            functions: ["register", "goLive", "setEnded", "close"]
          }
        },
        [`obs:${rogueId}:capture`]: {
          create: {
            label: "Capture",
            catalog: "capture:file",
            status: ["idle", null, fixedTs],
            settings: { maxPumpMs: 4 },
            readonly: {
              obsId: rogueId,
              kind: "file",
              sourceType: "file",
              sourceMode: "file",
              configured: false
            },
            functions: ["configure", "close"]
          }
        },
        [`obs:${rogueId}:publish`]: {
          create: {
            label: "Publish",
            catalog: "sink:live",
            status: ["idle", null, fixedTs],
            settings: { subscribe: ["publish.video.rendered"], required: true },
            readonly: { obsId: rogueId, kind: "live", configured: false },
            functions: ["configure", "close"]
          }
        }
      }
    });
    const cellOf = (patch: ReturnType<typeof validPatch>, id: string) =>
      (
        (patch.cells as unknown as Record<string, { create: Record<string, unknown> }>)[id]!
          .create
      );
    const cases: { name: string; mutate: (patch: ReturnType<typeof validPatch>) => void }[] = [
      { name: "title mismatch", mutate: (p) => {
        ((p.cells["system:config"] as { readonly: { set: { observations: Record<string, Record<string, unknown>> } } }).readonly.set.observations[rogueId]!).title = "Other";
      } },
      { name: "prepared run", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:run`).readonly as Record<string, unknown>).prepared = true;
      } },
      { name: "configured capture", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:capture`).readonly as Record<string, unknown>).configured = true;
      } },
      { name: "planted marketId", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:market`).readonly as Record<string, unknown>).marketId = "0xplanted";
      } },
      { name: "changed pause default", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:pause`).settings as Record<string, unknown>).requested = true;
      } },
      { name: "extra capture setting", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:capture`).settings as Record<string, unknown>).path = "/tmp/evil.mp4";
      } },
      { name: "extra readonly key", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:publish`).readonly as Record<string, unknown>).transport = "x";
      } },
      { name: "refs added", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:run`) as Record<string, unknown>).refs = {};
      } },
      { name: "extra function", mutate: (p) => {
        (cellOf(p, `obs:${rogueId}:capture`).functions as string[]).push("goLive");
      } },
      { name: "bad timestamp", mutate: (p) => {
        ((p.cells["system:config"] as { readonly: { set: { observations: Record<string, Record<string, unknown>> } } }).readonly.set.observations[rogueId]!).createdAtMs = Number.NaN;
      } },
      { name: "machine overwrite", mutate: (p) => {
        (p.cells as Record<string, unknown>)["system:memory"] = {
          create: {
            label: "Memory",
            catalog: "system:memory",
            status: ["idle", null, fixedTs],
            readonly: {},
            functions: ["configure"]
          }
        };
      } },
      { name: "extra session field", mutate: (p) => {
        const config = p.cells["system:config"] as unknown as Record<string, unknown>;
        config.settings = { ...(config.settings as Record<string, unknown> | undefined), hacked: true };
      } }
    ];
    for (const { name, mutate } of cases) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const bus = yield* makeBus();
          const patch = JSON.parse(JSON.stringify(validPatch()));
          mutate(patch);
          yield* mountRogueSessionSurface(bus, systemConfigConfigureScope, "configure", patch);
          const rejected = yield* Effect.exit(
            bus.callFunction({
              callId: `add-${name}`,
              runId: RUN,
              scope: systemConfigConfigureScope,
              payload: { title: "Real", chain: "c" }
            })
          );
          expect(Exit.isFailure(rejected), name).toBe(true);
          const after = yield* bus.readBoard();
          expect(Object.keys(readObservationIndex(after)).length, name).toBe(0);
          expect(after.cells[`obs:${rogueId}:run`], name).toBe(undefined);
          expect(yield* bus.execution.anyOwned(), name).toBe(false);
        })
      );
    }
  });

  it("rejects partial remove and close that spares a cell", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* freshSessionBus();
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        // Remove missing one family cell.
        const cells: Record<string, { remove: boolean }> = {};
        for (const kind of ["run", "pause", "capture", "publish"] as const) {
          cells[observationCellId(obsId, kind)] = { remove: true };
        }
        yield* mountRogueSessionSurface(bus, systemConfigRemoveScope, "remove", {
          cells: {
            ...cells,
            "system:config": {
              readonly: { set: { observations: {} } },
              status: ["idle", null, 1]
            }
          }
        });
        const removeRejected = yield* Effect.exit(
          bus.callFunction({
            callId: "rm-partial",
            runId: RUN,
            scope: systemConfigRemoveScope,
            payload: { obsId }
          })
        );
        expect(Exit.isFailure(removeRejected)).toBe(true);
        // Close sparing the market cell.
        const closeCells: Record<string, { remove: boolean }> = {};
        for (const id of Object.keys((yield* bus.readBoard()).cells)) {
          if (id !== "system:config" && id !== observationCellId(obsId, "market")) {
            closeCells[id] = { remove: true };
          }
        }
        yield* mountRogueSessionSurface(bus, systemConfigCloseScope, "close", {
          cells: {
            ...closeCells,
            "system:config": {
              readonly: { unset: ["observations", "chain", "capture", "publish", "process"] },
              status: ["idle", null, 1]
            }
          }
        });
        const closeRejected = yield* Effect.exit(
          bus.callFunction({ callId: "close-spare", runId: RUN, scope: systemConfigCloseScope })
        );
        expect(Exit.isFailure(closeRejected)).toBe(true);
        // Both families and index intact after the rejections.
        const after = yield* bus.readBoard();
        expect(Object.keys(readObservationIndex(after)).length).toBe(1);
        expect(yield* bus.execution.anyOwned()).toBe(false);
      })
    );
  });
});

describe("commit-time revalidation and artifact atomicity", () => {
  it("rejects a pause admitted before its functions were emptied", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        const gate = yield* Deferred.make<void>();
        const pauseCell = (yield* bus.readBoard()).cells[observationCellId(obsId, "pause")]!;
        yield* bus.mountSurface({
          cell: { id: "system:pause", cell: { ...pauseCell, functions: ["pause", "resume"] } },
          functions: [
            {
              name: "pause",
              scope: systemPausePauseScope,
              call: (_envelope, context) =>
                Effect.gen(function* () {
                  yield* Deferred.await(gate);
                  return {
                    boardPatch: {
                      cells: {
                        [context.cellId]: { settings: { set: { requested: true } } }
                      }
                    }
                  };
                })
            }
          ]
        });
        const fiber = yield* Effect.fork(
          bus.callFunction({
            callId: "pause-slow",
            runId: RUN,
            cellId: observationCellId(obsId, "pause"),
            scope: systemPausePauseScope,
            payload: {}
          })
        );
        yield* Effect.yieldNow();
        // The TARGET family's capability emptied mid-flight: the stale result must not
        // land. (The in-flight match was resolved before the remount and still invokes.)
        yield* bus.mountSurface({
          cell: {
            id: observationCellId(obsId, "pause"),
            cell: { ...pauseCell, functions: [] as string[] }
          },
          functions: []
        });
        yield* Deferred.succeed(gate, void 0);
        const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(String(exit.cause)).toContain("does not advertise function");
        }
      })
    );
  });

  it("never stores an artifact whose generation retired mid-flight", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        const gate = yield* Deferred.make<void>();
        const pauseCell = (yield* bus.readBoard()).cells[observationCellId(obsId, "pause")]!;
        yield* bus.mountSurface({
          cell: { id: "system:pause", cell: { ...pauseCell, functions: ["pause", "resume"] } },
          functions: [
            {
              name: "pause",
              scope: systemPausePauseScope,
              call: (_envelope, context) =>
                Effect.gen(function* () {
                  yield* Deferred.await(gate);
                  return {
                    artifact: {
                      kind: "test-artifact",
                      ownerCell: context.cellId,
                      function: "pause",
                      createdAtMs: 1,
                      payload: {}
                    }
                  };
                })
            }
          ]
        });
        const fiber = yield* Effect.fork(
          bus.callFunction({
            callId: "pause-art",
            runId: RUN,
            cellId: observationCellId(obsId, "pause"),
            scope: systemPausePauseScope,
            payload: {}
          })
        );
        yield* Effect.yieldNow();
        const rival = yield* bus.execution.reserve(`${RUN}#${obsId}`);
        yield* bus.execution.release(`${RUN}#${obsId}`, rival);
        yield* Deferred.succeed(gate, void 0);
        const exit = yield* Fiber.join(fiber).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* bus.getArtifact("nope")).toBe(undefined);
      })
    );
  });

  it("legacy commitBoard unchanged commits notify nothing", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        let boardNotes = 0;
        let wakes = 0;
        yield* bus.subscribeBoard(() => {
          boardNotes += 1;
        });
        yield* bus.registerWakeWorker(() =>
          Effect.sync(() => {
            wakes += 1;
          })
        );
        const current = yield* bus.readBoard();
        yield* bus.commitBoard(current);
        expect(boardNotes).toBe(0);
        expect(wakes).toBe(0);
      })
    );
  });

  it("preserves streamId across a goLive-shaped commit that unsets it", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        const target = observationCellId(obsId, "market");
        yield* bus.applyBoardPatch({
          cells: {
            [target]: {
              readonly: {
                set: { marketId: "0xabc", streamId: "stream-keep", registrationState: "registered" }
              },
              status: ["registered", null, 1]
            }
          }
        });
        // Chain-free goLive surface returning the real lifecycle shape (unsets streamId).
        const marketCell = (yield* bus.readBoard()).cells[target]!;
        yield* bus.mountSurface({
          cell: { id: target, cell: { ...marketCell, functions: ["goLive"] } },
          functions: [
            {
              name: "goLive",
              scope: "market:goLive",
              call: () =>
                Effect.succeed({
                  boardPatch: {
                    cells: {
                      [target]: {
                        status: ["live", "go-live", 2] as [string, string | null, number],
                        readonly: {
                          set: { marketId: "0xabc", status: "live" },
                          unset: ["streamId", "registrationState"]
                        }
                      }
                    }
                  }
                })
            }
          ]
        });
        const result = yield* bus.callFunction({
          callId: "golive-keep",
          runId: RUN,
          cellId: target,
          scope: "market:goLive",
          payload: {}
        });
        expect(result.changed).toBe(true);
        const final = yield* bus.readBoard();
        expect(final.cells[target]?.status[0]).toBe("live");
        expect(final.cells[target]?.readonly?.streamId).toBe("stream-keep");
        expect(final.cells[target]?.readonly?.marketId).toBe("0xabc");
      })
    );
  });
});

describe("kind-switch field allowlist", () => {
  it("rejects a kind result smuggling an extra path setting", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* makeBus();
        yield* addObservation(bus);
        const board = yield* bus.readBoard();
        const obsId = Object.keys(
          (board.cells["system:config"]?.readonly?.observations ?? {}) as Record<string, unknown>
        )[0]!;
        yield* bus.mountSurface({
          cell: {
            id: "system:config",
            cell: {
              label: "Session",
              catalog: "system:config",
              status: ["idle", null, 1],
              settings: {},
              readonly: {},
              functions: ["captureKind"]
            }
          },
          functions: [
            {
              name: "captureKind",
              scope: "system:config:captureKind",
              call: () =>
                Effect.succeed({
                  boardPatch: {
                    cells: {
                      [observationCellId(obsId, "capture")]: {
                        catalog: "capture:ingest",
                        settings: {
                          set: { source: "ingest", path: "/tmp/smuggled.mp4" },
                          unset: [] as string[]
                        },
                        readonly: { set: { kind: "ingest", configured: false } },
                        status: ["idle", null, 1] as [string, null, number]
                      }
                    }
                  }
                })
            }
          ]
        });
        const rejected = yield* Effect.exit(
          bus.callFunction({
            callId: "kind-smuggle",
            runId: RUN,
            scope: "system:config:captureKind",
            payload: { obsId, kind: "ingest" }
          })
        );
        expect(Exit.isFailure(rejected)).toBe(true);
        if (Exit.isFailure(rejected)) {
          expect(String(rejected.cause)).toContain("stamp source");
        }
        expect(
          (yield* bus.readBoard()).cells[observationCellId(obsId, "capture")]?.settings
        ).toMatchObject({});
      })
    );
  });
});

it("keeps raw semaphore and ledger operations off the public bus facade", async () => {
  const bus = await Effect.runPromise(makeBus());
  for (const key of ["transact", "claimRaw", "releaseRaw", "readEntriesSnapshot"]) {
    expect(key in bus.execution).toBe(false);
  }
  const first = await Effect.runPromise(bus.execution.readEntry(RUN));
  expect(first).toEqual({token:0,phase:"inactive"});
});

it("does not let an initial-generation ticket substitute for a worker or preparation owner", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const bus=yield* makeBus();
    for (const operation of [{kind:"snapshot",obsId:"a"},{kind:"prepareMeta",obsId:"a"},{kind:"sessionRemove",obsId:"a"}] as const) {
      const result=yield* Effect.exit(bus.commitGuardedUpdate({kind:"ticket",ticket:{obsKey:`${RUN}#a`,token:0}},operation,Effect.succeed));
      expect(Exit.isFailure(result)).toBe(true);
    }
  }));
});
