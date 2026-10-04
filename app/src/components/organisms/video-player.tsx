import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

import type { StreamMedia } from '#/utils/stream'
import { useLiveStreamFeed } from '#/hooks/use-live-stream-feed'

interface Props {
  /** Resolved player media: mode + source, derived from the on-chain stream status (A4). */
  media?: StreamMedia
  /** True once the host stream lookup has settled; while false we show a loading state. */
  ready?: boolean
}

const POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Crect fill='%23000'/%3E%3C/svg%3E"

export function VideoPlayer({ media, ready = true }: Props) {
  const kind = media?.kind ?? 'none'
  const src = media?.src
  const stream = media?.stream
  const live = media?.live
  const isLive = kind === 'live'
  const isVod = kind === 'vod'
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playbackError, setPlaybackError] = useState(false)
  const [retry, setRetry] = useState(0)

  // Live fMP4 fan-out: when the media carries a `live` descriptor, open the MSE player against THIS video
  // element (init + fragments from the host viewer endpoint). Recording plays as a native <video src>. One
  // element, two source modes — the live-vs-recording split collapses here.
  useLiveStreamFeed({
    enabled: isLive && live !== undefined,
    baseUrl: live?.baseUrl ?? '',
    streamId: live?.streamId ?? '',
    videoRef,
  })

  // A live WebRTC feed (legacy) arrives as a MediaStream — attach it via `srcObject`. Clearing on absence
  // lets the src/poster path take over for VOD/offline. (MSE live sets `.src` itself via the player.)
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

  // The MSE player owns `.src` when live; only bind the `src` attribute for the recording/URL path so we
  // don't clobber the MediaSource object URL.
  useEffect(() => {
    const video = videoRef.current
    setPlaybackError(false)
    if (!video || media?.format !== 'hls' || !src) return
    if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = src; return () => { video.removeAttribute('src'); video.load() } }
    if (!Hls.isSupported()) { setPlaybackError(true); return }
    const hls = new Hls()
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setPlaybackError(true) })
    hls.loadSource(src); hls.attachMedia(video)
    return () => { hls.destroy() }
  }, [src, media?.format, retry])
  const attributeSrc = live || media?.format === 'hls' ? undefined : stream ? undefined : src

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {kind !== 'none' && <video
        ref={videoRef}
        key={live ? `live-mse:${live.streamId}` : stream ? 'live-stream' : (src ?? 'offline')}
        src={attributeSrc}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
        muted autoPlay loop={isLive} playsInline
        onError={() => { if (isVod) setPlaybackError(true) }}
        controls={isVod}
        poster={POSTER}
      />}

      {/* Broadcast vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 70%, rgba(0,0,0,0.45) 100%)',
        pointerEvents: 'none',
      }} />

      {/* CRT scan lines */}
      <div className="crt-lines" />

      {playbackError && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.6)' }}>
        <button type="button" onClick={() => { setPlaybackError(false); setRetry(value => value + 1); if (media?.format !== 'hls') videoRef.current?.load() }} style={{ color: '#fff', background: '#222', border: '1px solid #555', borderRadius: 6, padding: '10px 16px', cursor: 'pointer' }}>Replay unavailable · Retry</button>
      </div>}

      {!ready && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Loading stream…</div>}

      {/* Offline placeholder copy */}
      {ready && kind === 'none' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span className="mono" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>
            {media?.processing ? 'Recording processing' : media?.ended ? 'No recording available' : 'STREAM OFFLINE'}
          </span>
        </div>
      )}
    </div>
  )
}
