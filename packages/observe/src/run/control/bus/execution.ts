import { Effect, Ref } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ExecutionOwner, ExecutionPhase } from "./types.js";

export interface ExecutionEntry {
  readonly token: number;
  readonly phase: ExecutionPhase;
}

const inactiveEntry = (token: number): ExecutionEntry => ({ token, phase: "inactive" });

/**
 * Per-observation admission/lease owner for one bus. Each observation (keyed `runId#obsId`,
 * bare runId for legacy runs) holds an independent entry: a monotonically advancing token plus
 * a protected phase. Entries are never deleted — removal retires to inactive with the token
 * intact, so a late token can never become current again if the same address is reused.
 *
 * One short semaphore guards EVERYTHING: all transitions (reserve/claim/release), all reads
 * used for admission, and — via transact — every board check/rebase/commit the bus performs.
 * Guarded sections are pure-CPU only (no surface invocation, chain, attach, callbacks or
 * cleanup inside); they never nest (public ops are single acquisitions; combined sections use
 * peekEntries plus pure checks, never a public op inside transact).
 *
 * Token discipline:
 * - reserve/claimConfig/claimPrepare fail unless inactive; otherwise bump, enter phase,
 *   return the fresh token. Single Ref.modify step: forced contenders yield exactly one winner.
 * - release bumps and returns to inactive ONLY for the matching token (stale no-ops).
 * - Tickets (readEntry snapshots) claim nothing: any later reserve/retire changes the token,
 *   so the ticket goes stale — even back to inactive.
 */
export interface ExecutionOwnerInternal extends ExecutionOwner {
  /** Run an effect under the shared owner/write guard (never nest a public op inside). */
  readonly transact: <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, E>;
  /**
   * Mutex-free primitives, for use ONLY inside transact (combined capture/commit sections
   * that must share one guard acquisition and therefore cannot call public ops). Every
   * public op below is exactly one transact around these — same atomicity, no nesting.
   */
  readonly readEntriesSnapshot: () => Effect.Effect<ReadonlyMap<string, ExecutionEntry>>;
  readonly claimRaw: (
    obsKey: string,
    phase: Exclude<ExecutionPhase, "inactive">
  ) => Effect.Effect<number, LiveStreakError>;
  readonly releaseRaw: (obsKey: string, token: number) => Effect.Effect<void>;
}

export const STALE_OWNER_MESSAGE = "Stale owner write for";

export const isStaleOwnerError = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message).startsWith(STALE_OWNER_MESSAGE);
  }
  return String(error).includes(STALE_OWNER_MESSAGE);
};

/** Pure token+key match against a peeked snapshot (no guard acquisition; call in transact). */
export const checkEntryToken = (
  entries: ReadonlyMap<string, ExecutionEntry>,
  obsKey: string,
  token: number
): Effect.Effect<void, LiveStreakConfigError> =>
  entries.get(obsKey)?.token === token
    ? Effect.void
    : Effect.fail(
        new LiveStreakConfigError({
          message: `${STALE_OWNER_MESSAGE} ${obsKey}: generation advanced`
        })
      );

export const createExecutionOwner = (): Effect.Effect<ExecutionOwnerInternal, never> =>
  Effect.gen(function* () {
    const guard = yield* Effect.makeSemaphore(1);
    const entries = yield* Ref.make<ReadonlyMap<string, ExecutionEntry>>(new Map());

    const transact = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      guard.withPermits(1)(effect);

    // Raw snapshot primitive: mutex-free by itself, used either inside transact (combined
    // sections) or inside exactly one transact-wrapped public op below — never both, so the
    // guard is never re-acquired (no nesting, no deadlock).

    const readRaw = (): Effect.Effect<ReadonlyMap<string, ExecutionEntry>> =>
      Effect.map(Ref.get(entries), (map) => new Map(map));

    // Raw transition/release: mutex-free building blocks for combined sections running
    // inside transact. Public ops below wrap exactly one of these in transact.
    const claimRaw = (
      obsKey: string,
      phase: Exclude<ExecutionPhase, "inactive">
    ): Effect.Effect<number, LiveStreakError> =>
      Effect.flatMap(readRaw(), (map) => {
        const current = map.get(obsKey) ?? inactiveEntry(0);
        if (current.phase !== "inactive") {
          return Effect.fail(
            new LiveStreakConfigError({
              message:
                current.phase === "executing"
                  ? `Observation ${obsKey} already has an active execution`
                  : `Observation ${obsKey} is already ${current.phase}`
            })
          );
        }
        const token = current.token + 1;
        return Effect.as(
          Ref.set(entries, new Map(map).set(obsKey, { token, phase })),
          token
        );
      });

    const releaseRaw = (obsKey: string, token: number): Effect.Effect<void> =>
      Effect.flatMap(readRaw(), (map) => {
        const current = map.get(obsKey);
        if (current === undefined || current.token !== token) {
          return Effect.void;
        }
        return Ref.set(entries, new Map(map).set(obsKey, inactiveEntry(token + 1))).pipe(
          Effect.asVoid
        );
      });

    // Acquisition is one uninterruptible unit: an interruption that lands mid-claim
    // either never starts the transition (nothing held) or arrives after the token
    // is returned (the caller then owns cleanup). It can never strand a completed
    // claim with no owner. Release is likewise uninterruptible (short, always safe).
    const transition = (
      obsKey: string,
      phase: Exclude<ExecutionPhase, "inactive">
    ): Effect.Effect<number, LiveStreakError> =>
      Effect.uninterruptible(transact(claimRaw(obsKey, phase)));

    return {
      transact,
      readEntriesSnapshot: () => readRaw(),
      claimRaw,
      releaseRaw,
      reserve: (obsKey: string): Effect.Effect<number, LiveStreakError> =>
        transition(obsKey, "executing"),
      claimConfig: (obsKey: string): Effect.Effect<number, LiveStreakError> =>
        transition(obsKey, "configuring"),
      claimPrepare: (obsKey: string): Effect.Effect<number, LiveStreakError> =>
        transition(obsKey, "preparing"),
      release: (obsKey: string, token: number): Effect.Effect<void> =>
        Effect.uninterruptible(transact(releaseRaw(obsKey, token))),
      readEntry: (obsKey: string) =>
        transact(
          Effect.map(readRaw(), (map) => {
            const current = map.get(obsKey);
            if (current === undefined) {
              return { token: 0, phase: "inactive" as const };
            }
            return { token: current.token, phase: current.phase };
          })
        ),
      isCurrent: (obsKey: string, token: number): Effect.Effect<boolean> =>
        transact(Effect.map(readRaw(), (map) => map.get(obsKey)?.token === token)),
      isActive: (obsKey: string): Effect.Effect<boolean> =>
        transact(
          Effect.map(readRaw(), (map) => (map.get(obsKey)?.phase ?? "inactive") !== "inactive")
        ),
      anyOwned: (): Effect.Effect<boolean> =>
        transact(
          Effect.map(readRaw(), (map) => {
            for (const entry of map.values()) {
              if (entry.phase !== "inactive") {
                return true;
              }
            }
            return false;
          })
        )
    };
  });
