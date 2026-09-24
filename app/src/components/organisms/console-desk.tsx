// The Desk: every entity in this session's scope, indented by containment. Depth is DERIVED by
// walking parentId chains — the session is the root; nothing about the tree is authored.

import { useMemo } from 'react'
import type { ConsoleThing } from '#/types/console'
import { ConsoleThingRow } from '#/components/molecules/console-thing-row'

const depthOf = (thing: ConsoleThing, byId: ReadonlyMap<string, ConsoleThing>): number => {
  let depth = 0
  let current = thing
  while (current.parentId !== undefined) {
    const parent = byId.get(current.parentId)
    if (parent === undefined) break
    depth += 1
    current = parent
    if (depth > 8) break // cycle guard — a malformed model must not hang the render
  }
  return depth
}

export function ConsoleDesk({
  things,
  selectedId,
  onSelect,
}: {
  readonly things: readonly ConsoleThing[]
  readonly selectedId: string
  readonly onSelect: (id: string) => void
}) {
  const rows = useMemo(() => {
    const byId = new Map(things.map((t) => [t.id, t]))
    return things.map((t) => ({ thing: t, depth: depthOf(t, byId) }))
  }, [things])

  return (
    <div data-testid="console-desk" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map(({ thing, depth }) => (
        <ConsoleThingRow
          key={thing.id}
          thing={thing}
          depth={depth}
          selected={thing.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
