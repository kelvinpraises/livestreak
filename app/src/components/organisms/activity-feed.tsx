import { type ElementType } from 'react'
import { motion } from 'framer-motion'
import { Warning, Stack, Lightning, Fire, CheckCircle, Trophy, Broadcast } from '@phosphor-icons/react'
import type { WSEvent } from '#/utils/mock'

const META: Record<string, { icon: ElementType; color: string; label: string }> = {
  alert: { icon: Warning, color: '#ffd553', label: 'ALERT' },
  vault_created: { icon: Stack, color: '#00ff87', label: 'NEW VAULT' },
  stream_surge: { icon: Lightning, color: '#00c8ff', label: 'SURGE' },
  hot_period: { icon: Fire, color: '#ff2d78', label: 'HOT' },
  resolved: { icon: CheckCircle, color: '#00ff87', label: 'RESOLVED' },
  milestone: { icon: Trophy, color: '#ffd553', label: 'MILESTONE' },
  system: { icon: Broadcast, color: 'rgba(255,255,255,0.4)', label: 'SYSTEM' },
}

export function ActivityFeed({ events }: { events: WSEvent[] }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 8px' }}>
      {events.map((e, i) => <EventRow key={e.id} event={e} index={i} />)}
      {events.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 10 }}>
          <Broadcast size={24} color="rgba(255,255,255,0.1)" />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>Waiting for events...</span>
        </div>
      )}
    </div>
  )
}

function EventRow({ event, index }: { event: WSEvent; index: number }) {
  const meta = META[event.t] ?? META['system']!
  const Icon = meta.icon
  const isHighlight = event.t === 'alert' || event.t === 'resolved'

  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateX(-12px)' }}
      animate={{ opacity: 1, transform: 'translateX(0px)' }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      style={{
        display: 'flex', gap: 12, padding: '10px 10px', borderRadius: 8, marginBottom: 4,
        background: isHighlight ? 'rgba(255,213,83,0.04)' : 'transparent',
        border: isHighlight ? '1px solid rgba(255,213,83,0.1)' : '1px solid transparent',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {isHighlight && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(255,213,83,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
      )}
      <div style={{ flexShrink: 0, width: 30, paddingTop: 2, textAlign: 'right' }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: isHighlight ? '#ffd553' : 'rgba(255,255,255,0.3)' }}>{event.min}'</span>
      </div>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
        background: `${meta.color}18`, border: `1px solid ${meta.color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
      }}>
        <Icon size={13} color={meta.color} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span className="display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: meta.color }}>{meta.label}</span>
        </div>
        <p style={{ fontSize: 12, color: isHighlight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)', lineHeight: 1.4, fontWeight: isHighlight ? 500 : 400 }}>{event.desc}</p>
      </div>
    </motion.div>
  )
}
