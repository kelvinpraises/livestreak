// The live console's call lifecycle: busy while the call is on the wire, settling until the
// package board catches up (stamp moves or ~8s fallback), failed with the reason on the verb.
// All transitions run through the pure pendingReducer (console-dispatch.ts); this hook only owns
// the React state, the timers, and the wire call. The pending map flows INTO the mappers, so
// busy/failed render as model verb states — one render path, the shell never special-cases.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FunctionDescriptor } from '@livestreak/schema'
import type { CallActionEnvelope } from '@livestreak/schema'
import type { ConsoleFormValues, ConsoleVerb } from '#/types/console'
import type { CallResult, RemoteBoard } from '#/utils/remote-transport'
import {
  boardStamp,
  buildCall,
  pendingReducer,
  type PendingState,
  type PendingEvent,
} from '#/utils/console-dispatch'

const SETTLE_FALLBACK_MS = 8000

export function useConsoleDispatch({
  functions,
  board,
  callRemote,
}: {
  readonly functions: readonly FunctionDescriptor[]
  readonly board: RemoteBoard
  readonly callRemote: (envelope: CallActionEnvelope, target?: string) => Promise<CallResult>
}) {
  const [pending, setPending] = useState<PendingState>(new Map())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t)
    },
    []
  )

  const send = useCallback((event: PendingEvent) => setPending((s) => pendingReducer(s, event)), [])

  // Board pushes clear settled entries whose package stamp moved.
  useEffect(() => {
    const stamps: Record<string, number | undefined> = {}
    for (const [pkg, b] of Object.entries(board)) stamps[pkg] = boardStamp(b)
    send({ type: 'boards', stamps })
  }, [board, send])

  const fnIndex = useRef(new Map<string, FunctionDescriptor>())
  fnIndex.current = new Map(functions.map((fn) => [fn.id, fn]))

  const dispatch = useCallback(
    (verb: Pick<ConsoleVerb, 'name' | 'callRef' | 'fields' | 'switchRef'>, values: ConsoleFormValues) => {
      const callRef = verb.callRef
      if (callRef === undefined) return
      const fn = fnIndex.current.get(callRef)
      const startedAt = Date.now()

      const fire = (envelope: CallActionEnvelope, target: string | undefined) => {
        send({
          type: 'fired',
          callRef,
          entry: {
            phase: 'busy',
            startedAt,
            pkg: target ?? '',
            stampAtCall: boardStamp(target !== undefined ? (board as Record<string, unknown>)[target] : undefined),
            envelope,
            target,
          },
        })
        void callRemote(envelope, target).then((res) => {
          if (!res.ok) {
            send({ type: 'failed', callRef, error: res.error ?? 'failed' })
            return
          }
          send({ type: 'settled_ok', callRef })
          const timer = setTimeout(() => {
            send({ type: 'expired', callRef, firedBefore: startedAt })
            timers.current.delete(timer)
          }, SETTLE_FALLBACK_MS)
          timers.current.add(timer)
        })
      }

      // Retry on a failed verb: no form rendered, so re-fire the stored envelope.
      const prior = pending.get(callRef)
      if (prior?.phase === 'failed' && Object.keys(values).length === 0 && prior.envelope !== undefined) {
        fire(prior.envelope, prior.target)
        return
      }

      // Mode switch: a changed switch-field routes to the switch call instead.
      const sw = verb.switchRef
      if (sw !== undefined) {
        const chosen = values[sw.field]
        if (typeof chosen === 'string' && chosen !== '' && chosen !== sw.current) {
          const swFn = fnIndex.current.get(sw.callRef)
          if (swFn === undefined) {
            send({ type: 'failed', callRef, error: 'switch action no longer available' })
            return
          }
          const swBuilt = buildCall(
            swFn,
            { fields: [{ name: sw.field, arg: sw.arg ?? 'kind', value: chosen }], presetArgs: sw.presetArgs },
            { [sw.field]: chosen }
          )
          if (!swBuilt.ok || swBuilt.envelope === undefined) {
            send({ type: 'failed', callRef, error: swBuilt.error ?? 'invalid input' })
            return
          }
          fire(swBuilt.envelope, swBuilt.target)
          return
        }
      }
      if (fn === undefined) {
        send({ type: 'failed', callRef, error: 'action no longer available' })
        return
      }
      const built = buildCall(fn, verb, values)
      if (!built.ok || built.envelope === undefined) {
        send({ type: 'failed', callRef, error: built.error ?? 'invalid input' })
        return
      }
      fire(built.envelope, built.target)
    },
    [board, callRemote, pending, send]
  )

  return { pending, dispatch }
}
