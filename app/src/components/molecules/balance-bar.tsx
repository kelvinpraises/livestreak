import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wallet, TrendUp, Gift, CaretUp } from '@phosphor-icons/react'
import { formatUSDCFull, formatLvst } from '#/utils/format'
import type { FlowState, WalletState } from '#/utils/mock'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { useWalletActions } from '#/hooks/use-wallet-actions'
import { ScoreUSD } from '#/components/atoms/score-usd'

interface Props {
  flow: FlowState
  wallet: WalletState
  onStake?: (n: number) => void
  onUnstake?: (n: number) => void
  onClaim?: () => void
  claiming?: boolean
}

export function BalanceBar({ flow, wallet, onStake, onUnstake, onClaim, claiming: mockClaiming }: Props) {
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()
  const useOptions = optionsEnabled && options.isConnected
  const walletActions = useWalletActions()

  const [expanded, setExpanded] = useState(false)
  const [stakeAmount, setStakeAmount] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const unstaked = flow.balance - flow.staked

  function parseAmount(): number {
    const n = parseFloat(stakeAmount)
    return Number.isFinite(n) ? n : 0
  }

  const amt = parseAmount()

  const stakeFn = useOptions ? options.findFunction('stakeLvst', fn => fn.target?.kind === 'lvst') : undefined
  const unstakeFn = useOptions ? options.findFunction('unstakeLvst', fn => fn.target?.kind === 'lvst') : undefined
  const claimFn = useOptions ? options.findFunction('claimDividends', fn => fn.target?.kind === 'lvst') : undefined

  const canStake = useOptions
    ? amt > 0 && amt <= unstaked && stakeFn !== undefined && !stakeFn.disabled
    : amt > 0 && amt <= unstaked

  const canUnstake = useOptions
    ? amt > 0 && amt <= flow.staked && unstakeFn !== undefined && !unstakeFn.disabled
    : amt > 0 && amt <= flow.staked

  const canClaim = useOptions
    ? claimFn !== undefined && !claimFn.disabled
    : flow.pendingDividends > 0

  const claiming = useOptions ? options.claiming : (mockClaiming ?? false)

  async function handleStake() {
    if (!canStake) return
    setActionError(null)
    if (useOptions) {
      try {
        await options.stake(amt)
        setStakeAmount('')
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Stake failed')
      }
      return
    }
    onStake?.(amt)
    setStakeAmount('')
  }

  async function handleUnstake() {
    if (!canUnstake) return
    setActionError(null)
    if (useOptions) {
      try {
        await options.unstake(amt)
        setStakeAmount('')
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Unstake failed')
      }
      return
    }
    onUnstake?.(amt)
    setStakeAmount('')
  }

  async function handleClaim() {
    if (!canClaim || claiming) return
    setActionError(null)
    if (useOptions) {
      try {
        await options.claimDividends()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Claim failed')
      }
      return
    }
    onClaim?.()
  }

  const stakeTitle = useOptions && stakeFn?.disabled ? stakeFn.disabledReason : undefined
  const unstakeTitle = useOptions && unstakeFn?.disabled ? unstakeFn.disabledReason : undefined
  const claimTitle = useOptions && claimFn?.disabled ? claimFn.disabledReason : undefined

  return (
    <div className="balance-bar-bg" style={{ flexShrink: 0 }}>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { type: 'spring', stiffness: 380, damping: 35, opacity: { duration: 0.1 } } }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
                <Stat label="Available" value={formatLvst(unstaked)} accent="#00ff87" />
                <Stat label="Staked" value={formatLvst(flow.staked)} accent="#00c8ff" />
              </div>
              {actionError && (
                <p style={{ fontSize: 11, color: '#ff2d78', marginBottom: 10 }}>{actionError}</p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Amount"
                  value={stakeAmount}
                  onChange={e => setStakeAmount(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 10px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, fontSize: 12,
                    color: '#fff', fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleStake}
                  disabled={!canStake || claiming}
                  title={stakeTitle}
                  className="btn-primary"
                  style={{
                    fontSize: 11, padding: '6px 12px',
                    opacity: canStake && !claiming ? 1 : 0.45,
                    cursor: canStake && !claiming ? 'pointer' : 'not-allowed',
                  }}
                >
                  Stake
                </button>
                <button
                  onClick={handleUnstake}
                  disabled={!canUnstake || claiming}
                  title={unstakeTitle}
                  style={{
                    fontSize: 11, padding: '6px 12px',
                    borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
                    opacity: canUnstake && !claiming ? 1 : 0.45,
                    cursor: canUnstake && !claiming ? 'pointer' : 'not-allowed',
                    fontFamily: 'var(--font-sans)', fontWeight: 500,
                  }}
                >
                  Unstake
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div style={{ height: 52, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 4 }}>
        {wallet.connected && (
          <><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Wallet size={13} color="rgba(255,255,255,0.35)" />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>USDC</span>
            <ScoreUSD value={wallet.usdcBalance} className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }} />
            {walletActions.canTopUp && (
              <button
                onClick={() => { void walletActions.topUp().catch(() => {}) }}
                disabled={walletActions.isToppingUp}
                title="Dev faucet — mint test USDC to your Safe (local stack only)"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, marginLeft: 2, borderRadius: 5,
                  border: '1px solid rgba(0,200,255,0.3)', background: 'rgba(0,200,255,0.08)',
                  color: '#00c8ff', fontSize: 13, lineHeight: 1, fontWeight: 600,
                  cursor: walletActions.isToppingUp ? 'wait' : 'pointer',
                  opacity: walletActions.isToppingUp ? 0.5 : 1,
                  padding: 0,
                }}
              >
                {walletActions.isToppingUp ? '·' : '+'}
              </button>
            )}
          </div><div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 12px' }} /></>
        )}
        <button onClick={() => setExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6 }}>
          <TrendUp size={13} color="rgba(0,200,255,0.6)" />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>$LVST</span>
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
          {(flow.pendingDividends > 0 || useOptions) && (
            <button
              onClick={handleClaim}
              disabled={!canClaim || claiming}
              title={claimTitle}
              className="btn-primary"
              style={{
                fontSize: 11, padding: '3px 10px', marginLeft: 4,
                opacity: canClaim && !claiming ? 1 : 0.45,
                cursor: canClaim && !claiming ? 'pointer' : 'not-allowed',
              }}
            >
              {claiming ? '...' : 'CLAIM'}
            </button>
          )}
        </div>
        <div style={{ flex: 1 }} />
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
