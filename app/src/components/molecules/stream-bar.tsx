import { ScoreUSD } from '#/components/atoms/score-usd'

interface Props {
  streamTitle: string
  totalPooled: number
  totalPooledRatePerSec?: number
  verified?: boolean
  status?: 'live' | 'ended' | 'offline' | 'stale' | 'loading' | 'unavailable'
}

export function StreamBar({ streamTitle, totalPooled, totalPooledRatePerSec, verified = false, status = 'unavailable' }: Props) {

  return (
    <header className="scan-line stream-summary" style={{
      background: 'linear-gradient(90deg, rgba(0,255,135,0.04) 0%, rgba(13,13,28,0.98) 20%, rgba(13,13,28,0.98) 80%, rgba(0,200,255,0.04) 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.07)',
      padding: '0 20px',
      height: 52,
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      position: 'relative',
      overflow: 'visible',
      flexShrink: 0,
    }}>
      {/* LIVE indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={status === 'live' ? 'live-dot' : undefined} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: status === 'live' ? '#ff2d78' : 'rgba(255,255,255,0.4)', boxShadow: status === 'live' ? '0 0 12px #ff2d78' : undefined }} />
        <span className="display" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: status === 'live' ? '#ff2d78' : 'rgba(255,255,255,0.6)' }}>{status.toUpperCase()}</span>
      </div>
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />

      {/* Stream title + elapsed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
        <span className="display" style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>{streamTitle}</span>

      </div>

      {/* Pooled total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>POOLED</span>
        {verified ? <ScoreUSD value={totalPooled} ratePerSec={totalPooledRatePerSec} className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }} /> : <span className="mono">—</span>}
      </div>
    </header>
  )
}
