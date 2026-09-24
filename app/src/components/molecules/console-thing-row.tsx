// One Desk row: a tone dot, label, note, indented by its containment depth. Pure render of a
// ConsoleThing — no role or package knowledge ever. Clicking selects (navigate, never act).

import type { ConsoleThing, ThingTone } from '#/types/console'

const DOT: Record<ThingTone, string> = {
  ok: '#00ff87',
  warn: '#ffb224',
  err: '#ff2d78',
  idle: 'rgba(255,255,255,0.35)',
}

export function ConsoleThingRow({
  thing,
  depth,
  selected,
  onSelect,
}: {
  readonly thing: ConsoleThing
  readonly depth: number
  readonly selected: boolean
  readonly onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      data-testid={`desk-thing-${thing.id}`}
      onClick={() => onSelect(thing.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        width: '100%',
        textAlign: 'left',
        padding: `5px 8px 5px ${8 + depth * 14}px`,
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'var(--font-sans)',
        color: 'rgba(255,255,255,0.85)',
        background: selected ? 'rgba(255,255,255,0.05)' : 'transparent',
        border: selected
          ? '1px solid rgba(255,255,255,0.12)'
          : thing.fresh
            ? '1px solid rgba(0,255,135,0.3)'
            : '1px solid transparent',
      }}
    >
      {depth > 0 ? (
        <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginRight: -2 }}>└</span>
      ) : null}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: DOT[thing.tone],
          flexShrink: 0,
        }}
      />
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {thing.label}
      </span>
      {thing.note ? (
        <span
          style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {thing.note}
        </span>
      ) : null}
    </button>
  )
}
