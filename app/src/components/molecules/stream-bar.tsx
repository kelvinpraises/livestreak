import { useEffect, useState } from 'react'
import { formatUSDCFull } from '#/utils/format'
import type { WSFrame } from '#/utils/mock'

interface Props {
  frame: WSFrame
  streamTitle: string
  totalPooled: number
}

export function StreamBar({ frame, streamTitle, totalPooled }: Props) {
  const [minute, setMinute] = useState(frame.min)
  useEffect(() => { setMinute(frame.min) }, [frame.min])

  return (
    <header className="scan-line" style={{
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
        <span className="live-dot" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#ff2d78', boxShadow: '0 0 12px #ff2d78' }} />
        <span className="display" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: '#ff2d78' }}>LIVE</span>
      </div>
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />

      {/* Stream title + elapsed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
        <span className="display" style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>{streamTitle}</span>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00ff87' }}>{minute}'</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>elapsed</span>
        </div>
      </div>

      {/* Pooled total */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em' }}>POOLED</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }}>{formatUSDCFull(totalPooled)}</span>
      </div>
    </header>
  )
}
