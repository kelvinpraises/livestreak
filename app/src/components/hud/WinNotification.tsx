import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, TrendUp } from '@phosphor-icons/react'

interface WinToast { id: string; type: 'win' | 'loss'; amount?: number; flowReceived?: number; option: string }
interface Props { notifications: WinToast[]; onDismiss: (id: string) => void }

export function WinNotification({ notifications, onDismiss }: Props) {
  return (
    <div style={{ position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none', width: '100%', maxWidth: 420 }}>
      <AnimatePresence mode="popLayout">
        {notifications.map(n => <Toast key={n.id} toast={n} onDismiss={() => onDismiss(n.id)} />)}
      </AnimatePresence>
    </div>
  )
}

function Toast({ toast, onDismiss }: { toast: WinToast; onDismiss: () => void }) {
  useEffect(() => { const t = setTimeout(onDismiss, 5000); return () => clearTimeout(t) }, [onDismiss])
  const isWin = toast.type === 'win'
  return (
    <motion.div
      initial={{ transform: 'translateY(-60px) scale(0.95)', opacity: 0, filter: 'blur(6px)' }}
      animate={{ transform: 'translateY(0px) scale(1)', opacity: 1, filter: 'blur(0px)' }}
      exit={{ transform: 'translateY(-40px) scale(0.97)', opacity: 0, filter: 'blur(4px)' }}
      transition={{ type: 'spring', stiffness: 350, damping: 24, exit: { duration: 0.15 } }}
      onClick={onDismiss}
      className=""
      style={{
        pointerEvents: 'auto', cursor: 'pointer',
        background: isWin
          ? 'linear-gradient(135deg, rgba(255,213,83,0.14) 0%, rgba(13,13,28,0.97) 60%)'
          : 'linear-gradient(135deg, rgba(0,200,255,0.08) 0%, rgba(13,13,28,0.97) 60%)',
        border: `1px solid ${isWin ? 'rgba(255,213,83,0.4)' : 'rgba(0,200,255,0.25)'}`,
        borderRadius: 12, padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 14,
        backdropFilter: 'blur(20px)',
        boxShadow: isWin
          ? '0 4px 40px rgba(255,213,83,0.2), 0 0 80px rgba(255,213,83,0.06)'
          : '0 4px 30px rgba(0,200,255,0.1)',
        minWidth: 340, overflow: 'visible',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: isWin ? 'rgba(255,213,83,0.15)' : 'rgba(0,200,255,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        boxShadow: isWin ? '0 0 20px rgba(255,213,83,0.15)' : 'none',
      }}>
        {isWin ? <CheckCircle size={18} color="#ffd553" weight="fill" /> : <TrendUp size={18} color="#00c8ff" />}
      </div>
      <div style={{ flex: 1 }}>
        {isWin ? (
          <>
            <div className="text-shimmer display" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2, letterSpacing: '0.02em' }}>You won ${toast.amount?.toFixed(2)}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{toast.option}</div>
          </>
        ) : (
          <>
            <div className="display" style={{ fontSize: 15, fontWeight: 600, color: '#00c8ff', letterSpacing: '0.02em' }}>You received {toast.flowReceived?.toLocaleString()} $FLOW</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>Losers become owners — stake to earn</div>
          </>
        )}
      </div>
    </motion.div>
  )
}

export function useWinNotifications() {
  const [notifications, setNotifications] = useState<WinToast[]>([])
  function push(toast: Omit<WinToast, 'id'>) {
    const id = Math.random().toString(36).slice(2)
    setNotifications(prev => [...prev, { ...toast, id }])
  }
  function dismiss(id: string) { setNotifications(prev => prev.filter(n => n.id !== id)) }
  return { notifications, push, dismiss }
}
