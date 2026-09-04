import { useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FocusedVault } from '#/components/predictions/FocusedVault'
import { ActivityFeed } from '#/components/feed/ActivityFeed'
import { MyPositions } from '#/components/predictions/MyPositions'
import type { Vault, WSEvent, Position } from '#/data/mock'

type Tab = 'feed' | 'mine'

interface Props {
  vaults: Vault[]
  events: WSEvent[]
  positions: Position[]
  selectedVaultId: string | null
  onDismissVault: () => void
  onStream?: (vaultId: string, side: 'yes' | 'no', rate: number) => void
}

export function VaultList({ vaults, events, positions, selectedVaultId, onDismissVault, onStream }: Props) {
  const [tab, setTab] = useState<Tab>('feed')
  const selectedVault = selectedVaultId ? vaults.find(v => v.id === selectedVaultId) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Focused vault from NikoNiko click */}
      <AnimatePresence>
        {selectedVault && (
          <FocusedVault key="focused-vault" vault={selectedVault} onDismiss={onDismissVault} onStream={onStream} />
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 16px', flexShrink: 0, gap: 4 }}>
        <TabBtn active={tab === 'feed'} onClick={() => setTab('feed')}>LIVE FEED</TabBtn>
        <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')} count={positions.filter(p => !p.resolved).length}>STREAMS</TabBtn>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <AnimatePresence mode="wait">
          {tab === 'feed' && (
            <motion.div key="feed" initial={{ opacity: 0, transform: 'translateX(8px)' }} animate={{ opacity: 1, transform: 'translateX(0px)' }} exit={{ opacity: 0, transform: 'translateX(-8px)', transition: { duration: 0.1 } }} transition={{ duration: 0.15 }} style={{ height: '100%', overflow: 'hidden' }}>
              <ActivityFeed events={events} />
            </motion.div>
          )}
          {tab === 'mine' && (
            <motion.div key="mine" initial={{ opacity: 0, transform: 'translateX(8px)' }} animate={{ opacity: 1, transform: 'translateX(0px)' }} exit={{ opacity: 0, transform: 'translateX(-8px)', transition: { duration: 0.1 } }} transition={{ duration: 0.15 }} style={{ height: '100%', overflow: 'hidden' }}>
              <MyPositions positions={positions} vaults={vaults} onSelectVault={() => { /* scroll up to focused vault handled by parent */ }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 12px 11px', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', fontFamily: 'var(--font-mono)', color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)', position: 'relative', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s cubic-bezier(0.23, 1, 0.32, 1)' }}>
      {children}
      {count !== undefined && count > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: active ? '#00ff87' : 'rgba(255,255,255,0.1)', color: active ? '#000' : 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 700 }}>{count}</span>}
      {active && <motion.div layoutId="vault-tab-indicator" style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'var(--color-green)', borderRadius: 1, boxShadow: '0 0 8px var(--color-green-glow)' }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
    </button>
  )
}
