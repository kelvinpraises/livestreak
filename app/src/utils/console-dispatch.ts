// Pure dispatch logic for the live console: verb form values → coerced call envelope, and the
// pending-call reducer (busy → settling → cleared/failed). No React/DOM so all of it unit-tests
// in the node environment; the use-console-dispatch hook is a thin stateful wrapper.

import type { CallActionEnvelope, FunctionDescriptor, JsonSchema } from '@livestreak/schema'
import { bridgeActionScope } from '@livestreak/schema'
import type { ConsoleFormValues, ConsoleVerb, VerbField } from '#/types/console'
import { coerceArgs } from '#/utils/auto-form-schema'
import type { PendingCall } from '#/utils/console-map/types'

// The ids the bridge already knows from the function's target are passed straight through as
// args — never asked for in the form (same rule as the legacy console, scope-app §P5.2).
export const prefilledFor = (fn: FunctionDescriptor): Record<string, unknown> => {
  const t = fn.target
  const out: Record<string, unknown> = {}
  if (t?.marketId) out.marketId = t.marketId
  if (t?.vaultId) out.vaultId = t.vaultId
  if (t?.tokenId) out.tokenId = t.tokenId
  if (t?.side) out.side = t.side
  return out
}

/** Display-name → wire-name record: each verb field's `arg` (default: its name) keys the value.
 *  Multi-picker arrays stay arrays (coerceField's array branch takes them as-is). Values with no
 *  matching field (shouldn't happen) pass through under their own name. */
export const renameValues = (
  verb: Pick<ConsoleVerb, 'fields'>,
  values: ConsoleFormValues
): Record<string, unknown> => {
  const argByName = new Map<string, string>()
  const walk = (fields: readonly VerbField[]): void => {
    for (const f of fields) {
      argByName.set(f.name, f.arg ?? f.name)
      if (f.arms !== undefined) {
        for (const arm of Object.values(f.arms)) walk(arm)
      }
    }
  }
  walk(verb.fields ?? [])
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(values)) {
    out[argByName.get(name) ?? name] = value
  }
  return out
}

/** Schema defaults for properties the form omitted (e.g. resolutionSource "manual") — the legacy
 *  auto-form rendered every property so defaults always shipped; the mapper legitimately omits
 *  defaulted fields, so they're merged here before coercion. */
export const applySchemaDefaults = (
  inputSchema: JsonSchema | undefined,
  record: Record<string, unknown>
): Record<string, unknown> => {
  if (inputSchema?.type !== 'object') return record
  const out = { ...record }
  for (const prop of inputSchema.properties ?? []) {
    if (out[prop.name] === undefined && prop.value.default !== undefined) {
      out[prop.name] = prop.value.default
    }
  }
  return out
}

export interface BuiltCall {
  readonly ok: boolean
  readonly envelope?: CallActionEnvelope
  readonly target?: string
  readonly error?: string
}

/** presetArgs under form values → renamed → defaulted → coerced → envelope. Coercion failure
 *  returns the first error (rendered as the verb's failed state — no wire call is made).
 *  Target prefill yields to anything the form/presets supply: when a mapper deliberately asks
 *  (options' Back-a-side side select overriding a per-side descriptor's target), the answer wins. */
export const buildCall = (
  fn: FunctionDescriptor,
  verb: Pick<ConsoleVerb, 'fields' | 'presetArgs'>,
  values: ConsoleFormValues
): BuiltCall => {
  const record = applySchemaDefaults(fn.inputSchema, {
    ...verb.presetArgs,
    ...renameValues(verb, values),
  })
  const prefilled = Object.fromEntries(
    Object.entries(prefilledFor(fn)).filter(([key]) => record[key] === undefined)
  )
  const coerced = coerceArgs(fn.inputSchema, record, prefilled)
  if (!coerced.ok) {
    const [field, message] = Object.entries(coerced.errors)[0] ?? ['input', 'invalid']
    return { ok: false, error: `${field}: ${message}` }
  }
  return {
    ok: true,
    // action = bare name (authz/spend key); id = cell-qualified descriptor id (dispatch key).
    envelope: { scope: bridgeActionScope, action: fn.name, id: fn.id, args: coerced.values },
    target: fn.package,
  }
}

// --- pending-call reducer ------------------------------------------------------------------

/** A board's change stamp: revision where the package board has one (observe/options/steward),
 *  updatedAtMs otherwise (bookmaker's panel view). Undefined = no stamp, timer-only settling. */
export const boardStamp = (board: unknown): number | undefined => {
  if (board === null || typeof board !== 'object') return undefined
  const b = board as { revision?: unknown; updatedAtMs?: unknown }
  if (typeof b.revision === 'number') return b.revision
  if (typeof b.updatedAtMs === 'number') return b.updatedAtMs
  return undefined
}

export interface PendingEntry extends PendingCall {
  readonly pkg: string
  /** The package board's stamp when the call fired — settling clears once it moves. */
  readonly stampAtCall?: number
  /** Kept for Retry (failed verbs render no form). */
  readonly envelope?: CallActionEnvelope
  readonly target?: string
}

export type PendingState = ReadonlyMap<string, PendingEntry>

export type PendingEvent =
  | { readonly type: 'fired'; readonly callRef: string; readonly entry: PendingEntry }
  | { readonly type: 'settled_ok'; readonly callRef: string }
  | { readonly type: 'failed'; readonly callRef: string; readonly error: string }
  | { readonly type: 'boards'; readonly stamps: Readonly<Record<string, number | undefined>> }
  | { readonly type: 'expired'; readonly callRef: string; readonly firedBefore: number }
  | { readonly type: 'cleared'; readonly callRef: string }

export const pendingReducer = (state: PendingState, event: PendingEvent): PendingState => {
  switch (event.type) {
    case 'fired': {
      const next = new Map(state)
      next.set(event.callRef, event.entry)
      return next
    }
    case 'settled_ok': {
      const entry = state.get(event.callRef)
      if (entry === undefined || entry.phase !== 'busy') return state
      const next = new Map(state)
      next.set(event.callRef, { ...entry, phase: 'settling' })
      return next
    }
    case 'failed': {
      const entry = state.get(event.callRef)
      const next = new Map(state)
      next.set(event.callRef, {
        pkg: entry?.pkg ?? '',
        startedAt: entry?.startedAt ?? 0,
        ...entry,
        phase: 'failed',
        error: event.error,
      })
      return next
    }
    case 'boards': {
      // A board push clears every settling entry whose package stamp moved past the one
      // recorded at fire time (an in-flight poll push predating the call can't clear it).
      let changed = false
      const next = new Map(state)
      for (const [ref, entry] of state) {
        if (entry.phase !== 'settling') continue
        const now = event.stamps[entry.pkg]
        if (now !== undefined && (entry.stampAtCall === undefined || now > entry.stampAtCall)) {
          next.delete(ref)
          changed = true
        }
      }
      return changed ? next : state
    }
    case 'expired': {
      // Fallback timer: a settling call that genuinely changed nothing clears quietly.
      const entry = state.get(event.callRef)
      if (entry === undefined || entry.phase !== 'settling' || entry.startedAt > event.firedBefore) {
        return state
      }
      const next = new Map(state)
      next.delete(event.callRef)
      return next
    }
    case 'cleared': {
      if (!state.has(event.callRef)) return state
      const next = new Map(state)
      next.delete(event.callRef)
      return next
    }
  }
}
