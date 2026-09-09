import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import { Robot, Eye, Shield, Crosshair, CaretDown, Pulse, TrendUp, Medal } from '@phosphor-icons/react'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'
import type { Agent, AgentRole } from '#/types/demo'
import { env } from '#/utils/env'
import { fetchAgentRows } from '#/utils/host'
import { formatUSDCFull } from '#/utils/format'

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

/**
 * Agents directory.
 *  - DEMO mode -> the fixture's agents.
 *  - LIVE mode -> the HOST's `GET /agents` aggregate (NOT the single-market board). Honest
 *                 empty state while loading / on error — no silent fixture fallback.
 */
function useAgents(): Agent[] {
  const preferFixture = usePreferFixture()
  const fixtureAgents = useParsedFixture().agents
  const [live, setLive] = useState<Agent[]>([])

  useEffect(() => {
    if (preferFixture) return
    let cancelled = false
    setLive([])

    void fetchAgentRows(env.hostBaseUrl)
      .then(rows => { if (!cancelled) setLive(rows) })
      .catch(() => { if (!cancelled) setLive([]) })

    return () => { cancelled = true }
  }, [preferFixture])

  return preferFixture ? fixtureAgents : live
}

function AgentsPage() {
  const allAgents = useAgents()
  const [filter, setFilter] = useState<FilterTab>('all')
  const filtered = filter === 'all' ? allAgents : allAgents.filter(a => a.role === filter)
  const sorted = [...filtered].sort((a, b) => b.reputation - a.reputation)

  return (
    <div style={{ overflowY: 'auto', height: 'calc(100vh - 56px)' }}>
      <section style={{ padding: '48px 24px 0', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Robot size={24} color="#00ff87" />
          <h1 className="display" style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>Agent Leaderboard</h1>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 28, maxWidth: 480 }}>
          Autonomous agents that create markets, resolve outcomes, and observe streams. Ranked by reputation.
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
          <AnimatePresence mode="popLayout">
            {sorted.map((agent, i) => <AgentCard key={agent.id} agent={agent} rank={i + 1} />)}
          </AnimatePresence>
        </div>
      </section>
    </div>
  )
}

const roleConfig: Record<AgentRole, { icon: typeof Robot; color: string; label: string }> = {
  bookmaker: { icon: Crosshair, color: '#00ff87', label: 'Bookmaker' },
  steward: { icon: Shield, color: '#ffd553', label: 'Steward' },
  observer: { icon: Eye, color: '#00c8ff', label: 'Observer' },
}

function AgentCard({ agent, rank }: { agent: Agent; rank: number }) {
  const [expanded, setExpanded] = useState(false)
  const rc = roleConfig[agent.role]
  const RoleIcon = rc.icon

  return (
    <motion.div layout initial={{ opacity: 0, transform: 'translateY(8px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0, transform: 'translateY(-6px)' }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      style={{ background: 'var(--color-bg-card)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.2s' }}>
      <div onClick={() => setExpanded(e => !e)} style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 32, minWidth: 32, textAlign: 'center' }}>
          <span className="mono" style={{ fontSize: rank <= 3 ? 16 : 14, fontWeight: 700, color: rank === 1 ? '#ffd553' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : 'rgba(255,255,255,0.2)' }}>#{rank}</span>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${rc.color}12`, border: `1px solid ${rc.color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <RoleIcon size={18} color={rc.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span className="display" style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.01em' }}>{agent.name}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: rc.color, background: `${rc.color}12`, border: `1px solid ${rc.color}25`, padding: '1px 8px', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>{rc.label}</span>
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{agent.address}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 2 }}>ACCURACY</div>
            <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: agent.accuracy >= 90 ? '#00ff87' : agent.accuracy >= 70 ? '#ffd553' : '#ff7a00' }}>{agent.accuracy}%</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginBottom: 2 }}>REPUTATION</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 48, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${agent.reputation}%`, height: '100%', background: agent.reputation >= 90 ? '#00ff87' : agent.reputation >= 70 ? '#ffd553' : '#ff7a00', borderRadius: 2 }} />
              </div>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)' }}>{agent.reputation}</span>
            </div>
          </div>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }} style={{ color: 'rgba(255,255,255,0.2)' }}>
            <CaretDown size={16} />
          </motion.div>
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 350, damping: 32 }} style={{ overflow: 'hidden' }}>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {agent.role === 'bookmaker' && (<>
                <StatCell icon={Crosshair} label="Win Rate" value={`${agent.winRate}%`} accent="#00ff87" />
                <StatCell icon={Pulse} label="Vaults Created" value={agent.vaultsCreated.toString()} />
                <StatCell icon={TrendUp} label="Volume" value={formatUSDCFull(agent.totalVolume)} accent="#00c8ff" />
                <StatCell icon={Medal} label="Reputation" value={agent.reputation.toString()} accent="#ffd553" />
              </>)}
              {agent.role === 'steward' && (<>
                <StatCell icon={Shield} label="Resolutions" value={(agent.resolutionsConfirmed ?? 0).toString()} />
                <StatCell icon={Pulse} label="Proposals" value={(agent.proposals ?? 0).toString()} />
                <StatCell icon={Crosshair} label="Success Rate" value={`${agent.successRate ?? 0}%`} accent="#00ff87" />
                <StatCell icon={Medal} label="Vetos Used" value={(agent.vetosUsed ?? 0).toString()} accent={agent.vetosUsed ? '#ff2d78' : 'rgba(255,255,255,0.5)'} />
              </>)}
              {agent.role === 'observer' && (<>
                <StatCell icon={Eye} label="Batches" value={(agent.batchesSubmitted ?? 0).toLocaleString()} />
                <StatCell icon={Pulse} label="Vaults Served" value={agent.vaultsMonitored.toString()} />
                <StatCell icon={TrendUp} label="Uptime" value={`${agent.uptime ?? 0}%`} accent="#00ff87" />
                <StatCell icon={Medal} label="Reputation" value={agent.reputation.toString()} accent="#ffd553" />
              </>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StatCell({ icon: Icon, label, value, accent }: { icon: typeof Robot; label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <Icon size={10} color="rgba(255,255,255,0.25)" />
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', fontFamily: 'var(--font-mono)' }}>{label.toUpperCase()}</span>
      </div>
      <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: accent ?? 'rgba(255,255,255,0.75)' }}>{value}</span>
    </div>
  )
}
