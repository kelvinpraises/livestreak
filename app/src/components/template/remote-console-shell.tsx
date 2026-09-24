// The live Remote Console page: password gate → the Desk · Focus · Attention ConsoleShell
// fed by buildConsoleModels over the session's wire data (functions[] + boards + grant).
// Packages without a live mapper yet render their fixture model, badged below the tabs —
// that badge is the walk-backwards progress meter and disappears as mappers land.
// The gear opens the live-board drawer: the raw JSON window each mapper is written against.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRemote } from '#/providers/remote-provider'
import { ConsoleShell } from '#/components/template/console-shell'
import { ConsoleBoardDrawer } from '#/components/organisms/console-board-drawer'
import { RemotePasswordGate } from '#/components/organisms/remote-password-gate'
import { buildConsoleModels } from '#/utils/console-map'
import { ADD_OPTIONS_LOCAL_REF } from '#/utils/console-map/map-options'
import { useConsoleDispatch } from '#/hooks/use-console-dispatch'
import type { ConsoleFormValues, ConsoleModel } from '#/types/console'

const readPicks = (key: string): ReadonlySet<string> => {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function RemoteConsoleShell() {
  const { session, status, functions, board, grant, callRemote } = useRemote()
  const [boardsOpen, setBoardsOpen] = useState(false)
  const { pending, dispatch } = useConsoleDispatch({ functions, board, callRemote })

  // Desk-membership picks (options' Add options): page-local, per session, never wire data.
  const picksKey = `livestreak-console-picks:${session}`
  const [localPicks, setLocalPicks] = useState<ReadonlySet<string>>(() => readPicks(picksKey))
  useEffect(() => {
    try {
      window.localStorage.setItem(picksKey, JSON.stringify([...localPicks]))
    } catch {
      /* storage unavailable — picks just don't persist */
    }
  }, [picksKey, localPicks])

  // Stabilize model identity: a board push that derives an IDENTICAL model reuses the previous
  // object, so the memoized shell (and every row under it) skips the render entirely. This is
  // what keeps rows still while a stream ticks the board revision up every frame.
  const stable = useRef<Record<string, { json: string; model: ConsoleModel }>>({})
  const built = useMemo(() => {
    const raw = buildConsoleModels({ functions, board, grant, pending, localPicks })
    const models: Record<string, ConsoleModel> = {}
    for (const [tab, model] of Object.entries(raw.models)) {
      const json = JSON.stringify(model)
      const prev = stable.current[tab]
      if (prev !== undefined && prev.json === json) {
        models[tab] = prev.model
      } else {
        stable.current[tab] = { json, model }
        models[tab] = model
      }
    }
    return { models, fixtureTabs: raw.fixtureTabs }
  }, [functions, board, grant, pending, localPicks])
  const builtRef = useRef(built)
  builtRef.current = built

  // The shell reports the verb by (tab, thingId, name); the model resolves it to its callRef —
  // or to a localRef, a UI-only action that never touches the wire. Stable identity (ref-read)
  // so the memoized shell never re-renders for a new closure.
  const onRun = useCallback(
    (tab: string, thingId: string, verbName: string, values: ConsoleFormValues) => {
      const verb = builtRef.current.models[tab]?.focus[thingId]?.verbs.find((v) => v.name === verbName)
      if (verb === undefined) return
      if (verb.localRef === ADD_OPTIONS_LOCAL_REF) {
        const picked = Object.values(values).flatMap((v) => (Array.isArray(v) ? v : []))
        if (picked.length > 0) setLocalPicks((prev) => new Set([...prev, ...picked]))
        return
      }
      if (verb.callRef === undefined) return // fixture-backed tab — cue-only until its mapper lands
      dispatch(verb, values)
    },
    [dispatch]
  )
  const onOpenSettings = useCallback(() => setBoardsOpen((o) => !o), [])

  if (status !== 'open') return <RemotePasswordGate />

  if (Object.keys(built.models).length === 0) {
    return (
      <p style={{ maxWidth: 420, margin: '20vh auto', fontSize: 13, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
        No functions are authorised for this session.
      </p>
    )
  }

  return (
    <>
      <ConsoleShell
        models={built.models}
        onRun={onRun}
        storageKey={`livestreak-console-location:${session}`}
        onOpenSettings={onOpenSettings}
      />
      {built.fixtureTabs.size > 0 ? (
        <p
          data-testid="fixture-tabs-badge"
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            padding: '0 24px 20px',
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: '#ffb224',
          }}
        >
          fixture data · {[...built.fixtureTabs].join(' · ')}
        </p>
      ) : null}
      <ConsoleBoardDrawer board={board} open={boardsOpen} onClose={() => setBoardsOpen(false)} />
    </>
  )
}
