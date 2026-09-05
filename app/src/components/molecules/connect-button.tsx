import { useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { Wallet, CaretDown, SignOut, Copy, Check, X, SpinnerGap, Warning } from '@phosphor-icons/react'
import { useWalletContext } from '#/providers/wallet-provider.tsx'
import { formatUSDCFull } from '#/utils/format.ts'

const iconSwap = {
  initial: { opacity: 0, scale: 0.8, filter: 'blur(4px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.8, filter: 'blur(4px)' },
  transition: { duration: 0.15 },
}

export function ConnectButton() {
  const {
    address,
    isConnected,
    isLoading,
    error,
    legacyWallet,
    connect,
    disconnect,
  } = useWalletContext()

  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [copied, setCopied] = useState(false)

  function copyAddress() {
    if (address) {
      navigator.clipboard.writeText(address).catch(() => null)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openModal() {
    setPassword('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setPassword('')
  }

  async function handleConnect() {
    if (!password.trim()) return
    try {
      await connect(password.trim())
      closeModal()
    } catch {
      // Error is set in the hook — shown in modal
    }
  }

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : ''

  /* ─── Not connected: show connect button + dialog ─── */
  if (!isConnected) {
    return (
      <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
        <Dialog.Trigger asChild>
          <button
            onClick={openModal}
            disabled={isLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(0,255,135,0.1)',
              border: '1px solid rgba(0,255,135,0.3)',
              borderRadius: 8, padding: '8px 14px', cursor: isLoading ? 'wait' : 'pointer',
              color: '#00ff87', fontSize: 13, fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              opacity: isLoading ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {isLoading ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                <SpinnerGap size={14} />
              </motion.div>
            ) : (
              <Wallet size={14} />
            )}
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Overlay
            className="wallet-dialog-overlay"
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(4px)',
              zIndex: 200,
            }}
          />
          <Dialog.Content
            className="wallet-dialog-content"
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 201, background: '#0d0d1c',
              border: '1px solid rgba(0,255,135,0.2)',
              borderRadius: 16, padding: 28, width: 380, maxWidth: 'calc(100vw - 2rem)',
              boxShadow: '0 0 60px rgba(0,255,135,0.08), 0 24px 80px rgba(0,0,0,0.8)',
            }}
          >
            <Dialog.Close asChild>
              <button
                style={{
                  position: 'absolute', top: 16, right: 16,
                  background: 'none', border: 'none',
                  cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 4,
                }}
              >
                <X size={16} />
              </button>
            </Dialog.Close>

            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: 'rgba(0,255,135,0.1)',
              border: '1px solid rgba(0,255,135,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}>
              <Wallet size={22} color="#00ff87" />
            </div>

            <Dialog.Title className="display" style={{
              fontSize: 20, fontWeight: 700, marginBottom: 10,
              color: '#fff', letterSpacing: '0.02em',
            }}>
              Connect Wallet
            </Dialog.Title>
            <Dialog.Description style={{
              fontSize: 14, color: 'rgba(255,255,255,0.5)',
              lineHeight: 1.6, marginBottom: 20,
            }}>
              Your wallet is derived deterministically from a password — same password, same wallet. Testnet only — this is not secure key management.
            </Dialog.Description>

            {error && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                background: 'rgba(255,45,120,0.08)',
                border: '1px solid rgba(255,45,120,0.2)',
                borderRadius: 8, padding: '10px 12px',
                marginBottom: 16,
              }}>
                <Warning size={14} color="#ff2d78" style={{ marginTop: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#ff2d78', lineHeight: 1.4 }}>{error}</span>
              </div>
            )}

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConnect() }}
              autoFocus
              style={{
                width: '100%', padding: '12px 14px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, fontSize: 14,
                color: '#fff', fontFamily: 'var(--font-sans)',
                outline: 'none', marginBottom: 16,
                transition: 'border-color 0.15s',
                boxSizing: 'border-box',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(0,255,135,0.4)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
            />

            <button
              onClick={handleConnect}
              disabled={isLoading || !password.trim()}
              className="btn-primary"
              style={{
                width: '100%', padding: '12px 0', fontSize: 13,
                borderRadius: 8, fontWeight: 600,
                opacity: isLoading || !password.trim() ? 0.5 : 1,
                cursor: isLoading || !password.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {isLoading ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                    <SpinnerGap size={14} />
                  </motion.div>
                  Deriving...
                </>
              ) : (
                'Continue'
              )}
            </button>

            <p style={{
              fontSize: 11, color: 'rgba(255,255,255,0.2)',
              textAlign: 'center', marginTop: 16,
            }}>
              Gasless &middot; testnet
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  /* ─── Connected: show address + balance + menu ─── */
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setMenuOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
          color: 'rgba(255,255,255,0.85)', fontSize: 13,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: '#00ff87', boxShadow: '0 0 6px #00ff87',
        }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500 }}>
          {truncatedAddress}
        </span>
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
        <span className="mono" style={{ fontSize: 12, color: '#00c8ff' }}>
          {formatUSDCFull(legacyWallet.usdcBalance)}
        </span>
        <CaretDown size={12} color="rgba(255,255,255,0.35)" />
      </button>

      <AnimatePresence>
        {menuOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, transform: 'translateY(-8px) scale(0.96)' }}
              animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
              exit={{ opacity: 0, transform: 'translateY(-6px) scale(0.97)' }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                background: '#12122a',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, padding: 6, minWidth: 200,
                zIndex: 50,
                boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                transformOrigin: 'top right',
              }}
            >
              <MenuItem onClick={copyAddress}>
                <AnimatePresence mode="wait" initial={false}>
                  {copied ? (
                    <motion.span key="check" {...iconSwap} style={{ display: 'flex' }}>
                      <Check size={13} color="#00ff87" />
                    </motion.span>
                  ) : (
                    <motion.span key="copy" {...iconSwap} style={{ display: 'flex' }}>
                      <Copy size={13} />
                    </motion.span>
                  )}
                </AnimatePresence>
                {copied ? 'Copied!' : 'Copy address'}
              </MenuItem>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
              <MenuItem
                onClick={() => {
                  disconnect()
                  setMenuOpen(false)
                }}
                danger
              >
                <SignOut size={13} />Disconnect
              </MenuItem>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ onClick, children, danger }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '8px 10px',
        background: 'none', border: 'none', borderRadius: 6,
        cursor: 'pointer', fontSize: 13,
        color: danger ? '#ff2d78' : 'rgba(255,255,255,0.7)',
        fontFamily: 'var(--font-sans)', textAlign: 'left',
        transition: 'background 0.12s cubic-bezier(0.23, 1, 0.32, 1)',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {children}
    </button>
  )
}
