import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wallet, TrendUp, Gift, CaretUp } from '@phosphor-icons/react'
import { formatUSDCFull, formatFlow } from '#/utils/format'
import type { FlowState, WalletState } from '#/data/mock'

interface Props { flow: FlowState; wallet: WalletState; onStake: (n: number) => void; onUnstake: (n: number) => void; onClaim: () => void; claiming: boolean }

export function BalanceBar({ flow, wallet, onClaim, claiming }: Props) {
  const [expanded, setExpanded] = useState(false)
  const unstaked = flow.balance - flow.staked

  return (
    <div className="balance-bar-bg" style={{ flexShrink: 0 }}>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30, exit: { type: 'spring', stiffness: 380, damping: 35, opacity: { duration: 0.1 } } }} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <Stat label="Available" value={formatFlow(unstaked)} accent="#00ff87" />
              <Stat label="Staked" value={formatFlow(flow.staked)} accent="#00c8ff" />
              <Stat label="APY" value={flow.apy + '%'} accent="#ffd553" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ height: 52, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {wallet.connected && (
          <><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={13} color="rgba(255,255,255,0.35)" />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>USDC</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }}>{formatUSDCFull(wallet.usdcBalance)}</span>
          </div><div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 12px' }} /></>
        )}
        <button onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>
          <TrendUp size={13} color="rgba(0,200,255,0.6)" />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>$FLOW</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{flow.balance.toLocaleString()}</span>
          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>STAKED</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: '#00c8ff' }}>{flow.staked.toLocaleString()}</span>
          <motion.div animate={{ rotate: expanded ? 0 : 180 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}><CaretUp size={13} color="rgba(255,255,255,0.3)" /></motion.div>
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 12px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Gift size={13} color={flow.pendingDividends > 0 ? '#ffd553' : 'rgba(255,255,255,0.25)'} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>DIV</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: flow.pendingDividends > 0 ? '#ffd553' : 'rgba(255,255,255,0.35)' }}>
            {flow.pendingDividends > 0 ? formatUSDCFull(flow.pendingDividends) : '—'}
          </span>
          {flow.pendingDividends > 0 && <button onClick={onClaim} disabled={claiming} className="btn-primary" style={{ fontSize: 11, padding: '3px 10px', marginLeft: 4 }}>{claiming ? '...' : 'CLAIM'}</button>}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>EARNED ALL-TIME</span>
        <span className="mono" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>{formatUSDCFull(flow.totalEarned)}</span>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>{label}</span>
      <span className="mono" style={{ fontSize: 16, fontWeight: 600, color: accent }}>{value}</span>
    </div>
  )
}
