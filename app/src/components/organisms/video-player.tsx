import { useEffect, useRef } from 'react'

import type { StreamMedia } from '#/utils/stream'

interface Props {
  streamTitle?: string
  /** Resolved player media: mode + source, derived from the on-chain stream status (A4). */
  media?: StreamMedia
  /** True once the host stream lookup has settled; while false we show a loading state. */
  ready?: boolean
}

const POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Crect fill='%23000'/%3E%3C/svg%3E"

export function VideoPlayer({ streamTitle, media, ready = true }: Props) {
  const kind = media?.kind ?? 'none'
  const src = media?.src
  const stream = media?.stream
  const isLive = kind === 'live'
  const isVod = kind === 'vod'
  const videoRef = useRef<HTMLVideoElement>(null)

  // A live WebRTC feed arrives as a MediaStream — attach it via `srcObject` (it cannot be set as an
  // attribute). Clearing on absence lets the src/poster path take over for VOD/offline.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (stream) {
      if (video.srcObject !== stream) video.srcObject = stream
      void video.play().catch(() => undefined)
    } else if (video.srcObject) {
      video.srcObject = null
    }
  }, [stream])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      <video
        ref={videoRef}
        key={stream ? 'live-stream' : (src ?? 'offline')}
        src={stream ? undefined : src}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
        muted autoPlay loop playsInline
        controls={isVod}
        poster={POSTER}
      />

      {/* Broadcast vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 70%, rgba(0,0,0,0.45) 100%)',
        pointerEvents: 'none',
      }} />

      {/* CRT scan lines */}
      <div className="crt-lines" />

      {/* Status badge + stream title — driven off the on-chain stream status, not just a title */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <StatusBadge ready={ready} isLive={isLive} isVod={isVod} />
        {streamTitle && (
          <div style={{
            background: 'rgba(0,0,0,0.5)',
            borderRadius: 6, padding: '5px 12px',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>{streamTitle}</span>
          </div>
        )}
      </div>

      {/* Offline placeholder copy */}
      {ready && kind === 'none' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span className="mono" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
            STREAM OFFLINE
          </span>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ ready, isLive, isVod }: { ready: boolean; isLive: boolean; isVod: boolean }) {
  if (!ready) {
    return (
      <Badge color="rgba(255,255,255,0.45)" border="rgba(255,255,255,0.15)" label="…" />
    )
  }
  if (isLive) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '5px 12px',
        backdropFilter: 'blur(8px)', border: '1px solid rgba(255,45,120,0.3)',
      }}>
        <div className="live-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2d78', boxShadow: '0 0 8px #ff2d78' }} />
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: '#ff2d78', letterSpacing: '0.12em' }}>LIVE</span>
      </div>
    )
  }
  if (isVod) {
    return <Badge color="#ffd553" border="rgba(255,213,83,0.3)" label="REPLAY" />
  }
  return <Badge color="rgba(255,255,255,0.4)" border="rgba(255,255,255,0.12)" label="OFFLINE" />
}

function Badge({ color, border, label }: { color: string; border: string; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(0,0,0,0.6)', borderRadius: 6, padding: '5px 12px',
      backdropFilter: 'blur(8px)', border: `1px solid ${border}`,
    }}>
      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.12em' }}>{label}</span>
    </div>
  )
}
