import { motion, AnimatePresence } from 'framer-motion'
import { Key, Shield, X } from '@phosphor-icons/react'

interface Props { visible: boolean; onSign: () => void; onDismiss: () => void }

export function SessionKey({ visible, onSign, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onDismiss} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200 }} />
          <motion.div initial={{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.95)', filter: 'blur(4px)' }} animate={{ opacity: 1, transform: 'translate(-50%, -50%) scale(1)', filter: 'blur(0px)' }} exit={{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.97)', filter: 'blur(2px)', transition: { duration: 0.15 } }} transition={{ type: 'spring', stiffness: 350, damping: 28 }}
            className="broadcast-corners"
            style={{ position: 'fixed', top: '50%', left: '50%', zIndex: 201, background: '#0d0d1c', border: '1px solid rgba(0,255,135,0.2)', borderRadius: 16, padding: 28, width: 360, boxShadow: '0 0 60px rgba(0,255,135,0.08), 0 24px 80px rgba(0,0,0,0.8)', overflow: 'visible' }}>
            <button onClick={onDismiss} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 4 }}><X size={16} /></button>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(0,255,135,0.1)', border: '1px solid rgba(0,255,135,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <Key size={22} color="#00ff87" />
            </div>
            <h2 className="display" style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, color: '#fff', letterSpacing: '0.02em' }}>Approve Session Key</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 20 }}>Sign once to enable seamless streaming. No more wallet popups — your session key handles transactions automatically.</p>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              {['Stream USDC to prediction vaults', 'Collect winnings automatically', 'Expires after this session'].map(item => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}><Shield size={12} color="#00ff87" />{item}</div>
              ))}
            </div>
            <button onClick={onSign} className="btn-primary" style={{ width: '100%', padding: '13px 0', fontSize: 14, borderRadius: 10 }}>Sign Session Key</button>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 12 }}>This signature does not cost gas</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
