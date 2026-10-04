import { createFileRoute } from '@tanstack/react-router'
import { Broadcast } from '@phosphor-icons/react'
import { useHomepageData } from '#/hooks/use-homepage-data'
import { IndexingStatus } from '#/components/molecules/indexing-status'
import { StreamCard } from '#/components/organisms/homepage'

export const Route = createFileRoute('/streams')({ component: StreamsPage })

function StreamsPage() {
  const { streams, ready, error, indexing } = useHomepageData()
  return (
    <main style={{ overflowY: 'auto', height: 'calc(100vh - 56px)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <Broadcast size={24} color="#00ff87" aria-hidden="true" />
          <h1 className="display" style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>Streams</h1>
        </div>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 28, maxWidth: 480 }}>Every broadcast, live and past, across the platform.</p>
        {ready && !error && <IndexingStatus indexing={indexing} />}
        {!ready && <p role="status" style={{ color: 'rgba(255,255,255,0.5)' }}>Loading streams…</p>}
        {error && <p role="alert" style={{ color: '#ffd553' }}>Stream catalog unavailable. Retrying…</p>}
        {ready && !error && streams.length === 0 && <p style={{ color: 'rgba(255,255,255,0.5)' }}>No streams yet.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 14 }}>
          {streams.map((stream, index) => <StreamCard key={`${stream.chain}:${stream.id}`} stream={stream} index={index} entranceDelay={0} />)}
        </div>
      </div>
    </main>
  )
}
