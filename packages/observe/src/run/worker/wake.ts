import { Deferred, Effect, Ref } from "effect";

export interface WorkerBoardWake {
  readonly notify: () => Effect.Effect<void>;
  readonly waitForWake: () => Effect.Effect<void>;
}

type WaiterDecision =
  | { readonly _tag: "done" }
  | { readonly _tag: "park"; readonly gate: Deferred.Deferred<void, never> }
  | { readonly _tag: "share"; readonly gate: Deferred.Deferred<void, never> };

interface WakeSlot {
  readonly gate: Deferred.Deferred<void, never> | undefined;
  readonly members: number;
  readonly pending: boolean;
}

/**
 * Atomic single-slot wake with gate membership: one notification satisfies the waiting
 * consumers OR remains pending for a future consumer — never both.
 *
 * Registration, cleanup installation and the actual wait are one interruption-safe handoff:
 * the decision/registration runs masked, and interruptibility is restored only for the wait
 * itself, which already carries its cleanup. Notify's take-and-complete is likewise one
 * protected handoff. The atomic step returns the selected gate/ownership — the waiter never
 * re-reads mutable slot state to discover it.
 *
 * Every waiter on one gate is a counted member. Cancelling a waiter removes only its own
 * membership and clears the gate only when no live waiter remains; a late cleanup compares
 * gate identity and can never decrement or remove a successor gate. Concurrent waiters share
 * the registered gate (single runtime consumer by design). Wakes mean "reread the board",
 * never replayed events. Keeps the current API.
 */
export const createWorkerBoardWake = (): Effect.Effect<WorkerBoardWake, never> =>
  Effect.gen(function* () {
    const slot = yield* Ref.make<WakeSlot>({ gate: undefined, members: 0, pending: false });

    return {
      notify: () =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const taken = yield* Ref.modify(slot, (state) =>
              state.gate !== undefined
                ? [
                    { gate: state.gate, members: state.members } as const,
                    { gate: undefined, members: 0, pending: false } as WakeSlot
                  ]
                : [undefined, { gate: undefined, members: 0, pending: true } as WakeSlot]
            );
            if (taken !== undefined) {
              yield* Deferred.succeed(taken.gate, void 0);
            }
          })
        ),
      waitForWake: () =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const gate = yield* Deferred.make<void>();
            const decision: WaiterDecision = yield* Ref.modify(slot, (state): readonly [WaiterDecision, WakeSlot] => {
              if (state.pending) {
                return [
                  { _tag: "done" as const },
                  { gate: undefined, members: 0, pending: false } as WakeSlot
                ];
              }
              if (state.gate !== undefined) {
                return [
                  { _tag: "share" as const, gate: state.gate },
                  { gate: state.gate, members: state.members + 1, pending: false } as WakeSlot
                ];
              }
              return [
                { _tag: "park" as const, gate },
                { gate, members: 1, pending: false } as WakeSlot
              ];
            });
            if (decision._tag === "done") {
              return;
            }
            // G20: park AND share take the same restored wait with identity-guarded cleanup.
            // The old share early-return skipped cleanup, so cancelling a shared peer left a
            // stale membership that swallowed the next notify. Every gate joiner owns its exit.
            yield* restore(Deferred.await(decision.gate)).pipe(
              Effect.onInterrupt(() =>
                Ref.update(slot, (state) =>
                  state.gate === decision.gate
                    ? state.members <= 1
                      ? { gate: undefined, members: 0, pending: state.pending }
                      : { ...state, members: state.members - 1 }
                    : state
                )
              )
            );
          })
        )
    };
  });
