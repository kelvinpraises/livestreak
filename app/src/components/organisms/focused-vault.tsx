import { ResolutionResult } from '#/components/molecules/resolution-result'
import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Fire, X } from '@phosphor-icons/react'
import {
  formatCountdown,
  formatMultiplier,
  formatUSDC,
  formatRate,
  formatShares,
  calcPoolPct,
} from '#/utils/format'
import type { OptionsVault } from '@livestreak/options'
import { useVaultView } from '#/hooks/use-vault-views'
import { FundingComposer } from '#/components/molecules/funding-composer'
import { useStreamDraft } from '#/hooks/use-stream-draft'

interface Props {
  vault: OptionsVault
  onDismiss: () => void
  onStream?: (
    vaultId: string,
    side: 'yes' | 'no',
    rate: number,
    durationMinutes?: number,
  ) => void | Promise<unknown>
  onGoToMint?: () => void
}

export function FocusedVault({ vault, onDismiss, onStream }: Props) {
  const view = useVaultView(vault.vaultId)
  const reducedMotion = useReducedMotion()
  const userPosition = view.userPosition
  const hotUntil = vault.steward.hotUntilMs ?? null

  const draft = useStreamDraft(vault.vaultId)
  const [hotMs, setHotMs] = useState(hotUntil ? Math.max(0, hotUntil - Date.now()) : 0)

  // Only the HOT window carries a real on-chain deadline; tick it while hot.
  useEffect(() => {
    if (!hotUntil) return
    const tick = setInterval(() => setHotMs(Math.max(0, hotUntil - Date.now())), 500)
    return () => clearInterval(tick)
  }, [hotUntil])

  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const totalPool = view.poolTotal ?? noTotal + yesTotal
  const poolPct = calcPoolPct(noTotal, yesTotal)
  const yesOdds = view.odds?.yesMultiplier ?? (yesTotal > 0 ? totalPool / yesTotal : 0)
  const noOdds = view.odds?.noMultiplier ?? (noTotal > 0 ? totalPool / noTotal : 0)
  const isHot = vault.status === 'hot'
  const hasPos = !!userPosition

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      exit={{
        opacity: 0,
        transform: 'translateY(-8px)',
        filter: 'blur(4px)',
        transition: { duration: reducedMotion ? 0 : 0.15 },
      }}
      transition={{ duration: reducedMotion ? 0 : 0.18 }}
      style={{
        flexShrink: 0,
        maxHeight: 'calc(100% - 48px)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '18px 18px 18px',
        background: isHot
          ? 'linear-gradient(180deg, rgba(255,45,120,0.04) 0%, transparent 100%)'
          : 'linear-gradient(180deg, rgba(0,255,135,0.02) 0%, transparent 100%)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            className="display"
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.9)',
              lineHeight: 1.35,
              marginBottom: 6,
              letterSpacing: '0.01em',
            }}
          >
            {vault.question}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isHot ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  background: 'rgba(255,45,120,0.12)',
                  border: '1px solid rgba(255,45,120,0.3)',
                  borderRadius: 4,
                  padding: '1px 6px',
                }}
              >
                <Fire size={9} color="#ff2d78" />
                <span
                  className="mono"
                  style={{ fontSize: 9, fontWeight: 700, color: '#ff2d78' }}
                >
                  HOT {formatCountdown(hotMs)}
                </span>
              </div>
            ) : (
              <span
                className="mono"
                style={{ fontSize: 9, fontWeight: 600, color: '#00ff87' }}
              >
                {vault.status === 'resolved'
                  ? `RESOLVED ${vault.outcome.toUpperCase()}`
                  : vault.status.toUpperCase()}
              </span>
            )}
            <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
              {formatUSDC(totalPool)} pooled
            </span>
          </div>
        </div>
        <button
          aria-label="Close question details"
          onClick={onDismiss}
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            flexShrink: 0,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          <X size={12} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '10px 0',
            borderRadius: 8,
            background:
              hasPos && userPosition?.side === 'yes'
                ? 'rgba(0,255,135,0.1)'
                : 'rgba(0,255,135,0.04)',
            border: `1px solid ${hasPos && userPosition?.side === 'yes' ? 'rgba(0,255,135,0.3)' : 'rgba(0,255,135,0.12)'}`,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 18, fontWeight: 700, color: '#00ff87' }}
          >
            {formatMultiplier(yesOdds)}
          </span>
          <span
            className="mono"
            style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(0,255,135,0.6)' }}
          >
            YES · {formatUSDC(yesTotal)}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '10px 0',
            borderRadius: 8,
            background:
              hasPos && userPosition?.side === 'no'
                ? 'rgba(255,45,120,0.1)'
                : 'rgba(255,45,120,0.04)',
            border: `1px solid ${hasPos && userPosition?.side === 'no' ? 'rgba(255,45,120,0.3)' : 'rgba(255,45,120,0.12)'}`,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 18, fontWeight: 700, color: '#ff2d78' }}
          >
            {formatMultiplier(noOdds)}
          </span>
          <span
            className="mono"
            style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(255,45,120,0.6)' }}
          >
            NO · {formatUSDC(noTotal)}
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            height: 3,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 2,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <div
            style={{
              width: `${(1 - poolPct) * 100}%`,
              background: '#ff2d78',
              opacity: 0.5,
            }}
          />
          <div
            style={{ width: `${poolPct * 100}%`, background: '#00ff87', opacity: 0.5 }}
          />
        </div>
      </div>

      {hasPos && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.025)',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <span
            style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}
          >
            YOUR POS
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78',
            }}
          >
            {userPosition!.side.toUpperCase()}
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
            {formatRate(userPosition!.rate)}
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
            {formatShares(userPosition!.shares)} shares
          </span>
        </div>
      )}

      {vault.status === 'resolved' || vault.status === 'disputed' ? (
        <ResolutionResult vault={vault} />
      ) : (
        <FundingComposer vault={vault} draft={draft} onStream={onStream} />
      )}
    </motion.div>
  )
}
