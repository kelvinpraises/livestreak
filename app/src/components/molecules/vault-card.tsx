import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Fire, CheckCircle, XCircle, CaretDown, TrendUp, Users } from '@phosphor-icons/react'
import { StreamSlider, mapAccrualPreview } from '#/components/molecules/stream-slider'
import { formatUSDC, formatCountdown, formatMultiplier, formatMinute, calcPoolPct } from '#/utils/format'
import type { VaultView } from '#/types/demo'
import type { OptionsVault, OptionsFunctionView } from '@livestreak/options'
import { DEFAULT_FUND_DURATION_MIN, fundCommitmentUsd } from '#/utils/options'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { OptionsActionButton } from '#/components/atoms/options-action-button'
import { useVaultFundingControls } from '#/hooks/use-vault-funding-controls'
import { useVaultView } from '#/hooks/use-vault-views'
import { useAccrualPreview } from '#/hooks/use-accrual-preview'

export function VaultCard({ vault, index = 0, onStream }: {
  vault: OptionsVault
  index?: number
  /** Single funding flow commit (D): same handler as the floating-card path — mint-if-needed → fund
   *  in live mode, mock notification in demo. */
  onStream?: (vaultId: string, side: 'yes' | 'no', rate: number, durationMinutes?: number) => void
}) {
  const view = useVaultView(vault.vaultId)
  const hotUntil = vault.steward.hotUntilMs ?? null
  // Full-precision USDC pools from the board (A1); fall back to the rounded mock pools in mock mode.
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()
  const useOptions = optionsEnabled && options.isConnected
  const funding = useVaultFundingControls(vault.vaultId)
  const side = view.userPosition?.side
  const [expanded, setExpanded] = useState(false)
  const [streamSide, setStreamSide] = useState<'yes' | 'no' | null>(null)
  const [streamRate, setStreamRate] = useState(0)
  const [fundDurationMin] = useState(DEFAULT_FUND_DURATION_MIN)
  const [fundBusy, setFundBusy] = useState(false)
  const [fundError, setFundError] = useState<string | null>(null)
  // D: the market NFT may not exist yet — the single flow mints it on first fund, so a connected user
  // can still initiate. When not using options (demo) the commit goes through the mock handler.
  const needsMint = useOptions && !funding.hasNft
  const canCommit = !!streamSide
    && streamRate >= 0.01
    && !fundBusy
    && (!useOptions || needsMint || (
      (streamSide === 'yes' ? funding.fundYes : funding.fundNo) !== undefined
      && !(streamSide === 'yes' ? funding.fundYes : funding.fundNo)!.disabled
    ))
  const { preview, loading: previewLoading } = useAccrualPreview(
    vault.vaultId,
    expanded ? streamSide : null,
    expanded ? streamRate : 0,
  )
  const accrualPreview = useMemo(() => mapAccrualPreview(preview), [preview])
  const [hotMs, setHotMs] = useState(hotUntil ? Math.max(0, hotUntil - Date.now()) : 0)
  const [expiryMs, setExpiryMs] = useState(Math.max(0, vault.timing.expiresAtMs - Date.now()))

  useEffect(() => {
    if (vault.status !== 'hot' && vault.status !== 'open') return
    const tick = setInterval(() => {
      if (hotUntil) setHotMs(Math.max(0, hotUntil - Date.now()))
      setExpiryMs(Math.max(0, vault.timing.expiresAtMs - Date.now()))
    }, 500)
    return () => clearInterval(tick)
  }, [hotUntil, vault.timing.expiresAtMs, vault.status])

  const poolPct = calcPoolPct(noTotal, yesTotal)
  const isHot = vault.status === 'hot'
  const isResolved = vault.status === 'resolved'
  const isWin = isResolved && view.userWon === true
  const isLoss = isResolved && view.userWon === false
  const isOpen = vault.status === 'open'
  const hasPos = !!view.userPosition
  const canBet = isOpen || isHot

  let cardStyle: CSSProperties = {}
  if (isHot) cardStyle = { borderColor: 'rgba(255,45,120,0.4)' }
  else if (isWin) cardStyle = { borderColor: 'rgba(255,213,83,0.3)' }
  else if (isLoss) cardStyle = { borderColor: 'rgba(255,255,255,0.04)', opacity: 0.7 }
  else if (isOpen && hasPos) cardStyle = { borderColor: 'rgba(0,255,135,0.2)' }

  // A2: authoritative per-side odds from the board (one formula for YES & NO); recompute only as a
  // mock-mode fallback.
  const yesMultiplier = view.odds?.yesMultiplier ?? view.multiplier ?? 1
  const noMultiplier = view.odds?.noMultiplier ?? (yesTotal > 0 ? (noTotal + yesTotal) / noTotal : 1)

  return (
    <motion.div
      id={`vault-${vault.vaultId}`}
      data-testid={`vault-card-${vault.vaultId}`}
      layout
      initial={{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(4px)' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: index * 0.04 }}
      className={`glass-card ${isHot ? 'card-hot' : ''} ${isWin ? 'card-win' : ''}`}
      style={{ marginBottom: 6, overflow: 'visible', ...cardStyle }}
    >
      {isWin && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(255,213,83,0.05) 0%, transparent 50%)',
          pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      <div style={{ padding: '10px 14px', position: 'relative', zIndex: 1 }}>
        {/* Row 1: Question + Status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="display" style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)', lineHeight: 1.35, marginBottom: 3, letterSpacing: '0.01em' }}>
              {vault.question}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                {formatMinute(view.createdMinute ?? 0)} &middot; {vault.type}
              </span>
              {hasPos && canBet && (
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: view.userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78',
                  background: view.userPosition!.side === 'yes' ? 'rgba(0,255,135,0.1)' : 'rgba(255,45,120,0.1)',
                  padding: '1px 5px', borderRadius: 3,
                }}>
                  {view.userPosition!.side.toUpperCase()} &middot; {formatUSDC(view.userPosition!.streamed)}
                </span>
              )}
            </div>
          </div>
          <StatusBadge vault={vault} view={view} hotMs={hotMs} expiryMs={expiryMs} />
        </div>

        {/* Row 2: YES / NO buttons */}
        {canBet && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <button
              data-testid={`fund-yes-${vault.vaultId}`}
              className="vault-bet-btn vault-bet-yes"
              onClick={() => setExpanded(true)}
              disabled={funding.useOptions && funding.fundYes?.disabled && !funding.activeFundedSide}
              title={funding.fundYes?.disabledReason}
              style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 0', borderRadius: 7, border: '1px solid rgba(0,255,135,0.25)',
              background: hasPos && view.userPosition?.side === 'yes' ? 'rgba(0,255,135,0.15)' : 'rgba(0,255,135,0.06)',
              cursor: funding.useOptions && funding.fundYes?.disabled && !funding.activeFundedSide ? 'not-allowed' : 'pointer',
              opacity: funding.useOptions && funding.fundYes?.disabled && !funding.activeFundedSide ? 0.45 : 1,
              transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: '#00ff87' }}>YES</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(0,255,135,0.6)' }}>+{formatMultiplier(yesMultiplier)}</span>
            </button>
            <button data-testid={`fund-no-${vault.vaultId}`} className="vault-bet-no" onClick={() => setExpanded(true)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 0', borderRadius: 7, border: '1px solid rgba(255,45,120,0.25)',
              background: hasPos && view.userPosition?.side === 'no' ? 'rgba(255,45,120,0.15)' : 'rgba(255,45,120,0.06)',
              cursor: funding.useOptions && funding.fundNo?.disabled && !funding.activeFundedSide ? 'not-allowed' : 'pointer',
              opacity: funding.useOptions && funding.fundNo?.disabled && !funding.activeFundedSide ? 0.45 : 1,
              transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            }}
              disabled={funding.useOptions && funding.fundNo?.disabled && !funding.activeFundedSide}
              title={funding.fundNo?.disabledReason}
            >
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: '#ff2d78' }}>NO</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,45,120,0.6)' }}>+{formatMultiplier(noMultiplier)}</span>
            </button>
          </div>
        )}

        {/* Row 3: Pool bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: canBet ? 4 : 8 }}>
          <span className="mono" style={{ fontSize: 10, color: '#ff2d78', minWidth: 28, textAlign: 'right' }}>{formatUSDC(noTotal)}</span>
          <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, rgba(255,45,120,0.0) 0%, #00ff87 100%)', transform: `scaleX(${poolPct})`, transformOrigin: 'left', transition: 'transform 0.25s cubic-bezier(0.23, 1, 0.32, 1)' }} />
          </div>
          <span className="mono" style={{ fontSize: 10, color: '#00ff87', minWidth: 28 }}>{formatUSDC(yesTotal)}</span>
        </div>

        {/* Win / Loss states */}
        <AnimatePresence>
          {isWin && (
            <WinState
              payout={view.payout ?? 0}
              useOptions={useOptions}
              withdrawFn={useOptions ? options.findFunction('withdraw', fn => fn.target?.vaultId === vault.vaultId && fn.target?.kind === 'vault') : undefined}
              onClaimWin={() => options.claimWin(vault.vaultId)}
            />
          )}
          {isLoss && (
            <LossState
              lvstReceived={view.lvstReceived ?? 0}
              side={side ?? 'yes'}
              useOptions={useOptions}
              claimLossFn={useOptions && side ? options.findFunction('claimLossLvst', fn => fn.target?.vaultId === vault.vaultId && fn.target?.side === side && fn.target?.kind === 'vault') : undefined}
              onClaimLoss={async () => { if (side) await options.claimLoss(vault.vaultId, side) }}
            />
          )}
        </AnimatePresence>

        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          width: '100%', marginTop: 2, padding: '3px 0 0',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.18)', fontSize: 10,
        }}>
          <span>{expanded ? 'collapse' : 'details'}</span>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
            <CaretDown size={11} />
          </motion.div>
        </button>
      </div>

      {/* Expanded section */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { type: 'spring', stiffness: 400, damping: 35, opacity: { duration: 0.1 } } }}
            transition={{ type: 'spring', stiffness: 350, damping: 32 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
              {canBet && (
                <div data-testid={`fund-amount-${vault.vaultId}`} style={{ marginBottom: 14 }}>
                  <StreamSlider
                    vaultId={vault.vaultId}
                    initialSide={funding.activeFundedSide ?? view.userPosition?.side ?? null}
                    initialRate={view.userPosition ? 0.8 : 0}
                    compact
                    fundYes={funding.fundYes}
                    fundNo={funding.fundNo}
                    stopFn={funding.stopFn}
                    activeFundedSide={funding.activeFundedSide}
                    onStopFunding={funding.activeFundedSide
                      ? () => funding.stopFunding(vault.vaultId, funding.activeFundedSide!)
                      : undefined}
                    sharePriceYes={view.sharePriceYes}
                    sharePriceNo={view.sharePriceNo}
                    accrualPreview={accrualPreview}
                    previewLoading={previewLoading}
                    showPreview={funding.useOptions}
                    onStream={(nextSide, nextRate) => { setStreamSide(nextSide); setStreamRate(nextRate) }}
                  />
                  {streamSide && streamRate > 0.01 && (
                    <p className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', margin: '8px 0 0' }}>
                      Funding ${fundCommitmentUsd(streamRate, fundDurationMin).toFixed(2)} over {fundDurationMin} min
                    </p>
                  )}
                  <button
                    data-testid={`fund-submit-${vault.vaultId}`}
                    disabled={!canCommit}
                    onClick={async () => {
                      if (!streamSide || !onStream) return
                      setFundError(null)
                      setFundBusy(true)
                      try {
                        await onStream(vault.vaultId, streamSide, streamRate, fundDurationMin)
                      } catch (err) {
                        setFundError(err instanceof Error ? err.message : 'Fund failed')
                      } finally {
                        setFundBusy(false)
                      }
                    }}
                    style={{
                      width: '100%', marginTop: 10, padding: '9px 0',
                      fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)',
                      letterSpacing: '0.04em', borderRadius: 7, border: 'none',
                      cursor: canCommit ? 'pointer' : 'default',
                      background: streamSide === 'yes' ? '#00ff87' : streamSide === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.06)',
                      color: streamSide ? '#000' : 'rgba(255,255,255,0.25)',
                      opacity: canCommit ? 1 : 0.45,
                      transition: 'background 0.2s, color 0.2s, opacity 0.2s',
                    }}
                  >
                    {fundBusy
                      ? '...'
                      : !streamSide
                        ? 'DRAG TO CHOOSE A SIDE'
                        : needsMint
                          ? `BACK VAULT → ${streamSide.toUpperCase()}`
                          : `STREAM → ${streamSide.toUpperCase()}`}
                  </button>
                  {fundError && (
                    <p style={{ fontSize: 9, color: '#ff7a00', margin: '6px 0 0' }}>{fundError}</p>
                  )}
                </div>
              )}
              <ExpandedDetails vault={vault} poolPct={poolPct} view={view} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StatusBadge({ vault, view, hotMs, expiryMs }: { vault: OptionsVault; view: VaultView; hotMs: number; expiryMs: number }) {
  if (vault.status === 'hot') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div className="broadcast-corners broadcast-corners-pink" style={{
        display: 'flex', alignItems: 'center', gap: 3,
        background: 'rgba(255,45,120,0.12)', border: '1px solid rgba(255,45,120,0.35)',
        borderRadius: 5, padding: '2px 8px', overflow: 'visible',
      }}>
        <Fire size={10} color="#ff2d78" />
        <span className="display" style={{ fontSize: 10, fontWeight: 700, color: '#ff2d78', letterSpacing: '0.06em' }}>{severityLabel(view.severity)}</span>
      </div>
      <span className="mono" style={{ fontSize: 10, color: '#ff7a00', textShadow: '0 0 8px rgba(255,122,0,0.3)' }}>{formatCountdown(hotMs)}</span>
    </div>
  )
  if (vault.status === 'resolved') {
    if (view.userWon === true) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <CheckCircle size={12} color="#ffd553" weight="fill" />
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: '#ffd553' }}>WON</span>
      </div>
    )
    if (view.userWon === false) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <XCircle size={12} color="rgba(255,255,255,0.25)" />
        <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>RESOLVED</span>
      </div>
    )
    return <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>RESOLVED</span>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.18)',
        borderRadius: 5, padding: '2px 6px',
      }}>
        <div className="live-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff87' }} />
        <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: '#00ff87' }}>OPEN</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Clock size={9} color="rgba(255,255,255,0.25)" />
        <span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{formatCountdown(expiryMs)}</span>
      </div>
    </div>
  )
}

function WinState({ payout, useOptions, withdrawFn, onClaimWin }: {
  payout: number
  useOptions: boolean
  withdrawFn?: OptionsFunctionView
  onClaimWin: () => Promise<unknown>
}) {
  return (
    <motion.div initial={{ scale: 0.95, opacity: 0, filter: 'blur(4px)' }} animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12 } }} transition={{ type: 'spring', stiffness: 350, damping: 30 }} style={{
      background: 'linear-gradient(135deg, rgba(255,213,83,0.08) 0%, rgba(255,150,0,0.04) 100%)',
      border: '1px solid rgba(255,213,83,0.25)', borderRadius: 7, padding: '8px 12px', marginBottom: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <CheckCircle size={14} color="#ffd553" weight="fill" />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ffd553' }}>You won</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="display text-shimmer" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' }}>${payout.toFixed(2)}</span>
        {useOptions && (
          <OptionsActionButton label="Withdraw winnings" fn={withdrawFn} onAction={onClaimWin} variant="green" compact />
        )}
      </div>
    </motion.div>
  )
}

function LossState({ lvstReceived, side, useOptions, claimLossFn, onClaimLoss }: {
  lvstReceived: number
  side: 'yes' | 'no'
  useOptions: boolean
  claimLossFn?: OptionsFunctionView
  onClaimLoss: () => Promise<unknown>
}) {
  void side
  return (
    <motion.div initial={{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12 } }} transition={{ type: 'spring', stiffness: 350, damping: 30 }} style={{
      background: 'rgba(0,200,255,0.04)', border: '1px solid rgba(0,200,255,0.1)',
      borderRadius: 7, padding: '7px 12px', marginBottom: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    }}>
      <div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 1 }}>LOSERS BECOME OWNERS</div>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }}>+{lvstReceived.toLocaleString()} $LVST</span>
      </div>
      {useOptions ? (
        <OptionsActionButton label="Claim LVST" fn={claimLossFn} onAction={onClaimLoss} variant="red" compact />
      ) : (
        <button className="btn-ghost" style={{ fontSize: 10, padding: '4px 10px' }}>Stake</button>
      )}
    </motion.div>
  )
}

function ExpandedDetails({ vault, poolPct, view }: { vault: OptionsVault; poolPct: number; view: VaultView }) {
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const total = view.poolTotal ?? noTotal + yesTotal
  // A2: authoritative odds; recompute only as mock-mode fallback.
  const yesOdds = view.odds?.yesMultiplier ?? (yesTotal > 0 ? (noTotal + yesTotal) / yesTotal : 0)
  const noOdds = view.odds?.noMultiplier ?? (noTotal > 0 ? (noTotal + yesTotal) / noTotal : 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Mini label="Total pool" value={formatUSDC(total)} />
        <Mini label="YES odds" value={`${yesOdds.toFixed(2)}x`} accent="#00ff87" />
        <Mini label="NO odds" value={`${noOdds.toFixed(2)}x`} accent="#ff2d78" />
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
          <span>NO {(100 - poolPct * 100).toFixed(0)}%</span>
          <span>YES {(poolPct * 100).toFixed(0)}%</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <div style={{ width: `${(1 - poolPct) * 100}%`, background: '#ff2d78', opacity: 0.6 }} />
            <div style={{ width: `${poolPct * 100}%`, background: '#00ff87', opacity: 0.6 }} />
          </div>
        </div>
      </div>
      {view.userPosition && (
        <div style={{
          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 7, padding: '8px 10px',
        }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 6, letterSpacing: '0.06em' }}>YOUR POSITION</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <Mini label="Side" value={view.userPosition.side.toUpperCase()} accent={view.userPosition.side === 'yes' ? '#00ff87' : '#ff2d78'} />
            <Mini label="Streamed" value={`$${view.userPosition.streamed.toFixed(2)}`} />
            <Mini label="Shares" value={view.userPosition.shares.toString()} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={10} color="rgba(255,255,255,0.2)" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{vault.vaultId}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <TrendUp size={10} color="rgba(255,255,255,0.2)" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{new Date(vault.timing.createdAtMs).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  )
}

function severityLabel(severity?: number): string {
  if (severity === 0) return 'WARM'
  if (severity === 2) return 'CRITICAL'
  return 'HOT'
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 2, letterSpacing: '0.05em' }}>{label}</div>
      <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: accent ?? 'rgba(255,255,255,0.75)' }}>{value}</div>
    </div>
  )
}
