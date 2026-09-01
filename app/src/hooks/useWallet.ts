import { useState } from 'react'
import { mockWallet, type WalletState } from '#/data/mock'

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>(mockWallet)
  const [showSessionKey, setShowSessionKey] = useState(false)

  function connect() {
    setWallet(prev => ({ ...prev, connected: true }))
    if (!wallet.sessionKeySigned) setTimeout(() => setShowSessionKey(true), 400)
  }
  function disconnect() { setWallet(prev => ({ ...prev, connected: false })) }
  function signSessionKey() { setWallet(prev => ({ ...prev, sessionKeySigned: true })); setShowSessionKey(false) }
  function dismissSessionKey() { setShowSessionKey(false) }

  return { wallet, connect, disconnect, showSessionKey, signSessionKey, dismissSessionKey }
}
