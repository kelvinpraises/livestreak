// Focus: the ONLY region where anything happens. The focused thing's state, its verbs in every
// state (composite forms inline), and its own history. A transient cue badge floats absolute in
// the corner (no layout shift) for run feedback.

import type { ConsoleFocusCard, ConsoleFormValues } from '#/types/console'
import { ConsoleVerbRow } from '#/components/molecules/console-verb-row'

export function ConsoleFocus({
  card,
  cue,
  onRun,
}: {
  readonly card: ConsoleFocusCard
  readonly cue?: string
  readonly onRun: (verbName: string, values: ConsoleFormValues) => void
}) {
  return (
    <div
      data-testid="console-focus"
      style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 12,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0, color: 'rgba(255,255,255,0.92)' }}>
        {card.title}
      </p>
      <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', margin: '2px 0 10px' }}>{card.sub}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {card.verbs.map((verb) => (
          <ConsoleVerbRow key={verb.name} verb={verb} onRun={onRun} />
        ))}
      </div>

      {card.history !== undefined && card.history.length > 0 ? (
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            marginTop: 10,
            paddingTop: 7,
          }}
        >
          {card.history.map((line) => (
            <p
              key={line}
              style={{
                fontSize: 10.5,
                color: 'rgba(255,255,255,0.38)',
                margin: '0 0 3px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <span
        aria-live="polite"
        data-testid="focus-cue"
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          padding: '2px 7px',
          borderRadius: 6,
          color: '#00ff87',
          background: 'rgba(0,255,135,0.12)',
          border: '1px solid rgba(0,255,135,0.3)',
          opacity: cue ? 1 : 0,
          transition: 'opacity 160ms ease',
          pointerEvents: 'none',
        }}
      >
        {cue ?? ''}
      </span>
    </div>
  )
}
