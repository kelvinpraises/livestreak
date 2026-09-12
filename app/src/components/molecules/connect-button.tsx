import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wallet, CaretDown, SignOut, Copy, Check, X, SpinnerGap, Warning } from '@phosphor-icons/react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '#/components/atoms/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/atoms/dropdown-menu'
import { useWalletContext } from '#/providers/wallet-provider.tsx'
import { useOptionsContext } from '#/providers/options-provider'
import { formatUSDCFull } from '#/utils/format.ts'
import { testOptionsSeed } from '#/utils/env'
import { ChainSelector } from '#/components/molecules/chain-selector'

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
  const { derivationStep } = useOptionsContext()

  const [modalOpen, setModalOpen] = useState(false)
  // Test-only: pre-fill from `VITE_OPTIONS_SEED` so the deterministic E2E wallet derives without
  // typing. Empty string in normal builds → unchanged manual-password flow.
  const [password, setPassword] = useState(testOptionsSeed() ?? '')
  const [copied, setCopied] = useState(false)

  function copyAddress() {
    if (address) {
      navigator.clipboard.writeText(address).catch(() => null)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openModal() {
    setPassword(testOptionsSeed() ?? '')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setPassword(testOptionsSeed() ?? '')
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

  /* ─── Not connected: connect button + canonical Dialog atom ─── */
  if (!isConnected) {
    return (
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogTrigger asChild>
          <button
            data-testid="connect-wallet"
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
        </DialogTrigger>

        {/* Canonical DialogContent renders its own Radix overlay (dimmed via the
            [data-slot=dialog-overlay] rule in styles.css to our blur look). We
            keep our own phosphor close button, so showCloseButton is off. The
            inline styles below pin the panel to the exact previous look. */}
        <DialogContent
          showCloseButton={false}
          className="wallet-dialog-content"
          style={{
            display: 'block',
            zIndex: 201, background: '#0d0d1c',
            border: '1px solid rgba(0,255,135,0.2)',
            borderRadius: 16, padding: 28, width: 380, maxWidth: 'calc(100vw - 2rem)',
            boxShadow: '0 0 60px rgba(0,255,135,0.08), 0 24px 80px rgba(0,0,0,0.8)',
          }}
        >
          <DialogClose asChild>
            <button
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'none', border: 'none',
                cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 4,
              }}
            >
              <X size={16} />
            </button>
          </DialogClose>

          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'rgba(0,255,135,0.1)',
            border: '1px solid rgba(0,255,135,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 20,
          }}>
            <Wallet size={22} color="#00ff87" />
          </div>

          <DialogTitle className="display" style={{
            fontSize: 20, fontWeight: 700, marginBottom: 10,
            color: '#fff', letterSpacing: '0.02em',
          }}>
            Connect Wallet
          </DialogTitle>
          <DialogDescription style={{
            fontSize: 14, color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.6, marginBottom: 20,
          }}>
            Your wallet is derived deterministically from a password — same password, same wallet. Testnet only — this is not secure key management.
          </DialogDescription>

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

          {/* Pick the chain BEFORE connecting — selecting a pill sets chainRef so `connect` derives the
              right (EVM Safe vs Sui) address from the same password. Disabled mid-derivation. */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 600, marginBottom: 8 }}>
              Network
            </div>
            <ChainSelector />
          </div>

          <input
            data-testid="connect-password"
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
            data-testid="connect-submit"
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
                <span data-testid="connect-progress">{derivationStep ?? 'Deriving…'}</span>
              </>
            ) : (
              'Continue'
            )}
          </button>
          {isLoading && derivationStep && (
            <p data-testid="connect-progress-detail" style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
              {derivationStep}
              <br />
              <span style={{ color: 'rgba(255,255,255,0.25)' }}>First connect derives your smart-account address — later reconnects are instant.</span>
            </p>
          )}

          <p style={{
            fontSize: 11, color: 'rgba(255,255,255,0.2)',
            textAlign: 'center', marginTop: 16,
          }}>
            Gasless &middot; testnet
          </p>
        </DialogContent>
      </Dialog>
    )
  }

  /* ─── Connected: address + balance trigger → canonical DropdownMenu ───
     Replaces the hand-rolled menu + fixed-div backdrop. Radix gives robust
     dismiss (outside-click + Escape + focus management) for free, fixing the
     reported wallet-menu bug. Trigger look is unchanged; content is richer. */
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="wallet-menu"
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
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        style={{
          background: '#12122a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: 6, minWidth: 240,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Full address + active chain */}
        <DropdownMenuLabel style={{ padding: '6px 10px' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 600, marginBottom: 4 }}>
            Wallet
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.85)', wordBreak: 'break-all', lineHeight: 1.5, fontWeight: 400 }}>
            {address}
          </div>
        </DropdownMenuLabel>

        {/* USDC balance + active chain */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Balance</span>
          <span className="mono" style={{ fontSize: 12, color: '#00c8ff', fontWeight: 600 }}>
            {formatUSDCFull(legacyWallet.usdcBalance)}
          </span>
        </div>
        {/* Switchable post-connect: re-derives this chain's wallet from the same seed (no re-login). */}
        <div data-testid="wallet-chain" style={{ padding: '6px 10px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>Network</div>
          <ChainSelector />
        </div>

        <DropdownMenuSeparator style={{ background: 'rgba(255,255,255,0.06)' }} />

        <DropdownMenuItem
          data-testid="wallet-copy"
          onSelect={e => { e.preventDefault(); copyAddress() }}
          style={{ padding: '8px 10px', fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-sans)' }}
        >
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
        </DropdownMenuItem>

        <DropdownMenuSeparator style={{ background: 'rgba(255,255,255,0.06)' }} />

        <DropdownMenuItem
          data-testid="wallet-disconnect"
          variant="destructive"
          onSelect={() => disconnect()}
          style={{ padding: '8px 10px', fontSize: 13, color: '#ff2d78', fontFamily: 'var(--font-sans)' }}
        >
          <SignOut size={13} />Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
