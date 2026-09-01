import { Deferred, Effect, Ref } from "effect";

export interface WorkerBoardWake {
  readonly notify: () => Effect.Effect<void>;
  readonly waitForWake: () => Effect.Effect<void>;
}

export const createWorkerBoardWake = (): Effect.Effect<WorkerBoardWake, never> =>
  Effect.gen(function* () {
    const waiters = yield* Ref.make<{ readonly value?: Deferred.Deferred<void, never> }>({});
    const pendingWakes = yield* Ref.make(0);

    const notify = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const slot = yield* Ref.get(waiters);
        if (slot.value !== undefined) {
          yield* Ref.set(waiters, {});
          yield* Deferred.succeed(slot.value, void 0);
          return;
        }

        yield* Ref.update(pendingWakes, (count) => count + 1);
      });

    const waitForWake = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const pending = yield* Ref.get(pendingWakes);
        if (pending > 0) {
          yield* Ref.set(pendingWakes, pending - 1);
          return;
        }

        const waiter = yield* Deferred.make<void>();
        yield* Ref.set(waiters, { value: waiter });
        yield* Deferred.await(waiter);
      });

    return {
      notify,
      waitForWake
    };
  });
