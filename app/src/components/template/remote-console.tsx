// The Remote Bridge Console page shell (P5): password gate → package tabs → function
// tree (id/parentId) with auto-forms from inputSchema → relayed call → per-package
// board readout. Renders ONLY the functions the host advertised for this session
// (already grant-filtered; the transport mirrors the filter defensively). No seed here —
// every call goes over the transport to the host relay.

import { useMemo, useState } from 'react'
import type {
  CallActionEnvelope,
  ConsolePackage,
  FunctionDescriptor,
  FunctionDescriptorTarget,
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

const groupLabel = (t?: FunctionDescriptorTarget): string => {
  const kind = t?.kind ?? 'global'
  switch (kind) {
    case 'market':
      return 'Markets'
    case 'vault':
      return 'Vaults'
    case 'nft':
      return 'Positions'
    case 'lvst':
      return '$LVST'
    default:
      return 'Global'
  }
}

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
  const [activePackage, setActivePackage] = useState<ConsolePackage>('options')

  const packageFns = useMemo(
    () => functions.filter((fn) => fn.package === activePackage),
    [functions, activePackage]
  )

  const activeBoard = board[activePackage] ?? {}

  const packagesWithFns = useMemo(() => {
    const set = new Set(functions.map((f) => f.package))
    return PACKAGE_TABS.filter((t) => set.has(t.id))
  }, [functions])

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: 22, color: 'rgba(255,255,255,0.9)' }}>
          Remote Console
        </h1>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>
          {functions.length} function{functions.length === 1 ? '' : 's'} in scope
          {grant ? ` · grant ${grant.id}` : ''}
        </span>
      </div>

      <div
        data-testid="package-tabs"
        style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}
      >
        {PACKAGE_TABS.map((tab) => {
          const active = tab.id === activePackage
          const count = functions.filter((f) => f.package === tab.id).length
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
          renderAction={(fn) => (
            <FunctionCard
              key={fn.id}
              fn={fn}
              groupName={groupLabel(fn.target)}
              onCall={(envelope) => callRemote(envelope, fn.package)}
            />
          )}
        />
      )}

      <BoardView packageId={activePackage} board={activeBoard} />
    </div>
  )
}

function FunctionCard({
  fn,
  groupName,
  onCall,
}: {
  fn: FunctionDescriptor
  groupName: string
  onCall: (envelope: CallActionEnvelope) => Promise<{ ok: boolean; error?: string }>
}) {
  const [result, setResult] = useState<string | undefined>(undefined)
  const prefilled = useMemo(() => prefilledFor(fn), [fn])

  const submit = async (args: Record<string, unknown>) => {
    const envelope: CallActionEnvelope = { scope: bridgeActionScope, action: fn.name, args }
    const res = await onCall(envelope)
    setResult(res.ok ? '✓ sent' : `✗ ${res.error ?? 'failed'}`)
  }

  return (
    <div
      data-testid={`remote-fn-${fn.name}`}
      style={{
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
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase' }}>
          {groupName}
        </span>
        <h3 style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', margin: '2px 0 0' }}>{fn.label}</h3>
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
      {result ? (
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: result.startsWith('✓') ? '#00ff87' : '#ff2d78' }}>
          {result}
        </span>
      ) : null}
    </div>
  )
}

function BoardView({ packageId, board }: { packageId: string; board: unknown }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Live Board · {packageId}
      </h2>
      <pre
        data-testid={`board-${packageId}`}
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'rgba(255,255,255,0.7)',
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
          padding: 14,
          overflowX: 'auto',
        }}
      >
        {JSON.stringify(board, null, 2)}
      </pre>
    </div>
  )
}
