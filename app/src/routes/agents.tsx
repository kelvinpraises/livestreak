import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AnimatePresence } from 'framer-motion'
import { Robot } from '@phosphor-icons/react'
import type { Agent, AgentRole } from '#/types/ui'
import { env } from '#/utils/env'
import { fetchAgents } from '#/utils/host'

export const Route = createFileRoute('/agents')({
  component: AgentsPage,
})

type FilterTab = 'all' | AgentRole

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bookmaker', label: 'Bookmakers' },
  { key: 'steward', label: 'Stewards' },
  { key: 'observer', label: 'Observers' },
]

/** Agents from the Host catalog. */
function useAgents() {
  const [live, setLive] = useState<Agent[]>([])
  const [source, setSource] = useState<string>('unavailable')

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLive([])

    void fetchAgents(env.hostBaseUrl)
      .then(rows => { if (!cancelled) { setLive([...rows.agents]); setSource(rows.source ?? 'unavailable'); setReady(true); setError(null) } })
      .catch(err => { if (!cancelled) { setReady(true); setError(err instanceof Error ? err.message : String(err)) } })

    return () => { cancelled = true }
  }, [])

  return { agents: live, ready, error, source }
}

function AgentsPage() {
  const { agents: allAgents, ready, error, source } = useAgents()
  const [filter, setFilter] = useState<FilterTab>('all')
  const filtered = filter === 'all' ? allAgents : allAgents.filter(a => a.role === filter)
  const sorted = filtered

  return (
    <div style={{ overflowY: 'auto', height: 'calc(100vh - 56px)' }}>
      <section style={{ padding: '48px 24px 0', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Robot size={24} color="#00ff87" />
          <h1 className="display" style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>Agents</h1>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 28, maxWidth: 480 }}>
          Bookmakers, stewards and observers. Activity and performance indexing is not available yet.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'BOOKMAKERS', value: allAgents.filter(a => a.role === 'bookmaker').length, accent: '#00ff87' },
            { label: 'STEWARDS', value: allAgents.filter(a => a.role === 'steward').length, accent: '#ffd553' },
            { label: 'OBSERVERS', value: allAgents.filter(a => a.role === 'observer').length, accent: '#00c8ff' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>{s.label}</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: s.accent }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 20 }}>
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)} className={filter === tab.key ? 'tab-active' : ''}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 16px 11px', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', fontFamily: 'var(--font-mono)', color: filter === tab.key ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)', position: 'relative', transition: 'color 0.15s cubic-bezier(0.23, 1, 0.32, 1)' }}>
              {tab.label.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section style={{ padding: '0 24px 48px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!ready && <p role="status" style={{ color: 'rgba(255,255,255,0.5)' }}>Loading agents…</p>}
          {error && <p role="alert" style={{ color: '#ffd553' }}>Agent directory unavailable. Reload to retry.</p>}
          {ready && !error && sorted.length === 0 && <p style={{ color: 'rgba(255,255,255,0.5)' }}>Agent activity has not been indexed. No measured rankings are available.</p>}
          <AnimatePresence mode="popLayout">
            {source === 'configured' && sorted.map(agent => <div key={agent.id} style={{ padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'var(--color-bg-card)' }}><span className="display" style={{ color: '#fff' }}>{agent.name}</span><span className="mono" style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 12 }}>{agent.role} · {agent.address}</span></div>)}
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
}
