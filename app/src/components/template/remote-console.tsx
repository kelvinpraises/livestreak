// The Remote Bridge Console page shell (P5): password gate → package tabs → a single per-package
// function container (id/parentId tree with auto-forms from inputSchema) on the left, and a
// collapsible Live Board rail on the right. Renders ONLY the functions the host advertised for this
// session (already grant-filtered; the transport mirrors the filter defensively). Every call goes
// over the transport to the host relay — no local seed here.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CallActionEnvelope,
  ConsolePackage,
  FunctionDescriptor,
} from '@livestreak/schema'
import { bridgeActionScope } from '@livestreak/schema'
import { AutoForm } from '#/components/organisms/auto-form'
import { FunctionTree } from '#/components/organisms/function-tree'
import { useRemote } from '#/providers/remote-provider'

const PACKAGE_TABS: readonly { id: ConsolePackage; label: string }[] = [
  { id: 'observe', label: 'Observe' },
  { id: 'options', label: 'Options' },
  { id: 'bookmaker', label: 'Bookmaker' },
  { id: 'steward', label: 'Steward' },
]

const packageLabel = (id: ConsolePackage): string =>
  PACKAGE_TABS.find((t) => t.id === id)?.label ?? id

// The ids the bridge already knows from the function's target (and the connected holder)
// are passed straight through as args — never asked for in the form (scope-app §P5.2).
const prefilledFor = (fn: FunctionDescriptor): Record<string, unknown> => {
  const t = fn.target
  const out: Record<string, unknown> = {}
  if (t?.marketId) out.marketId = t.marketId
  if (t?.vaultId) out.vaultId = t.vaultId
  if (t?.tokenId) out.tokenId = t.tokenId
  if (t?.side) out.side = t.side
  return out
}

export function RemoteConsole() {
  const { status } = useRemote()
  if (status !== 'open') return <PasswordGate />
  return <ConsoleBody />
}

function PasswordGate() {
  const { session, redeem, status, error } = useRemote()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await redeem(password)
    } catch {
      /* error surfaced via context */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '12vh auto', padding: 24 }}>
      <h1 className="display" style={{ fontSize: 20, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>
        Remote Console
      </h1>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
        session: {session}
      </p>
      <form data-testid="remote-gate-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          data-testid="remote-password"
          type="password"
          value={password}
          placeholder="Session password"
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          style={{
            fontSize: 13,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.9)',
            fontFamily: 'var(--font-sans)',
          }}
        />
        <button
          data-testid="remote-unlock"
          type="submit"
          disabled={busy || status === 'redeeming' || status === 'connecting'}
          style={{
            fontSize: 13,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(0,255,135,0.35)',
            background: 'rgba(0,255,135,0.12)',
            color: '#00ff87',
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {error ? (
          <span style={{ fontSize: 11, color: '#ff2d78', fontFamily: 'var(--font-mono)' }}>{error}</span>
        ) : null}
      </form>
    </div>
  )
}

function ConsoleBody() {
  const { functions, board, grant, callRemote } = useRemote()
  const [activePackage, setActivePackage] = useState<ConsolePackage>('observe')
  const [boardOpen, setBoardOpen] = useState(true)

  const packageFns = useMemo(
    () => functions.filter((fn) => fn.package === activePackage),
    [functions, activePackage]
  )

  const activeBoard = board[activePackage] ?? {}

  const packagesWithFns = useMemo(() => {
    const set = new Set(functions.map((f) => f.package))
    return PACKAGE_TABS.filter((t) => set.has(t.id))
  }, [functions])

  // Count only callable, currently-VISIBLE functions (exclude structural group panes + board-first
  // hidden actions) so every package reads the same way — ~2 (configure + close) on start, growing as
  // configure reveals more. Without this the badges show inflated raw descriptor counts.
  const isCountable = (f: FunctionDescriptor): boolean => f.visible !== false && f.nodeKind !== 'group'
  const countableTotal = functions.filter(isCountable).length

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 className="display" style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)' }}>
          Remote Console
        </h1>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>
          {countableTotal} function{countableTotal === 1 ? '' : 's'} in scope
          {grant ? ` · grant ${grant.id}` : ''}
        </span>
      </div>

      <div
        data-testid="package-tabs"
        style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}
      >
        {PACKAGE_TABS.map((tab) => {
          const active = tab.id === activePackage
          const count = functions.filter((f) => f.package === tab.id && isCountable(f)).length
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`package-tab-${tab.id}`}
              onClick={() => setActivePackage(tab.id)}
              style={{
                fontSize: 12,
                padding: '6px 12px',
                borderRadius: 6,
                border: active ? '1px solid rgba(0,255,135,0.45)' : '1px solid rgba(255,255,255,0.1)',
                background: active ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.03)',
                color: active ? '#00ff87' : 'rgba(255,255,255,0.55)',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}
            >
              {tab.label}
              {count > 0 ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {functions.length === 0 ? (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              No functions are authorised for this session.
            </p>
          ) : packagesWithFns.length > 0 && !packagesWithFns.some((t) => t.id === activePackage) ? (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              No functions in the {activePackage} package for this session.
            </p>
          ) : (
            <FunctionTree
              functions={packageFns}
              packageLabel={packageLabel(activePackage)}
              renderAction={(fn) => (
                <FunctionCard
                  key={fn.id}
                  fn={fn}
                  onCall={(envelope) => callRemote(envelope, fn.package)}
                />
              )}
            />
          )}
        </div>

        <BoardRail
          packageId={activePackage}
          board={activeBoard}
          open={boardOpen}
          onToggle={() => setBoardOpen((o) => !o)}
        />
      </div>
    </div>
  )
}

function FunctionCard({
  fn,
  onCall,
}: {
  fn: FunctionDescriptor
  onCall: (envelope: CallActionEnvelope) => Promise<{ ok: boolean; error?: string }>
}) {
  const [result, setResult] = useState<{ text: string; ok: boolean } | undefined>(undefined)
  const prefilled = useMemo(() => prefilledFor(fn), [fn])
  const resultTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(resultTimer.current), [])

  const submit = async (args: Record<string, unknown>) => {
    const envelope: CallActionEnvelope = { scope: bridgeActionScope, action: fn.name, args }
    const res = await onCall(envelope)
    setResult(res.ok ? { text: '✓ sent', ok: true } : { text: `✗ ${res.error ?? 'failed'}`, ok: false })
    // Auto-dismiss after 3s. The row below is ALWAYS rendered (opacity toggles, not mount/unmount), so
    // showing and hiding the result never shifts the card's layout.
    clearTimeout(resultTimer.current)
    resultTimer.current = setTimeout(() => setResult(undefined), 3000)
  }

  return (
    <div
      data-testid={`remote-fn-${fn.name}`}
      style={{
        position: 'relative',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.02)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div>
        <h3 style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', margin: 0 }}>{fn.label}</h3>
        {Object.keys(prefilled).length > 0 ? (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>
            {Object.entries(prefilled).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
          </span>
        ) : null}
      </div>
      <AutoForm
        inputSchema={fn.inputSchema}
        prefilled={prefilled}
        onSubmit={submit}
        submitLabel={fn.label}
        disabled={fn.disabled}
      />
      {fn.disabled && fn.disabledReason ? (
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{fn.disabledReason}</span>
      ) : null}
      {/* Absolute badge in the card corner — fades in/out, takes NO layout space, so there is neither a
          chin nor any CLS. Mirrors the board's cue badge for a consistent feel. */}
      <span
        aria-live="polite"
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          padding: '2px 7px',
          borderRadius: 6,
          color: result?.ok === false ? '#ff2d78' : '#00ff87',
          background: result?.ok === false ? 'rgba(255,45,120,0.12)' : 'rgba(0,255,135,0.12)',
          border: result?.ok === false ? '1px solid rgba(255,45,120,0.3)' : '1px solid rgba(0,255,135,0.3)',
          opacity: result ? 1 : 0,
          transition: 'opacity 160ms ease',
          pointerEvents: 'none',
        }}
      >
        {result?.text ?? ''}
      </span>
    </div>
  )
}

// Lightweight JSON syntax styling for the board: keys are brighter + a little bolder, values keep
// their tone, and punctuation/structure recedes — easier on the eyes without a highlighter dependency.
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
      // object key: the quoted name (bold) plus its colon (punctuation)
      out.push(<span key={key++} style={KEY_STYLE}>{tok.slice(0, -1)}</span>)
      out.push(<span key={key++} style={PUNCT_STYLE}>:</span>)
    } else {
      // string / number / boolean / null value — kept as-is
      out.push(<span key={key++} style={VALUE_STYLE}>{tok}</span>)
    }
    last = m.index + tok.length
  }
  if (last < json.length) {
    out.push(<span key={key++} style={PUNCT_STYLE}>{json.slice(last)}</span>)
  }
  return out
}

// The Live Board rail: sticky right column, collapsible to a thin strip so the function list can take
// the full width when there are many functions. Copy lifts the whole JSON; selecting text and releasing
// copies just the selection. Feedback shows in an absolutely-positioned cue badge (fades in/out, never
// shifts layout) and auto-clears.
function BoardRail({
  packageId,
  board,
  open,
  onToggle,
}: {
  packageId: string
  board: unknown
  open: boolean
  onToggle: () => void
}) {
  const [cue, setCue] = useState<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const json = useMemo(() => JSON.stringify(board, null, 2), [board])
  const highlighted = useMemo(() => highlightJson(json), [json])

  const flash = (msg: string) => {
    setCue(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCue(undefined), 2200)
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(json)
      flash('Copied ✓')
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  // Selection-to-copy: when a drag-select inside the board ends, copy exactly what was selected.
  const onSelectionEnd = async () => {
    const selection = window.getSelection?.()?.toString() ?? ''
    if (selection.length === 0) return
    try {
      await navigator.clipboard.writeText(selection)
      flash(`copied ${selection.length} chars to clipboard`)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="board-toggle"
        onClick={onToggle}
        title="Show live board"
        style={{
          position: 'sticky',
          top: 16,
          width: 34,
          minHeight: 120,
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.02)',
          color: 'rgba(255,255,255,0.5)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          cursor: 'pointer',
          writingMode: 'vertical-rl',
          padding: '12px 0',
          textTransform: 'uppercase',
        }}
      >
        ‹ Board · {packageId}
      </button>
    )
  }

  return (
    <aside
      style={{
        position: 'sticky',
        top: 16,
        width: 476,
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        background: 'rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.55)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Live Board · {packageId}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="board-copy"
            onClick={onCopy}
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
            }}
          >
            Copy
          </button>
          <button
            type="button"
            data-testid="board-toggle"
            onClick={onToggle}
            title="Collapse live board"
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
            }}
          >
            ›
          </button>
        </div>
      </div>
      <pre
        data-testid={`board-${packageId}`}
        onMouseUp={onSelectionEnd}
        style={{
          fontSize: 11.5,
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.6,
          margin: 0,
          padding: 16,
          maxHeight: 'calc(100vh - 200px)',
          overflow: 'auto',
        }}
      >
        {highlighted}
      </pre>
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
