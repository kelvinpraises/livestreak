import { useHostContext } from '#/providers/host-provider'

/** Dev control: switch host edge between live fetch and injectable demo JSON. */
export function DemoEdgeToggle() {
  const { demoEdge, setDemoEdge, error } = useHostContext()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={() => setDemoEdge(!demoEdge)}
        title="Use demo host-edge JSON instead of live host /catalog"
        style={{
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.06em',
          padding: '3px 8px',
          borderRadius: 4,
          border: `1px solid ${demoEdge ? 'rgba(255,213,83,0.4)' : 'rgba(255,255,255,0.12)'}`,
          background: demoEdge ? 'rgba(255,213,83,0.1)' : 'rgba(255,255,255,0.04)',
          color: demoEdge ? '#ffd553' : 'rgba(255,255,255,0.45)',
          cursor: 'pointer',
        }}
      >
        DEMO EDGE {demoEdge ? 'ON' : 'OFF'}
      </button>
      {error && !demoEdge && (
        <span style={{ fontSize: 9, color: '#ff7a00', fontFamily: 'var(--font-mono)' }} title={error}>
          host ↓
        </span>
      )}
    </div>
  )
}
