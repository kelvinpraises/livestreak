import { ResolutionResult } from '#/components/molecules/resolution-result'
import { useEffect, useState, type CSSProperties } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  Fire,
  CheckCircle,
  XCircle,
  CaretDown,
  TrendUp,
  Users,
} from '@phosphor-icons/react'
import {
  formatUSDC,
  formatRate,
  formatCountdown,
  formatMultiplier,
  formatMinute,
  formatShares,
  calcPoolPct,
} from '#/utils/format'
import type { VaultView } from '#/types/demo'
import type { OptionsVault } from '@livestreak/options'
import { useVaultView } from '#/hooks/use-vault-views'
import { useVaultCardUi } from '#/hooks/use-board-ui-state'
import { FundingComposer } from '#/components/molecules/funding-composer'
import { useStreamDraft } from '#/hooks/use-stream-draft'

export function VaultCard({
  vault,
  onStream,
  fundingFocused = false,
}: {
  vault: OptionsVault
  index?: number
  fundingFocused?: boolean
  /** Funding creates the viewer position if needed and confirms its on-chain lane. */
  onStream?: (
    vaultId: string,
    side: 'yes' | 'no',
    rate: number,
    durationMinutes?: number,
  ) => void | Promise<unknown>
  /** Jump to the Streams tab to mint a position NFT (shown when the user has none for this market). */
  onGoToMint?: () => void
}) {
  const view = useVaultView(vault.vaultId)
  const reducedMotion = useReducedMotion()
  const hotUntil = vault.steward.hotUntilMs ?? null
  // Full-precision USDC pools from the board (A1); fall back to the rounded mock pools in mock mode.
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  // A1/S5: expanded + selected side + amount persist across the board's periodic refresh so a
  // mid-fund user is never collapsed back to step 0.
  const { expanded, setExpanded } = useVaultCardUi(vault.vaultId)
  const draft = useStreamDraft(vault.vaultId)
  const [hotMs, setHotMs] = useState(hotUntil ? Math.max(0, hotUntil - Date.now()) : 0)

  // Only the HOT window has a real on-chain deadline (steward hotUntil); tick it down while hot. There is
  // no vault expiry to count (see StatusBadge), so no expiry timer here.
  useEffect(() => {
    if (!hotUntil) return
    const tick = setInterval(() => setHotMs(Math.max(0, hotUntil - Date.now())), 500)
    return () => clearInterval(tick)
  }, [hotUntil])

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
  const noMultiplier =
    view.odds?.noMultiplier ?? (yesTotal > 0 ? (noTotal + yesTotal) / noTotal : 1)

  return (
    <motion.div
      id={`vault-${vault.vaultId}`}
      data-testid={`vault-card-${vault.vaultId}`}
      layout={!reducedMotion}
      initial={false}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(4px)' }}
      transition={{ duration: reducedMotion ? 0 : 0.18 }}
      className={`glass-card ${isHot ? 'card-hot' : ''} ${isWin ? 'card-win' : ''}`}
      style={{ marginBottom: 6, overflow: 'visible', ...cardStyle }}
    >
      {isWin && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 12,
            background:
              'linear-gradient(135deg, rgba(255,213,83,0.05) 0%, transparent 50%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      <div style={{ padding: '10px 14px', position: 'relative', zIndex: 1 }}>
        {/* Row 1: Question + Status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              className="display"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.88)',
                lineHeight: 1.35,
                marginBottom: 3,
                letterSpacing: '0.01em',
              }}
            >
              {vault.question}
            </p>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                {formatMinute(view.createdMinute ?? 0)} &middot; {vault.type}
              </span>
              {hasPos && canBet && (
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: view.userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78',
                    background:
                      view.userPosition!.side === 'yes'
                        ? 'rgba(0,255,135,0.1)'
                        : 'rgba(255,45,120,0.1)',
                    padding: '1px 5px',
                    borderRadius: 3,
                  }}
                >
                  {view.userPosition!.side.toUpperCase()} &middot;{' '}
                  {formatRate(view.userPosition!.rate)}
                </span>
              )}
            </div>
          </div>
          <StatusBadge vault={vault} view={view} hotMs={hotMs} />
        </div>

        {/* Row 2: YES / NO buttons */}
        {canBet && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <button
              data-testid={`fund-yes-${vault.vaultId}`}
              className="vault-bet-btn vault-bet-yes"
              onClick={() => {
                draft.setSide('yes')
                if (draft.rate < 0.01) draft.setRate(1)
                setExpanded(true)
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '7px 0',
                borderRadius: 7,
                border: '1px solid rgba(0,255,135,0.25)',
                background:
                  hasPos && view.userPosition?.side === 'yes'
                    ? 'rgba(0,255,135,0.15)'
                    : 'rgba(0,255,135,0.06)',
                cursor: 'pointer',
                opacity: 1,
                transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.06em',
                  color: '#00ff87',
                }}
              >
                YES
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'rgba(0,255,135,0.6)',
                }}
              >
                +{formatMultiplier(yesMultiplier)}
              </span>
            </button>
            <button
              data-testid={`fund-no-${vault.vaultId}`}
              className="vault-bet-no"
              onClick={() => {
                draft.setSide('no')
                if (draft.rate < 0.01) draft.setRate(1)
                setExpanded(true)
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '7px 0',
                borderRadius: 7,
                border: '1px solid rgba(255,45,120,0.25)',
                background:
                  hasPos && view.userPosition?.side === 'no'
                    ? 'rgba(255,45,120,0.15)'
                    : 'rgba(255,45,120,0.06)',
                cursor: 'pointer',
                opacity: 1,
                transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.06em',
                  color: '#ff2d78',
                }}
              >
                NO
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'rgba(255,45,120,0.6)',
                }}
              >
                +{formatMultiplier(noMultiplier)}
              </span>
            </button>
          </div>
        )}

        {/* Row 3: Pool bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: canBet ? 4 : 8,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, color: '#ff2d78', minWidth: 28, textAlign: 'right' }}
          >
            {formatUSDC(noTotal)}
          </span>
          <div
            style={{
              flex: 1,
              height: 2,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: '100%',
                background: 'linear-gradient(90deg, rgba(255,45,120,0.0) 0%, #00ff87 100%)',
                transform: `scaleX(${poolPct})`,
                transformOrigin: 'left',
                transition: 'transform 0.25s cubic-bezier(0.23, 1, 0.32, 1)',
              }}
            />
          </div>
          <span className="mono" style={{ fontSize: 10, color: '#00ff87', minWidth: 28 }}>
            {formatUSDC(yesTotal)}
          </span>
        </div>

        {(isResolved || vault.status === 'disputed') && <ResolutionResult vault={vault} />}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            width: '100%',
            marginTop: 2,
            padding: '3px 0 0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.18)',
            fontSize: 10,
          }}
        >
          <span>{expanded ? 'collapse' : 'details'}</span>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
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
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: reducedMotion ? 0 : 0.18 },
            }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                borderTop: '1px solid rgba(255,255,255,0.06)',
                padding: '12px 14px',
              }}
            >
              {canBet && !fundingFocused && (
                <FundingComposer vault={vault} draft={draft} onStream={onStream} />
              )}
              <ExpandedDetails vault={vault} poolPct={poolPct} view={view} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StatusBadge({
  vault,
  view,
  hotMs,
}: {
  vault: OptionsVault
  view: VaultView
  hotMs: number
}) {
  if (vault.status === 'hot')
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div
          className="broadcast-corners broadcast-corners-pink"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            background: 'rgba(255,45,120,0.12)',
            border: '1px solid rgba(255,45,120,0.35)',
            borderRadius: 5,
            padding: '2px 8px',
            overflow: 'visible',
          }}
        >
          <Fire size={10} color="#ff2d78" />
          <span
            className="display"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#ff2d78',
              letterSpacing: '0.06em',
            }}
          >
            {severityLabel(view.severity)}
          </span>
        </div>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: '#ff7a00',
            textShadow: '0 0 8px rgba(255,122,0,0.3)',
          }}
        >
          {formatCountdown(hotMs)}
        </span>
      </div>
    )
  if (vault.status === 'resolved') {
    if (view.userWon === true)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <CheckCircle size={12} color="#ffd553" weight="fill" />
          <span
            className="mono"
            style={{ fontSize: 10, fontWeight: 700, color: '#ffd553' }}
          >
            WON
          </span>
        </div>
      )
    if (view.userWon === false)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <XCircle size={12} color="rgba(255,255,255,0.25)" />
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
            RESOLVED
          </span>
        </div>
      )
    return (
      <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
        RESOLVED
      </span>
    )
  }
  // No expiry countdown: the vault contract stores no deadline (createVault takes none, VaultData has
  // only resolvedAt), so any "expires in" timer was fabricated from a 0 timestamp. A vault stays OPEN
  // until the steward resolves it.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        background: 'rgba(0,255,135,0.06)',
        border: '1px solid rgba(0,255,135,0.18)',
        borderRadius: 5,
        padding: '2px 6px',
      }}
    >
      <div
        className="live-dot"
        style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff87' }}
      />
      <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: '#00ff87' }}>
        OPEN
      </span>
    </div>
  )
}

function ExpandedDetails({
  vault,
  poolPct,
  view,
}: {
  vault: OptionsVault
  poolPct: number
  view: VaultView
}) {
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const total = view.poolTotal ?? noTotal + yesTotal
  // A2: authoritative odds; recompute only as mock-mode fallback.
  const yesOdds =
    view.odds?.yesMultiplier ?? (yesTotal > 0 ? (noTotal + yesTotal) / yesTotal : 0)
  const noOdds =
    view.odds?.noMultiplier ?? (noTotal > 0 ? (noTotal + yesTotal) / noTotal : 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Mini label="Total pool" value={formatUSDC(total)} />
        <Mini label="YES odds" value={`${yesOdds.toFixed(2)}x`} accent="#00ff87" />
        <Mini label="NO odds" value={`${noOdds.toFixed(2)}x`} accent="#ff2d78" />
      </div>
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 4,
            fontSize: 10,
            color: 'rgba(255,255,255,0.25)',
          }}
        >
          <span>NO {(100 - poolPct * 100).toFixed(0)}%</span>
          <span>YES {(poolPct * 100).toFixed(0)}%</span>
        </div>
        <div
          style={{
            height: 4,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', height: '100%' }}>
            <div
              style={{
                width: `${(1 - poolPct) * 100}%`,
                background: '#ff2d78',
                opacity: 0.6,
              }}
            />
            <div
              style={{ width: `${poolPct * 100}%`, background: '#00ff87', opacity: 0.6 }}
            />
          </div>
        </div>
      </div>
      {view.userPosition && (
        <div
          style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 7,
            padding: '8px 10px',
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.25)',
              marginBottom: 6,
              letterSpacing: '0.06em',
            }}
          >
            YOUR POSITION
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <Mini
              label="Side"
              value={view.userPosition.side.toUpperCase()}
              accent={view.userPosition.side === 'yes' ? '#00ff87' : '#ff2d78'}
            />
            <Mini label="Rate" value={formatRate(view.userPosition.rate)} />
            <Mini label="Shares" value={formatShares(view.userPosition.shares)} />
          </div>
        </div>
      )}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={10} color="rgba(255,255,255,0.2)" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
            {vault.vaultId}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <TrendUp size={10} color="rgba(255,255,255,0.2)" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
            {vault.timing.createdAtMs > 0
              ? new Date(vault.timing.createdAtMs).toLocaleTimeString()
              : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

// "Tush" redirect CTA shown when the user has no position NFT: an inviting outlined gradient that points
// to the Streams tab to mint, distinct from the solid fund button so it doesn't read as "commit now".

function severityLabel(severity?: number): string {
  if (severity === 0) return 'WARM'
  if (severity === 2) return 'CRITICAL'
  return 'HOT'
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: 'rgba(255,255,255,0.25)',
          marginBottom: 2,
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 12, fontWeight: 600, color: accent ?? 'rgba(255,255,255,0.75)' }}
      >
        {value}
      </div>
    </div>
  )
}
