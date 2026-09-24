// The live-board drawer: the JSON debug lens behind the shell's gear button. Shows every
// package's raw board (the window we map against while walking backwards), one section per
// package, with whole-board copy and selection-to-copy. Floats over the console on its own
// scroll — opening it never shifts the shell's layout.
// The legacy BoardRail in remote-console.tsx keeps its own copy of this styling until the
// legacy view is deleted (port Phase F).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'

// Keys brighter + a little bolder, values keep their tone, punctuation recedes.
const JSON_TOKEN = /("(?:\\.|[^"\\])*"(?::)?)|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
const KEY_STYLE = { color: 'rgba(255,255,255,0.92)', fontWeight: 600 } as const
const VALUE_STYLE = { color: 'rgba(255,255,255,0.7)' } as const
const PUNCT_STYLE = { color: 'rgba(255,255,255,0.32)' } as const

function highlightJson(json: string): ReactNode {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  JSON_TOKEN.lastIndex = 0
  while ((m = JSON_TOKEN.exec(json)) !== null) {
    if (m.index > last) {
      out.push(<span key={key++} style={PUNCT_STYLE}>{json.slice(last, m.index)}</span>)
    }
    const tok = m[0]
    if (m[1] && tok.endsWith(':')) {
      out.push(<span key={key++} style={KEY_STYLE}>{tok.slice(0, -1)}</span>)
      out.push(<span key={key++} style={PUNCT_STYLE}>:</span>)
    } else {
      out.push(<span key={key++} style={VALUE_STYLE}>{tok}</span>)
    }
    last = m.index + tok.length
  }
  if (last < json.length) {
    out.push(<span key={key++} style={PUNCT_STYLE}>{json.slice(last)}</span>)
  }
  return out
}

function BoardSection({
  packageId,
  board,
  onCue,
}: {
  readonly packageId: string
  readonly board: unknown
  readonly onCue: (msg: string) => void
}) {
  const json = useMemo(() => JSON.stringify(board, null, 2) ?? 'undefined', [board])
  const highlighted = useMemo(() => highlightJson(json), [json])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      onCue(`Copied ${packageId} ✓`)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  const onSelectionEnd = async () => {
    const selection = window.getSelection?.()?.toString() ?? ''
    if (selection.length === 0) return
    try {
      await navigator.clipboard.writeText(selection)
      onCue(`copied ${selection.length} chars to clipboard`)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <details open style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <summary
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 14px',
          cursor: 'pointer',
          fontSize: 11,
          color: 'rgba(255,255,255,0.55)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          listStyle: 'none',
        }}
      >
        <span>Board · {packageId}</span>
        <button
          type="button"
          data-testid={`board-copy-${packageId}`}
          onClick={(e) => {
            e.preventDefault()
            void onCopy()
          }}
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            textTransform: 'none',
          }}
        >
          Copy
        </button>
      </summary>
      <pre
        data-testid={`board-${packageId}`}
        onMouseUp={onSelectionEnd}
        style={{
          fontSize: 11.5,
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.6,
          margin: 0,
          padding: '4px 14px 14px',
          overflowX: 'auto',
        }}
      >
        {highlighted}
      </pre>
    </details>
  )
}

export function ConsoleBoardDrawer({
  board,
  open,
  onClose,
}: {
  readonly board: Readonly<Record<string, unknown>>
  readonly open: boolean
  readonly onClose: () => void
}) {
  const [cue, setCue] = useState<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const flash = (msg: string) => {
    setCue(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCue(undefined), 2200)
  }

  if (!open) return null
  const packages = Object.keys(board)

  return (
    <aside
      data-testid="board-drawer"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: 'min(480px, 92vw)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(8,10,9,0.97)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Live boards
        </span>
        <button
          type="button"
          data-testid="board-drawer-close"
          aria-label="close boards"
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
          }}
        >
          <X size={13} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {packages.length === 0 ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: 14 }}>
            no board pushed yet
          </p>
        ) : (
          packages.map((pkg) => (
            <BoardSection key={pkg} packageId={pkg} board={board[pkg]} onCue={flash} />
          ))
        )}
      </div>
      <div
        data-testid="board-cue"
        aria-live="polite"
        style={{
          position: 'absolute',
          bottom: 12,
          right: 14,
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          padding: '4px 9px',
          borderRadius: 6,
          background: 'rgba(0,255,135,0.14)',
          color: '#00ff87',
          border: '1px solid rgba(0,255,135,0.3)',
          opacity: cue ? 1 : 0,
          transition: 'opacity 160ms ease',
          pointerEvents: 'none',
        }}
      >
        {cue ?? ''}
      </div>
    </aside>
  )
}
