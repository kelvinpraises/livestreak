interface Props {
  streamTitle?: string
}

export function VideoPlayer({ streamTitle }: Props) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      <video
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
        muted autoPlay loop playsInline
        poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Crect fill='%23000'/%3E%3C/svg%3E"
      />

      {/* Broadcast vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.05) 70%, rgba(0,0,0,0.45) 100%)',
        pointerEvents: 'none',
      }} />

      {/* CRT scan lines */}
      <div className="crt-lines" />

      {/* LIVE badge + stream title */}
      {streamTitle && (
        <div style={{
          position: 'absolute', top: 16, left: 16,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 6, padding: '5px 12px',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,45,120,0.3)',
          }}>
            <div className="live-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2d78', boxShadow: '0 0 8px #ff2d78' }} />
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: '#ff2d78', letterSpacing: '0.12em' }}>LIVE</span>
          </div>
          <div style={{
            background: 'rgba(0,0,0,0.5)',
            borderRadius: 6, padding: '5px 12px',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>{streamTitle}</span>
          </div>
        </div>
      )}
    </div>
  )
}
