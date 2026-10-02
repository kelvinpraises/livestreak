import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Fiber, Option, Queue, Ref, Scope, Stream, Deferred } from "effect";
import { createWorkerBoardWake } from "#run/worker/wake.js";
import { createCaptureFramePull } from "#run/worker/capture-pull.js";

// Test-only deterministic interruption barrier (adapted from the review probes): wraps
// Ref.modify so the test can force an interruption exactly after registration publishes and
// before cleanup ownership installs. Production code carries no test knobs.
const barrierHook = vi.hoisted(() => ({
  armed: false,
  entered: undefined as Deferred.Deferred<void, never> | undefined,
  release: undefined as Deferred.Deferred<void, never> | undefined
}));
vi.mock("effect", async (original) => {
  const actual = await original<typeof import("effect")>();
  return {
    ...actual,
    Ref: {
      ...actual.Ref,
      modify: (ref: never, fn: never) =>
        (actual.Ref.modify(ref as never, fn as never) as Effect.Effect<unknown>).pipe(
          actual.Effect.tap(() => {
            if (!barrierHook.armed) return actual.Effect.void;
            barrierHook.armed = false;
            return actual.Deferred.succeed(barrierHook.entered!, undefined).pipe(
              actual.Effect.zipRight(actual.Deferred.await(barrierHook.release!))
            );
          })
        )
    }
  };
});

describe("worker board wake", () => {
  it("a wait interrupted mid-park does not swallow the next notify (M2-01)", async () => {
    const recovered = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const waiter = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        yield* Fiber.interrupt(waiter);
        yield* wake.notify();
        // Bounded second wait: must observe the post-interrupt notify, not hang.
        const second = yield* Effect.fork(wake.waitForWake());
        const done = yield* Fiber.join(second).pipe(
          Effect.as(true),
          Effect.timeoutOption(30),
          Effect.map(Option.isSome)
        );
        return done;
      })
    );

    expect(recovered).toBe(true);
  });

  it("early notifies coalesce and release a later wait", async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        yield* wake.notify();
        yield* wake.notify();
        const done = yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(30),
          Effect.map(Option.isSome)
        );
        return done;
      })
    );

    expect(seen).toBe(true);
  });

  it("a burst coalesces: one wait completes, the next stays parked without a new notify", async () => {
    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        for (let n = 0; n < 100; n += 1) {
          yield* wake.notify();
        }
        const one = yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(30),
          Effect.map(Option.isSome)
        );
        // No new notify: a counting wake would replay stale revisions, a coalescing
        // wake stays parked here.
        const two = yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(30),
          Effect.map(Option.isSome)
        );
        return [one, two] as const;
      })
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("one notify releases one waiter; the next wait stays parked (no phantom wake)", async () => {
    // G14-B02 adversarial probe: park, notify once, join, then a bounded wait with NO new
    // notify must stay parked. The old gate completed the waiter AND left pending set.
    const [first, second] = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const waiter = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        yield* wake.notify();
        const one = yield* Fiber.join(waiter).pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
        const two = yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(40),
          Effect.map(Option.isSome)
        );
        return [one, two] as const;
      })
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("concurrent waiters share one notification", async () => {
    const both = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const first = yield* Effect.fork(wake.waitForWake());
        const second = yield* Effect.fork(wake.waitForWake());
        // Let both waiters reach their parked waits before notifying (registration is
        // synchronous per fiber; one scheduler turn each, plus margin).
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        yield* wake.notify();
        const both = yield* Effect.all([Fiber.join(first), Fiber.join(second)], {
          concurrency: 2
        }).pipe(Effect.as(true), Effect.timeoutOption(1000), Effect.map(Option.isSome));
        return both;
      })
    );

    expect(both).toBe(true);
  });

  it("cancellation before registration still recovers on the next notify", async () => {
    const recovered = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        // Interrupt immediately: the waiter may not have registered yet.
        const waiter = yield* Effect.fork(wake.waitForWake());
        yield* Fiber.interrupt(waiter);
        yield* wake.notify();
        const done = yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(30),
          Effect.map(Option.isSome)
        );
        return done;
      })
    );

    expect(recovered).toBe(true);
  });

  it("a retained take fiber survives a lost wake race and joins twice with one upstream take", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const takes = yield* Ref.make(0);
          const wake = yield* createWorkerBoardWake();
          const queue = yield* Queue.bounded<number>(1);
          const takeOnce = Ref.update(takes, (n) => n + 1).pipe(
            Effect.zipRight(Queue.take(queue))
          );
          const retained = yield* Effect.forkIn(scope)(takeOnce);
          // The wake is ready before any frame: it must win without consuming the take.
          yield* wake.notify();
          const winner = yield* Effect.race(
            Effect.as(Fiber.join(retained), "pull" as const),
            Effect.as(wake.waitForWake(), "wake" as const)
          );
          expect(winner).toBe("wake");
          // One frame unblocks the SAME fiber; both joins observe it; one take started.
          yield* Queue.offer(queue, 7);
          const first = yield* Fiber.join(retained);
          const second = yield* Fiber.join(retained);
          expect(first).toBe(7);
          expect(second).toBe(7);
          expect(yield* Ref.get(takes)).toBe(1);
          return true;
        })
      )
    );

    expect(result).toBe(true);
  });

  it("scope closure interrupts a still-pending helper-owned pull", async () => {
    // G14-B03: the pull belongs to createCaptureFramePull's scope — not a freestanding Queue.
    const interrupted = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const pull = yield* Scope.extend(
          createCaptureFramePull(Stream.never),
          scope
        );
        const wake = yield* createWorkerBoardWake();
        const pending = yield* Effect.fork(pull.pullNextAware!(wake));
        yield* Effect.yieldNow();
        yield* Scope.close(scope, Exit.succeed(undefined));
        const exit = yield* Fiber.await(pending);
        return exit._tag === "Failure" && Cause.isInterrupted(exit.cause);
      })
    );

    expect(interrupted).toBe(true);
  });

  it("cancelled waits recover repeatedly without losing later wakes", async () => {
    const ok = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        for (let round = 0; round < 3; round += 1) {
          const waiter = yield* Effect.fork(wake.waitForWake());
          yield* Effect.yieldNow();
          yield* Fiber.interrupt(waiter);
          yield* wake.notify();
          const done = yield* wake.waitForWake().pipe(
            Effect.as(true),
            Effect.timeout(30),
            Effect.map((value) => value ?? false)
          );
          if (!done) return false;
        }
        return true;
      })
    );

    expect(ok).toBe(true);
  });

  it("owner cancel preserves a live peer sharing the gate", async () => {
    // G19 exact repro: owner parks, peer shares, owner interrupted, notify must wake peer.
    const peerWoke = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const owner = yield* Effect.fork(wake.waitForWake());
        yield* Effect.sleep(20);
        const peer = yield* Effect.fork(wake.waitForWake());
        yield* Effect.sleep(20);
        yield* Fiber.interrupt(owner);
        yield* wake.notify();
        const woke = yield* Fiber.join(peer).pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
        yield* Fiber.interrupt(peer);
        return woke;
      })
    );

    expect(peerWoke).toBe(true);
  });

  it("shared-peer cancel leaves the owner working", async () => {
    const ownerWoke = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const owner = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        const peer = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        yield* Fiber.interrupt(peer);
        yield* wake.notify();
        const woke = yield* Fiber.join(owner).pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
        yield* Fiber.interrupt(owner);
        return woke;
      })
    );

    expect(ownerWoke).toBe(true);
  });

  // Await actual fiber death: the test must observe termination (not merely issue interrupts)
  // before asserting slot state, or it races fiber startup/scheduling instead of testing
  // cancellation ownership. Failure here is loud, not a mysterious false.
  const awaitTerminated = (fiber: Fiber.Fiber<unknown>, what: string): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      const deadline = Date.now() + 5000;
      for (;;) {
        const polled = yield* Fiber.poll(fiber);
        if (polled._tag === "Some") return;
        if (Date.now() >= deadline) {
          return yield* Effect.fail(new Error(`timed out waiting for ${what} to terminate`));
        }
        yield* Effect.yieldNow();
      }
    });

  it("cancel-all leaves the next notify recoverable", async () => {
    const recovered = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        // Truly concurrent parked members: both share one gate before either is cancelled.
        const owner = yield* Effect.fork(wake.waitForWake());
        const peer = yield* Effect.fork(wake.waitForWake());
        yield* Effect.sleep(100);
        yield* Fiber.interrupt(owner);
        yield* Fiber.interrupt(peer);
        yield* awaitTerminated(owner, "owner");
        yield* awaitTerminated(peer, "peer");
        yield* wake.notify();
        return yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
      })
    );

    expect(recovered).toBe(true);
  });

  it("cancel in both orders leaves the next notify recoverable", async () => {
    for (const order of [["owner", "peer"], ["peer", "owner"]] as const) {
      const recovered = await Effect.runPromise(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          const fibers = {
            owner: yield* Effect.fork(wake.waitForWake()),
            peer: yield* Effect.fork(wake.waitForWake())
          };
          yield* Effect.sleep(100);
          yield* Fiber.interrupt(fibers[order[0]]);
          yield* Fiber.interrupt(fibers[order[1]]);
          yield* awaitTerminated(fibers[order[0]], `${order[0]}-first`);
          yield* awaitTerminated(fibers[order[1]], `${order[1]}-second`);
          yield* wake.notify();
          return yield* wake.waitForWake().pipe(
            Effect.as(true),
            Effect.timeoutOption(1000),
            Effect.map(Option.isSome)
          );
        })
      );
      expect(recovered, order.join(",")).toBe(true);
    }
  });

  it("three members all cancelled, plus survivor keeps its wake", async () => {
    const [allRecovered, survivorWoke] = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const members = yield* Effect.all(
          [wake.waitForWake(), wake.waitForWake(), wake.waitForWake()].map((wait) =>
            Effect.fork(wait)
          )
        );
        yield* Effect.sleep(100);
        for (const member of members) {
          yield* Fiber.interrupt(member);
        }
        for (const [index, member] of members.entries()) {
          yield* awaitTerminated(member, `member-${index}`);
        }
        yield* wake.notify();
        const allRecovered = yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
        // Survivor path on a fresh wake: one waiter parks, a peer shares, the peer is
        // cancelled, and the single notify still releases the survivor.
        const wake2 = yield* createWorkerBoardWake();
        const survivor = yield* Effect.fork(wake2.waitForWake());
        const doomed = yield* Effect.fork(wake2.waitForWake());
        yield* Effect.sleep(100);
        yield* Fiber.interrupt(doomed);
        yield* awaitTerminated(doomed, "doomed-peer");
        yield* wake2.notify();
        const survivorWoke = yield* Fiber.join(survivor).pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
        yield* Fiber.interrupt(survivor);
        return [allRecovered, survivorWoke] as const;
      })
    );

    expect(allRecovered).toBe(true);
    expect(survivorWoke).toBe(true);
  });

  it("late cleanup cannot clear a successor gate", async () => {
    const recovered = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const owner = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        // Owner's cleanup is delayed past a successor registration: it must compare
        // identity and leave the successor gate alone.
        const hammer = yield* Effect.fork(
          Fiber.interrupt(owner).pipe(Effect.delay(50))
        );
        yield* wake.notify();
        const successor = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        yield* Fiber.join(hammer);
        yield* wake.notify();
        const woke = yield* Fiber.join(successor).pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
        yield* Fiber.interrupt(successor);
        return woke;
      })
    );

    expect(recovered).toBe(true);
  });

  it("registration barrier: interrupt between register and cleanup still recovers", async () => {
    const recovered = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        barrierHook.entered = yield* Deferred.make<void>();
        barrierHook.release = yield* Deferred.make<void>();
        barrierHook.armed = true;
        const waiter = yield* Effect.fork(wake.waitForWake());
        yield* Deferred.await(barrierHook.entered).pipe(Effect.timeout(5000));
        // Fork the interrupt: it pends across the masked handoff (joining it here would
        // deadlock against the release below).
        const interrupter = yield* Effect.fork(Fiber.interrupt(waiter));
        yield* Deferred.succeed(barrierHook.release, undefined);
        yield* Fiber.join(interrupter).pipe(Effect.timeout(5000));
        yield* Fiber.await(waiter).pipe(Effect.timeout(5000));
        yield* wake.notify();
        return yield* wake.waitForWake().pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
      })
    );

    expect(recovered).toBe(true);
  });

  it("publication barrier: interrupting notify cannot lose the published wake", async () => {
    const recovered = await Effect.runPromise(
      Effect.gen(function* () {
        const wake = yield* createWorkerBoardWake();
        const parked = yield* Effect.fork(wake.waitForWake());
        yield* Effect.yieldNow();
        barrierHook.entered = yield* Deferred.make<void>();
        barrierHook.release = yield* Deferred.make<void>();
        barrierHook.armed = true;
        const notifier = yield* Effect.fork(wake.notify());
        yield* Deferred.await(barrierHook.entered).pipe(Effect.timeout(5000));
        // Forked interrupt for the same deadlock reason as above: notify is fully
        // uninterruptible, so joining an interrupt here would wait forever.
        const interrupter = yield* Effect.fork(Fiber.interrupt(notifier));
        yield* Deferred.succeed(barrierHook.release, undefined);
        yield* Fiber.join(interrupter).pipe(Effect.timeout(5000));
        yield* Fiber.await(notifier).pipe(Effect.timeout(5000));
        return yield* Fiber.join(parked).pipe(
          Effect.as(true),
          Effect.timeoutOption(1000),
          Effect.map(Option.isSome)
        );
      })
    );

    expect(recovered).toBe(true);
  });
});
