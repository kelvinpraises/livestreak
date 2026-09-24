// The walk-backwards seam: pure mappers that turn one package's live wire data
// (functions[] + board snapshot) into the ConsoleModel the shell renders. No React,
// no DOM — these promote to a shared package for the CLI skin later.
//
// STABILITY RULE: thing ids, verb names, and field names must be stable across board
// pushes (derive them from entity ids, never array indices). The verb forms are
// uncontrolled inputs — a remount wipes the operator's half-typed values, and the
// options board repolls every ~3s.

import type { CapabilityGrant, FunctionDescriptor } from '@livestreak/schema'
import type { ConsoleModel } from '#/types/console'

export type PendingPhase = 'busy' | 'settling' | 'failed'

/** Dispatch overlay for one in-flight call, keyed by the verb's callRef (= FunctionDescriptor.id).
 *  Mappers render it as the verb's state — busy/failed come from here, never from the shell. */
export interface PendingCall {
  readonly phase: PendingPhase
  readonly error?: string
  readonly startedAt: number
}

export interface PackageMapperInput {
  /** This package's slice of the session's functions[]. */
  readonly functions: readonly FunctionDescriptor[]
  /** This package's board snapshot (board[pkg]) — still unknown on the wire; each mapper
   *  duck-types it against the package's own board shape. */
  readonly board: unknown
  readonly grant?: CapabilityGrant
  readonly pending: ReadonlyMap<string, PendingCall>
  /** UI-local desk-membership additions keyed by entity id (options' Add options picker) —
   *  page state, never wire data. */
  readonly localPicks?: ReadonlySet<string>
  /** Clock for live derivations (runway minutes). Injected so golden tests are deterministic;
   *  the page passes Date.now(). */
  readonly nowMs?: number
}

export type PackageMapper = (input: PackageMapperInput) => ConsoleModel
